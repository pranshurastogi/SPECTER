//! DTOs for API requests and responses.

use serde::{Deserialize, Serialize};
use specter_core::types::Announcement;
use uuid::Uuid;

/// Response for key generation.
///
/// Note: there is intentionally **no** `view_tag` here. In SPECTER, every
/// announcement carries its own per-payment view tag derived from the
/// ML-KEM shared secret at create time; a wallet does **not** have a
/// stable view tag.
#[derive(Debug, Serialize)]
pub struct GenerateKeysResponse {
    /// Spending public key (hex)
    pub spending_pk: String,
    /// Spending secret key (hex) - HANDLE WITH CARE
    pub spending_sk: String,
    /// Viewing public key (hex)
    pub viewing_pk: String,
    /// Viewing secret key (hex) - HANDLE WITH CARE
    pub viewing_sk: String,
    /// Meta-address (hex-encoded, for ENS storage)
    pub meta_address: String,
}

/// Request to create a stealth payment.
#[derive(Debug, Deserialize)]
pub struct CreateStealthRequest {
    /// Meta-address (hex-encoded)
    pub meta_address: String,
}

/// Response for stealth payment creation.
///
/// The server holds the full announcement against `payment_id`. After the
/// sender broadcasts the on-chain tx they must POST to
/// `/api/v1/registry/announcements` with this `payment_id` so the server
/// publishes the announcement it built (preventing client-side view-tag
/// tampering). The full `announcement` DTO is also returned for clients
/// that want to retain a local copy as backup.
#[derive(Debug, Serialize)]
pub struct CreateStealthResponse {
    /// Server-held pending-payment identifier; required by publish.
    pub payment_id: Uuid,
    /// The stealth Ethereum address to send funds to
    pub stealth_address: String,
    /// The stealth Sui address (same key)
    pub stealth_sui_address: String,
    /// The ephemeral ciphertext (hex)
    pub ephemeral_ciphertext: String,
    /// View tag for the announcement (informational; bound to payment_id server-side)
    pub view_tag: u8,
    /// Full announcement (returned for client-side reference / fallback publish)
    pub announcement: AnnouncementDto,
}

/// Request to scan for payments.
#[derive(Debug, Deserialize)]
pub struct ScanRequest {
    /// Viewing secret key (hex)
    pub viewing_sk: String,
    /// Spending public key (hex)
    pub spending_pk: String,
    /// Spending secret key (hex)
    pub spending_sk: String,
    /// Optional: Only scan specific view tags
    pub view_tags: Option<Vec<u8>>,
    /// Optional: Scan from timestamp
    pub from_timestamp: Option<u64>,
    /// Optional: Scan to timestamp
    pub to_timestamp: Option<u64>,
}

/// Response for scanning.
#[derive(Debug, Serialize)]
pub struct ScanResponse {
    /// Discovered payments
    pub discoveries: Vec<DiscoveryDto>,
    /// Scan statistics
    pub stats: ScanStatsDto,
}

/// A discovered payment.
#[derive(Debug, Serialize)]
pub struct DiscoveryDto {
    /// Stealth Ethereum address (checksummed)
    pub stealth_address: String,
    /// Stealth Sui address
    pub stealth_sui_address: String,
    /// Stealth private key (hex) - HANDLE WITH CARE
    pub stealth_sk: String,
    /// Ethereum-compatible private key (32 bytes, hex)
    pub eth_private_key: String,
    /// Announcement ID
    pub announcement_id: u64,
    /// Timestamp
    pub timestamp: u64,
    /// Optional transaction hash
    pub tx_hash: Option<String>,
    /// Amount (human-readable, e.g. "0.1" ETH or "1.5" SUI)
    pub amount: String,
    /// Chain identifier (e.g. "ethereum", "sui")
    pub chain: String,
}

/// Scan statistics.
///
/// `view_tag_matches` is the number of announcements that passed the view-tag
/// filter (i.e. decapsulation succeeded and `compute_view_tag(shared_secret)
/// == announcement.view_tag`). It is **strictly ≥ `discoveries`** because a
/// view-tag match may still fail the subsequent stealth-key derivation in
/// rare cases. `total_scanned - view_tag_matches` is the count filtered out
/// by the view tag.
#[derive(Debug, Serialize)]
pub struct ScanStatsDto {
    /// Total announcements scanned
    pub total_scanned: u64,
    /// Announcements whose view tag matched after decapsulation
    pub view_tag_matches: u64,
    /// Payments discovered (subset of view_tag_matches)
    pub discoveries: u64,
    /// Duration in milliseconds
    pub duration_ms: u64,
    /// Scan rate (announcements per second)
    pub rate: f64,
}

/// Response for ENS resolution.
#[derive(Debug, Serialize)]
pub struct ResolveEnsResponse {
    /// ENS name that was resolved
    pub ens_name: String,
    /// Meta-address (hex)
    pub meta_address: String,
    /// Spending public key (hex)
    pub spending_pk: String,
    /// Viewing public key (hex)
    pub viewing_pk: String,
    /// IPFS CID where meta-address is stored
    pub ipfs_cid: Option<String>,
}

/// Response for SuiNS resolution.
#[derive(Debug, Serialize)]
pub struct ResolveSuinsResponse {
    /// SuiNS name that was resolved
    pub suins_name: String,
    /// Meta-address (hex)
    pub meta_address: String,
    /// Spending public key (hex)
    pub spending_pk: String,
    /// Viewing public key (hex)
    pub viewing_pk: String,
    /// IPFS CID where meta-address is stored
    pub ipfs_cid: Option<String>,
}

/// Request to upload meta-address to IPFS.
#[derive(Debug, Deserialize)]
pub struct UploadIpfsRequest {
    /// Meta-address (hex)
    pub meta_address: String,
    /// Optional name for the pin
    pub name: Option<String>,
}

/// Response for IPFS upload.
#[derive(Debug, Serialize)]
pub struct UploadIpfsResponse {
    /// IPFS CID
    pub cid: String,
    /// Formatted text record value for ENS
    pub text_record: String,
}

/// Announcement DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnouncementDto {
    /// Announcement ID
    pub id: u64,
    /// ML-KEM ephemeral ciphertext (hex, 1088 bytes)
    pub ephemeral_key: String,
    /// View tag (0–255)
    pub view_tag: u8,
    /// Unix timestamp
    pub timestamp: u64,
    /// EIP-155 chain ID of the payment's source chain (e.g. 42161 = Arbitrum)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_chain_id: Option<u64>,
    /// Monad announce tx hash — the SPECTERAnnouncer.announce() call (dedup key)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    /// Payment tx hash on the source chain — from metadata bytes [1..33]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payment_tx_hash: Option<String>,
    /// Raw amount hex uint256 (e.g. "0x...de0b6b3a7640000" = 1 ETH in wei)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<String>,
    /// Human-readable chain name (e.g. "monad-testnet", "arbitrum-one")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chain: Option<String>,
    /// Recipient stealth address (checksummed)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stealth_address: Option<String>,
}

impl From<Announcement> for AnnouncementDto {
    fn from(ann: Announcement) -> Self {
        Self {
            id: ann.id,
            ephemeral_key: hex::encode(&ann.ephemeral_key),
            view_tag: ann.view_tag,
            timestamp: ann.timestamp,
            source_chain_id: ann.source_chain_id,
            tx_hash: ann.tx_hash,
            payment_tx_hash: ann.payment_tx_hash,
            amount: ann.amount,
            chain: ann.chain,
            stealth_address: ann.stealth_address,
        }
    }
}

impl TryFrom<AnnouncementDto> for Announcement {
    type Error = specter_core::error::SpecterError;

    fn try_from(dto: AnnouncementDto) -> Result<Self, Self::Error> {
        let ephemeral_key = hex::decode(&dto.ephemeral_key)?;

        Ok(Announcement {
            id: dto.id,
            ephemeral_key,
            view_tag: dto.view_tag,
            timestamp: dto.timestamp,
            source_chain_id: dto.source_chain_id,
            block_number: None,
            tx_hash: dto.tx_hash,
            payment_tx_hash: dto.payment_tx_hash,
            amount: dto.amount,
            chain: dto.chain,
            stealth_address: dto.stealth_address,
        })
    }
}

/// Request to publish a previously-created stealth payment.
///
/// **Preferred path (`payment_id`):** the server retrieves the announcement
/// it built at `/api/v1/stealth/create` time and publishes it with the
/// supplied metadata. This is the only path where the protocol view tag is
/// guaranteed correct.
///
/// **Fallback path (`announcement`):** if the server restarted and the
/// pending payment expired, the client may resubmit the original
/// `AnnouncementDto` returned by `/stealth/create`. The server validates
/// structure (ciphertext size, non-zero, timestamp bounds) but cannot
/// re-derive the view tag without the recipient's viewing secret key;
/// senders must therefore submit exactly what the server returned. This
/// path is logged and metered.
///
/// At least one of `payment_id` or `announcement` MUST be provided. The
/// legacy loose `view_tag` + `ephemeral_key` fields are no longer accepted.
#[derive(Debug, Deserialize)]
pub struct PublishAnnouncementRequest {
    /// Preferred: the `payment_id` returned by `/api/v1/stealth/create`.
    #[serde(default)]
    pub payment_id: Option<Uuid>,
    /// Fallback: full announcement DTO returned by `/api/v1/stealth/create`.
    #[serde(default)]
    pub announcement: Option<AnnouncementDto>,
    /// Monad announce tx hash.
    /// Required in dev mode (no relayer). Ignored when relayer is active —
    /// the server generates it after broadcasting to Monad.
    #[serde(default)]
    pub tx_hash: Option<String>,
    /// Source-chain payment tx hash to be verified on `chain`'s RPC.
    /// When provided and a matching CHAIN_RPC_* is configured, the server
    /// calls eth_getTransactionReceipt and rejects reverted or missing txs.
    #[serde(default)]
    pub payment_tx_hash: Option<String>,
    /// EIP-155 chain ID of the chain where `payment_tx_hash` was broadcast.
    #[serde(default)]
    pub source_chain_id: Option<u64>,
    /// Human-readable amount string (e.g. "1000000000000000000" wei, or "0x0de0b6b3a7640000").
    pub amount: Option<String>,
    /// Human-readable source chain name (e.g. "arbitrum", "ethereum", "base").
    pub chain: Option<String>,
}

/// Response for publish.
#[derive(Debug, Serialize)]
pub struct PublishAnnouncementResponse {
    /// Assigned announcement ID in the registry.
    pub id: u64,
    /// Always true on success.
    pub success: bool,
    /// Monad tx hash of the announce() call.
    /// Present when the relayer broadcast it; equal to req.tx_hash in dev mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monad_tx_hash: Option<String>,
}

/// Query parameters for listing announcements.
#[derive(Debug, Deserialize)]
pub struct ListAnnouncementsQuery {
    /// Filter by view tag
    pub view_tag: Option<u8>,
    /// Pagination: offset
    pub offset: Option<u64>,
    /// Pagination: limit
    pub limit: Option<u64>,
    /// Filter: from timestamp
    pub from_timestamp: Option<u64>,
    /// Filter: to timestamp
    pub to_timestamp: Option<u64>,
}

/// Response for listing announcements.
#[derive(Debug, Serialize)]
pub struct ListAnnouncementsResponse {
    /// Announcements
    pub announcements: Vec<AnnouncementDto>,
    /// Total count (for pagination)
    pub total: u64,
}

/// Registry statistics.
#[derive(Debug, Serialize)]
pub struct RegistryStatsResponse {
    /// Total announcements
    pub total_announcements: u64,
    /// View tag distribution
    pub view_tag_distribution: Vec<ViewTagCount>,
}

/// View tag count for distribution.
#[derive(Debug, Serialize)]
pub struct ViewTagCount {
    /// View tag value
    pub tag: u8,
    /// Number of announcements
    pub count: u64,
}

/// Health check response.
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_seconds: u64,
    pub announcements_count: u64,
    pub use_testnet: bool,
    /// True when RELAYER_PRIVATE_KEY is set and valid.
    pub relayer_ok: bool,
    /// True when Turso responds to a SELECT 1.
    pub turso_ok: bool,
    /// Last Monad block number processed by the event poller (from registry_metadata).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poller_last_block: Option<u64>,
    /// True when the poller has processed at least one block.
    pub poller_ok: bool,
}

