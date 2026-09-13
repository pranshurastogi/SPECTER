//! API route handlers.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Instant;

use alloy::primitives::Address;
use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::{header, HeaderMap},
    response::IntoResponse,
    Json,
};
use specter_core::types::AnnouncementMetadata;
use tracing::{debug, info, warn};

use specter_core::traits::AnnouncementRegistry;
use specter_core::types::{Announcement, KyberPublicKey, MetaAddress};
use specter_crypto::{generate_keypair, generate_spending_keypair};
use specter_stealth::create_stealth_payment;

use crate::dto::*;
use crate::error::ApiError;
use crate::state::AppState;
use crate::verifier;

type Result<T> = std::result::Result<T, ApiError>;

// ── key generation ────────────────────────────────────────────────────────────

/// POST /api/v1/keys/generate
pub async fn generate_keys(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<GenerateKeysResponse>> {
    let spending = generate_spending_keypair();
    let viewing = generate_keypair();

    let meta = MetaAddress::new(
        spending.public.clone(),
        KyberPublicKey::from_array(*viewing.public.as_array()),
    );

    let response = GenerateKeysResponse {
        spending_pub: spending.public.to_hex(),
        spending_sk: hex::encode(spending.secret.as_bytes()),
        viewing_pk: hex::encode(viewing.public.as_bytes()),
        viewing_sk: hex::encode(viewing.secret.as_bytes()),
        meta_address: meta.to_hex(),
        protocol_version: specter_core::constants::PROTOCOL_VERSION,
    };

    info!("Generated new SPECTER keys (protocol v2, secp256k1 spending)");
    Ok(Json(response))
}

// ── stealth payment creation ──────────────────────────────────────────────────

/// POST /api/v1/stealth/create
pub async fn create_stealth(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateStealthRequest>,
) -> Result<Json<CreateStealthResponse>> {
    let meta = MetaAddress::from_hex(&req.meta_address)
        .map_err(|e| ApiError::bad_request(format!("Invalid meta_address: {}", e)))?;

    let payment = create_stealth_payment(&meta)
        .map_err(|e| ApiError::internal(format!("Failed to create stealth payment: {}", e)))?;

    // Attach stealth_address so the relayer can call announce(stealth_addr, …) later.
    let mut ann = payment.announcement.clone();
    ann.stealth_address = Some(payment.stealth_address.to_checksum_string());
    let payment_id = state
        .pending_payments
        .insert(ann.clone(), payment.shared_secret)
        .await
        .map_err(|e| ApiError::internal(format!("pending persist failed: {e}")))?;

    let response = CreateStealthResponse {
        payment_id,
        stealth_address: payment.stealth_address.to_checksum_string(),
        stealth_sui_address: payment.stealth_sui_address.to_hex_string(),
        ephemeral_ciphertext: hex::encode(&ann.ephemeral_key),
        view_tag: ann.view_tag,
        announcement: AnnouncementDto::from(ann),
    };

    debug!(
        payment_id = %response.payment_id,
        stealth_address = %response.stealth_address,
        view_tag = response.view_tag,
        "Created stealth payment"
    );

    Ok(Json(response))
}

// ── scan ──────────────────────────────────────────────────────────────────────

/// POST /api/v1/stealth/scan
pub async fn scan_payments(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ScanRequest>,
) -> Result<Json<ScanResponse>> {
    let start = Instant::now();

    let viewing_sk = hex::decode(strip_hex_prefix(&req.viewing_sk))?;
    let spending_pub = hex::decode(strip_hex_prefix(&req.spending_pub))?;

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
        &spending_pub,
    );

    let elapsed = start.elapsed();
    let duration_ms = elapsed.as_millis() as u64;

    let discovery_dtos: Vec<DiscoveryDto> = discoveries
        .into_iter()
        .map(|d| DiscoveryDto {
            stealth_address: d.payment.address.to_checksum_string(),
            stealth_sui_address: d.payment.sui_address.to_hex_string(),
            shared_secret: hex::encode(d.payment.shared_secret),
            announcement_id: d.announcement.id,
            timestamp: d.announcement.timestamp,
            tx_hash: d.announcement.tx_hash.clone(),
            payment_tx_hash: d.announcement.payment_tx_hash.clone(),
            amount: d.announcement.amount.clone().unwrap_or_default(),
            chain: d.announcement.chain.clone().unwrap_or_default(),
            source_chain_id: d.announcement.source_chain_id,
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

// ── ENS / SuiNS / IPFS ────────────────────────────────────────────────────────

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

    Ok(Json(ResolveEnsResponse {
        ens_name: result.ens_name,
        meta_address: result.meta_address.to_hex(),
        spending_pub: result.meta_address.spending_pub.to_hex(),
        viewing_pk: result.meta_address.viewing_pk.to_hex(),
        ipfs_cid: if result.ipfs_cid.is_empty() {
            None
        } else {
            Some(result.ipfs_cid)
        },
    }))
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

    Ok(Json(ResolveSuinsResponse {
        suins_name: result.suins_name,
        meta_address: result.meta_address.to_hex(),
        spending_pub: result.meta_address.spending_pub.to_hex(),
        viewing_pk: result.meta_address.viewing_pk.to_hex(),
        ipfs_cid: if result.ipfs_cid.is_empty() {
            None
        } else {
            Some(result.ipfs_cid)
        },
    }))
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

/// GET /api/v1/ipfs/:cid
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

// ── registry publish ───────────────────────────────────────────────────────────

/// POST /api/v1/registry/announcements
///
/// Full publish flow:
///   1. Resolve announcement from `payment_id` (preferred) or `announcement` (fallback).
///   2. Validate ephemeral key size (must be 1088 bytes, non-zero).
///   3. If `payment_tx_hash` + matching CHAIN_RPC_* env var: verify tx on source chain RPC.
///   4. If relayer configured: broadcast `announce()` on Monad, return monad_tx_hash.
///      If no relayer (dev mode): require client-supplied `tx_hash`.
///   5. Write to registry with `record_source = 'api'`.
pub async fn publish_announcement(
    maybe_connect: Option<ConnectInfo<SocketAddr>>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Json(req): Json<PublishAnnouncementRequest>,
) -> Result<Json<PublishAnnouncementResponse>> {
    let request_start = Instant::now();

    // ── 1. Resolve announcement ───────────────────────────────────────────────
    // The take is atomic (that is what keeps `payment_id` single-use against
    // concurrent requests), but it happens before the payment is verified and
    // relayed. If anything downstream fails, put the entry back: otherwise a
    // transient RPC error permanently burns the id and the client's retry falls
    // back to a publish with no shared secret — silently dropping the payment
    // metadata that the encrypted path would have carried.
    let (announcement, shared_secret, taken) = resolve_pending_announcement(&state, &req).await?;

    let mut committed = false;
    let result = publish_resolved(
        &state,
        &req,
        &headers,
        maybe_connect.as_ref(),
        request_start,
        announcement,
        shared_secret,
        &mut committed,
    )
    .await;

    if result.is_err() && !committed {
        if let Some((pid, payment)) = taken {
            if let Err(e) = state.pending_payments.restore(&pid, payment).await {
                // Best-effort: the publish already failed, and losing the entry
                // only costs the user a re-create. Never mask the real error.
                warn!(payment_id = %pid, "Failed to restore pending payment: {e}");
            }
        }
    }

    result
}

/// The publish flow proper, running against an already-resolved announcement.
///
/// `committed` is set the instant the `announce()` transaction is broadcast.
/// Past that point the announcement is irreversibly public, so the caller must
/// not restore the pending entry — doing so would allow the same payment to be
/// announced twice.
#[allow(clippy::too_many_arguments)]
async fn publish_resolved(
    state: &Arc<AppState>,
    req: &PublishAnnouncementRequest,
    headers: &HeaderMap,
    maybe_connect: Option<&ConnectInfo<SocketAddr>>,
    request_start: Instant,
    mut announcement: Announcement,
    shared_secret: Option<[u8; 32]>,
    committed: &mut bool,
) -> Result<Json<PublishAnnouncementResponse>> {
    // ── 2. Local-only payment metadata (kept transiently, NOT persisted plaintext)
    announcement.payment_tx_hash = req
        .payment_tx_hash
        .clone()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    announcement.amount = req
        .amount
        .clone()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    announcement.chain = req
        .chain
        .clone()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(chain_id) = req.source_chain_id {
        announcement.source_chain_id = Some(chain_id);
    }

    // ── 3. Validate ephemeral key ─────────────────────────────────────────────
    let ek_len = announcement.ephemeral_key.len();
    if ek_len != 1088 {
        return Err(ApiError::bad_request(format!(
            "ephemeral_key must be exactly 1088 bytes, got {ek_len}"
        )));
    }
    if announcement.ephemeral_key.iter().all(|&b| b == 0) {
        return Err(ApiError::bad_request("ephemeral_key cannot be all zeros"));
    }

    // ── 4. Verify payment on source chain ─────────────────────────────────────
    if let (Some(ptx), Some(chain_name)) = (&announcement.payment_tx_hash, &announcement.chain) {
        match state.config.chain_rpc_map.get(chain_name.as_str()) {
            Some(rpc_urls) => {
                let stealth = announcement.stealth_address.as_deref().unwrap_or_default();
                let amount_u256 = announcement
                    .amount
                    .as_deref()
                    .map(parse_amount_u256)
                    .unwrap_or(alloy::primitives::U256::ZERO);
                let token = req
                    .token
                    .as_deref()
                    .and_then(|t| t.parse::<alloy::primitives::Address>().ok());
                verifier::verify_payment_tx(rpc_urls, ptx, stealth, amount_u256, token)
                    .await
                    .map_err(|e| {
                        warn!(chain = %chain_name, tx = %ptx, "Payment verification failed: {e:?}");
                        e
                    })?;
                debug!(chain = %chain_name, tx = %ptx, "Payment verified to stealth address");
            }
            None => {
                warn!(
                    chain = %chain_name,
                    "No RPC configured for chain — skipping payment verification. \
                     Set CHAIN_RPC_{} to enable.",
                    chain_name.to_uppercase().replace('-', "_")
                );
            }
        }
    }

    // ── 5. Build the encrypted blob + dedup MAC + key hash (BEFORE stripping) ──
    // build_on_chain_metadata reads the plaintext payment fields, so it must run
    // before they are nulled below.
    let metadata_blob = build_on_chain_metadata(&announcement, shared_secret.as_ref());
    if let (Some(keys), Some(ptx)) = (
        state.db_keys.as_ref(),
        announcement.payment_tx_hash.as_deref(),
    ) {
        announcement.payment_tx_hash_hmac = Some(keys.payment_hmac(&ptx.trim().to_lowercase()));
    }
    announcement.ephemeral_key_hash =
        Some(specter_crypto::hash::keccak256(&announcement.ephemeral_key).to_vec());
    announcement.metadata_blob = Some(metadata_blob.clone());

    // Capture telemetry fields before stripping (source_chain_id is nulled below).
    let view_tag = announcement.view_tag;
    let chain_for_tel = announcement.chain.clone();
    let chain_id_for_tel = req.source_chain_id;

    // Strip plaintext payment fields from the PERSISTED row (they live only in the blob).
    announcement.payment_tx_hash = None;
    announcement.amount = None;
    announcement.source_chain_id = None;
    announcement.tx_hash = None;

    // ── 6. Reserve the dedup slot BEFORE relaying ─────────────────────────────
    let reserved_id = match state.registry.reserve_announcement(&announcement).await {
        Ok(id) => id,
        Err(specter_core::error::SpecterError::DuplicatePayment) => {
            return Err(ApiError::conflict("announcement could not be published"));
        }
        Err(e) => return Err(ApiError::internal(format!("reserve failed: {e}"))),
    };

    // ── 7. Relay (or accept dev-mode tx_hash) using the SAME blob ─────────────
    // Any failure from here on releases the reservation: otherwise the row
    // (on_chain = 0, tx_hash = NULL) would keep occupying the dedup UNIQUE
    // index and every retry of this payment would 409 as a false duplicate.
    let relay_result = if let Some(relayer) = &state.relayer_config {
        relay_announcement(&announcement, relayer, &metadata_blob).await
    } else {
        // Dev mode: client must supply tx_hash directly
        req.tx_hash
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or_else(|| {
                ApiError::bad_request(
                    "tx_hash is required when the relayer is not configured (dev mode). \
                     Set RELAYER_PRIVATE_KEY to enable server-side relay.",
                )
            })
    };
    let monad_tx_hash = match relay_result {
        Ok(hash) => {
            // The announce() tx is out. The payment is public from here on, so
            // the pending entry must stay consumed no matter what follows.
            *committed = true;
            hash
        }
        Err(e) => {
            release_reservation_best_effort(state, reserved_id, view_tag).await;
            return Err(e);
        }
    };

    // ── 8. Finalize the reserved row ──────────────────────────────────────────
    if let Err(e) = state
        .registry
        .finalize_announcement(reserved_id, view_tag, &monad_tx_hash)
        .await
    {
        // The relay tx is already out; releasing here would allow a duplicate
        // announce. Keep the reservation (it will age into reclaimable state
        // only if genuinely abandoned) and surface the error.
        return Err(ApiError::internal(format!("finalize failed: {e}")));
    }
    let id = reserved_id;
    announcement.tx_hash = Some(monad_tx_hash.clone());

    let elapsed_ms = request_start.elapsed().as_millis() as u64;

    info!(
        id,
        view_tag,
        monad_tx_hash = %monad_tx_hash,
        "Published announcement"
    );

    // ── 7. Telemetry (best-effort) ────────────────────────────────────────────
    let ip = extract_client_ip(headers, maybe_connect);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let ip_hash = state
        .db_keys
        .as_ref()
        .map(|k| k.telemetry_ip_hash(&ip.to_string(), now));
    let ua = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    state
        .registry
        .write_telemetry(
            "announce",
            ip_hash.as_deref(),
            ua.as_deref(),
            chain_for_tel.as_deref(),
            chain_id_for_tel,
            Some(view_tag),
            "success",
            None,
            elapsed_ms,
        )
        .await;

    Ok(Json(PublishAnnouncementResponse {
        id,
        success: true,
        monad_tx_hash: Some(monad_tx_hash),
    }))
}

// ── registry list / stats ──────────────────────────────────────────────────────

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

// ── sweep records (claim-flow history) ─────────────────────────────────────────

const MAX_SWEEP_ROWS: usize = 200;
const SWEEP_LIST_LIMIT: u64 = 500;

fn is_lower_hex_64(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn is_decimal_amount(s: &str) -> bool {
    !s.is_empty() && s.len() <= 40 && s.bytes().all(|b| b.is_ascii_digit())
}

fn is_tx_hash_or_empty(s: &str) -> bool {
    s.is_empty()
        || (s.len() == 66 && s.starts_with("0x") && s[2..].bytes().all(|b| b.is_ascii_hexdigit()))
}

fn validate_sweep_request(req: &RecordSweepsRequest) -> Result<()> {
    if req.receipt_id.is_empty() || req.receipt_id.len() > 64 {
        return Err(ApiError::validation("receipt_id must be 1–64 chars"));
    }
    if !is_lower_hex_64(&req.identity_hash) {
        return Err(ApiError::validation(
            "identity_hash must be 64 lowercase hex chars (SHA-256)",
        ));
    }
    if req.chain.is_empty() || req.chain.len() > 32 {
        return Err(ApiError::validation("chain must be 1–32 chars"));
    }
    if req.destination.parse::<Address>().is_err() {
        return Err(ApiError::validation(
            "destination must be a valid EVM address",
        ));
    }
    if req.destination_input.is_empty() || req.destination_input.len() > 256 {
        return Err(ApiError::validation(
            "destination_input must be 1–256 chars",
        ));
    }
    if req.records.is_empty() || req.records.len() > MAX_SWEEP_ROWS {
        return Err(ApiError::validation(format!(
            "records must contain 1–{MAX_SWEEP_ROWS} rows"
        )));
    }
    for r in &req.records {
        if r.id.is_empty() || r.id.len() > 64 {
            return Err(ApiError::validation("record id must be 1–64 chars"));
        }
        if r.stealth_address.parse::<Address>().is_err() {
            return Err(ApiError::validation(
                "record stealth_address must be a valid EVM address",
            ));
        }
        if !is_decimal_amount(&r.amount_base) || !is_decimal_amount(&r.fee_base) {
            return Err(ApiError::validation(
                "amount_base and fee_base must be decimal base-unit strings",
            ));
        }
        if !is_tx_hash_or_empty(&r.tx_hash) {
            return Err(ApiError::validation(
                "record tx_hash must be a 0x-prefixed 32-byte hash or empty",
            ));
        }
        if !matches!(r.status.as_str(), "confirmed" | "failed" | "skipped_dust") {
            return Err(ApiError::validation(
                "record status must be confirmed | failed | skipped_dust",
            ));
        }
        if r.status == "confirmed" && r.tx_hash.is_empty() {
            return Err(ApiError::validation(
                "record tx_hash is required when status is confirmed",
            ));
        }
    }
    Ok(())
}

/// POST /api/v1/sweeps
///
/// Records the rows of a completed claim operation. Idempotent per row id.
/// Requires the Turso backend; recording is best-effort on the client, so a
/// 503 here never blocks a user's claim.
pub async fn record_sweeps(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RecordSweepsRequest>,
) -> Result<Json<RecordSweepsResponse>> {
    validate_sweep_request(&req)?;

    let Some(store) = state.sweep_store.as_ref() else {
        return Err(ApiError::new(
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "sweep records require the Turso backend",
            "SWEEPS_UNAVAILABLE",
        ));
    };

    let rows: Vec<specter_registry::turso::SweepRecord> = req
        .records
        .iter()
        .map(|r| specter_registry::turso::SweepRecord {
            id: r.id.clone(),
            receipt_id: req.receipt_id.clone(),
            identity_hash: req.identity_hash.clone(),
            chain: req.chain.clone(),
            stealth_address: r.stealth_address.clone(),
            destination: req.destination.clone(),
            destination_input: req.destination_input.clone(),
            amount_base: r.amount_base.clone(),
            fee_base: r.fee_base.clone(),
            tx_hash: r.tx_hash.clone(),
            status: r.status.clone(),
            created_at: 0,
        })
        .collect();

    let inserted = store
        .insert_batch(&rows)
        .await
        .map_err(|e| ApiError::internal(format!("sweep insert failed: {e}")))?;

    info!(
        receipt_id = %req.receipt_id,
        rows = rows.len(),
        inserted,
        "sweep records stored"
    );
    Ok(Json(RecordSweepsResponse { inserted }))
}

/// POST /api/v1/sweeps/history
///
/// Returns an identity's sweep history, newest first. The identity hash is
/// computed client-side (HMAC-SHA256 keyed on the secret viewing key — see
/// [`RecordSweepsRequest::identity_hash`]). This is a POST with the hash in
/// the JSON body, not a GET with the hash in the URL path, so this
/// bearer-equivalent value never lands in server access logs, CDN logs, or
/// browser history.
pub async fn list_sweeps(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ListSweepsRequest>,
) -> Result<Json<ListSweepsResponse>> {
    if !is_lower_hex_64(&req.identity_hash) {
        return Err(ApiError::validation(
            "identity_hash must be 64 lowercase hex chars (HMAC-SHA256)",
        ));
    }

    let Some(store) = state.sweep_store.as_ref() else {
        return Err(ApiError::new(
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "sweep records require the Turso backend",
            "SWEEPS_UNAVAILABLE",
        ));
    };

    let rows = store
        .list_by_identity(&req.identity_hash, SWEEP_LIST_LIMIT)
        .await
        .map_err(|e| ApiError::internal(format!("sweep list failed: {e}")))?;

    let sweeps: Vec<SweepRecordDto> = rows
        .into_iter()
        .map(|r| SweepRecordDto {
            id: r.id,
            receipt_id: r.receipt_id,
            chain: r.chain,
            stealth_address: r.stealth_address,
            destination: r.destination,
            destination_input: r.destination_input,
            amount_base: r.amount_base,
            fee_base: r.fee_base,
            tx_hash: r.tx_hash,
            status: r.status,
            created_at: r.created_at,
        })
        .collect();

    let total = sweeps.len() as u64;
    Ok(Json(ListSweepsResponse { sweeps, total }))
}

// ── health ─────────────────────────────────────────────────────────────────────

static START_TIME: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

/// GET /health
pub async fn health_check(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    let start = START_TIME.get_or_init(Instant::now);
    let uptime = start.elapsed().as_secs();

    let count = state.registry.count().await.unwrap_or(0);
    let turso_ok = state.registry.health_check().await.is_ok();
    let relayer_ok = state.relayer_config.is_some();

    let poller_last_block = state.registry.get_poller_last_block().await;
    let poller_ok = poller_last_block.map(|b| b > 0).unwrap_or(false);

    let status = if turso_ok { "ok" } else { "degraded" }.to_string();

    Json(HealthResponse {
        status,
        version: env!("CARGO_PKG_VERSION").into(),
        uptime_seconds: uptime,
        announcements_count: count,
        use_testnet: state.config.use_testnet,
        use_sui_testnet: state.config.use_sui_testnet,
        relayer_ok,
        turso_ok,
        poller_last_block,
        poller_ok,
    })
}

// ── private helpers ────────────────────────────────────────────────────────────

/// Releases a reservation after a failed relay, logging instead of masking the
/// original error if the cleanup itself fails (the stale-reservation reclaim
/// in `reserve_announcement` is the fallback for rows this misses).
async fn release_reservation_best_effort(state: &AppState, id: u64, view_tag: u8) {
    if let Err(e) = state.registry.release_reservation(id, view_tag).await {
        warn!(
            id,
            "failed to release reservation after publish failure: {e}"
        );
    }
}

fn strip_hex_prefix(s: &str) -> &str {
    let s = s.trim();
    if s.len() >= 2 && s.get(..2).map(|p| p.eq_ignore_ascii_case("0x")) == Some(true) {
        &s[2..]
    } else {
        s
    }
}

/// Resolves an `Announcement` and its associated shared secret from the pending store.
///
/// Returns `(announcement, shared_secret, taken)`.
///
/// `shared_secret` is `Some` only for the `payment_id` path; the raw-announcement
/// fallback has no secret, so its metadata is published view-tag-only.
///
/// `taken` carries the consumed pending entry so the caller can put it back if
/// the publish does not commit. The take stays atomic — that is what keeps
/// `payment_id` single-use under concurrent requests — but a publish that never
/// reached the relayer must not burn it.
type TakenPending = Option<(uuid::Uuid, crate::pending::PendingPayment)>;

async fn resolve_pending_announcement(
    state: &AppState,
    req: &PublishAnnouncementRequest,
) -> Result<(Announcement, Option<[u8; 32]>, TakenPending)> {
    match (req.payment_id, req.announcement.as_ref()) {
        (Some(pid), _) => {
            let pending = state
                .pending_payments
                .take(&pid)
                .await
                .map_err(|e| ApiError::internal(format!("pending lookup failed: {e}")))?
                .ok_or_else(|| {
                    ApiError::bad_request(
                        "Unknown or expired payment_id. Re-create the stealth payment \
                     via POST /api/v1/stealth/create.",
                    )
                })?;
            debug!(payment_id = %pid, view_tag = pending.announcement.view_tag, "Resolved pending payment");
            let secret = pending.shared_secret;
            Ok((
                pending.announcement.clone(),
                Some(secret),
                Some((pid, pending)),
            ))
        }
        (None, Some(dto)) => {
            warn!(
                "Publish via announcement fallback (no payment_id). Payment metadata will be \
                 omitted from the on-chain blob — it cannot be encrypted without the secret."
            );
            let mut ann: Announcement =
                dto.clone()
                    .try_into()
                    .map_err(|e: specter_core::error::SpecterError| {
                        ApiError::bad_request(format!("Invalid announcement: {}", e))
                    })?;
            ann.id = 0;
            Ok((ann, None, None))
        }
        (None, None) => Err(ApiError::bad_request(
            "Either payment_id or announcement is required",
        )),
    }
}

/// Broadcasts the announcement on Monad via the server-side relayer.
/// Returns the Monad transaction hash as a lowercase hex string.
///
/// `metadata` is the pre-built on-chain blob — the SAME bytes persisted in the
/// registry row, so the stored and relayed metadata are byte-identical.
async fn relay_announcement(
    announcement: &Announcement,
    relayer: &crate::state::RelayerConfig,
    metadata: &[u8],
) -> Result<String> {
    let stealth_addr_str = announcement
        .stealth_address
        .as_deref()
        .ok_or_else(|| ApiError::internal("stealth_address missing from pending payment"))?;

    let stealth_addr: Address = stealth_addr_str.parse().map_err(|e| {
        ApiError::internal(format!("Invalid stealth_address '{stealth_addr_str}': {e}"))
    })?;

    let ek_arr: [u8; 1088] = announcement
        .ephemeral_key
        .as_slice()
        .try_into()
        .map_err(|_| ApiError::internal("ephemeral_key must be 1088 bytes"))?;

    let announcer_addr: Address = relayer
        .announcer_addr
        .parse()
        .map_err(|e| ApiError::internal(format!("Invalid announcer address: {e}")))?;

    let hash = specter_chain::announcer::publish_announcement(
        &relayer.monad_rpc_url,
        relayer.signer.clone(),
        announcer_addr,
        stealth_addr,
        &ek_arr,
        metadata,
    )
    .await
    .map_err(|e| {
        warn!(error = %e, "Relayer failed to broadcast announcement");
        ApiError::internal(format!("Relay failed: {e}"))
    })?;

    Ok(format!("{hash}"))
}

/// Encodes on-chain metadata from an announcement's payment fields.
///
/// With a `shared_secret`, returns 93 bytes (AES-256-GCM over the full
/// metadata). Without one, returns a 77-byte blob carrying **only the view
/// tag** — the payment fields are omitted, not published in the clear.
///
/// Emitting them in plaintext would put the funding transaction hash, the
/// amount, and the source chain id on-chain right next to the stealth address,
/// handing an observer the sender→stealth-address link and the value directly.
/// Discovery does not need them: the recipient matches on the view tag, then
/// derives the stealth key and reads live balances. So the safe degradation is
/// "less convenience metadata", never "less privacy".
fn build_on_chain_metadata(ann: &Announcement, shared_secret: Option<&[u8; 32]>) -> Vec<u8> {
    let Some(secret) = shared_secret else {
        warn!(
            view_tag = ann.view_tag,
            "no shared secret for this announcement — publishing a view-tag-only blob and \
             omitting payment metadata (tx hash, amount, source chain)"
        );
        return AnnouncementMetadata::new(ann.view_tag).encode().to_vec();
    };

    let mut meta = AnnouncementMetadata::new(ann.view_tag);

    if let Some(ptx) = &ann.payment_tx_hash {
        let bytes = hex_str_to_bytes32(ptx);
        if bytes.iter().any(|&b| b != 0) {
            meta = meta.with_tx_hash(bytes);
        }
    }

    if let Some(amt) = &ann.amount {
        let bytes = amount_str_to_bytes32(amt);
        if bytes.iter().any(|&b| b != 0) {
            meta = meta.with_amount(bytes);
        }
    }

    if let Some(chain_id) = ann.source_chain_id {
        meta = meta.with_source_chain_id(chain_id);
    }

    let plaintext = meta.encode();
    specter_crypto::encrypt_announcement_metadata(&plaintext, secret).to_vec()
}

/// Parses a hex tx hash string ("0x..." or bare hex) into a 32-byte array.
fn hex_str_to_bytes32(s: &str) -> [u8; 32] {
    let hex = strip_hex_prefix(s.trim());
    let mut buf = [0u8; 32];
    if let Ok(decoded) = hex::decode(hex) {
        if decoded.len() == 32 {
            buf.copy_from_slice(&decoded);
        }
    }
    buf
}

/// Parses a wei amount string (decimal or "0x..." hex) into a 32-byte big-endian uint256.
fn amount_str_to_bytes32(s: &str) -> [u8; 32] {
    let s = s.trim();
    let mut buf = [0u8; 32];

    if let Some(hex_str) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        if let Ok(decoded) = hex::decode(hex_str) {
            let start = 32usize.saturating_sub(decoded.len());
            let len = decoded.len().min(32);
            buf[start..start + len].copy_from_slice(&decoded[..len]);
        }
    } else if let Ok(n) = s.parse::<u128>() {
        buf[16..].copy_from_slice(&n.to_be_bytes());
    }

    buf
}

/// Parses a wei amount string (hex "0x..." or decimal) into a `U256`,
/// defaulting to `U256::ZERO` on parse failure.
fn parse_amount_u256(s: &str) -> alloy::primitives::U256 {
    let s = s.trim();
    let parsed = if let Some(hex_str) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        alloy::primitives::U256::from_str_radix(hex_str, 16)
    } else {
        alloy::primitives::U256::from_str_radix(s, 10)
    };
    parsed.unwrap_or(alloy::primitives::U256::ZERO)
}

/// Extracts the real client IP from forwarding headers or the socket address.
fn extract_client_ip(
    headers: &HeaderMap,
    connect_info: Option<&ConnectInfo<SocketAddr>>,
) -> IpAddr {
    // X-Forwarded-For: leftmost entry is the original client (set by proxies/CDNs)
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            if let Ok(ip) = first.trim().parse::<IpAddr>() {
                return ip;
            }
        }
    }
    // X-Real-IP: set by nginx
    if let Some(real_ip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        if let Ok(ip) = real_ip.trim().parse::<IpAddr>() {
            return ip;
        }
    }
    // CF-Connecting-IP: set by Cloudflare
    if let Some(cf_ip) = headers
        .get("cf-connecting-ip")
        .and_then(|v| v.to_str().ok())
    {
        if let Ok(ip) = cf_ip.trim().parse::<IpAddr>() {
            return ip;
        }
    }
    connect_info
        .map(|ci| ci.0.ip())
        .unwrap_or_else(|| IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
}

#[cfg(test)]
mod metadata_tests {
    use super::*;
    use specter_core::constants::KYBER_CIPHERTEXT_SIZE;

    /// A recognisable tx hash and amount so we can assert they never leak.
    const TX_HASH: &str = "0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
    const AMOUNT_WEI: &str = "1234567890000000000";
    const VIEW_TAG: u8 = 0x5A;

    fn tx_hash_bytes() -> Vec<u8> {
        hex::decode(TX_HASH.trim_start_matches("0x")).unwrap()
    }

    fn ann_with_payment_fields() -> Announcement {
        let mut a = Announcement::new(vec![0x42u8; KYBER_CIPHERTEXT_SIZE], VIEW_TAG);
        a.payment_tx_hash = Some(TX_HASH.to_string());
        a.amount = Some(AMOUNT_WEI.to_string());
        a.source_chain_id = Some(11_155_111);
        a
    }

    /// Returns true when `needle` appears anywhere in `haystack`.
    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        !needle.is_empty() && haystack.windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn without_a_secret_the_payment_fields_are_omitted_not_published_in_the_clear() {
        // The regression: a publish with no shared secret used to emit the
        // funding tx hash and amount as plaintext on-chain, next to the stealth
        // address — handing an observer the sender link and the value.
        let blob = build_on_chain_metadata(&ann_with_payment_fields(), None);

        assert!(
            !contains(&blob, &tx_hash_bytes()),
            "the source payment tx hash leaked into the on-chain blob"
        );
        assert_eq!(
            blob[0], VIEW_TAG,
            "the view tag must survive — discovery needs it"
        );
        assert_eq!(blob.len(), 77, "unencrypted blobs stay the 77-byte shape");
        assert!(
            blob[1..].iter().all(|&b| b == 0),
            "everything past the view tag must be zeroed, got {:?}",
            &blob[1..16]
        );
    }

    #[test]
    fn with_a_secret_the_fields_are_carried_but_encrypted() {
        let secret = [0x9Cu8; 32];
        let blob = build_on_chain_metadata(&ann_with_payment_fields(), Some(&secret));

        assert_eq!(blob.len(), 93, "AES-256-GCM blob is 93 bytes");
        assert!(
            !contains(&blob, &tx_hash_bytes()),
            "the tx hash must not appear in the ciphertext"
        );
    }

    #[test]
    fn the_two_paths_are_distinguishable_only_by_length_not_by_leaked_data() {
        let secret = [0x01u8; 32];
        let ann = ann_with_payment_fields();
        let encrypted = build_on_chain_metadata(&ann, Some(&secret));
        let omitted = build_on_chain_metadata(&ann, None);

        for blob in [&encrypted, &omitted] {
            assert!(!contains(blob, &tx_hash_bytes()), "tx hash leaked");
        }
        assert_ne!(encrypted.len(), omitted.len());
    }

    #[test]
    fn an_announcement_with_no_payment_fields_still_encodes_the_view_tag() {
        let ann = Announcement::new(vec![0x42u8; KYBER_CIPHERTEXT_SIZE], VIEW_TAG);
        let blob = build_on_chain_metadata(&ann, None);
        assert_eq!(blob[0], VIEW_TAG);
        assert_eq!(blob.len(), 77);
    }

    #[test]
    fn view_tag_survives_every_possible_value_without_a_secret() {
        // The view tag is the one field discovery depends on; an off-by-one in
        // the omission path would silently make payments undiscoverable.
        for tag in [0u8, 1, 0x7F, 0x80, 0xFE, 0xFF] {
            let mut a = ann_with_payment_fields();
            a.view_tag = tag;
            let blob = build_on_chain_metadata(&a, None);
            assert_eq!(blob[0], tag, "view tag {tag} did not survive");
        }
    }

    #[test]
    fn a_malformed_tx_hash_does_not_leak_partial_bytes() {
        let mut a = ann_with_payment_fields();
        a.payment_tx_hash = Some("0xnot-hex".to_string());
        let blob = build_on_chain_metadata(&a, None);
        assert!(blob[1..].iter().all(|&b| b == 0));
    }
}
