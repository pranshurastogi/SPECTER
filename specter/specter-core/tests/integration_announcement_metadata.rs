//! Integration tests for Announcement and AnnouncementMetadata working together.

use specter_core::constants::KYBER_CIPHERTEXT_SIZE;
use specter_core::types::{Announcement, AnnouncementBuilder, AnnouncementMetadata};

fn make_valid_ephemeral_key() -> Vec<u8> {
    vec![0x42u8; KYBER_CIPHERTEXT_SIZE]
}

/// Announcement with stealth_address + metadata encode/decode roundtrip
#[test]
fn test_announcement_with_metadata_roundtrip() {
    let announcement = AnnouncementBuilder::new()
        .ephemeral_key(make_valid_ephemeral_key())
        .view_tag(0x99)
        .stealth_address("0xabcd1234567890ab")
        .tx_hash("0xdeadbeef".to_string())
        .build()
        .unwrap();

    let mut metadata = AnnouncementMetadata::new(announcement.view_tag);
    metadata.tx_hash = Some([0xDE; 32]);
    metadata.amount = Some([0x01; 32]);
    metadata.source_chain_id = Some(42161); // Arbitrum

    let meta_bytes = metadata.encode();
    assert_eq!(meta_bytes.len(), 77);
    assert_eq!(meta_bytes[0], announcement.view_tag);

    let decoded = AnnouncementMetadata::decode(&meta_bytes);
    assert_eq!(decoded.view_tag, announcement.view_tag);
    assert_eq!(decoded.tx_hash, metadata.tx_hash);
    assert_eq!(decoded.amount, metadata.amount);
    assert_eq!(decoded.source_chain_id, Some(42161));

    assert_eq!(
        announcement.stealth_address,
        Some("0xabcd1234567890ab".to_string())
    );
}

/// view_tag must be consistent between Announcement and AnnouncementMetadata
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

/// source_chain_id from metadata propagates to announcement
#[test]
fn test_announcement_source_chain_id_from_metadata() {
    let metadata = AnnouncementMetadata::new(0x42).with_source_chain_id(42161);
    let encoded = metadata.encode();
    let decoded = AnnouncementMetadata::decode(&encoded);

    assert_eq!(decoded.source_chain_id, Some(42161));

    let ann = AnnouncementBuilder::new()
        .ephemeral_key(make_valid_ephemeral_key())
        .view_tag(0x42)
        .source_chain_id(decoded.source_chain_id.unwrap())
        .build()
        .unwrap();

    assert_eq!(ann.source_chain_id, Some(42161));
}

/// Full announcement with all optional fields + complete metadata
#[test]
fn test_full_announcement_with_all_metadata_fields() {
    let announcement = AnnouncementBuilder::new()
        .ephemeral_key(make_valid_ephemeral_key())
        .view_tag(0xCC)
        .stealth_address("0x0123456789abcdef")
        .tx_hash("0xdeadbeef".to_string())
        .chain("monad-testnet")
        .block_number(17_000_000)
        .source_chain_id(42161)
        .build()
        .unwrap();

    let metadata = AnnouncementMetadata::new(announcement.view_tag)
        .with_tx_hash([0xDE; 32])
        .with_amount([0x01; 32])
        .with_source_chain_id(42161);

    let meta_bytes = metadata.encode();
    let decoded = AnnouncementMetadata::decode(&meta_bytes);

    assert_eq!(announcement.view_tag, decoded.view_tag);
    assert_eq!(decoded.tx_hash, Some([0xDE; 32]));
    assert_eq!(decoded.amount, Some([0x01; 32]));
    assert_eq!(decoded.source_chain_id, Some(42161));

    assert_eq!(
        announcement.stealth_address,
        Some("0x0123456789abcdef".to_string())
    );
    assert_eq!(announcement.source_chain_id, Some(42161));
    assert_eq!(announcement.chain, Some("monad-testnet".to_string()));
}

/// Binary format (to_bytes/from_bytes) is independent of metadata fields
#[test]
fn test_announcement_binary_format_independent_of_metadata() {
    let announcement = AnnouncementBuilder::new()
        .ephemeral_key(make_valid_ephemeral_key())
        .view_tag(0x77)
        .stealth_address("0xstealthaddr")
        .source_chain_id(10143)
        .build()
        .unwrap();

    let metadata = AnnouncementMetadata::new(0x77)
        .with_tx_hash([0x11; 32])
        .with_amount([0x22; 32])
        .with_source_chain_id(10143);

    let binary = announcement.to_bytes();
    let meta_bytes = metadata.encode();

    assert_eq!(meta_bytes.len(), 77);
    // Binary announcement format is ephemeral_key(1088) + view_tag(1) + timestamp(8)
    assert_eq!(binary.len(), KYBER_CIPHERTEXT_SIZE + 1 + 8);

    let decoded_ann = Announcement::from_bytes(&binary).unwrap();
    // source_chain_id is not in the binary format — comes from on-chain metadata decode
    assert!(decoded_ann.source_chain_id.is_none());
    assert!(decoded_ann.stealth_address.is_none());
    assert_eq!(decoded_ann.ephemeral_key, announcement.ephemeral_key);
    assert_eq!(decoded_ann.view_tag, announcement.view_tag);

    let decoded_meta = AnnouncementMetadata::decode(&meta_bytes);
    assert_eq!(decoded_meta.source_chain_id, Some(10143));
}

/// JSON serialization includes stealth_address and source_chain_id
#[test]
fn test_announcement_json_with_metadata() {
    let announcement = AnnouncementBuilder::new()
        .ephemeral_key(make_valid_ephemeral_key())
        .view_tag(0x55)
        .stealth_address("0xstealthaddress")
        .source_chain_id(42161)
        .build()
        .unwrap();

    let ann_json = serde_json::to_string(&announcement).unwrap();
    assert!(ann_json.contains("stealth_address"));
    assert!(ann_json.contains("0xstealthaddress"));
    assert!(ann_json.contains("source_chain_id"));

    let decoded_ann: Announcement = serde_json::from_str(&ann_json).unwrap();
    assert_eq!(
        decoded_ann.stealth_address,
        Some("0xstealthaddress".to_string())
    );
    assert_eq!(decoded_ann.source_chain_id, Some(42161));

    // Metadata: source_chain_id serializes/deserializes correctly
    let metadata = AnnouncementMetadata::new(0x55).with_source_chain_id(42161);
    let meta_json = serde_json::to_string(&metadata).unwrap();
    assert!(meta_json.contains("source_chain_id"));
    assert!(!meta_json.contains("channel_id")); // Yellow is removed

    let decoded_meta: AnnouncementMetadata = serde_json::from_str(&meta_json).unwrap();
    assert_eq!(decoded_meta.source_chain_id, Some(42161));
}

/// Optional metadata fields are skipped in JSON when None
#[test]
fn test_metadata_optional_fields_skipped_in_json() {
    let minimal_meta = AnnouncementMetadata::new(0x42);
    let json = serde_json::to_string(&minimal_meta).unwrap();

    assert!(json.contains("view_tag"));
    assert!(!json.contains("tx_hash"));
    assert!(!json.contains("amount"));
    assert!(!json.contains("source_chain_id"));
    assert!(!json.contains("channel_id")); // Yellow is removed

    let mut partial_meta = AnnouncementMetadata::new(0x42);
    partial_meta.tx_hash = Some([0xAA; 32]);
    let json = serde_json::to_string(&partial_meta).unwrap();

    assert!(json.contains("tx_hash"));
    assert!(!json.contains("amount"));
    assert!(!json.contains("source_chain_id"));
}

/// stealth_address is JSON-only (not preserved in binary format)
#[test]
fn test_announcement_stealth_address_json_only() {
    let announcement = AnnouncementBuilder::new()
        .ephemeral_key(make_valid_ephemeral_key())
        .view_tag(0x88)
        .stealth_address("0xjsononly")
        .build()
        .unwrap();

    let json = serde_json::to_string(&announcement).unwrap();
    assert!(json.contains("stealth_address"));

    let binary = announcement.to_bytes();
    let decoded = Announcement::from_bytes(&binary).unwrap();
    assert!(decoded.stealth_address.is_none());
    assert_eq!(decoded.view_tag, announcement.view_tag);
}

/// Batch announcements across multiple chains
#[test]
fn test_batch_announcements_with_consistent_metadata() {
    let chains = [42161u64, 10143, 1, 137, 8453];

    for (i, &chain_id) in chains.iter().enumerate() {
        let view_tag = (i * 50) as u8;
        let announcement = AnnouncementBuilder::new()
            .ephemeral_key(make_valid_ephemeral_key())
            .view_tag(view_tag)
            .stealth_address(format!("0xstealth{}", i))
            .source_chain_id(chain_id)
            .build()
            .unwrap();

        let metadata = AnnouncementMetadata::new(view_tag).with_source_chain_id(chain_id);

        let encoded = metadata.encode();
        let decoded = AnnouncementMetadata::decode(&encoded);

        assert_eq!(decoded.view_tag, view_tag);
        assert_eq!(decoded.source_chain_id, Some(chain_id));
        assert_eq!(announcement.source_chain_id, Some(chain_id));
        assert_eq!(announcement.view_tag, view_tag);
    }
}
