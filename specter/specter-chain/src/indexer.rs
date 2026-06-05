//! Blockchain event indexer for SPECTER announcements.
//!
//! This module provides background polling of on-chain Announcement events,
//! decoding metadata, and persisting announcements to the registry.
//!
//! The indexer respects MonadBFT finality by waiting for CONFIRMATION_DEPTH blocks
//! before ingesting events, protecting against short-term reorgs.

use alloy::primitives::Address;
use anyhow::Result;
use specter_core::types::{Announcement, AnnouncementBuilder, AnnouncementMetadata};

const CONFIRMATION_DEPTH: u64 = 2;

/// Pure function to construct an Announcement from decoded event fields.
///
/// This function is testable without requiring an RPC connection.
/// It handles metadata decoding, field extraction, and Announcement construction.
///
/// # Arguments
///
/// * `ephem_key` - Ephemeral key bytes (1088 bytes)
/// * `metadata_bytes` - Fixed 77-byte metadata payload
/// * `stealth_addr` - Stealth address from event (checksummed)
/// * `block_number` - Block number of the event
///
/// # Returns
///
/// An `Announcement` with all fields populated, or error if validation fails.
///
/// # Example
///
/// ```ignore
/// let announcement = announcement_from_event(
///     vec![0x42u8; 1088],
///     [0u8; 77],
///     "0x1234...".parse()?,
///     17000000,
/// )?;
/// ```
pub fn announcement_from_event(
    ephem_key: Vec<u8>,
    metadata_bytes: Vec<u8>,
    stealth_addr: Address,
    block_number: u64,
) -> Result<Announcement> {
    // Ensure metadata is exactly 77 bytes
    if metadata_bytes.len() != 77 {
        return Err(anyhow::anyhow!(
            "metadata must be 77 bytes, got {}",
            metadata_bytes.len()
        ));
    }

    let metadata = AnnouncementMetadata::decode(&metadata_bytes);

    let announcement = AnnouncementBuilder::new()
        .ephemeral_key(ephem_key)
        .view_tag(metadata.view_tag)
        .stealth_address(format!("{:?}", stealth_addr))
        .tx_hash(metadata.tx_hash.map(|h| format!("{:?}", h)))
        .amount(metadata.amount.map(|a| a.to_string()))
        .channel_id(metadata.channel_id_padded().unwrap_or([0u8; 32]))
        .block_number(block_number)
        .chain("monad".to_string())
        .build()?;

    Ok(announcement)
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::constants::KYBER_CIPHERTEXT_SIZE;

    fn make_valid_ephemeral_key() -> Vec<u8> {
        vec![0x42u8; KYBER_CIPHERTEXT_SIZE]
    }

    fn make_valid_metadata() -> [u8; 77] {
        let mut buf = [0u8; 77];
        buf[0] = 0x99; // view_tag
        buf
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
    }

    #[test]
    fn test_announcement_from_event_with_all_metadata_fields() {
        let mut metadata_bytes = [0u8; 77];
        metadata_bytes[0] = 0x77;
        metadata_bytes[1..33].copy_from_slice(&[0xAA; 32]);
        metadata_bytes[33..65].copy_from_slice(&[0xBB; 32]);
        metadata_bytes[65..77].copy_from_slice(&[0xCC; 12]);

        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            metadata_bytes.to_vec(),
            "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd".parse().unwrap(),
            2_000_000,
        );

        assert!(result.is_ok());
        let ann = result.unwrap();
        assert_eq!(ann.view_tag, 0x77);
        assert!(ann.tx_hash.is_some());
        assert!(ann.amount.is_some());
        assert!(ann.channel_id.is_some());
        assert_eq!(ann.block_number, Some(2_000_000));
        assert_eq!(ann.chain, Some("monad".to_string()));
    }

    #[test]
    fn test_announcement_from_event_metadata_roundtrip() {
        // Create metadata, encode it, then decode it through announcement_from_event
        let mut meta = AnnouncementMetadata::new(0x55);
        meta.tx_hash = Some([0x11; 32]);
        meta.amount = Some([0x22; 32]);
        meta.channel_id = Some([0x33; 12]);

        let encoded = meta.encode();
        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            encoded.to_vec(),
            "0x0000000000000000000000000000000000000000".parse().unwrap(),
            999,
        );

        assert!(result.is_ok());
        let ann = result.unwrap();
        assert_eq!(ann.view_tag, meta.view_tag);
        assert!(ann.tx_hash.is_some());
        assert!(ann.amount.is_some());
        assert!(ann.channel_id.is_some());
    }

    #[test]
    fn test_announcement_from_event_channel_id_padding() {
        let mut metadata_bytes = [0u8; 77];
        metadata_bytes[0] = 0x42;
        metadata_bytes[65..77].copy_from_slice(&[0xDD; 12]);

        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            metadata_bytes.to_vec(),
            "0x1122334455667788990011223344556677889900".parse().unwrap(),
            5_000_000,
        );

        assert!(result.is_ok());
        let ann = result.unwrap();
        assert!(ann.channel_id.is_some());
        let padded = ann.channel_id.unwrap();
        assert_eq!(&padded[..12], &[0xDD; 12]);
        assert_eq!(&padded[12..], &[0u8; 20]);
    }

    #[test]
    fn test_announcement_from_event_invalid_metadata_length() {
        // Metadata too short
        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            vec![0u8; 76],
            "0x0000000000000000000000000000000000000000".parse().unwrap(),
            0,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("77 bytes"));
    }

    #[test]
    fn test_announcement_from_event_metadata_too_long() {
        // Extra bytes are acceptable (ignored)
        let mut metadata_bytes = vec![0u8; 100];
        metadata_bytes[0] = 0x42;

        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            metadata_bytes,
            "0x0000000000000000000000000000000000000000".parse().unwrap(),
            0,
        );

        // Should fail because we check len() != 77
        assert!(result.is_err());
    }

    #[test]
    fn test_announcement_from_event_preserves_chain() {
        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            make_valid_metadata().to_vec(),
            "0x0000000000000000000000000000000000000000".parse().unwrap(),
            0,
        );

        assert!(result.is_ok());
        let ann = result.unwrap();
        assert_eq!(ann.chain, Some("monad".to_string()));
    }
}
