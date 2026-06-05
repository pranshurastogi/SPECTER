//! Integration tests for Announcement, AnnouncementMetadata,
//! and ChainIndexer working together.
//!
//! These tests verify the full pipeline:
//! Metadata (encode) → event simulation → announcement_from_event → Announcement creation

use specter_chain::announcement_from_event;
use specter_core::constants::KYBER_CIPHERTEXT_SIZE;
use specter_core::types::AnnouncementMetadata;

fn make_valid_ephemeral_key() -> Vec<u8> {
    vec![0x42u8; KYBER_CIPHERTEXT_SIZE]
}

fn make_test_address() -> alloy::primitives::Address {
    "0x0000000000000000000000000000000000000001".parse().unwrap()
}

/// Test: Create metadata with all fields → encode → pass to announcement_from_event → verify
#[test]
fn test_announcement_from_event_with_all_metadata_fields() {
    // Create and encode metadata
    let mut metadata = AnnouncementMetadata::new(0xAA);
    metadata.tx_hash = Some([0x11; 32]);
    metadata.amount = Some([0x22; 32]);
    metadata.channel_id = Some([0x33; 12]);

    let encoded = metadata.encode();
    assert_eq!(encoded.len(), 77);

    // Pass to announcement_from_event
    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded.to_vec(),
        make_test_address(),
        1_000_000,
    );

    // Verify Announcement fields
    assert!(result.is_ok());
    let ann = result.unwrap();

    assert_eq!(ann.view_tag, 0xAA);
    assert!(ann.tx_hash.is_some());
    assert!(ann.amount.is_some());
    assert!(ann.channel_id.is_some());
    assert_eq!(ann.block_number, Some(1_000_000));
    assert_eq!(ann.chain, Some("monad".to_string()));
    assert!(ann.stealth_address.is_some());
    assert_eq!(ann.ephemeral_key.len(), KYBER_CIPHERTEXT_SIZE);
}

/// Test: Minimal metadata (view_tag only) → verify optional fields are None in Announcement
#[test]
fn test_announcement_from_event_minimal_metadata() {
    // Create metadata with only view_tag
    let metadata = AnnouncementMetadata::new(0x42);
    let encoded = metadata.encode();

    // Create announcement
    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded.to_vec(),
        make_test_address(),
        999,
    );

    // Verify only required fields are set
    assert!(result.is_ok());
    let ann = result.unwrap();

    assert_eq!(ann.view_tag, 0x42);
    assert!(ann.tx_hash.is_none());
    assert!(ann.amount.is_none());
    assert!(ann.channel_id.is_some()); // Was padded from None
    assert_eq!(ann.block_number, Some(999));
}

/// Test: 12-byte channel_id in metadata → verify padded to 32 bytes in Announcement
#[test]
fn test_announcement_channel_id_padding_integration() {
    // Create metadata with 12-byte channel_id
    let mut metadata = AnnouncementMetadata::new(0x77);
    metadata.channel_id = Some([0xCC; 12]);

    let encoded = metadata.encode();

    // Create announcement
    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded.to_vec(),
        make_test_address(),
        5_000_000,
    );

    // Verify padding
    assert!(result.is_ok());
    let ann = result.unwrap();

    assert!(ann.channel_id.is_some());
    let padded = ann.channel_id.unwrap();
    assert_eq!(padded.len(), 32);
    assert_eq!(&padded[..12], &[0xCC; 12]);
    assert_eq!(&padded[12..], &[0u8; 20]);
}

/// Test: Roundtrip with builder pattern → metadata → encode → event simulation → Announcement
#[test]
fn test_full_roundtrip_builder_to_announcement() {
    // Build complete metadata using builder
    let metadata = AnnouncementMetadata::new(0x99)
        .with_tx_hash([0xDE; 32])
        .with_amount([0xAD; 32])
        .with_channel_id([0xBE; 12]);

    let encoded = metadata.encode();

    // Simulate event and create announcement
    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded.to_vec(),
        "0x1234567890abcdef1234567890abcdef12345678".parse().unwrap(),
        12_345_678,
    );

    // Verify announcement matches metadata
    assert!(result.is_ok());
    let ann = result.unwrap();

    assert_eq!(ann.view_tag, metadata.view_tag);
    assert!(ann.tx_hash.is_some());
    assert!(ann.amount.is_some());
    assert!(ann.channel_id.is_some());
    assert_eq!(ann.block_number, Some(12_345_678));
    assert_eq!(ann.chain, Some("monad".to_string()));
}

/// Test: Metadata serialization → encode → decode via announcement_from_event → verify consistency
#[test]
fn test_metadata_json_serialization_to_announcement() {
    // Create metadata, serialize to JSON, deserialize
    let mut metadata = AnnouncementMetadata::new(0x55);
    metadata.tx_hash = Some([0x11; 32]);
    metadata.amount = Some([0x22; 32]);
    metadata.channel_id = Some([0x33; 12]);

    let json = serde_json::to_string(&metadata).unwrap();
    let metadata_restored: AnnouncementMetadata = serde_json::from_str(&json).unwrap();

    let encoded = metadata_restored.encode();

    // Create announcement from encoded metadata
    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded.to_vec(),
        make_test_address(),
        7_000_000,
    );

    // Verify all fields present
    assert!(result.is_ok());
    let ann = result.unwrap();

    assert_eq!(ann.view_tag, 0x55);
    assert!(ann.tx_hash.is_some());
    assert!(ann.amount.is_some());
    assert!(ann.channel_id.is_some());
}

/// Test: Batch creation of announcements with consistent metadata
#[test]
fn test_batch_announcements_from_events() {
    let mut announcements = Vec::new();

    for i in 0..5 {
        let view_tag = (i * 50) as u8;

        // Create metadata
        let metadata = AnnouncementMetadata::new(view_tag)
            .with_amount([(i + 1) as u8; 32])
            .with_channel_id([(i + 1) as u8; 12]);

        let encoded = metadata.encode();

        // Create announcement
        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            encoded.to_vec(),
            make_test_address(),
            1_000_000 + (i as u64),
        );

        assert!(result.is_ok());
        announcements.push(result.unwrap());
    }

    // Verify consistency
    for (i, ann) in announcements.iter().enumerate() {
        assert_eq!(ann.view_tag, (i * 50) as u8);
        assert!(ann.amount.is_some());
        assert!(ann.channel_id.is_some());
        assert_eq!(ann.block_number, Some(1_000_000 + i as u64));
        assert_eq!(ann.chain, Some("monad".to_string()));
    }
}

/// Test: Metadata with partial zero fields (partial zero bytes = present)
#[test]
fn test_metadata_partial_zero_fields_to_announcement() {
    // Create metadata with one non-zero byte in each field
    let mut metadata_bytes = [0u8; 77];
    metadata_bytes[0] = 0x42; // view_tag
    metadata_bytes[32] = 0x01; // Last byte of tx_hash is non-zero
    metadata_bytes[64] = 0x02; // Last byte of amount is non-zero
    metadata_bytes[76] = 0x03; // Last byte of channel_id is non-zero

    // Decode to verify they're present
    let metadata = AnnouncementMetadata::decode(&metadata_bytes);
    assert!(metadata.tx_hash.is_some());
    assert!(metadata.amount.is_some());
    assert!(metadata.channel_id.is_some());

    // Create announcement from these bytes
    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        metadata_bytes.to_vec(),
        make_test_address(),
        999,
    );

    // Verify all optional fields are present
    assert!(result.is_ok());
    let ann = result.unwrap();
    assert!(ann.tx_hash.is_some());
    assert!(ann.amount.is_some());
    assert!(ann.channel_id.is_some());
}

/// Test: Multiple views of the same metadata (encode → decode → encode → decode)
#[test]
fn test_metadata_multiple_roundtrips_to_announcement() {
    // Create and encode metadata
    let mut metadata1 = AnnouncementMetadata::new(0x88);
    metadata1.tx_hash = Some([0xAA; 32]);
    metadata1.amount = Some([0xBB; 32]);
    metadata1.channel_id = Some([0xCC; 12]);

    let encoded1 = metadata1.encode();

    // First decode
    let metadata2 = AnnouncementMetadata::decode(&encoded1);
    assert_eq!(metadata1, metadata2);

    let encoded2 = metadata2.encode();
    assert_eq!(encoded1, encoded2);

    // Create announcement from final encoded form
    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded2.to_vec(),
        make_test_address(),
        8_888_888,
    );

    // Verify integrity through roundtrips
    assert!(result.is_ok());
    let ann = result.unwrap();
    assert_eq!(ann.view_tag, 0x88);
    assert!(ann.tx_hash.is_some());
    assert!(ann.amount.is_some());
    assert!(ann.channel_id.is_some());
}

/// Test: Announcement from event preserves all metadata fields in correct format
#[test]
fn test_announcement_field_format_consistency() {
    // Create metadata with specific values
    let mut metadata = AnnouncementMetadata::new(0xDD);
    metadata.tx_hash = Some([0xEE; 32]);
    metadata.amount = Some([0xFF; 32]);
    metadata.channel_id = Some([0x99; 12]);

    let encoded = metadata.encode();

    // Create announcement
    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded.to_vec(),
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd".parse().unwrap(),
        9_999_999,
    );

    // Verify format consistency
    assert!(result.is_ok());
    let ann = result.unwrap();

    // view_tag should be preserved exactly
    assert_eq!(ann.view_tag, 0xDD);

    // Optional fields should exist and be properly formatted
    assert!(ann.tx_hash.is_some());
    assert!(ann.amount.is_some());
    assert!(ann.channel_id.is_some());

    // Channel ID should be 32 bytes with 12 non-zero + 20 zero
    let ch = ann.channel_id.unwrap();
    assert_eq!(ch.len(), 32);
    assert!(ch[..12].iter().all(|&b| b == 0x99));
    assert!(ch[12..].iter().all(|&b| b == 0x00));

    // Stealth address should be hex-formatted
    assert!(ann.stealth_address.is_some());
    assert!(ann.stealth_address.as_ref().unwrap().contains("0x"));

    // Chain should be set to "monad"
    assert_eq!(ann.chain, Some("monad".to_string()));
}
