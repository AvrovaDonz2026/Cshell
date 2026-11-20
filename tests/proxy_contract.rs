use axum::{
    Router,
    body::to_bytes,
    extract::Request,
    http::{StatusCode, header},
    routing::any,
};
use cshell::{Config, router};
use std::{net::SocketAddr, time::Duration};
use tokio::{net::TcpListener, task::JoinHandle};
use tokio_util::sync::CancellationToken;

async fn proxy(upstream: SocketAddr, dir: &str) -> (String, JoinHandle<()>) {
    let config = Config::from_lookup(|key| match key {
        "SUB2API_UPSTREAM" => Some(format!("http://{upstream}")),
        "CSHELL_STATIC_DIR" => Some(dir.into()),
        "CSHELL_CONNECT_TIMEOUT_SECS" => Some("1".into()),
        _ => None,
    })
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            router(config, CancellationToken::new())
                .into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    (url, task)
}

#[tokio::test]
async fn upstream_fault_keeps_liveness_independent() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream = listener.local_addr().unwrap();
    drop(listener);
    let (url, task) = proxy(upstream, "/missing").await;
    let client = reqwest::Client::new();
    for (path, status) in [
        ("/_cshell/health", 200),
        ("/_cshell/ready", 503),
        ("/api/test", 502),
        ("/login", 503),
    ] {
        assert_eq!(
            client
                .get(format!("{url}{path}"))
                .send()
                .await
                .unwrap()
                .status(),
            status
        );
    }
    task.abort();
}

#[tokio::test]
async fn routing_methods_and_static_traversal_are_enforced() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().fallback(any(|| async { (StatusCode::IM_A_TEAPOT, "upstream") })),
        )
        .await
        .unwrap();
    });
    let dir = tempfile::tempdir().unwrap();
    tokio::fs::write(dir.path().join("index.html"), "spa")
        .await
        .unwrap();
    let outside = tempfile::NamedTempFile::new().unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.path(), dir.path().join("escape")).unwrap();
    let (url, task) = proxy(address, dir.path().to_str().unwrap()).await;
    let client = reqwest::Client::new();
    for path in [
        "/admin",
        "/admin/users",
        "/administrator",
        "/setup",
        "/unknown",
        "/api/test",
    ] {
        assert_eq!(
            client
                .get(format!("{url}{path}"))
                .send()
                .await
                .unwrap()
                .status(),
            418,
            "{path}"
        );
    }
    assert_eq!(
        client
            .post(format!("{url}/login"))
            .send()
            .await
            .unwrap()
            .status(),
        418
    );
    let head = client.head(format!("{url}/login")).send().await.unwrap();
    assert_eq!(head.status(), 200);
    assert!(head.bytes().await.unwrap().is_empty());
    let post = client
        .post(format!("{url}/_cshell/index.html"))
        .send()
        .await
        .unwrap();
    assert_eq!(post.status(), 405);
    assert_eq!(post.headers()[header::ALLOW], "GET, HEAD");
    for path in [
        "/_cshell/%2e%2e%2fsecret",
        "/_cshell/%5csecret",
        "/_cshell/escape",
    ] {
        assert_eq!(
            client
                .get(format!("{url}{path}"))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
    }
    task.abort();
    upstream.abort();
}

#[tokio::test]
async fn uploads_stream_before_completion_and_headers_have_no_request_timeout() {
    use http_body_util::BodyExt;
    let (seen_tx, mut seen_rx) = tokio::sync::mpsc::channel(1);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let upstream = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().fallback(any(move |request: Request| {
                let seen_tx = seen_tx.clone();
                async move {
                    let mut body = request.into_body();
                    let first = body.frame().await.unwrap().unwrap().into_data().unwrap();
                    seen_tx.send(first).await.unwrap();
                    let remaining = to_bytes(body, 1024).await.unwrap();
                    tokio::time::sleep(Duration::from_millis(1100)).await;
                    (StatusCode::CREATED, remaining)
                }
            })),
        )
        .await
        .unwrap();
    });
    let (url, task) = proxy(address, "/missing").await;
    let (finish_tx, finish_rx) = tokio::sync::oneshot::channel::<()>();
    let stream = async_stream::stream! {
        yield Ok::<_, std::io::Error>(bytes::Bytes::from_static(b"first"));
        finish_rx.await.unwrap();
        yield Ok(bytes::Bytes::from_static(b"last"));
    };
    let request = tokio::spawn(async move {
        reqwest::Client::new()
            .post(format!("{url}/upload"))
            .body(reqwest::Body::wrap_stream(stream))
            .send()
            .await
            .unwrap()
    });
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), seen_rx.recv())
            .await
            .unwrap()
            .unwrap(),
        "first"
    );
    finish_tx.send(()).unwrap();
    let response = request.await.unwrap();
    assert_eq!(response.status(), 201);
    assert_eq!(response.text().await.unwrap(), "last");
    task.abort();
    upstream.abort();
}
