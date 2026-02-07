//! DTOs for API requests and responses.

use serde::{Deserialize, Serialize};
use specter_core::types::{Announcement, MetaAddress, EthAddress};

/// Response for key generation.
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
    /// Base view tag for this wallet
    pub view_tag: u8,
}

/// Request to create a stealth payment.
#[derive(Debug, Deserialize)]
pub struct CreateStealthRequest {
    /// Meta-address (hex-encoded)
    pub meta_address: String,
    /// Optional: Yellow channel ID (hex)
    pub channel_id: Option<String>,
}

/// Response for stealth payment creation.
#[derive(Debug, Serialize)]
pub struct CreateStealthResponse {
    /// The stealth Ethereum address to send funds to
    pub stealth_address: String,
    /// The stealth Sui address (same key)
    pub stealth_sui_address: String,
    /// The ephemeral ciphertext (hex)
    pub ephemeral_ciphertext: String,
    /// View tag for the announcement
    pub view_tag: u8,
    /// Full announcement to publish
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
#[derive(Debug, Serialize)]
pub struct ScanStatsDto {
    /// Total announcements scanned
    pub total_scanned: u64,
    /// View tag matches
    pub view_tag_matches: u64,
    /// Payments discovered
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
    /// Ephemeral ciphertext (hex)
    pub ephemeral_key: String,
    /// View tag
    pub view_tag: u8,
    /// Timestamp
    pub timestamp: u64,
    /// Optional channel ID (hex)
    pub channel_id: Option<String>,
    /// Optional transaction hash (when published with verified tx)
    pub tx_hash: Option<String>,
    /// Optional amount (human-readable, e.g. "0.1" ETH or "1.5" SUI)
    pub amount: Option<String>,
    /// Optional chain identifier (e.g. "ethereum", "sui")
    pub chain: Option<String>,
}

impl From<Announcement> for AnnouncementDto {
    fn from(ann: Announcement) -> Self {
        Self {
            id: ann.id,
            ephemeral_key: hex::encode(&ann.ephemeral_key),
            view_tag: ann.view_tag,
            timestamp: ann.timestamp,
            channel_id: ann.channel_id.map(hex::encode),
            tx_hash: ann.tx_hash,
            amount: ann.amount,
            chain: ann.chain,
        }
    }
}

impl TryFrom<AnnouncementDto> for Announcement {
    type Error = specter_core::error::SpecterError;

    fn try_from(dto: AnnouncementDto) -> Result<Self, Self::Error> {
        let ephemeral_key = hex::decode(&dto.ephemeral_key)?;
        let channel_id = dto.channel_id
            .map(|s| {
                let bytes = hex::decode(&s)?;
                let mut arr = [0u8; 32];
                if bytes.len() == 32 {
                    arr.copy_from_slice(&bytes);
                    Ok(arr)
                } else {
                    Err(specter_core::error::SpecterError::ValidationError(
                        "channel_id must be 32 bytes".into()
                    ))
                }
            })
            .transpose()?;

        Ok(Announcement {
            id: dto.id,
            ephemeral_key,
            view_tag: dto.view_tag,
            timestamp: dto.timestamp,
            channel_id,
            block_number: None,
            tx_hash: dto.tx_hash,
            amount: dto.amount,
            chain: dto.chain,
        })
    }
}

/// Request to publish an announcement.
#[derive(Debug, Deserialize)]
pub struct PublishAnnouncementRequest {
    /// Ephemeral key (hex)
    pub ephemeral_key: String,
    /// View tag
    pub view_tag: u8,
    /// Optional channel ID (hex)
    pub channel_id: Option<String>,
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
    /// Transaction hash
    pub tx_hash: String,
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
