use std::path::Path;

use axum::{
    body::Body,
    extract::Request,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use percent_encoding::percent_decode_str;
use tower::ServiceExt;
use tower_http::services::ServeFile;

// SPA allowlist for Cshell user routes served from web/dist (independent UI).
// Historical Sub2API-era paths may remain listed so they still fall through to
// the SPA shell instead of the upstream; keep unused entries unless routing changes.
pub(crate) fn is_spa(path: &str) -> bool {
    // Browser navigation is case-insensitive for the user-facing route allowlist,
    // and a trailing slash should not turn a valid SPA route into an upstream hit.
    let normalized = if path.len() > 1 {
        path.trim_end_matches('/')
    } else {
        path
    };
    let route_key = normalized.to_ascii_lowercase();

    matches!(
        route_key.as_str(),
        "/" | "/home"
            | "/login"
            | "/register"
            | "/email-verify"
            | "/auth/callback"
            | "/auth/oauth/callback"
            | "/auth/linuxdo/callback"
            | "/auth/wechat/callback"
            | "/auth/wechat/payment/callback"
            | "/auth/dingtalk/callback"
            | "/auth/dingtalk/email-completion"
            | "/auth/oidc/callback"
            | "/forgot-password"
            | "/reset-password"
            | "/key-usage"
            | "/model-plaza"
            | "/dashboard"
            | "/keys"
            | "/batch-image"
            | "/docs/batch-image"
            | "/usage"
            | "/redeem"
            | "/affiliate"
            | "/available-channels"
            | "/settings/mcp"
            | "/oauth/mcp/authorize"
            | "/profile"
            | "/subscriptions"
            | "/purchase"
            | "/orders"
            | "/payment/qrcode"
            | "/payment/result"
            | "/payment/stripe"
            | "/payment/airwallex"
            | "/payment/stripe-popup"
            | "/monitor"
    ) || ["/legal/", "/custom/"]
        .iter()
        .any(|prefix| normalized.strip_prefix(prefix).is_some_and(safe_segment))
}

fn safe_segment(segment: &str) -> bool {
    percent_decode_str(segment).decode_utf8().is_ok_and(|part| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && !part.contains(['/', '\\', ':'])
            && !part.chars().any(char::is_control)
    })
}

pub(crate) async fn serve(dir: &Path, request: Request, path: &str, spa: bool) -> Response {
    let mut full = dir.to_owned();
    for segment in path.split('/') {
        if !safe_segment(segment) {
            return StatusCode::NOT_FOUND.into_response();
        }
        full.push(
            percent_decode_str(segment)
                .decode_utf8()
                .expect("validated segment")
                .as_ref(),
        );
    }
    let missing = if spa {
        StatusCode::SERVICE_UNAVAILABLE
    } else {
        StatusCode::NOT_FOUND
    };
    let Ok(root) = tokio::fs::canonicalize(dir).await else {
        return missing.into_response();
    };
    let Ok(full) = tokio::fs::canonicalize(full).await else {
        return missing.into_response();
    };
    if !full.starts_with(root) || !tokio::fs::metadata(&full).await.is_ok_and(|m| m.is_file()) {
        return missing.into_response();
    }
    let mut response = ServeFile::new(full)
        .oneshot(request)
        .await
        .expect("file service is infallible")
        .map(Body::new);
    if spa {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            "no-cache".parse().expect("static value"),
        );
    }
    response
}
