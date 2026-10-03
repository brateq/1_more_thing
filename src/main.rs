mod api;
mod auth;
mod database;
mod thoughts;

use axum::{
    Router,
    http::{HeaderValue, header},
    routing::get,
};
use std::{
    env,
    io::{Read, Write},
    net::TcpStream,
    path::PathBuf,
    time::Duration,
};
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Explicit environment wins, then .env.local, then .env.
    let _ = dotenvy::from_filename(".env.local");
    let _ = dotenvy::dotenv();
    match env::args().nth(1).as_deref() {
        Some("healthcheck") => return healthcheck(),
        Some("hash-password") => {
            let password = if let Some(password) = env::args().nth(2) {
                password
            } else {
                let mut value = String::new();
                std::io::stdin().read_to_string(&mut value)?;
                value.trim_end_matches(['\r', '\n']).to_owned()
            };
            if password.encode_utf16().count() < 10 {
                return Err("Podaj hasło mające co najmniej 10 znaków.".into());
            }
            println!("{}", auth::hash_password(&password));
            return Ok(());
        }
        Some(arg) => return Err(format!("Unknown command: {arg}").into()),
        None => {}
    }
    let database_path = env::var("DATABASE_PATH").unwrap_or_else(|_| "data/and1.db".into());
    let db = database::Database::open(std::path::Path::new(&database_path))?;
    let auth = auth::Auth {
        password_hash: env::var("AUTH_PASSWORD_HASH").unwrap_or_default(),
        secret: env::var("SESSION_SECRET").unwrap_or_default(),
    };
    if !auth.configured() {
        eprintln!("AUTH_PASSWORD_HASH and SESSION_SECRET are required to log in");
    }
    let static_dir = PathBuf::from(env::var("STATIC_DIR").unwrap_or_else(|_| "dist/client".into()));
    let immutable = SetResponseHeaderLayer::if_not_present(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    let assets = Router::new()
        .fallback_service(
            ServeDir::new(static_dir.join("assets"))
                .precompressed_br()
                .precompressed_gzip(),
        )
        .layer(immutable)
        .layer(SetResponseHeaderLayer::if_not_present(
            header::VARY,
            HeaderValue::from_static("Accept-Encoding"),
        ));
    let pages = Router::new()
        .route_service(
            "/",
            ServeFile::new(static_dir.join("index.html"))
                .precompressed_br()
                .precompressed_gzip(),
        )
        .route_service(
            "/favicon.svg",
            ServeFile::new(static_dir.join("favicon.svg")),
        )
        .fallback(get(|| async { axum::http::StatusCode::NOT_FOUND }))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::VARY,
            HeaderValue::from_static("Accept-Encoding"),
        ));
    let app = Router::new()
        .merge(api::routes(api::AppState::new(db, auth)))
        .nest_service("/assets", assets)
        .merge(pages)
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ));
    let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port = env::var("PORT").unwrap_or_else(|_| "3000".into());
    let listener = tokio::net::TcpListener::bind(format!("{host}:{port}")).await?;
    println!(
        "1 more thing listening on http://{}",
        listener.local_addr()?
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}

fn healthcheck() -> Result<(), Box<dyn std::error::Error>> {
    let port = env::var("PORT").unwrap_or_else(|_| "3000".into());
    let address = format!("127.0.0.1:{port}").parse()?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    stream.write_all(b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    if response.starts_with("HTTP/1.1 200 ") {
        Ok(())
    } else {
        Err("Unhealthy server".into())
    }
}
