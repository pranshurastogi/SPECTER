//! Announcement metadata encoding/decoding for on-chain compatibility.
//!
//! This module defines the 77-byte fixed-width metadata layout matching the
//! SPECTERAnnouncer Solidity contract event encoding.
//!
//! # Binary Layout (77 bytes)
//!
//! ```text
//! [0]       view_tag     uint8   1 byte     (always present)
//! [1..33]   tx_hash      bytes32 32 bytes   (optional: 0x00..00 = absent)
//! [33..65]  amount       uint256 32 bytes   (optional: all zeros = absent)
//! [65..77]  channel_id   bytes12 12 bytes   (optional: 0x00..00 = absent)
//! ```

use serde::{Deserialize, Serialize};

/// Fixed 77-byte metadata layout for announcement on-chain events.
///
/// This struct encodes metadata that accompanies an ephemeral key announcement,
/// providing optional information about the transaction, amount, and trading channel.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AnnouncementMetadata {
    /// View tag for efficient filtering (first byte of hash) - always present
    pub view_tag: u8,
    /// Optional transaction hash (32 bytes, Ethereum H256)
    /// Serialized as hex string for JSON, but stored as Option<[u8; 32]> internally
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<[u8; 32]>,
    /// Optional amount (32 bytes, Solidity uint256 big-endian)
    /// Stored as Option<[u8; 32]> to preserve exact byte layout
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<[u8; 32]>,
    /// Optional Yellow channel ID (12 bytes)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<[u8; 12]>,
}

impl AnnouncementMetadata {
    /// Creates a new metadata with view tag and optional fields.
    ///
    /// # Arguments
    ///
    /// * `view_tag` - Required view tag (0-255)
    ///
    /// # Example
    ///
    /// ```ignore
    /// let meta = AnnouncementMetadata::new(0x42);
    /// ```
    pub fn new(view_tag: u8) -> Self {
        Self {
            view_tag,
            tx_hash: None,
            amount: None,
            channel_id: None,
        }
    }

    /// Encodes metadata to a fixed 77-byte array.
    ///
    /// # Layout
    ///
    /// - Byte 0: view_tag (always present)
    /// - Bytes 1-32: tx_hash (all zeros if None)
    /// - Bytes 33-64: amount (all zeros if None)
    /// - Bytes 65-76: channel_id (all zeros if None)
    ///
    /// # Example
    ///
    /// ```ignore
    /// let meta = AnnouncementMetadata::new(0x42);
    /// let bytes = meta.encode();
    /// assert_eq!(bytes.len(), 77);
    /// ```
    pub fn encode(&self) -> [u8; 77] {
        let mut buf = [0u8; 77];

        // [0] view_tag
        buf[0] = self.view_tag;

        // [1..33] tx_hash
        if let Some(hash) = &self.tx_hash {
            buf[1..33].copy_from_slice(hash);
        }

        // [33..65] amount
        if let Some(amt) = &self.amount {
            buf[33..65].copy_from_slice(amt);
        }

        // [65..77] channel_id
        if let Some(cid) = &self.channel_id {
            buf[65..77].copy_from_slice(cid);
        }

        buf
    }

    /// Decodes metadata from raw bytes.
    ///
    /// Parses a 77-byte buffer, treating all-zero optional fields as absent.
    ///
    /// # Panics
    ///
    /// Panics if input is less than 77 bytes.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let bytes = [0u8; 77];
    /// let meta = AnnouncementMetadata::decode(&bytes);
    /// ```
    pub fn decode(raw: &[u8]) -> Self {
        assert!(
            raw.len() >= 77,
            "metadata must be exactly 77 bytes, got {}",
            raw.len()
        );

        let view_tag = raw[0];

        // [1..33] tx_hash - treat all zeros as None
        let tx_hash = {
            let slice = &raw[1..33];
            if slice.iter().all(|&b| b == 0) {
                None
            } else {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(slice);
                Some(arr)
            }
        };

        // [33..65] amount - treat all zeros as None
        let amount = {
            let slice = &raw[33..65];
            if slice.iter().all(|&b| b == 0) {
                None
            } else {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(slice);
                Some(arr)
            }
        };

        // [65..77] channel_id - treat all zeros as None
        let channel_id = {
            let slice = &raw[65..77];
            if slice.iter().all(|&b| b == 0) {
                None
            } else {
                let mut arr = [0u8; 12];
                arr.copy_from_slice(slice);
                Some(arr)
            }
        };

        Self {
            view_tag,
            tx_hash,
            amount,
            channel_id,
        }
    }

    /// Converts 12-byte channel ID to 32-byte padded format for struct compatibility.
    ///
    /// Pads with zeros on the right (high bytes) to match existing `Announcement::channel_id`
    /// which uses `[u8; 32]`.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let mut meta = AnnouncementMetadata::new(0x42);
    /// meta.channel_id = Some([0xCC; 12]);
    ///
    /// let padded = meta.channel_id_padded();
    /// assert_eq!(padded, Some([0xCC, 0xCC, ..., 0x00, 0x00]));
    /// ```
    pub fn channel_id_padded(&self) -> Option<[u8; 32]> {
        self.channel_id.map(|c| {
            let mut padded = [0u8; 32];
            padded[..12].copy_from_slice(&c);
            padded
        })
    }

    /// Sets the tx_hash field.
    pub fn with_tx_hash(mut self, hash: [u8; 32]) -> Self {
        self.tx_hash = Some(hash);
        self
    }

    /// Sets the amount field.
    pub fn with_amount(mut self, amount: [u8; 32]) -> Self {
        self.amount = Some(amount);
        self
    }

    /// Sets the channel_id field.
    pub fn with_channel_id(mut self, cid: [u8; 12]) -> Self {
        self.channel_id = Some(cid);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metadata_new() {
        let meta = AnnouncementMetadata::new(0x42);
        assert_eq!(meta.view_tag, 0x42);
        assert!(meta.tx_hash.is_none());
        assert!(meta.amount.is_none());
        assert!(meta.channel_id.is_none());
    }

    #[test]
    fn test_metadata_encode_all_none() {
        let meta = AnnouncementMetadata::new(0x42);
        let bytes = meta.encode();

        assert_eq!(bytes.len(), 77);
        assert_eq!(bytes[0], 0x42);
        assert!(bytes[1..33].iter().all(|&b| b == 0));
        assert!(bytes[33..65].iter().all(|&b| b == 0));
        assert!(bytes[65..77].iter().all(|&b| b == 0));
    }

    #[test]
    fn test_metadata_encode_with_tx_hash() {
        let mut meta = AnnouncementMetadata::new(0x99);
        meta.tx_hash = Some([0xAB; 32]);

        let bytes = meta.encode();
        assert_eq!(bytes[0], 0x99);
        assert_eq!(&bytes[1..33], &[0xAB; 32]);
        assert!(bytes[33..65].iter().all(|&b| b == 0));
    }

    #[test]
    fn test_metadata_encode_with_amount() {
        let mut meta = AnnouncementMetadata::new(0x11);
        meta.amount = Some([0xCD; 32]);

        let bytes = meta.encode();
        assert_eq!(bytes[0], 0x11);
        assert!(bytes[1..33].iter().all(|&b| b == 0));
        assert_eq!(&bytes[33..65], &[0xCD; 32]);
    }

    #[test]
    fn test_metadata_encode_with_channel_id() {
        let mut meta = AnnouncementMetadata::new(0xEE);
        meta.channel_id = Some([0xDD; 12]);

        let bytes = meta.encode();
        assert_eq!(bytes[0], 0xEE);
        assert!(bytes[1..33].iter().all(|&b| b == 0));
        assert!(bytes[33..65].iter().all(|&b| b == 0));
        assert_eq!(&bytes[65..77], &[0xDD; 12]);
    }

    #[test]
    fn test_metadata_encode_all_fields() {
        let mut meta = AnnouncementMetadata::new(0x77);
        meta.tx_hash = Some([0x01; 32]);
        meta.amount = Some([0x02; 32]);
        meta.channel_id = Some([0x03; 12]);

        let bytes = meta.encode();
        assert_eq!(bytes[0], 0x77);
        assert_eq!(&bytes[1..33], &[0x01; 32]);
        assert_eq!(&bytes[33..65], &[0x02; 32]);
        assert_eq!(&bytes[65..77], &[0x03; 12]);
    }

    #[test]
    fn test_metadata_decode_all_none() {
        let bytes = [0u8; 77];
        let meta = AnnouncementMetadata::decode(&bytes);

        assert_eq!(meta.view_tag, 0);
        assert!(meta.tx_hash.is_none());
        assert!(meta.amount.is_none());
        assert!(meta.channel_id.is_none());
    }

    #[test]
    fn test_metadata_decode_with_tx_hash() {
        let mut bytes = [0u8; 77];
        bytes[0] = 0x42;
        bytes[1..33].copy_from_slice(&[0xAB; 32]);

        let meta = AnnouncementMetadata::decode(&bytes);
        assert_eq!(meta.view_tag, 0x42);
        assert_eq!(meta.tx_hash, Some([0xAB; 32]));
        assert!(meta.amount.is_none());
        assert!(meta.channel_id.is_none());
    }

    #[test]
    fn test_metadata_decode_with_amount() {
        let mut bytes = [0u8; 77];
        bytes[0] = 0x55;
        bytes[33..65].copy_from_slice(&[0xCD; 32]);

        let meta = AnnouncementMetadata::decode(&bytes);
        assert_eq!(meta.view_tag, 0x55);
        assert!(meta.tx_hash.is_none());
        assert_eq!(meta.amount, Some([0xCD; 32]));
        assert!(meta.channel_id.is_none());
    }

    #[test]
    fn test_metadata_decode_with_channel_id() {
        let mut bytes = [0u8; 77];
        bytes[0] = 0xCC;
        bytes[65..77].copy_from_slice(&[0xDD; 12]);

        let meta = AnnouncementMetadata::decode(&bytes);
        assert_eq!(meta.view_tag, 0xCC);
        assert!(meta.tx_hash.is_none());
        assert!(meta.amount.is_none());
        assert_eq!(meta.channel_id, Some([0xDD; 12]));
    }

    #[test]
    fn test_metadata_decode_all_fields() {
        let mut bytes = [0u8; 77];
        bytes[0] = 0x77;
        bytes[1..33].copy_from_slice(&[0x01; 32]);
        bytes[33..65].copy_from_slice(&[0x02; 32]);
        bytes[65..77].copy_from_slice(&[0x03; 12]);

        let meta = AnnouncementMetadata::decode(&bytes);
        assert_eq!(meta.view_tag, 0x77);
        assert_eq!(meta.tx_hash, Some([0x01; 32]));
        assert_eq!(meta.amount, Some([0x02; 32]));
        assert_eq!(meta.channel_id, Some([0x03; 12]));
    }

    #[test]
    fn test_metadata_roundtrip_all_none() {
        let meta = AnnouncementMetadata::new(0x42);
        let bytes = meta.encode();
        let meta2 = AnnouncementMetadata::decode(&bytes);

        assert_eq!(meta, meta2);
    }

    #[test]
    fn test_metadata_roundtrip_all_fields() {
        let mut meta = AnnouncementMetadata::new(0xAA);
        meta.tx_hash = Some([0x11; 32]);
        meta.amount = Some([0x22; 32]);
        meta.channel_id = Some([0x33; 12]);

        let bytes = meta.encode();
        let meta2 = AnnouncementMetadata::decode(&bytes);

        assert_eq!(meta, meta2);
    }

    #[test]
    fn test_metadata_channel_id_padded() {
        let mut meta = AnnouncementMetadata::new(0x42);
        meta.channel_id = Some([0xCC; 12]);

        let padded = meta.channel_id_padded().unwrap();
        assert_eq!(padded.len(), 32);
        assert_eq!(&padded[..12], &[0xCC; 12]);
        assert_eq!(&padded[12..], &[0x00; 20]);
    }

    #[test]
    fn test_metadata_channel_id_padded_none() {
        let meta = AnnouncementMetadata::new(0x42);
        assert!(meta.channel_id_padded().is_none());
    }

    #[test]
    fn test_metadata_builder_pattern() {
        let meta = AnnouncementMetadata::new(0x77)
            .with_tx_hash([0xAA; 32])
            .with_amount([0xBB; 32])
            .with_channel_id([0xCC; 12]);

        assert_eq!(meta.view_tag, 0x77);
        assert_eq!(meta.tx_hash, Some([0xAA; 32]));
        assert_eq!(meta.amount, Some([0xBB; 32]));
        assert_eq!(meta.channel_id, Some([0xCC; 12]));
    }

    #[test]
    fn test_metadata_serialization_none_skipped() {
        let meta = AnnouncementMetadata::new(0x42);
        let json = serde_json::to_string(&meta).unwrap();

        // Optional fields should be skipped when None
        assert!(!json.contains("tx_hash"));
        assert!(!json.contains("amount"));
        assert!(!json.contains("channel_id"));
        assert!(json.contains("view_tag"));
    }

    #[test]
    fn test_metadata_serialization_with_fields() {
        let mut meta = AnnouncementMetadata::new(0x42);
        meta.tx_hash = Some([0x11; 32]);
        meta.amount = Some([0x22; 32]);
        meta.channel_id = Some([0x33; 12]);

        let json = serde_json::to_string(&meta).unwrap();
        let meta2: AnnouncementMetadata = serde_json::from_str(&json).unwrap();

        assert_eq!(meta, meta2);
    }

    #[test]
    #[should_panic(expected = "metadata must be exactly 77 bytes")]
    fn test_metadata_decode_too_short() {
        let bytes = [0u8; 76];
        AnnouncementMetadata::decode(&bytes);
    }

    #[test]
    fn test_metadata_decode_ignores_extra_bytes() {
        let mut bytes = vec![0u8; 100];
        bytes[0] = 0x42;
        bytes[65..77].copy_from_slice(&[0xDD; 12]);

        let meta = AnnouncementMetadata::decode(&bytes);
        assert_eq!(meta.view_tag, 0x42);
        assert_eq!(meta.channel_id, Some([0xDD; 12]));
    }

    #[test]
    fn test_metadata_partial_zero_detection() {
        // Verify that fields with single non-zero byte are not treated as absent
        let mut bytes = [0u8; 77];
        bytes[0] = 0x42;
        bytes[32] = 0x01; // Last byte of tx_hash is non-zero

        let meta = AnnouncementMetadata::decode(&bytes);
        assert!(meta.tx_hash.is_some());

        // Encode back and verify
        let bytes2 = meta.encode();
        assert_eq!(bytes2[32], 0x01);
    }
}
