//! Blockchain event indexer for SPECTER announcements.
//!
//! Provides `announcement_from_event` — a pure, RPC-free function that converts
//! decoded on-chain event fields into an `Announcement` ready for the registry.
//!
//! For full historical indexing with HyperSync backfill, see `specter-envio/`.
//! This module handles the Rust-side registry write once Envio delivers events.

use alloy::primitives::{Address, B256};
use anyhow::Result;
use specter_core::traits::AnnouncementRegistry;
use specter_core::types::{Announcement, AnnouncementBuilder, AnnouncementMetadata};
use std::sync::Arc;
use tracing::info;

/// Number of Monad blocks to wait before treating an event as confirmed.
/// MonadBFT achieves single-slot finality; 2 is a conservative safety buffer.
pub const CONFIRMATION_DEPTH: u64 = 2;

/// Constructs an `Announcement` from decoded SPECTERAnnouncer event fields.
///
/// This is a pure function — no RPC, no I/O — making it fully unit-testable.
/// It decodes the 77-byte metadata payload and populates all Announcement fields.
///
/// # Arguments
///
/// * `ephem_key`      - ML-KEM ciphertext (must be 1088 bytes)
/// * `metadata_bytes` - Fixed 77-byte metadata from the on-chain event
/// * `stealth_addr`   - Indexed `stealthAddress` field from the event
/// * `block_number`   - Monad block number of the event
///
/// # Errors
///
/// Returns an error if `metadata_bytes.len() != 77` or the Announcement fails validation.
pub fn announcement_from_event(
    ephem_key: Vec<u8>,
    metadata_bytes: Vec<u8>,
    stealth_addr: Address,
    block_number: u64,
) -> Result<Announcement> {
    if metadata_bytes.len() != 77 {
        return Err(anyhow::anyhow!(
            "metadata must be 77 bytes, got {}",
            metadata_bytes.len()
        ));
    }

    let metadata = AnnouncementMetadata::decode(&metadata_bytes);

    let mut builder = AnnouncementBuilder::new()
        .ephemeral_key(ephem_key)
        .view_tag(metadata.view_tag)
        .stealth_address(format!("{:?}", stealth_addr))
        .block_number(block_number)
        .chain("monad-testnet".to_string());

    // tx_hash from metadata = the source-chain payment tx; stored as payment_tx_hash.
    // The Monad announce tx hash is set later by the caller (Envio handler or e2e flow).
    if let Some(h) = metadata.tx_hash {
        builder = builder.payment_tx_hash(format!("{}", B256::from(h)));
    }

    if let Some(a) = metadata.amount {
        builder = builder.amount(format!("{}", B256::from(a)));
    }

    if let Some(chain_id) = metadata.source_chain_id {
        builder = builder.source_chain_id(chain_id);
    }

    Ok(builder.build()?)
}

// ── ChainIndexer ──────────────────────────────────────────────────────────────
//
// Lightweight Rust-side indexer that feeds Turso from Envio GraphQL.
// The heavy lifting (HyperSync backfill, reorg protection) is done by Envio;
// this struct provides the registry write path once events are confirmed.

/// Configuration for the chain indexer.
#[derive(Clone, Debug)]
pub struct ChainIndexerConfig {
    /// Monad RPC endpoint URL
    pub rpc_url: String,
    /// SPECTERAnnouncer contract address on Monad
    pub announcer_addr: Address,
    /// Block number where SPECTERAnnouncer was deployed
    pub deploy_block: u64,
}

impl ChainIndexerConfig {
    /// Loads configuration from environment variables.
    ///
    /// Required env vars:
    /// - `MONAD_RPC_URL`
    /// - `SPECTER_ANNOUNCER_ADDRESS`
    /// - `SPECTER_ANNOUNCER_DEPLOY_BLOCK`
    pub fn from_env() -> Result<Self> {
        let rpc_url = std::env::var("MONAD_RPC_URL")
            .map_err(|_| anyhow::anyhow!("MONAD_RPC_URL not set"))?;

        let addr_str = std::env::var("SPECTER_ANNOUNCER_ADDRESS")
            .map_err(|_| anyhow::anyhow!("SPECTER_ANNOUNCER_ADDRESS not set"))?;
        let announcer_addr: Address = addr_str
            .parse()
            .map_err(|e| anyhow::anyhow!("Invalid SPECTER_ANNOUNCER_ADDRESS: {e}"))?;

        let block_str = std::env::var("SPECTER_ANNOUNCER_DEPLOY_BLOCK")
            .map_err(|_| anyhow::anyhow!("SPECTER_ANNOUNCER_DEPLOY_BLOCK not set"))?;
        let deploy_block: u64 = block_str
            .parse()
            .map_err(|e| anyhow::anyhow!("Invalid SPECTER_ANNOUNCER_DEPLOY_BLOCK: {e}"))?;

        if rpc_url.is_empty() {
            return Err(anyhow::anyhow!("MONAD_RPC_URL is empty"));
        }

        Ok(Self { rpc_url, announcer_addr, deploy_block })
    }
}

/// Background indexer that writes confirmed Announcement events to the registry.
pub struct ChainIndexer {
    config: ChainIndexerConfig,
    // Reserved for the direct-RPC fallback polling path (currently handled by Envio).
    #[allow(dead_code)]
    registry: Arc<dyn AnnouncementRegistry>,
}

impl ChainIndexer {
    /// Creates a new ChainIndexer.
    pub fn new(config: ChainIndexerConfig, registry: Arc<dyn AnnouncementRegistry>) -> Self {
        Self { config, registry }
    }

    /// Runs the indexer (does not return).
    ///
    /// Spawn this with `tokio::spawn()`. Full event polling is handled by
    /// the Envio indexer in `specter-envio/`; this stub logs intent and returns.
    pub async fn run(&self) -> Result<()> {
        info!(
            "ChainIndexer ready: announcer={} deploy_block={}",
            self.config.announcer_addr, self.config.deploy_block
        );
        info!(
            "Full indexing is provided by specter-envio (Envio HyperIndex). \
             This indexer handles registry writes from confirmed events."
        );
        // Envio delivers events via dual-write to Turso directly.
        // This run() method is reserved for a future direct-RPC fallback path.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::constants::KYBER_CIPHERTEXT_SIZE;
    use specter_core::types::AnnouncementMetadata;

    fn make_valid_ephemeral_key() -> Vec<u8> {
        vec![0x42u8; KYBER_CIPHERTEXT_SIZE]
    }

    fn make_valid_metadata() -> [u8; 77] {
        let mut buf = [0u8; 77];
        buf[0] = 0x99; // view_tag
        buf
    }

    fn zero_addr() -> Address {
        "0x0000000000000000000000000000000000000000".parse().unwrap()
    }

    #[test]
    fn test_announcement_from_event_minimal() {
        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            make_valid_metadata().to_vec(),
            "0x1234567890123456789012345678901234567890".parse().unwrap(),
            1_000_000,
        );

        assert!(result.is_ok());
        let ann = result.unwrap();
        assert_eq!(ann.view_tag, 0x99);
        assert_eq!(ann.block_number, Some(1_000_000));
        assert!(ann.stealth_address.is_some());
        assert!(ann.source_chain_id.is_none()); // no chain ID in minimal metadata
    }

    #[test]
    fn test_announcement_from_event_with_source_chain_id() {
        let meta = AnnouncementMetadata::new(0x55)
            .with_tx_hash([0x11; 32])
            .with_amount([0x22; 32])
            .with_source_chain_id(42161); // Arbitrum

        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            meta.encode().to_vec(),
            zero_addr(),
            2_000_000,
        );

        assert!(result.is_ok());
        let ann = result.unwrap();
        assert_eq!(ann.view_tag, 0x55);
        assert!(ann.payment_tx_hash.is_some()); // metadata tx_hash → payment_tx_hash
        assert!(ann.amount.is_some());
        assert_eq!(ann.source_chain_id, Some(42161));
        assert_eq!(ann.block_number, Some(2_000_000));
    }

    #[test]
    fn test_announcement_from_event_monad_chain_id() {
        let meta = AnnouncementMetadata::new(0x77).with_source_chain_id(10143); // Monad testnet

        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            meta.encode().to_vec(),
            zero_addr(),
            5_000_000,
        );

        assert!(result.is_ok());
        let ann = result.unwrap();
        assert_eq!(ann.source_chain_id, Some(10143));
    }

    #[test]
    fn test_announcement_from_event_metadata_roundtrip() {
        let meta = AnnouncementMetadata::new(0x55)
            .with_tx_hash([0x11; 32])
            .with_amount([0x22; 32])
            .with_source_chain_id(1); // Ethereum mainnet

        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            meta.encode().to_vec(),
            zero_addr(),
            999,
        );

        assert!(result.is_ok());
        let ann = result.unwrap();
        assert_eq!(ann.view_tag, meta.view_tag);
        assert!(ann.payment_tx_hash.is_some()); // metadata tx_hash → payment_tx_hash
        assert!(ann.amount.is_some());
        assert_eq!(ann.source_chain_id, Some(1));
    }

    #[test]
    fn test_announcement_from_event_invalid_metadata_length() {
        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            vec![0u8; 76],
            zero_addr(),
            0,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("77 bytes"));
    }

    #[test]
    fn test_announcement_from_event_metadata_too_long() {
        // Exactly 77 bytes is required — reject anything else
        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            vec![0u8; 100],
            zero_addr(),
            0,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_announcement_from_event_chain_name_is_monad_testnet() {
        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            make_valid_metadata().to_vec(),
            zero_addr(),
            0,
        );

        assert!(result.is_ok());
        assert_eq!(result.unwrap().chain, Some("monad-testnet".to_string()));
    }

    #[test]
    fn test_chain_indexer_config_creation() {
        let config = ChainIndexerConfig {
            rpc_url: "https://testnet-rpc.monad.xyz".into(),
            announcer_addr: "0x0000000000000000000000000000000000000001".parse().unwrap(),
            deploy_block: 37571591,
        };
        assert_eq!(config.rpc_url, "https://testnet-rpc.monad.xyz");
        assert_eq!(config.deploy_block, 37571591);
    }
}
