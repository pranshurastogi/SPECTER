//! Integration tests for Announcement (Phase 2) and AnnouncementMetadata (Phase 3)
//!
//! These tests verify that the types work correctly together in realistic scenarios.

use specter_core::types::{Announcement, AnnouncementBuilder, AnnouncementMetadata};
use specter_core::constants::KYBER_CIPHERTEXT_SIZE;

fn make_valid_ephemeral_key() -> Vec<u8> {
    vec![0x42u8; KYBER_CIPHERTEXT_SIZE]
}

/// Test creating an announcement with stealth_address and encoding its metadata
#[test]
fn test_announcement_with_metadata_roundtrip() {
    // Create a complete announcement with stealth address
    let announcement = AnnouncementBuilder::new()
        .ephemeral_key(make_valid_ephemeral_key())
        .view_tag(0x99)
        .stealth_address("0xabcd1234567890ab")
        .amount("1.5")
        .tx_hash("0xdeadbeef".to_string())
        .build()
        .unwrap();

    // Create corresponding metadata
    let mut metadata = AnnouncementMetadata::new(announcement.view_tag);
    metadata.tx_hash = Some([0xDE; 32]); // Simplified for test
    metadata.amount = Some([0x01; 32]);
    metadata.channel_id = Some([0xCC; 12]);

    // Encode metadata to bytes
    let meta_bytes = metadata.encode();
    assert_eq!(meta_bytes.len(), 77);
    assert_eq!(meta_bytes[0], announcement.view_tag);

    // Decode back and verify consistency
    let decoded_metadata = AnnouncementMetadata::decode(&meta_bytes);
    assert_eq!(decoded_metadata.view_tag, announcement.view_tag);
    assert_eq!(decoded_metadata.tx_hash, metadata.tx_hash);
    assert_eq!(decoded_metadata.amount, metadata.amount);
    assert_eq!(decoded_metadata.channel_id, metadata.channel_id);

    // Verify stealth_address is preserved in announcement
    assert_eq!(announcement.stealth_address, Some("0xabcd1234567890ab".to_string()));
}

/// Test that announcement view_tag matches metadata view_tag
#[test]
fn test_announcement_metadata_view_tag_consistency() {
    for view_tag in [0u8, 0x42, 0xFF, 127, 255] {
        let announcement = AnnouncementBuilder::new()
            .ephemeral_key(make_valid_ephemeral_key())
            .view_tag(view_tag)
            .stealth_address("0x1234")
            .build()
            .unwrap();

        let metadata = AnnouncementMetadata::new(announcement.view_tag);
        let encoded = metadata.encode();

        assert_eq!(encoded[0], view_tag);
        assert_eq!(encoded[0], announcement.view_tag);
    }
}

/// Test updating announcement with metadata-derived channel_id
#[test]
fn test_announcement_channel_id_from_metadata() {
    let mut announcement = AnnouncementBuilder::new()
        .ephemeral_key(make_valid_ephemeral_key())
        .view_tag(0x42)
        .stealth_address("0xstealthaddr")
        .build()
        .unwrap();

    // Create metadata with channel_id
    let mut metadata = AnnouncementMetadata::new(0x42);
    let channel_id_12 = [0xAA; 12];
    metadata.channel_id = Some(channel_id_12);

    // Use the padded version to update announcement
    if let Some(padded) = metadata.channel_id_padded() {
        announcement.channel_id = Some(padded);
    }

    // Verify the conversion
    assert!(announcement.channel_id.is_some());
    let padded = announcement.channel_id.unwrap();
    assert_eq!(&padded[..12], &channel_id_12);
    assert_eq!(&padded[12..], &[0u8; 20]); // Remaining bytes are zero
}

/// Test announcement with all optional fields and complete metadata
#[test]
fn test_full_announcement_with_all_metadata_fields() {
    let ephemeral_key = make_valid_ephemeral_key();
    let announcement = AnnouncementBuilder::new()
        .ephemeral_key(ephemeral_key.clone())
        .view_tag(0xCC)
        .stealth_address("0x0123456789abcdef")
        .amount("123.45")
        .tx_hash("0xdeadbeefcafebabe".to_string())
        .chain("ethereum")
        .block_number(17_000_000)
        .build()
        .unwrap();

    // Build complete metadata
    let metadata = AnnouncementMetadata::new(announcement.view_tag)
        .with_tx_hash([0xDE; 32])
        .with_amount([0x01; 32])
        .with_channel_id([0xBB; 12]);

    // Roundtrip through encoding
    let meta_bytes = metadata.encode();
    let decoded = AnnouncementMetadata::decode(&meta_bytes);

    // Verify all fields are preserved
    assert_eq!(announcement.view_tag, decoded.view_tag);
    assert_eq!(decoded.tx_hash, Some([0xDE; 32]));
    assert_eq!(decoded.amount, Some([0x01; 32]));
    assert_eq!(decoded.channel_id, Some([0xBB; 12]));

    // Verify announcement fields are independent
    assert_eq!(announcement.stealth_address, Some("0x0123456789abcdef".to_string()));
    assert_eq!(announcement.amount, Some("123.45".to_string()));
    assert_eq!(announcement.chain, Some("ethereum".to_string()));
}

/// Test that announcement binary serialization (to_bytes/from_bytes) doesn't interfere
/// with stealth_address or metadata
#[test]
fn test_announcement_binary_format_independent_of_metadata() {
    let announcement = AnnouncementBuilder::new()
        .ephemeral_key(make_valid_ephemeral_key())
        .view_tag(0x77)
        .stealth_address("0xstealthaddr")
        .build()
        .unwrap();

    // Create metadata
    let mut metadata = AnnouncementMetadata::new(0x77);
    metadata.tx_hash = Some([0x11; 32]);
    metadata.amount = Some([0x22; 32]);
    metadata.channel_id = Some([0x33; 12]);

    // Binary encode announcement (should not include stealth_address)
    let binary = announcement.to_bytes();

    // Encode metadata to 77 bytes
    let meta_bytes = metadata.encode();

    // Verify they are independent
    assert_eq!(meta_bytes.len(), 77);
    assert_ne!(binary.len(), 77); // Binary format is different

    // Decode announcement from binary
    let decoded_ann = Announcement::from_bytes(&binary).unwrap();

    // Stealth address should not be preserved in binary format
    assert!(decoded_ann.stealth_address.is_none());

    // But ephemeral_key and view_tag should be
    assert_eq!(decoded_ann.ephemeral_key, announcement.ephemeral_key);
    assert_eq!(decoded_ann.view_tag, announcement.view_tag);

    // Metadata should still be unchanged
    let decoded_meta = AnnouncementMetadata::decode(&meta_bytes);
    assert_eq!(decoded_meta.tx_hash, metadata.tx_hash);
}

/// Test JSON serialization with both announcement stealth_address and metadata
#[test]
fn test_announcement_json_with_metadata() {
    let announcement = AnnouncementBuilder::new()
        .ephemeral_key(make_valid_ephemeral_key())
        .view_tag(0x55)
        .stealth_address("0xstealthaddress")
        .amount("10.5")
        .build()
        .unwrap();

    // Serialize announcement to JSON
    let ann_json = serde_json::to_string(&announcement).unwrap();
    assert!(ann_json.contains("stealth_address"));
    assert!(ann_json.contains("0xstealthaddress"));

    // Deserialize back
    let decoded_ann: Announcement = serde_json::from_str(&ann_json).unwrap();
    assert_eq!(decoded_ann.stealth_address, Some("0xstealthaddress".to_string()));

    // Separately, handle metadata
    let metadata = AnnouncementMetadata::new(announcement.view_tag)
        .with_channel_id([0xEE; 12]);
    let meta_json = serde_json::to_string(&metadata).unwrap();
    assert!(meta_json.contains("channel_id"));

    // Deserialize metadata
    let decoded_meta: AnnouncementMetadata = serde_json::from_str(&meta_json).unwrap();
    assert_eq!(decoded_meta.channel_id, Some([0xEE; 12]));
}

/// Test that optional fields in metadata are correctly omitted when None
#[test]
fn test_metadata_optional_fields_skipped_in_json() {
    // Metadata with no optional fields
    let minimal_meta = AnnouncementMetadata::new(0x42);
    let json = serde_json::to_string(&minimal_meta).unwrap();

    assert!(json.contains("view_tag"));
    assert!(!json.contains("tx_hash"));
    assert!(!json.contains("amount"));
    assert!(!json.contains("channel_id"));

    // Metadata with one optional field
    let mut partial_meta = AnnouncementMetadata::new(0x42);
    partial_meta.tx_hash = Some([0xAA; 32]);
    let json = serde_json::to_string(&partial_meta).unwrap();

    assert!(json.contains("tx_hash"));
    assert!(!json.contains("amount"));
    assert!(!json.contains("channel_id"));
}

/// Test that announcement stealth_address is JSON-only (not in binary format)
/// while metadata is fixed binary format
#[test]
fn test_announcement_stealth_address_json_only() {
    let announcement = AnnouncementBuilder::new()
        .ephemeral_key(make_valid_ephemeral_key())
        .view_tag(0x88)
        .stealth_address("0xjsononly")
        .build()
        .unwrap();

    // JSON includes stealth_address
    let json = serde_json::to_string(&announcement).unwrap();
    assert!(json.contains("stealth_address"));

    // Binary format does not
    let binary = announcement.to_bytes();
    let decoded = Announcement::from_bytes(&binary).unwrap();
    assert!(decoded.stealth_address.is_none());
    assert_eq!(decoded.view_tag, announcement.view_tag);
}

/// Test creating announcements in a batch with consistent metadata
#[test]
fn test_batch_announcements_with_consistent_metadata() {
    let mut announcements = Vec::new();
    let mut metadata_list = Vec::new();

    for i in 0..5 {
        let view_tag = (i * 50) as u8;
        let announcement = AnnouncementBuilder::new()
            .ephemeral_key(make_valid_ephemeral_key())
            .view_tag(view_tag)
            .stealth_address(&format!("0xstealth{}", i))
            .build()
            .unwrap();

        // Use non-zero values to avoid them being treated as absent
        // (all-zero optional fields are treated as None in decode)
        let amount_value = (i + 1) as u8;
        let channel_id_value = (i + 1) as u8;

        let metadata = AnnouncementMetadata::new(view_tag)
            .with_amount([amount_value; 32])
            .with_channel_id([channel_id_value; 12]);

        announcements.push(announcement);
        metadata_list.push(metadata);
    }

    // Verify consistency
    for (ann, meta) in announcements.iter().zip(metadata_list.iter()) {
        assert_eq!(ann.view_tag, meta.view_tag);

        // Verify metadata roundtrip
        let encoded = meta.encode();
        let decoded = AnnouncementMetadata::decode(&encoded);
        assert_eq!(*meta, decoded);
    }
}
