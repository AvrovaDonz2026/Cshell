mod config;
mod headers;
mod ui;

pub use config::{Config, ConfigError};

use std::{
    net::SocketAddr,
    time::{Duration, Instant},
};

use axum::{
    Router,
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::{Method, Response, StatusCode, Uri, Version, header},
    response::IntoResponse,
};
use hyper::upgrade::OnUpgrade;
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::{
    client::legacy::{Client, connect::HttpConnector},
    rt::{TokioExecutor, TokioIo, TokioTimer},
};
use tokio::io::copy_bidirectional;
use tokio_util::sync::CancellationToken;

use headers::{has_token, set_forwarding, set_websocket, strip_hop};

type BoxError = Box<dyn std::error::Error + Send + Sync>;

#[derive(Clone)]
struct TimedConnector {
    inner: HttpsConnector<HttpConnector>,
    timeout: Duration,
}

impl tower::Service<Uri> for TimedConnector {
    type Response = <HttpsConnector<HttpConnector> as tower::Service<Uri>>::Response;
    type Error = BoxError;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send>,
    >;

    fn poll_ready(
        &mut self,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, uri: Uri) -> Self::Future {
        let connect = self.inner.call(uri);
        let timeout = self.timeout;
        Box::pin(async move {
            tokio::time::timeout(timeout, connect)
                .await
                .map_err(|_| -> BoxError {
                    std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "upstream connection timed out",
                    )
                    .into()
                })?
        })
    }
}

type ProxyClient = Client<TimedConnector, Body>;

#[derive(Clone)]
struct App {
    config: Config,
    client: ProxyClient,
    shutdown: CancellationToken,
}

pub fn router(config: Config, shutdown: CancellationToken) -> Router {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut tcp = HttpConnector::new();
    tcp.enforce_http(false);
    let https = HttpsConnectorBuilder::new()
        .with_webpki_roots()
        .https_or_http()
        .enable_http1()
        .wrap_connector(tcp);
    let client = Client::builder(TokioExecutor::new())
        .pool_timer(TokioTimer::new())
        .pool_max_idle_per_host(32)
        .retry_canceled_requests(false)
        .build(TimedConnector {
            inner: https,
            timeout: config.connect_timeout,
        });
    Router::new().fallback(dispatch).with_state(App {
        config,
        client,
        shutdown,
    })
}

async fn dispatch(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
) -> Response<Body> {
    let started = Instant::now();
    let path = request.uri().path();
    let read_method = matches!(*request.method(), Method::GET | Method::HEAD);
    let ws = websocket_requested(&request);
    let (route, response) = match path {
        "/_cshell/health" if read_method => ("live", (StatusCode::OK, "ok\n").into_response()),
        "/_cshell/ready" if read_method => ("ready", readiness(&app).await),
        "/_cshell" | "/_cshell/" => ("static", StatusCode::NOT_FOUND.into_response()),
        path if path.starts_with("/_cshell/") => {
            let file = path["/_cshell/".len()..].to_owned();
            let response = if read_method {
                ui::serve(&app.config.static_dir, request, &file, false).await
            } else {
                (
                    StatusCode::METHOD_NOT_ALLOWED,
                    [(header::ALLOW, "GET, HEAD")],
                )
                    .into_response()
            };
            ("static", response)
        }
        path if read_method && !ws && ui::is_spa(path) => (
            "spa",
            ui::serve(&app.config.static_dir, request, "index.html", true).await,
        ),
        _ => ("proxy", proxy(&app, peer, request, ws).await),
    };
    tracing::info!(
        route,
        status = response.status().as_u16(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "response headers"
    );
    response
}

fn upstream_uri(app: &App, path_and_query: &str) -> Result<Uri, axum::http::Error> {
    Uri::builder()
        .scheme(app.config.upstream.scheme.clone())
        .authority(app.config.upstream.authority.clone())
        .path_and_query(path_and_query)
        .build()
}

async fn readiness(app: &App) -> Response<Body> {
    let probe = Request::get(upstream_uri(app, "/health").expect("valid health URI"))
        .body(Body::empty())
        .expect("valid probe");
    if tokio::time::timeout(
        Duration::from_secs(2).min(app.config.connect_timeout),
        app.client.request(probe),
    )
    .await
    .is_ok_and(|result| result.is_ok_and(|response| response.status().is_success()))
    {
        (StatusCode::OK, "ready\n").into_response()
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "upstream unavailable\n").into_response()
    }
}

fn websocket_requested(request: &Request) -> bool {
    request.version() == Version::HTTP_11
        && request.method() == Method::GET
        && has_token(request.headers(), header::CONNECTION, "upgrade")
        && has_token(request.headers(), header::UPGRADE, "websocket")
}

async fn proxy(
    app: &App,
    peer: SocketAddr,
    mut request: Request,
    websocket: bool,
) -> Response<Body> {
    let uri = request.uri().clone();
    let Some(target) = uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .filter(|pq| pq.starts_with('/') || *pq == "*")
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    // A CONNECT tunnel has a different target form and is not a reverse-proxied HTTP request.
    if request.method() == Method::CONNECT {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let Ok(destination) = upstream_uri(app, target) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let client_upgrade = if websocket {
        Some(hyper::upgrade::on(&mut request))
    } else {
        None
    };
    let headers = request.headers_mut();
    strip_hop(headers);
    set_forwarding(
        headers,
        &uri,
        peer,
        &app.config.trusted_proxies,
        app.config.public.as_ref(),
    );
    headers.remove(header::HOST);
    if websocket {
        set_websocket(headers);
    }
    *request.uri_mut() = destination;
    *request.version_mut() = Version::HTTP_11;
    let mut response = match app.client.request(request).await {
        Ok(response) => response,
        Err(_) => {
            tracing::warn!("upstream request failed");
            return bad_gateway();
        }
    };
    let upgrade = if response.status() == StatusCode::SWITCHING_PROTOCOLS {
        let Some(client_upgrade) = client_upgrade.filter(|_| {
            has_token(response.headers(), header::CONNECTION, "upgrade")
                && has_token(response.headers(), header::UPGRADE, "websocket")
        }) else {
            return bad_gateway();
        };
        let server_upgrade = hyper::upgrade::on(&mut response);
        let shutdown = app.shutdown.clone();
        tokio::spawn(tunnel(client_upgrade, server_upgrade, shutdown));
        true
    } else {
        false
    };
    strip_hop(response.headers_mut());
    if upgrade {
        set_websocket(response.headers_mut());
    }
    if let Some(public) = &app.config.public {
        headers::rewrite_response(response.headers_mut(), &app.config.upstream, public);
    }
    response.map(Body::new)
}

fn bad_gateway() -> Response<Body> {
    (StatusCode::BAD_GATEWAY, "upstream unavailable\n").into_response()
}

async fn tunnel(client: OnUpgrade, upstream: OnUpgrade, shutdown: CancellationToken) {
    tokio::select! {
        _ = shutdown.cancelled() => {},
        result = async {
            let (client, upstream) = tokio::try_join!(client, upstream)?;
            if copy_bidirectional(&mut TokioIo::new(client), &mut TokioIo::new(upstream)).await.is_err() {
                tracing::debug!("websocket tunnel closed with an I/O error");
            }
            Ok::<(), hyper::Error>(())
        } => {
            if result.is_err() { tracing::debug!("websocket upgrade did not complete"); }
        },
    }
}
