//! SPECTER REST API. See README and routes for endpoints.

#![forbid(unsafe_code)]
#![warn(missing_docs, rust_2018_idioms)]

mod dto;
mod error;
mod handlers;
mod middleware;
mod routes;
mod state;

pub use error::ApiError;
pub use routes::create_router;
pub use state::{ApiConfig, AppState, SecurityConfig};

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::Router;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;

use crate::middleware::{RateLimitState, spawn_rate_limit_cleanup};

/// API server for SPECTER.
pub struct ApiServer {
    state: Arc<AppState>,
}

impl ApiServer {
    /// Creates a new API server with the given configuration.
    pub fn new(config: ApiConfig) -> Self {
        Self {
            state: Arc::new(AppState::new(config)),
        }
    }

    /// Creates the router with all routes and security middleware configured.
    pub fn router(&self) -> Router {
        let security = &self.state.config.security;

        // ── CORS: restrict origins in production ──────────────────────
        let cors = build_cors_layer(&security.allowed_origins);

        // ── Rate limiter ─────────────────────────────────────────────
        let rate_limit_state = Arc::new(RateLimitState::new(
            security.rate_limit_rps,
            security.rate_limit_burst,
        ));
        spawn_rate_limit_cleanup(rate_limit_state.clone());

        // ── API key auth state ───────────────────────────────────────
        let security_config = Arc::new(security.clone());

        // ── Body size limit ──────────────────────────────────────────
        let body_limit = DefaultBodyLimit::max(security.max_body_size);

        // Layer order (outermost → innermost):
        //   TraceLayer → security_headers → CORS → rate_limit → api_key_auth → body_limit → router
        create_router(self.state.clone())
            .layer(body_limit)
            .layer(axum::middleware::from_fn_with_state(
                security_config,
                middleware::api_key_auth,
            ))
            .layer(axum::middleware::from_fn_with_state(
                rate_limit_state,
                middleware::rate_limit,
            ))
            .layer(cors)
            .layer(axum::middleware::from_fn(middleware::security_headers))
            .layer(TraceLayer::new_for_http())
    }

    /// Runs the server on the given address.
    pub async fn run(self, addr: impl Into<SocketAddr>) -> std::io::Result<()> {
        let addr = addr.into();
        let security = &self.state.config.security;

        info!("SPECTER API server listening on {}", addr);
        info!(
            "Security: CORS origins={:?}, rate_limit={} rps (burst {}), api_key={}, body_limit={} bytes",
            security.allowed_origins,
            security.rate_limit_rps,
            security.rate_limit_burst,
            if security.api_key.is_some() { "enabled" } else { "disabled" },
            security.max_body_size,
        );

        let listener = tokio::net::TcpListener::bind(addr).await?;

        axum::serve(
            listener,
            self.router().into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
    }
}

/// Starts the API server with default configuration.
pub async fn start_server(port: u16) -> std::io::Result<()> {
    let config = ApiConfig::from_env();
    let server = ApiServer::new(config);
    server.run(([0, 0, 0, 0], port)).await
}

/// Build CORS layer from allowed origins list.
fn build_cors_layer(origins: &[String]) -> CorsLayer {
    let allow_methods = AllowMethods::list([
        axum::http::Method::GET,
        axum::http::Method::POST,
        axum::http::Method::OPTIONS,
    ]);

    let allow_headers = AllowHeaders::list([
        axum::http::header::CONTENT_TYPE,
        axum::http::header::AUTHORIZATION,
        axum::http::header::HeaderName::from_static("x-api-key"),
    ]);

    if origins.iter().any(|o| o == "*") {
        // Dev mode: allow all
        CorsLayer::new()
            .allow_origin(AllowOrigin::any())
            .allow_methods(allow_methods)
            .allow_headers(allow_headers)
    } else {
        // Production: only allow specified origins
        let parsed: Vec<axum::http::HeaderValue> = origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();

        CorsLayer::new()
            .allow_origin(AllowOrigin::list(parsed))
            .allow_methods(allow_methods)
            .allow_headers(allow_headers)
    }
}
