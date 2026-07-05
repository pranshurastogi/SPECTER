//! API route configuration.

use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};

use crate::handlers;
use crate::state::AppState;

/// Builds the Axum router for the SPECTER API.
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
        .route(
            "/api/v1/registry/announcements",
            get(handlers::list_announcements),
        )
        .route(
            "/api/v1/registry/announcements",
            post(handlers::publish_announcement),
        )
        .route("/api/v1/registry/stats", get(handlers::get_registry_stats))
        .route("/api/v1/sweeps", post(handlers::record_sweeps))
        .route("/api/v1/sweeps/:identity_hash", get(handlers::list_sweeps))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::ApiConfig;
    use axum::body::{to_bytes, Body};
    use axum::http::StatusCode;
    use tower::ServiceExt;

    fn test_app() -> Router {
        let state = Arc::new(AppState::new_sync(ApiConfig::default()));
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
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        // v1 schema fix: wallet-level view_tag is gone, only meta_address + keys remain.
        assert!(json.get("meta_address").is_some());
        assert!(
            json.get("view_tag").is_none(),
            "GenerateKeysResponse must not include view_tag"
        );
    }

    /// Full create → publish round-trip via `payment_id`.
    ///
    /// Verifies the server-authoritative binding: the announcement that ends up
    /// in the registry has the exact view_tag computed at create time.
    #[tokio::test]
    async fn test_create_then_publish_via_payment_id() {
        let state = Arc::new(AppState::new_sync(ApiConfig::default()));
        let app = create_router(state.clone());

        // 1. Generate keys
        let res = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/keys/generate")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let keys: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let meta_address = keys["meta_address"].as_str().unwrap().to_string();

        // 2. Create stealth payment
        let req = format!(r#"{{"meta_address":"{}"}}"#, meta_address);
        let res = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/stealth/create")
                    .header("content-type", "application/json")
                    .body(Body::from(req))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let create: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let payment_id = create["payment_id"].as_str().unwrap().to_string();
        let expected_view_tag = create["view_tag"].as_u64().unwrap() as u8;

        // 3. Publish via payment_id (server-authoritative path)
        let req = format!(
            r#"{{"payment_id":"{}","tx_hash":"0xdeadbeef","chain":"ethereum","amount":"0.01"}}"#,
            payment_id
        );
        let res = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/registry/announcements")
                    .header("content-type", "application/json")
                    .body(Body::from(req))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK, "publish must succeed");

        // 4. Inspect registry: stored announcement must carry the server-built view_tag.
        let all = state.registry.all_announcements().await;
        assert_eq!(all.len(), 1, "exactly one announcement was published");
        assert_eq!(
            all[0].view_tag, expected_view_tag,
            "registry must hold the protocol view_tag built at create time"
        );
        assert_eq!(all[0].tx_hash.as_deref(), Some("0xdeadbeef"));
        // Plaintext payment fields are NOT persisted — they live only inside the
        // encrypted metadata_blob. The row must carry the encrypted shape instead.
        assert_eq!(
            all[0].amount, None,
            "amount must not be persisted in plaintext"
        );
        assert_eq!(
            all[0].source_chain_id, None,
            "source_chain_id must not be persisted in plaintext"
        );
        assert!(
            all[0].metadata_blob.is_some(),
            "encrypted metadata_blob must be present"
        );
        assert!(
            all[0].ephemeral_key_hash.is_some(),
            "ephemeral_key_hash must be present"
        );
        assert_eq!(all[0].chain.as_deref(), Some("ethereum"));
    }

    /// Publishing twice with the same payment_id must fail: the entry is consumed.
    #[tokio::test]
    async fn test_payment_id_is_single_use() {
        let state = Arc::new(AppState::new_sync(ApiConfig::default()));
        let app = create_router(state);

        // Set up a payment_id
        let res = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/keys/generate")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let keys: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let meta_address = keys["meta_address"].as_str().unwrap().to_string();

        let res = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/stealth/create")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"meta_address":"{}"}}"#,
                        meta_address
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let create: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let payment_id = create["payment_id"].as_str().unwrap().to_string();

        let publish_body = format!(
            r#"{{"payment_id":"{}","tx_hash":"0xfeedface"}}"#,
            payment_id
        );

        let res = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/registry/announcements")
                    .header("content-type", "application/json")
                    .body(Body::from(publish_body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK, "first publish succeeds");

        let res = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/registry/announcements")
                    .header("content-type", "application/json")
                    .body(Body::from(publish_body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::BAD_REQUEST,
            "second publish must fail (payment_id consumed)"
        );
    }

    /// Publish must reject requests missing both `payment_id` and `announcement`.
    #[tokio::test]
    async fn test_publish_rejects_loose_view_tag() {
        let app = test_app();

        // Old shape: loose ephemeral_key + view_tag — must be rejected.
        let res = app
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/registry/announcements")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"ephemeral_key":"00","view_tag":42,"tx_hash":"0x1"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::BAD_REQUEST,
            "loose view_tag must no longer be accepted"
        );
    }

    /// Regression (false "duplicate detected"): a publish that fails AFTER the
    /// dedup slot is reserved (here: dev mode with tx_hash missing) must not
    /// leave the reservation behind — retrying the same payment used to 409
    /// forever with on_chain = 0 in the DB and nothing on the contract.
    #[tokio::test]
    async fn test_failed_publish_releases_reservation_so_retry_succeeds() {
        // db_keys enable the payment_tx_hash_hmac dedup path (the one that leaked).
        let mut state = AppState::new_sync(ApiConfig::default());
        state.db_keys = Some(std::sync::Arc::new(specter_crypto::DbKeys::from_master(
            &[7u8; 32],
        )));
        let state = Arc::new(state);
        let app = create_router(state.clone());

        let keys_res = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/keys/generate")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = to_bytes(keys_res.into_body(), usize::MAX).await.unwrap();
        let keys: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let meta_address = keys["meta_address"].as_str().unwrap().to_string();

        let create = |app: Router| {
            let meta = meta_address.clone();
            async move {
                let res = app
                    .oneshot(
                        axum::http::Request::builder()
                            .method("POST")
                            .uri("/api/v1/stealth/create")
                            .header("content-type", "application/json")
                            .body(Body::from(format!(r#"{{"meta_address":"{meta}"}}"#)))
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
                let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
                v["payment_id"].as_str().unwrap().to_string()
            }
        };

        // Attempt 1: same source payment, but tx_hash omitted → 400 in dev
        // mode. This failure happens AFTER the reservation is taken.
        let pid1 = create(app.clone()).await;
        let res = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/registry/announcements")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"payment_id":"{pid1}","payment_tx_hash":"0xsamepayment"}}"#
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::BAD_REQUEST,
            "dev mode needs tx_hash"
        );

        // Attempt 2: retry the SAME source payment properly. Before the fix
        // this returned 409 CONFLICT (stuck reservation); it must succeed.
        let pid2 = create(app.clone()).await;
        let res = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/registry/announcements")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"payment_id":"{pid2}","tx_hash":"0xretry-ok","payment_tx_hash":"0xsamepayment"}}"#
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::OK,
            "retry after a failed publish must not be treated as a duplicate"
        );
    }

    /// Sweep recording rejects malformed payloads before touching any store.
    #[tokio::test]
    async fn test_record_sweeps_validates_payload() {
        let app = test_app();

        // identity_hash is not 64-char lowercase hex → 422.
        let bad = r#"{
            "receipt_id":"rcpt-1",
            "identity_hash":"NOT-A-HASH",
            "chain":"sepolia",
            "destination":"0x2222222222222222222222222222222222222222",
            "destination_input":"alice.eth",
            "records":[{
                "id":"row-1",
                "stealth_address":"0x1111111111111111111111111111111111111111",
                "amount_base":"1000",
                "fee_base":"21",
                "tx_hash":"",
                "status":"confirmed"
            }]
        }"#;
        let res = app
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/sweeps")
                    .header("content-type", "application/json")
                    .body(Body::from(bad))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    /// A valid sweep payload on the memory backend reports 503 (Turso required).
    #[tokio::test]
    async fn test_record_sweeps_requires_turso() {
        let app = test_app();

        let ok = format!(
            r#"{{
            "receipt_id":"rcpt-1",
            "identity_hash":"{}",
            "chain":"sepolia",
            "destination":"0x2222222222222222222222222222222222222222",
            "destination_input":"alice.eth",
            "records":[{{
                "id":"row-1",
                "stealth_address":"0x1111111111111111111111111111111111111111",
                "amount_base":"1000000000000000",
                "fee_base":"31500000000000",
                "tx_hash":"0x{}",
                "status":"confirmed"
            }}]
        }}"#,
            "ab".repeat(32),
            "cd".repeat(32),
        );
        let res = app
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/api/v1/sweeps")
                    .header("content-type", "application/json")
                    .body(Body::from(ok))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    /// Sweep listing validates the identity hash path parameter.
    #[tokio::test]
    async fn test_list_sweeps_validates_identity_hash() {
        let app = test_app();

        let res = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/v1/sweeps/not-a-hash")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
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
