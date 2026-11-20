use std::{net::SocketAddr, time::Duration};

use cshell::{Config, router};
use tokio::{net::TcpListener, signal};
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> std::process::ExitCode {
    tracing_subscriber::fmt().json().init();
    match run().await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "service failed");
            std::process::ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env()?;
    let listener = TcpListener::bind(config.listen).await?;
    let shutdown = CancellationToken::new();
    let app = router(config, shutdown.clone());
    tracing::info!(listen = %listener.local_addr()?, "service listening");
    let graceful = shutdown.clone();
    let server = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        shutdown_signal().await;
        tracing::info!("shutdown requested");
        graceful.cancel();
    });
    tokio::select! {
        result = server => result?,
        _ = async {
            shutdown.cancelled().await;
            tokio::time::sleep(Duration::from_secs(30)).await;
        } => tracing::warn!("shutdown drain period expired"),
    }
    Ok(())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        if let Ok(mut term) = signal::unix::signal(signal::unix::SignalKind::terminate()) {
            tokio::select! {
                _ = term.recv() => {},
                _ = signal::ctrl_c() => {},
            }
            return;
        }
    }
    let _ = signal::ctrl_c().await;
}
