//! API route handlers.

use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::{Path, Query, State},
    http::header,
    response::IntoResponse,
    Json,
};
use tracing::{debug, info};

use specter_core::traits::AnnouncementRegistry;
use specter_core::types::{Announcement, KyberPublicKey, MetaAddress};
use specter_crypto::generate_keypair;
use specter_stealth::create_stealth_payment;

use crate::dto::*;
use crate::error::ApiError;
use crate::state::AppState;

type Result<T> = std::result::Result<T, ApiError>;

/// POST /api/v1/keys/generate
pub async fn generate_keys(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<GenerateKeysResponse>> {
    let spending = generate_keypair();
    let viewing = generate_keypair();

    let meta = MetaAddress::new(
        KyberPublicKey::from_array(*spending.public.as_array()),
        KyberPublicKey::from_array(*viewing.public.as_array()),
    );

    // Intentionally NO `view_tag` field on the response — see GenerateKeysResponse.
    let response = GenerateKeysResponse {
        spending_pk: hex::encode(spending.public.as_bytes()),
        spending_sk: hex::encode(spending.secret.as_bytes()),
        viewing_pk: hex::encode(viewing.public.as_bytes()),
        viewing_sk: hex::encode(viewing.secret.as_bytes()),
        meta_address: meta.to_hex(),
    };

    info!("Generated new SPECTER keys");
    Ok(Json(response))
}

/// POST /api/v1/stealth/create
pub async fn create_stealth(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateStealthRequest>,
) -> Result<Json<CreateStealthResponse>> {
    let meta = MetaAddress::from_hex(&req.meta_address)
        .map_err(|e| ApiError::bad_request(format!("Invalid meta_address: {}", e)))?;

    let payment = create_stealth_payment(&meta)
        .map_err(|e| ApiError::internal(format!("Failed to create stealth payment: {}", e)))?;

    // Server retains the canonical announcement (correct view_tag + ephemeral
    // key) keyed by payment_id. The frontend will quote this id back to
    // `/api/v1/registry/announcements` after broadcasting the on-chain tx.
    let payment_id = state.pending_payments.insert(payment.announcement.clone());

    let response = CreateStealthResponse {
        payment_id,
        stealth_address: payment.stealth_address.to_checksum_string(),
        stealth_sui_address: payment.stealth_sui_address.to_hex_string(),
        ephemeral_ciphertext: hex::encode(&payment.announcement.ephemeral_key),
        view_tag: payment.announcement.view_tag,
        announcement: AnnouncementDto::from(payment.announcement),
    };

    debug!(
        payment_id = %response.payment_id,
        stealth_address = %response.stealth_address,
        view_tag = response.view_tag,
        "Created stealth payment"
    );

    Ok(Json(response))
}

fn strip_hex_prefix(s: &str) -> &str {
    let s = s.trim();
    if s.len() >= 2 && s.get(..2).map(|p| p.eq_ignore_ascii_case("0x")) == Some(true) {
        &s[2..]
    } else {
        s
    }
}

/// POST /api/v1/stealth/scan
pub async fn scan_payments(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ScanRequest>,
) -> Result<Json<ScanResponse>> {
    let start = Instant::now();

    let viewing_sk = hex::decode(strip_hex_prefix(&req.viewing_sk))?;
    let spending_pk = hex::decode(strip_hex_prefix(&req.spending_pk))?;
    let spending_sk = hex::decode(strip_hex_prefix(&req.spending_sk))?;

    let announcements = if let Some(tags) = &req.view_tags {
        let mut all = Vec::new();
        for tag in tags {
            let matching = state
                .registry
                .get_by_view_tag(*tag)
                .await
                .map_err(|e| ApiError::internal(e.to_string()))?;
            all.extend(matching);
        }
        all
    } else if let (Some(from), Some(to)) = (req.from_timestamp, req.to_timestamp) {
        state
            .registry
            .get_by_time_range(from, to)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?
    } else {
        state.registry.all_announcements().await
    };

    let (discoveries, scan_stats) = specter_stealth::discovery::scan_with_context_and_stats(
        &announcements,
        &viewing_sk,
        &spending_pk,
        &spending_sk,
    );

    let elapsed = start.elapsed();
    let duration_ms = elapsed.as_millis() as u64;

    let discovery_dtos: Vec<DiscoveryDto> = discoveries
        .into_iter()
        .map(|d| DiscoveryDto {
            stealth_address: d.keys.address.to_checksum_string(),
            stealth_sui_address: d.keys.sui_address.to_hex_string(),
            stealth_sk: hex::encode(d.keys.private_key.as_bytes()),
            eth_private_key: hex::encode(d.keys.private_key.to_eth_private_key()),
            announcement_id: d.announcement.id,
            timestamp: d.announcement.timestamp,
            tx_hash: d.announcement.tx_hash.clone(),
            amount: d.announcement.amount.clone().unwrap_or_default(),
            chain: d.announcement.chain.clone().unwrap_or_default(),
        })
        .collect();

    let stats = ScanStatsDto {
        total_scanned: scan_stats.total_scanned,
        view_tag_matches: scan_stats.view_tag_matches,
        discoveries: scan_stats.discoveries,
        duration_ms,
        rate: if elapsed.as_secs_f64() > 0.0 {
            scan_stats.total_scanned as f64 / elapsed.as_secs_f64()
        } else {
            0.0
        },
    };

    info!(
        total_scanned = stats.total_scanned,
        view_tag_matches = stats.view_tag_matches,
        discoveries = stats.discoveries,
        duration_ms = stats.duration_ms,
        "Scan complete"
    );

    Ok(Json(ScanResponse {
        discoveries: discovery_dtos,
        stats,
    }))
}

/// GET /api/v1/ens/resolve/:name
pub async fn resolve_ens(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<Json<ResolveEnsResponse>> {
    let result = state
        .resolver
        .resolve_full(&name)
        .await
        .map_err(ApiError::from)?;

    let response = ResolveEnsResponse {
        ens_name: result.ens_name,
        meta_address: result.meta_address.to_hex(),
        spending_pk: result.meta_address.spending_pk.to_hex(),
        viewing_pk: result.meta_address.viewing_pk.to_hex(),
        ipfs_cid: if result.ipfs_cid.is_empty() {
            None
        } else {
            Some(result.ipfs_cid)
        },
    };

    Ok(Json(response))
}

/// GET /api/v1/suins/resolve/:name
pub async fn resolve_suins(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<ResolveSuinsResponse>> {
    if params.contains_key("no_cache") {
        state.suins_resolver.clear_cache();
    }

    let result = state
        .suins_resolver
        .resolve_full(&name)
        .await
        .map_err(ApiError::from)?;

    let response = ResolveSuinsResponse {
        suins_name: result.suins_name,
        meta_address: result.meta_address.to_hex(),
        spending_pk: result.meta_address.spending_pk.to_hex(),
        viewing_pk: result.meta_address.viewing_pk.to_hex(),
        ipfs_cid: if result.ipfs_cid.is_empty() {
            None
        } else {
            Some(result.ipfs_cid)
        },
    };

    Ok(Json(response))
}

/// POST /api/v1/ipfs/upload
pub async fn upload_ipfs(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UploadIpfsRequest>,
) -> Result<Json<UploadIpfsResponse>> {
    let meta = MetaAddress::from_hex(&req.meta_address)
        .map_err(|e| ApiError::bad_request(format!("Invalid meta_address: {}", e)))?;

    let cid = state
        .resolver
        .upload(&meta, req.name.as_deref())
        .await
        .map_err(|e| ApiError::internal(format!("IPFS upload failed: {}", e)))?;

    let text_record = state.resolver.format_text_record(&cid);

    Ok(Json(UploadIpfsResponse { cid, text_record }))
}

/// GET /api/v1/ipfs/:cid - returns raw bytes (for "View on IPFS" via backend)
pub async fn ipfs_get(
    State(state): State<Arc<AppState>>,
    Path(cid): Path<String>,
) -> Result<impl IntoResponse> {
    let data = state
        .resolver
        .download_raw(&cid)
        .await
        .map_err(|e| ApiError::internal(format!("IPFS retrieve failed: {}", e)))?;

    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], data))
}

/// POST /api/v1/registry/announcements
///
/// Publishes a previously-created stealth payment. The protocol view tag is
/// always derived server-side; clients can no longer supply a loose `view_tag`
/// or `ephemeral_key` here.
///
/// Resolution order:
///  1. `payment_id` (preferred) — server retrieves the pending announcement.
///  2. `announcement` (fallback) — accepted only if the server restarted and
///     the pending entry expired; logged for observability.
pub async fn publish_announcement(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PublishAnnouncementRequest>,
) -> Result<Json<PublishAnnouncementResponse>> {
    let tx_hash = req.tx_hash.trim();
    if tx_hash.is_empty() {
        return Err(ApiError::bad_request(
            "tx_hash is required and cannot be empty",
        ));
    }

    let mut announcement = match (req.payment_id, req.announcement) {
        // Happy path: server-authoritative announcement bound to a payment_id.
        (Some(pid), _) => {
            let pending = state.pending_payments.take(&pid).ok_or_else(|| {
                ApiError::bad_request(
                    "Unknown or expired payment_id. Re-create the stealth payment.",
                )
            })?;
            debug!(payment_id = %pid, view_tag = pending.announcement.view_tag, "Resolved pending payment");
            pending.announcement
        }
        // Fallback: client provided the full create-time announcement DTO.
        (None, Some(dto)) => {
            tracing::warn!(
                "Publish via announcement fallback (no payment_id). Verify clients are up-to-date."
            );
            let mut ann: Announcement =
                dto.try_into()
                    .map_err(|e: specter_core::error::SpecterError| {
                        ApiError::bad_request(format!("Invalid announcement: {}", e))
                    })?;
            // Force fresh id assignment by the registry.
            ann.id = 0;
            ann
        }
        (None, None) => {
            return Err(ApiError::bad_request(
                "Either payment_id or announcement is required",
            ));
        }
    };

    announcement.tx_hash = Some(tx_hash.to_string());
    announcement.amount = req.amount.filter(|s| !s.trim().is_empty());
    announcement.chain = req.chain.filter(|s| !s.trim().is_empty());

    let view_tag = announcement.view_tag;

    let id = state
        .registry
        .publish(announcement)
        .await
        .map_err(|e| ApiError::bad_request(format!("Invalid announcement: {}", e)))?;

    info!(id, view_tag, "Published announcement");

    Ok(Json(PublishAnnouncementResponse { id, success: true }))
}

/// GET /api/v1/registry/announcements
pub async fn list_announcements(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ListAnnouncementsQuery>,
) -> Result<Json<ListAnnouncementsResponse>> {
    let announcements = if let Some(tag) = params.view_tag {
        state
            .registry
            .get_by_view_tag(tag)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?
    } else if let (Some(from), Some(to)) = (params.from_timestamp, params.to_timestamp) {
        state
            .registry
            .get_by_time_range(from, to)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?
    } else {
        state.registry.all_announcements().await
    };

    let total = announcements.len() as u64;

    let offset = params.offset.unwrap_or(0) as usize;
    let limit = params.limit.unwrap_or(100) as usize;

    let paginated: Vec<AnnouncementDto> = announcements
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(AnnouncementDto::from)
        .collect();

    Ok(Json(ListAnnouncementsResponse {
        announcements: paginated,
        total,
    }))
}

/// GET /api/v1/registry/stats
pub async fn get_registry_stats(
    State(state): State<Arc<AppState>>,
) -> Result<Json<RegistryStatsResponse>> {
    let stats = state.registry.stats().await;

    let distribution: Vec<ViewTagCount> = stats
        .view_tag_distribution
        .iter()
        .enumerate()
        .filter(|(_, &count)| count > 0)
        .map(|(tag, &count)| ViewTagCount {
            tag: tag as u8,
            count,
        })
        .collect();

    Ok(Json(RegistryStatsResponse {
        total_announcements: stats.total_count,
        view_tag_distribution: distribution,
    }))
}

static START_TIME: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

/// GET /health
pub async fn health_check(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    let start = START_TIME.get_or_init(Instant::now);
    let uptime = start.elapsed().as_secs();

    let count = state.registry.count().await.unwrap_or(0);

    Json(HealthResponse {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        uptime_seconds: uptime,
        announcements_count: count,
        use_testnet: state.config.use_testnet,
    })
}

