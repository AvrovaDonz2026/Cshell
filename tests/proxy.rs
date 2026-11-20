use std::{net::SocketAddr, time::Duration};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::Request,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use cshell::{Config, router};
use futures_util::{SinkExt, StreamExt};
use tokio::{net::TcpListener, task::JoinHandle};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use tokio_util::sync::CancellationToken;

async fn start(app: Router) -> (SocketAddr, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    (
        address,
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        }),
    )
}

async fn start_proxy(
    upstream: SocketAddr,
    public: Option<&str>,
    static_dir: &str,
) -> (SocketAddr, CancellationToken, JoinHandle<()>) {
    let config = Config::from_lookup(|key| match key {
        "SUB2API_UPSTREAM" => Some(format!("http://{upstream}")),
        "CSHELL_PUBLIC_URL" => public.map(str::to_owned),
        "CSHELL_STATIC_DIR" => Some(static_dir.into()),
        "CSHELL_LISTEN" | "CSHELL_CONNECT_TIMEOUT_SECS" | "CSHELL_TRUSTED_PROXY_CIDRS" => None,
        _ => None,
    })
    .unwrap();
    let token = CancellationToken::new();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let proxy = router(config, token.clone());
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            proxy.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    (address, token, task)
}

async fn mock(request: Request) -> Response<Body> {
    let path = request.uri().path().to_owned();
    let query = request.uri().query().unwrap_or("").to_owned();
    let method = request.method().clone();
    let host = request
        .headers()
        .get(header::HOST)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    let forwarded_for = request.headers().get("x-forwarded-for").cloned();
    let conn = request.headers().get(header::CONNECTION).cloned();
    let nominated = request.headers().get("x-secret-hop").is_some();
    let body = to_bytes(request.into_body(), usize::MAX).await.unwrap();
    match path.as_str() {
        "/health" => StatusCode::OK.into_response(),
        "/cookies" => {
            let mut response = Response::new(Body::from("cookies"));
            response.headers_mut().append(
                header::SET_COOKIE,
                HeaderValue::from_static("a=1; Domain=127.0.0.1; Path=/"),
            );
            response.headers_mut().append(
                header::SET_COOKIE,
                HeaderValue::from_static("b=2; HttpOnly"),
            );
            response
        }
        "/redirect" => {
            let mut response = StatusCode::FOUND.into_response();
            response.headers_mut().insert(
                header::LOCATION,
                HeaderValue::from_str(&format!("http://{host}/inside?q=1")).unwrap(),
            );
            response
        }
        "/external" => {
            let mut response = StatusCode::FOUND.into_response();
            response.headers_mut().insert(
                header::LOCATION,
                HeaderValue::from_static("https://other.test/keep"),
            );
            response
        }
        "/hop" => {
            let mut response = Body::from(format!(
                "{method}|{path}|{query}|{}|{}|{}|{}",
                String::from_utf8_lossy(&body),
                nominated,
                conn.is_some(),
                forwarded_for.map_or_else(String::new, |x| x.to_str().unwrap_or("").to_owned())
            ))
            .into_response();
            response
                .headers_mut()
                .insert("x-response-secret", HeaderValue::from_static("hidden"));
            response.headers_mut().insert(
                header::CONNECTION,
                HeaderValue::from_static("x-response-secret"),
            );
            response
        }
        "/sse" => {
            let stream = async_stream::stream! {
                yield Ok::<_, std::convert::Infallible>(hyper::body::Frame::data(bytes::Bytes::from_static(b"data: first\n\n")));
                tokio::time::sleep(Duration::from_millis(350)).await;
                yield Ok(hyper::body::Frame::data(bytes::Bytes::from_static(b"data: second\n\n")));
            };
            Response::new(Body::new(http_body_util::StreamBody::new(stream)))
        }
        _ => Body::from(format!(
            "{method}|{path}|{query}|{}|{}|{}|{}",
            String::from_utf8_lossy(&body),
            nominated,
            conn.is_some(),
            forwarded_for.map_or_else(String::new, |x| x.to_str().unwrap_or("").to_owned())
        ))
        .into_response(),
    }
}

#[tokio::test]
async fn preserves_path_query_methods_bodies_headers_status_and_static_fallback() {
    let (upstream, upstream_task) =
        start(Router::new().fallback(any(|request| async move { mock(request).await }))).await;
    let temp = tempfile::tempdir().unwrap();
    tokio::fs::write(temp.path().join("index.html"), "index")
        .await
        .unwrap();
    tokio::fs::create_dir(temp.path().join("assets"))
        .await
        .unwrap();
    tokio::fs::write(temp.path().join("assets/app.js"), "asset")
        .await
        .unwrap();
    let (proxy, token, task) = start_proxy(upstream, None, temp.path().to_str().unwrap()).await;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let response = client
        .post(format!("http://{proxy}/raw/%2Fpath?x=%2f&x=a+b"))
        .body("streamed body")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        response.text().await.unwrap(),
        "POST|/raw/%2Fpath|x=%2f&x=a+b|streamed body|false|false|127.0.0.1"
    );
    assert_eq!(
        client
            .get(format!("http://{proxy}/login"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "index"
    );
    assert_eq!(
        client
            .get(format!("http://{proxy}/dashboard"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "index"
    );
    assert_eq!(
        client
            .get(format!("http://{proxy}/assets/app.js"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "GET|/assets/app.js|||false|false|127.0.0.1"
    );
    assert_eq!(
        client
            .get(format!("http://{proxy}/_cshell/assets/app.js"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "asset"
    );
    assert_eq!(
        client
            .get(format!("http://{proxy}/_cshell/health"))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    token.cancel();
    task.abort();
    upstream_task.abort();
}

#[tokio::test]
async fn rewrites_only_matching_redirects_and_domain_cookie_preserving_repeats() {
    let (upstream, upstream_task) =
        start(Router::new().fallback(any(|r: Request| async move { mock(r).await }))).await;
    let (proxy, token, task) = start_proxy(upstream, Some("https://panel.test"), "/missing").await;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let response = client
        .get(format!("http://{proxy}/redirect"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.headers()[header::LOCATION],
        "https://panel.test/inside?q=1"
    );
    let response = client
        .get(format!("http://{proxy}/external"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.headers()[header::LOCATION],
        "https://other.test/keep"
    );
    let response = client
        .get(format!("http://{proxy}/cookies"))
        .send()
        .await
        .unwrap();
    let cookies: Vec<_> = response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap())
        .collect();
    assert_eq!(cookies, ["a=1; Domain=panel.test; Path=/", "b=2; HttpOnly"]);
    token.cancel();
    task.abort();
    upstream_task.abort();
}

#[tokio::test]
async fn strips_hop_headers_readiness_and_streams_sse_before_completion() {
    let (upstream, upstream_task) =
        start(Router::new().fallback(any(|r: Request| async move { mock(r).await }))).await;
    let (proxy, token, task) = start_proxy(upstream, None, "/missing").await;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    assert_eq!(
        client
            .get(format!("http://{proxy}/_cshell/ready"))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONNECTION,
        HeaderValue::from_static("keep-alive, X-Secret-Hop"),
    );
    headers.insert("x-secret-hop", HeaderValue::from_static("must disappear"));
    let response = client
        .get(format!("http://{proxy}/hop?x=%2F"))
        .headers(headers)
        .send()
        .await
        .unwrap();
    assert!(response.headers().get("x-response-secret").is_none());
    let result = response.text().await.unwrap();
    assert!(
        result.contains("GET|/hop|x=%2F||false|false|127.0.0.1"),
        "{result}"
    );
    let mut response = client
        .get(format!("http://{proxy}/sse"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_millis(200), response.chunk())
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        "data: first\n\n"
    );
    assert_eq!(response.chunk().await.unwrap().unwrap(), "data: second\n\n");
    token.cancel();
    task.abort();
    upstream_task.abort();
}

#[tokio::test]
async fn streams_websocket_in_both_directions() {
    // axum's WebSocket extractor uses the same upgrade mechanism; echo verifies both directions.
    use axum::extract::ws::{WebSocket, WebSocketUpgrade};
    async fn echo(ws: WebSocketUpgrade) -> impl axum::response::IntoResponse {
        ws.on_upgrade(|mut socket: WebSocket| async move {
            while let Some(Ok(message)) = socket.recv().await {
                if socket.send(message).await.is_err() {
                    break;
                }
            }
        })
    }
    let (upstream, upstream_task) = start(Router::new().route("/ws", any(echo))).await;
    let (proxy, token, task) = start_proxy(upstream, None, "/missing").await;
    let (mut client, _) = connect_async(format!("ws://{proxy}/ws")).await.unwrap();
    client
        .send(Message::Text("through tunnel".into()))
        .await
        .unwrap();
    assert_eq!(
        client.next().await.unwrap().unwrap(),
        Message::Text("through tunnel".into())
    );
    token.cancel();
    task.abort();
    upstream_task.abort();
}
