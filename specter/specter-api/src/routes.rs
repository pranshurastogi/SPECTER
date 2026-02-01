//! API route configuration.

use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};

use crate::handlers;
use crate::state::AppState;

/// Creates the API router with all routes configured.
pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        // Health check
        .route("/health", get(handlers::health_check))
        
        // Key generation
        .route("/api/v1/keys/generate", post(handlers::generate_keys))
        
        // Stealth operations
        .route("/api/v1/stealth/create", post(handlers::create_stealth))
        .route("/api/v1/stealth/scan", post(handlers::scan_payments))
        
        // ENS integration
        .route("/api/v1/ens/resolve/:name", get(handlers::resolve_ens))
        .route("/api/v1/ens/upload", post(handlers::upload_ipfs))
        
        // Registry
        .route("/api/v1/registry/announcements", get(handlers::list_announcements))
        .route("/api/v1/registry/announcements", post(handlers::publish_announcement))
        .route("/api/v1/registry/stats", get(handlers::get_registry_stats))
        
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use axum::body::Body;
    use tower::ServiceExt;
    use crate::state::ApiConfig;

    fn test_app() -> Router {
        let state = Arc::new(AppState::new(ApiConfig::default()));
        create_router(state)
    }

    #[tokio::test]
    async fn test_health_check() {
        let app = test_app();
        
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_generate_keys() {
        let app = test_app();
        
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/keys/generate")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_registry_stats() {
        let app = test_app();
        
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/v1/registry/stats")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }
}
