//! API route configuration.

use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};

use crate::handlers;
use crate::state::AppState;

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(handlers::health_check))
        .route("/api/v1/keys/generate", post(handlers::generate_keys))
        .route("/api/v1/stealth/create", post(handlers::create_stealth))
        .route("/api/v1/stealth/scan", post(handlers::scan_payments))
        .route("/api/v1/ens/resolve/:name", get(handlers::resolve_ens))
        .route("/api/v1/suins/resolve/:name", get(handlers::resolve_suins))
        .route("/api/v1/ipfs/upload", post(handlers::upload_ipfs))
        .route("/api/v1/ipfs/:cid", get(handlers::ipfs_get))
        .route("/api/v1/registry/announcements", get(handlers::list_announcements))
        .route("/api/v1/registry/announcements", post(handlers::publish_announcement))
        .route("/api/v1/registry/stats", get(handlers::get_registry_stats))
        // Yellow Network endpoints
        .route("/api/v1/yellow/channel/create", post(handlers::yellow_create_channel))
        .route("/api/v1/yellow/channel/discover", post(handlers::yellow_discover_channels))
        .route("/api/v1/yellow/channel/fund", post(handlers::yellow_fund_channel))
        .route("/api/v1/yellow/channel/close", post(handlers::yellow_close_channel))
        .route("/api/v1/yellow/channel/:id/status", get(handlers::yellow_channel_status))
        .route("/api/v1/yellow/transfer", post(handlers::yellow_transfer))
        .route("/api/v1/yellow/config", get(handlers::yellow_config))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use axum::body::{Body, to_bytes};
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

        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "ok");
        assert!(json.get("version").is_some());
        assert!(json.get("uptime_seconds").is_some());
        assert_eq!(json["announcements_count"], 0);
        assert_eq!(json["use_testnet"], false);
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
