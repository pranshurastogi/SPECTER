//! SPECTER REST API. See README and routes for endpoints.

#![forbid(unsafe_code)]
#![warn(missing_docs, rust_2018_idioms)]

mod routes;
mod handlers;
mod state;
mod dto;
mod error;

pub use routes::create_router;
pub use state::{AppState, ApiConfig};
pub use error::ApiError;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;

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

    /// Creates the router with all routes configured.
    pub fn router(&self) -> Router {
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        create_router(self.state.clone())
            .layer(cors)
            .layer(TraceLayer::new_for_http())
    }

    /// Runs the server on the given address.
    pub async fn run(self, addr: impl Into<SocketAddr>) -> std::io::Result<()> {
        let addr = addr.into();
        let listener = tokio::net::TcpListener::bind(addr).await?;
        
        info!("SPECTER API server listening on {}", addr);
        
        axum::serve(listener, self.router()).await
    }
}

/// Starts the API server with default configuration.
pub async fn start_server(port: u16) -> std::io::Result<()> {
    let config = ApiConfig::from_env();
    let server = ApiServer::new(config);
    server.run(([0, 0, 0, 0], port)).await
}
