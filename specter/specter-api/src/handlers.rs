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
use specter_crypto::generate_keypair;
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
    let spending = generate_keypair();
    let viewing = generate_keypair();

    let meta = MetaAddress::new(
        KyberPublicKey::from_array(*spending.public.as_array()),
        KyberPublicKey::from_array(*viewing.public.as_array()),
    );

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
    let payment_id = state.pending_payments.insert(ann.clone(), payment.shared_secret);

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
        spending_pk: result.meta_address.spending_pk.to_hex(),
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
        spending_pk: result.meta_address.spending_pk.to_hex(),
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
    let (mut announcement, shared_secret) = resolve_pending_announcement(&state, &req)?;

    // ── 2. Enrich with client-supplied payment metadata ───────────────────────
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
    if let (Some(ptx), Some(chain_name)) =
        (&announcement.payment_tx_hash, &announcement.chain)
    {
        match state.config.chain_rpc_map.get(chain_name.as_str()) {
            Some(rpc_url) => {
                verifier::verify_payment_tx(rpc_url, ptx).await.map_err(|e| {
                    warn!(chain = %chain_name, tx = %ptx, "Payment verification failed: {e:?}");
                    e
                })?;
                debug!(chain = %chain_name, tx = %ptx, "Payment verified on source chain");
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

    // ── 5. Relay or accept dev-mode tx_hash ───────────────────────────────────
    let monad_tx_hash = if let Some(relayer) = &state.relayer_config {
        relay_announcement(&announcement, relayer, shared_secret.as_ref()).await?
    } else {
        // Dev mode: client must supply tx_hash directly
        req.tx_hash
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                ApiError::bad_request(
                    "tx_hash is required when the relayer is not configured (dev mode). \
                     Set RELAYER_PRIVATE_KEY to enable server-side relay.",
                )
            })?
            .to_string()
    };

    announcement.tx_hash = Some(monad_tx_hash.clone());
    let view_tag = announcement.view_tag;
    let chain_for_tel = announcement.chain.clone();
    let chain_id_for_tel = announcement.source_chain_id;

    // ── 6. Write to registry ──────────────────────────────────────────────────
    let id = state
        .registry
        .publish(announcement)
        .await
        .map_err(|e| ApiError::bad_request(format!("Publish failed: {e}")))?;

    let elapsed_ms = request_start.elapsed().as_millis() as u64;

    info!(
        id,
        view_tag,
        monad_tx_hash = %monad_tx_hash,
        "Published announcement"
    );

    // ── 7. Telemetry (best-effort) ────────────────────────────────────────────
    let ip = extract_client_ip(&headers, maybe_connect.as_ref());
    let ua = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    state
        .registry
        .write_telemetry(
            "announce",
            Some(&ip.to_string()),
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
        relayer_ok,
        turso_ok,
        poller_last_block,
        poller_ok,
    })
}

// ── private helpers ────────────────────────────────────────────────────────────

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
/// Returns `(announcement, shared_secret)` where `shared_secret` is `Some` only for
/// the `payment_id` path. The fallback (raw `announcement`) has no secret available
/// and metadata will be emitted in plaintext.
fn resolve_pending_announcement(
    state: &AppState,
    req: &PublishAnnouncementRequest,
) -> Result<(Announcement, Option<[u8; 32]>)> {
    match (req.payment_id, req.announcement.as_ref()) {
        (Some(pid), _) => {
            let pending = state.pending_payments.take(&pid).ok_or_else(|| {
                ApiError::bad_request(
                    "Unknown or expired payment_id. Re-create the stealth payment \
                     via POST /api/v1/stealth/create.",
                )
            })?;
            debug!(payment_id = %pid, view_tag = pending.announcement.view_tag, "Resolved pending payment");
            let secret = pending.shared_secret;
            Ok((pending.announcement, Some(secret)))
        }
        (None, Some(dto)) => {
            warn!("Publish via announcement fallback (no payment_id). Metadata will not be encrypted.");
            let mut ann: Announcement =
                dto.clone().try_into().map_err(|e: specter_core::error::SpecterError| {
                    ApiError::bad_request(format!("Invalid announcement: {}", e))
                })?;
            ann.id = 0;
            Ok((ann, None))
        }
        (None, None) => Err(ApiError::bad_request(
            "Either payment_id or announcement is required",
        )),
    }
}

/// Broadcasts the announcement on Monad via the server-side relayer.
/// Returns the Monad transaction hash as a lowercase hex string.
///
/// When `shared_secret` is `Some`, metadata bytes [1..76] are AES-256-GCM encrypted
/// so the on-chain event leaks only the view_tag. When `None` (fallback path),
/// metadata is emitted in plaintext.
async fn relay_announcement(
    announcement: &Announcement,
    relayer: &crate::state::RelayerConfig,
    shared_secret: Option<&[u8; 32]>,
) -> Result<String> {
    let stealth_addr_str = announcement
        .stealth_address
        .as_deref()
        .ok_or_else(|| ApiError::internal("stealth_address missing from pending payment"))?;

    let stealth_addr: Address = stealth_addr_str
        .parse()
        .map_err(|e| ApiError::internal(format!("Invalid stealth_address '{stealth_addr_str}': {e}")))?;

    let ek_arr: [u8; 1088] = announcement
        .ephemeral_key
        .as_slice()
        .try_into()
        .map_err(|_| ApiError::internal("ephemeral_key must be 1088 bytes"))?;

    let metadata = build_on_chain_metadata(announcement, shared_secret);

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
        &metadata,
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
/// When `shared_secret` is `Some`, returns 93 bytes (AES-256-GCM encrypted).
/// When `None`, returns 77 bytes (plaintext). The contract accepts both sizes.
fn build_on_chain_metadata(ann: &Announcement, shared_secret: Option<&[u8; 32]>) -> Vec<u8> {
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

    match shared_secret {
        Some(secret) => specter_crypto::encrypt_announcement_metadata(&plaintext, secret).to_vec(),
        None => {
            warn!("publishing announcement without metadata encryption (no shared secret)");
            plaintext.to_vec()
        }
    }
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
    if let Some(cf_ip) = headers.get("cf-connecting-ip").and_then(|v| v.to_str().ok()) {
        if let Ok(ip) = cf_ip.trim().parse::<IpAddr>() {
            return ip;
        }
    }
    connect_info
        .map(|ci| ci.0.ip())
        .unwrap_or_else(|| IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
}
