//! # SPECTER API Server
//!
//! REST API for the SPECTER protocol, designed to be consumed by the Next.js frontend.
//!
//! ## Endpoints
//!
//! - `POST /api/v1/keys/generate` - Generate new SPECTER keys
//! - `POST /api/v1/stealth/create` - Create stealth payment address
//! - `POST /api/v1/stealth/scan` - Scan announcements for payments
//! - `GET /api/v1/ens/resolve/:name` - Resolve ENS to meta-address
//! - `POST /api/v1/registry/publish` - Publish announcement
//! - `GET /api/v1/registry/announcements` - Get announcements
//!
//! ## Example
//!
//! ```rust,ignore
//! use specter_api::{ApiServer, ApiConfig};
//!
//! let config = ApiConfig::default();
//! let server = ApiServer::new(config);
//! server.run("0.0.0.0:3001").await?;
//! ```

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
