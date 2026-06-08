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
    /// Optional: Yellow channel ID (hex)
    #[allow(dead_code)]
    pub channel_id: Option<String>,
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
    /// Optional channel ID
    pub channel_id: Option<String>,
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
    /// Transaction hash (required; for duplicate detection and storage)
    pub tx_hash: String,
    /// Amount (human-readable, e.g. "0.1" ETH or "1.5" SUI)
    pub amount: Option<String>,
    /// Chain identifier (e.g. "ethereum", "sui")
    pub chain: Option<String>,
}

/// Response for publish.
#[derive(Debug, Serialize)]
pub struct PublishAnnouncementResponse {
    /// Assigned announcement ID
    pub id: u64,
    /// Confirmation
    pub success: bool,
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
    /// Status
    pub status: String,
    /// Version
    pub version: String,
    /// Uptime in seconds
    pub uptime_seconds: u64,
    /// Total announcements in registry
    pub announcements_count: u64,
    /// When true, backend uses Sepolia ENS
    pub use_testnet: bool,
}

// ═══════════════════════════════════════════════════════════════════════════
// Yellow Network DTOs
// ═══════════════════════════════════════════════════════════════════════════

/// Request to create a private Yellow channel.
#[derive(Debug, Deserialize)]
pub struct YellowCreateChannelRequest {
    /// Recipient ENS name (e.g. "bob.eth") or meta-address hex
    pub recipient: String,
    /// Token address
    pub token: String,
    /// Initial funding amount (human-readable)
    pub amount: String,
    /// Optional: real channel ID from on-chain create (hex). When set, used for the announcement instead of generating a random ID.
    pub channel_id: Option<String>,
}

/// Response for private Yellow channel creation.
#[derive(Debug, Serialize)]
pub struct YellowCreateChannelResponse {
    /// Channel ID
    pub channel_id: String,
    /// Stealth address for recipient
    pub stealth_address: String,
    /// Announcement data (ephemeral_key, view_tag, channel_id)
    pub announcement: YellowAnnouncementData,
    /// Transaction hash
    pub tx_hash: String,
}

/// Announcement data included in channel creation response.
#[derive(Debug, Serialize)]
pub struct YellowAnnouncementData {
    /// Ephemeral ciphertext (hex)
    pub ephemeral_key: String,
    /// View tag
    pub view_tag: u8,
    /// Channel ID (hex)
    pub channel_id: String,
}

/// Request to discover private Yellow channels.
#[derive(Debug, Deserialize)]
pub struct YellowDiscoverRequest {
    /// Viewing secret key (hex)
    pub viewing_sk: String,
    /// Spending public key (hex)
    pub spending_pk: String,
    /// Spending secret key (hex)
    pub spending_sk: String,
}

/// A discovered Yellow channel.
#[derive(Debug, Serialize)]
pub struct YellowDiscoveredChannelDto {
    /// Channel ID
    pub channel_id: String,
    /// Stealth address
    pub stealth_address: String,
    /// Ethereum private key for stealth address (hex)
    pub eth_private_key: String,
    /// Channel status
    pub status: String,
    /// Discovery timestamp
    pub discovered_at: u64,
    /// Funded amount (from announcement)
    pub amount: String,
    /// Token symbol (e.g. "USDC")
    pub token: String,
}

/// Response for Yellow channel discovery.
#[derive(Debug, Serialize)]
pub struct YellowDiscoverResponse {
    /// Discovered channels
    pub channels: Vec<YellowDiscoveredChannelDto>,
}

/// Request to fund a Yellow channel.
#[derive(Debug, Deserialize)]
pub struct YellowFundChannelRequest {
    /// Channel ID
    pub channel_id: String,
    /// Amount to add
    pub amount: String,
}

/// Response for Yellow channel funding.
#[derive(Debug, Serialize)]
pub struct YellowFundChannelResponse {
    /// Transaction hash
    pub tx_hash: String,
    /// New balance after funding
    pub new_balance: String,
}

/// Request to close a Yellow channel.
#[derive(Debug, Deserialize)]
pub struct YellowCloseChannelRequest {
    /// Channel ID
    pub channel_id: String,
}

/// Response for Yellow channel closure.
#[derive(Debug, Serialize)]
pub struct YellowCloseChannelResponse {
    /// Transaction hash (placeholder from backend when no L1 tx is submitted; real tx comes from Yellow Network when they settle)
    pub tx_hash: String,
    /// When true, tx_hash is not a real Sepolia tx; real settlement depends on Yellow Network processing the close.
    #[serde(default)]
    pub tx_hash_is_placeholder: bool,
    /// Final balances
    pub final_balances: Vec<YellowAllocationDto>,
}

/// Allocation DTO for Yellow channels.
#[derive(Debug, Serialize)]
pub struct YellowAllocationDto {
    /// Destination address
    pub destination: String,
    /// Token address
    pub token: String,
    /// Amount
    pub amount: String,
}

/// Response for Yellow channel status.
#[derive(Debug, Serialize)]
pub struct YellowChannelStatusResponse {
    /// Channel ID
    pub channel_id: String,
    /// Status
    pub status: String,
    /// Balances
    pub balances: Vec<YellowAllocationDto>,
    /// Participants
    pub participants: Vec<String>,
    /// Created timestamp
    pub created_at: u64,
    /// State version
    pub version: u64,
}

/// Request for off-chain transfer.
#[derive(Debug, Deserialize)]
pub struct YellowTransferRequest {
    /// Channel ID
    pub channel_id: String,
    /// Destination address
    pub destination: String,
    /// Amount to transfer
    pub amount: String,
    /// Asset identifier
    pub asset: String,
}

/// Response for off-chain transfer.
#[derive(Debug, Serialize)]
pub struct YellowTransferResponse {
    /// New state version
    pub new_state_version: u64,
    /// Updated balances
    pub balances: Vec<YellowAllocationDto>,
}

/// Response for Yellow config.
#[derive(Debug, Serialize)]
pub struct YellowConfigResponse {
    /// WebSocket URL
    pub ws_url: String,
    /// Custody contract address
    pub custody_address: String,
    /// Adjudicator contract address
    pub adjudicator_address: String,
    /// Chain ID
    pub chain_id: u64,
    /// Supported tokens
    pub supported_tokens: Vec<YellowTokenInfo>,
}

/// Token info for Yellow Network.
#[derive(Debug, Serialize)]
pub struct YellowTokenInfo {
    /// Token symbol
    pub symbol: String,
    /// Token address
    pub address: String,
    /// Decimals
    pub decimals: u8,
}
