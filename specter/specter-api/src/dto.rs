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
    /// secp256k1 spending public key (33-byte compressed, hex)
    pub spending_pub: String,
    /// secp256k1 spending secret key (32 bytes, hex) - HANDLE WITH CARE.
    /// This controls all funds; generate client-side in production.
    pub spending_sk: String,
    /// ML-KEM viewing public key (hex)
    pub viewing_pk: String,
    /// ML-KEM viewing secret key (hex) - HANDLE WITH CARE
    pub viewing_sk: String,
    /// Meta-address (hex-encoded, for ENS storage)
    pub meta_address: String,
    /// Protocol version of the generated keys (currently 2).
    pub protocol_version: u8,
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

/// Request to scan for payments (view-only).
///
/// Deliberately does NOT accept the spending secret key. Detection needs only
/// the viewing secret key and the spending *public* key; the per-payment
/// `shared_secret` is returned so the client can derive spend keys locally with
/// its own secret spending key (which must never be sent to a server).
#[derive(Debug, Deserialize)]
pub struct ScanRequest {
    /// ML-KEM viewing secret key (hex)
    pub viewing_sk: String,
    /// secp256k1 spending public key (33-byte compressed, hex)
    pub spending_pub: String,
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
///
/// Contains no private key. To spend, the client derives the spend key locally
/// from `shared_secret` + its secret spending key (never sent to the server).
#[derive(Debug, Serialize)]
pub struct DiscoveryDto {
    /// Stealth Ethereum address (checksummed)
    pub stealth_address: String,
    /// Stealth Sui address
    pub stealth_sui_address: String,
    /// Per-payment ML-KEM shared secret (hex). Feed this plus your secret
    /// spending key into client-side `derive_stealth_keys` to obtain the spend
    /// key. Knowing it alone does NOT allow spending.
    pub shared_secret: String,
    /// Announcement ID
    pub announcement_id: u64,
    /// Timestamp
    pub timestamp: u64,
    /// Monad announce() tx hash (registry row)
    pub tx_hash: Option<String>,
    /// Source-chain payment tx hash, decrypted from the metadata blob
    /// (present only when the recipient could decrypt the blob).
    pub payment_tx_hash: Option<String>,
    /// Amount in base units (hex uint256, e.g. "0x...0de0b6b3a7640000"),
    /// decrypted from the metadata blob. Empty when unavailable.
    pub amount: String,
    /// Chain name as stored at publish time (e.g. "monad-testnet", "sui")
    pub chain: String,
    /// EIP-155 chain ID of the payment's source chain, decrypted from the
    /// metadata blob — the most reliable chain identifier for clients.
    pub source_chain_id: Option<u64>,
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
    /// secp256k1 spending public key (hex)
    pub spending_pub: String,
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
    /// secp256k1 spending public key (hex)
    pub spending_pub: String,
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
    /// AEAD-encrypted on-chain metadata blob (hex). Opaque to everyone except
    /// the recipient, who decrypts it with the per-payment shared secret to
    /// recover the amount / source tx / chain id during client-side scanning.
    /// Safe to serve publicly — it reveals nothing without the viewing key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata_blob: Option<String>,
    /// keccak256(ciphertext) for chain-indexed rows whose full ciphertext has
    /// not been resolved yet (hex). Lets clients verify a resolved ciphertext.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ephemeral_key_hash: Option<String>,
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
            metadata_blob: ann.metadata_blob.map(hex::encode),
            ephemeral_key_hash: ann.ephemeral_key_hash.map(hex::encode),
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
            // Client DTOs never carry these; chain-sourced fields only.
            ephemeral_key_hash: None,
            metadata_blob: None,
            payment_tx_hash_hmac: None,
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
    /// Optional ERC-20 token contract address for payment verification.
    /// `None` ⇒ native transfer (or best-effort ERC-20 log scan).
    #[serde(default)]
    pub token: Option<String>,
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

// ── sweep records (claim-flow history) ─────────────────────────────────────

/// One swept stealth address inside a claim operation.
#[derive(Debug, Deserialize, Serialize)]
pub struct SweepRowDto {
    /// Client-generated UUID for this row (idempotency key).
    pub id: String,
    /// Swept stealth address (0x…).
    pub stealth_address: String,
    /// Amount transferred, base units (wei) as a decimal string.
    pub amount_base: String,
    /// Network fee paid, base units (wei) as a decimal string.
    pub fee_base: String,
    /// Broadcast tx hash (empty string for skipped rows).
    pub tx_hash: String,
    /// "confirmed" | "failed" | "skipped_dust".
    pub status: String,
}

/// Request to record a completed claim operation.
///
/// Contains only public-after-broadcast data plus a pre-hashed identity key.
/// Recording is best-effort on the client: rejection never blocks a claim.
#[derive(Debug, Deserialize)]
pub struct RecordSweepsRequest {
    /// Groups these rows into one receipt (client UUID).
    pub receipt_id: String,
    /// SHA-256 of the meta-address bytes, lowercase hex (64 chars).
    pub identity_hash: String,
    /// Backend chain name (e.g. "sepolia", "arbitrum", "monad-testnet").
    pub chain: String,
    /// Resolved destination address (0x…).
    pub destination: String,
    /// What the user typed (ENS name or the address itself).
    pub destination_input: String,
    /// Per-address rows (at least one, at most 200).
    pub records: Vec<SweepRowDto>,
}

/// Response for recording sweeps.
#[derive(Debug, Serialize)]
pub struct RecordSweepsResponse {
    /// Rows newly inserted (idempotent re-posts insert 0).
    pub inserted: u64,
}

/// One stored sweep row, as returned by the list endpoint.
#[derive(Debug, Serialize)]
pub struct SweepRecordDto {
    /// Row id.
    pub id: String,
    /// Receipt this row belongs to.
    pub receipt_id: String,
    /// Backend chain name.
    pub chain: String,
    /// Swept stealth address.
    pub stealth_address: String,
    /// Resolved destination address.
    pub destination: String,
    /// What the user typed (ENS name or address).
    pub destination_input: String,
    /// Amount transferred (wei, decimal string).
    pub amount_base: String,
    /// Network fee paid (wei, decimal string).
    pub fee_base: String,
    /// Broadcast tx hash.
    pub tx_hash: String,
    /// "confirmed" | "failed" | "skipped_dust".
    pub status: String,
    /// Unix seconds when recorded.
    pub created_at: i64,
}

/// Response for listing an identity's sweep history.
#[derive(Debug, Serialize)]
pub struct ListSweepsResponse {
    /// Sweep rows, newest first.
    pub sweeps: Vec<SweepRecordDto>,
    /// Number of rows returned.
    pub total: u64,
}

/// Health check response.
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_seconds: u64,
    pub announcements_count: u64,
    /// General EVM/Monad testnet flag.
    pub use_testnet: bool,
    /// When true, backend resolves SuiNS against testnet registry (ENS is always mainnet).
    pub use_sui_testnet: bool,
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
