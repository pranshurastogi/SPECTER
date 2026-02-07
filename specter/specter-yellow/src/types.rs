//! Types for Yellow Network integration.

use serde::{Deserialize, Serialize};
use specter_core::types::EthAddress;

/// Yellow Network configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct YellowConfig {
    /// WebSocket URL for Yellow Node
    pub ws_url: String,
    /// Ethereum RPC URL
    pub rpc_url: String,
    /// Chain ID (e.g., 11155111 for Sepolia)
    pub chain_id: u64,
    /// Custody contract address
    pub custody_address: String,
    /// Adjudicator contract address
    pub adjudicator_address: String,
    /// Challenge duration in seconds
    pub challenge_duration: u64,
}

impl Default for YellowConfig {
    fn default() -> Self {
        Self {
            ws_url: "wss://clearnet-sandbox.yellow.com/ws".into(),
            rpc_url: "https://1rpc.io/sepolia".into(),
            chain_id: 11155111, // Sepolia
            custody_address: "0x019B65A265EB3363822f2752141b3dF16131b262".into(),
            adjudicator_address: "0x7c7ccbc98469190849BCC6c926307794fDfB11F2".into(),
            challenge_duration: 3600, // 1 hour
        }
    }
}

impl YellowConfig {
    /// Creates config for Sepolia testnet.
    pub fn sepolia() -> Self {
        Self::default()
    }

    /// Creates config for mainnet (when available).
    pub fn mainnet() -> Self {
        Self {
            ws_url: "wss://clearnet.yellow.com/ws".into(),
            rpc_url: "https://eth.llamarpc.com".into(),
            chain_id: 1,
            // TODO: Update with mainnet addresses
            custody_address: "0x0000000000000000000000000000000000000000".into(),
            adjudicator_address: "0x0000000000000000000000000000000000000000".into(),
            challenge_duration: 86400, // 24 hours for mainnet
        }
    }
}

/// Channel status.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelStatus {
    /// Channel is being created
    Pending,
    /// Channel is open and active
    Open,
    /// Channel is being closed
    Closing,
    /// Channel is closed
    Closed,
    /// Channel is in dispute
    Disputed,
}

/// A Yellow Network state channel with SPECTER privacy.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PrivateChannelInfo {
    /// Channel ID (32 bytes, hex)
    pub channel_id: String,
    /// Stealth address (the recipient's one-time address)
    pub stealth_address: EthAddress,
    /// SPECTER ephemeral ciphertext (for recipient to discover)
    #[serde(with = "hex")]
    pub ephemeral_ciphertext: Vec<u8>,
    /// View tag for efficient scanning
    pub view_tag: u8,
    /// Token address being traded
    pub token: String,
    /// Current channel status
    pub status: ChannelStatus,
    /// Channel creation timestamp
    pub created_at: u64,
    /// Last state version
    pub version: u64,
    /// Current balance allocation
    pub allocations: Vec<Allocation>,
}

/// Balance allocation in a channel.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Allocation {
    /// Destination address
    pub destination: String,
    /// Token address
    pub token: String,
    /// Amount (in smallest units)
    pub amount: String,
}

/// Session key for Yellow Network authentication.
#[derive(Clone, Debug)]
pub struct SessionKey {
    /// Session public key (address)
    pub address: String,
    /// Session private key (for signing)
    pub private_key: Vec<u8>,
    /// Expiration timestamp
    pub expires_at: u64,
    /// Allowed assets and amounts
    pub allowances: Vec<Allowance>,
}

/// Asset allowance for a session.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Allowance {
    /// Asset identifier (e.g., "ytest.usd")
    pub asset: String,
    /// Maximum allowed amount
    pub amount: String,
}

/// Request to create a private channel.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreatePrivateChannelRequest {
    /// Recipient's ENS name or meta-address
    pub recipient: String,
    /// Token address
    pub token: String,
    /// Initial funding amount
    pub amount: u64,
    /// Optional: Custom channel parameters
    pub params: Option<ChannelParams>,
}

/// Optional channel parameters.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ChannelParams {
    /// Challenge duration override
    pub challenge_duration: Option<u64>,
    /// Custom metadata
    pub metadata: Option<String>,
}

/// Result of channel creation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateChannelResult {
    /// Channel ID
    pub channel_id: String,
    /// Stealth address for recipient
    pub stealth_address: EthAddress,
    /// SPECTER announcement to publish
    pub announcement: AnnouncementData,
    /// Transaction hash of on-chain creation
    pub tx_hash: String,
}

/// Data for SPECTER announcement.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AnnouncementData {
    /// Ephemeral ciphertext (hex)
    pub ephemeral_key: String,
    /// View tag
    pub view_tag: u8,
    /// Channel ID (hex)
    pub channel_id: String,
}

/// Discovered private channel (from Bob's perspective).
#[derive(Clone, Debug)]
pub struct DiscoveredChannel {
    /// Channel ID
    pub channel_id: String,
    /// Stealth address (Bob's one-time address)
    pub stealth_address: EthAddress,
    /// Derived stealth private key (for signing)
    pub stealth_private_key: Vec<u8>,
    /// Ethereum-compatible private key (32 bytes)
    pub eth_private_key: [u8; 32],
    /// Channel info from Yellow Node
    pub channel_info: Option<PrivateChannelInfo>,
    /// Discovery timestamp
    pub discovered_at: u64,
}

/// Transfer request within a channel.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransferRequest {
    /// Channel ID
    pub channel_id: String,
    /// Destination address
    pub destination: String,
    /// Allocations to transfer
    pub allocations: Vec<TransferAllocation>,
}

/// Allocation for a transfer.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransferAllocation {
    /// Asset identifier
    pub asset: String,
    /// Amount to transfer
    pub amount: String,
}

/// Settlement result.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SettlementResult {
    /// Channel ID
    pub channel_id: String,
    /// Final balance for each party
    pub final_balances: Vec<Allocation>,
    /// Close transaction hash
    pub close_tx_hash: String,
    /// Withdrawal transaction hash (if withdrawn)
    pub withdrawal_tx_hash: Option<String>,
}

/// Yellow Network RPC message types.
pub mod rpc {
    use serde::{Deserialize, Serialize};

    /// Auth request message.
    #[derive(Debug, Serialize)]
    pub struct AuthRequest {
        pub address: String,
        pub application: String,
        pub session_key: String,
        pub allowances: Vec<super::Allowance>,
        pub expires_at: u64,
        pub scope: String,
    }

    /// Create channel request.
    #[derive(Debug, Serialize)]
    pub struct CreateChannelRequest {
        pub chain_id: u64,
        pub token: String,
        pub participant: Option<String>, // Stealth address for private channels
    }

    /// Resize channel request.
    #[derive(Debug, Serialize)]
    pub struct ResizeChannelRequest {
        pub channel_id: String,
        pub allocate_amount: u64,
        pub funds_destination: String,
    }

    /// Close channel request.
    #[derive(Debug, Serialize)]
    pub struct CloseChannelRequest {
        pub channel_id: String,
        pub funds_destination: String,
    }

    /// Generic RPC response.
    #[derive(Debug, Deserialize)]
    pub struct RpcResponse<T> {
        pub res: Option<(String, String, T, Option<u64>)>,
        pub error: Option<RpcError>,
    }

    /// RPC error.
    #[derive(Debug, Deserialize)]
    pub struct RpcError {
        pub code: i32,
        pub message: String,
    }
}
