//! Integration tests for Announcement, AnnouncementMetadata,
//! and the announcement_from_event pipeline working together.
//!
//! Verifies: metadata encode → event simulation → announcement_from_event → Announcement fields

use specter_chain::announcement_from_event;
use specter_core::constants::KYBER_CIPHERTEXT_SIZE;
use specter_core::types::AnnouncementMetadata;

fn make_valid_ephemeral_key() -> Vec<u8> {
    vec![0x42u8; KYBER_CIPHERTEXT_SIZE]
}

fn make_test_address() -> alloy::primitives::Address {
    "0x0000000000000000000000000000000000000001"
        .parse()
        .unwrap()
}

/// Full pipeline: metadata with all fields → encode → announcement_from_event → verify
#[test]
fn test_announcement_from_event_with_all_metadata_fields() {
    let metadata = AnnouncementMetadata::new(0xAA)
        .with_tx_hash([0x11; 32])
        .with_amount([0x22; 32])
        .with_source_chain_id(42161); // Arbitrum One

    let encoded = metadata.encode();
    assert_eq!(encoded.len(), 77);

    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded.to_vec(),
        make_test_address(),
        1_000_000,
    );

    assert!(result.is_ok());
    let ann = result.unwrap();

    assert_eq!(ann.view_tag, 0xAA);
    assert!(ann.payment_tx_hash.is_some()); // metadata tx_hash → payment_tx_hash
    assert!(ann.amount.is_some());
    assert_eq!(ann.source_chain_id, Some(42161));
    assert_eq!(ann.block_number, Some(1_000_000));
    assert_eq!(ann.chain, Some("monad-testnet".to_string()));
    assert!(ann.stealth_address.is_some());
    assert_eq!(ann.ephemeral_key.len(), KYBER_CIPHERTEXT_SIZE);
}

/// Minimal metadata (view_tag only) → optional fields are None
#[test]
fn test_announcement_from_event_minimal_metadata() {
    let metadata = AnnouncementMetadata::new(0x42);
    let encoded = metadata.encode();

    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded.to_vec(),
        make_test_address(),
        999,
    );

    assert!(result.is_ok());
    let ann = result.unwrap();

    assert_eq!(ann.view_tag, 0x42);
    assert!(ann.payment_tx_hash.is_none()); // no tx_hash in minimal metadata
    assert!(ann.amount.is_none());
    assert!(ann.source_chain_id.is_none());
    assert_eq!(ann.block_number, Some(999));
}

/// source_chain_id = Monad testnet (10143) roundtrip
#[test]
fn test_announcement_source_chain_id_monad() {
    let metadata = AnnouncementMetadata::new(0x77).with_source_chain_id(10143);
    let encoded = metadata.encode();

    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded.to_vec(),
        make_test_address(),
        5_000_000,
    );

    assert!(result.is_ok());
    let ann = result.unwrap();
    assert_eq!(ann.source_chain_id, Some(10143));
}

/// Full builder → metadata → encode → event → verify all fields preserved
#[test]
fn test_full_roundtrip_builder_to_announcement() {
    let metadata = AnnouncementMetadata::new(0x99)
        .with_tx_hash([0xDE; 32])
        .with_amount([0xAD; 32])
        .with_source_chain_id(1); // Ethereum mainnet

    let encoded = metadata.encode();

    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded.to_vec(),
        "0x1234567890abcdef1234567890abcdef12345678"
            .parse()
            .unwrap(),
        12_345_678,
    );

    assert!(result.is_ok());
    let ann = result.unwrap();

    assert_eq!(ann.view_tag, metadata.view_tag);
    assert!(ann.payment_tx_hash.is_some()); // metadata tx_hash → payment_tx_hash
    assert!(ann.amount.is_some());
    assert_eq!(ann.source_chain_id, Some(1));
    assert_eq!(ann.block_number, Some(12_345_678));
    assert_eq!(ann.chain, Some("monad-testnet".to_string()));
}

/// JSON serialize/deserialize metadata → encode → event → verify
#[test]
fn test_metadata_json_serialization_to_announcement() {
    let mut metadata = AnnouncementMetadata::new(0x55);
    metadata.tx_hash = Some([0x11; 32]);
    metadata.amount = Some([0x22; 32]);
    metadata.source_chain_id = Some(42161);

    let json = serde_json::to_string(&metadata).unwrap();
    let metadata_restored: AnnouncementMetadata = serde_json::from_str(&json).unwrap();

    let encoded = metadata_restored.encode();

    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded.to_vec(),
        make_test_address(),
        7_000_000,
    );

    assert!(result.is_ok());
    let ann = result.unwrap();

    assert_eq!(ann.view_tag, 0x55);
    assert!(ann.payment_tx_hash.is_some()); // metadata tx_hash → payment_tx_hash
    assert!(ann.amount.is_some());
    assert_eq!(ann.source_chain_id, Some(42161));
}

/// Batch creation — verify consistency across multiple events
#[test]
fn test_batch_announcements_from_events() {
    let chains = [42161u64, 10143, 1, 137, 8453]; // Arbitrum, Monad, Ethereum, Polygon, Base

    for (i, &chain_id) in chains.iter().enumerate() {
        let view_tag = (i * 50) as u8;
        let metadata = AnnouncementMetadata::new(view_tag)
            .with_amount([(i + 1) as u8; 32])
            .with_source_chain_id(chain_id);

        let result = announcement_from_event(
            make_valid_ephemeral_key(),
            metadata.encode().to_vec(),
            make_test_address(),
            1_000_000 + i as u64,
        );

        assert!(result.is_ok());
        let ann = result.unwrap();
        assert_eq!(ann.view_tag, view_tag);
        assert!(ann.amount.is_some());
        assert_eq!(ann.source_chain_id, Some(chain_id));
        assert_eq!(ann.block_number, Some(1_000_000 + i as u64));
    }
}

/// Partial zero fields (single non-zero byte) are treated as present
#[test]
fn test_metadata_partial_zero_fields_to_announcement() {
    let mut metadata_bytes = [0u8; 77];
    metadata_bytes[0] = 0x42;
    metadata_bytes[32] = 0x01; // Last byte of tx_hash non-zero
    metadata_bytes[64] = 0x02; // Last byte of amount non-zero
                               // source_chain_id: set to 1 (Ethereum mainnet)
    metadata_bytes[65..73].copy_from_slice(&1u64.to_be_bytes());

    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        metadata_bytes.to_vec(),
        make_test_address(),
        999,
    );

    assert!(result.is_ok());
    let ann = result.unwrap();
    assert!(ann.payment_tx_hash.is_some()); // metadata tx_hash → payment_tx_hash
    assert!(ann.amount.is_some());
    assert_eq!(ann.source_chain_id, Some(1));
}

/// Multiple encode/decode roundtrips preserve integrity
#[test]
fn test_metadata_multiple_roundtrips_to_announcement() {
    let mut meta1 = AnnouncementMetadata::new(0x88);
    meta1.tx_hash = Some([0xAA; 32]);
    meta1.amount = Some([0xBB; 32]);
    meta1.source_chain_id = Some(42161);

    let encoded1 = meta1.encode();
    let meta2 = AnnouncementMetadata::decode(&encoded1);
    assert_eq!(meta1, meta2);

    let encoded2 = meta2.encode();
    assert_eq!(encoded1, encoded2);

    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        encoded2.to_vec(),
        make_test_address(),
        8_888_888,
    );

    assert!(result.is_ok());
    let ann = result.unwrap();
    assert_eq!(ann.view_tag, 0x88);
    assert!(ann.payment_tx_hash.is_some()); // metadata tx_hash → payment_tx_hash
    assert!(ann.amount.is_some());
    assert_eq!(ann.source_chain_id, Some(42161));
}

/// Field format consistency — hex formatting, chain name, stealth address format
#[test]
fn test_announcement_field_format_consistency() {
    let metadata = AnnouncementMetadata::new(0xDD)
        .with_tx_hash([0xEE; 32])
        .with_amount([0xFF; 32])
        .with_source_chain_id(42161);

    let result = announcement_from_event(
        make_valid_ephemeral_key(),
        metadata.encode().to_vec(),
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
            .parse()
            .unwrap(),
        9_999_999,
    );

    assert!(result.is_ok());
    let ann = result.unwrap();

    assert_eq!(ann.view_tag, 0xDD);
    assert_eq!(ann.source_chain_id, Some(42161));

    // payment_tx_hash (from metadata bytes) should be hex-formatted
    let h = ann.payment_tx_hash.unwrap();
    assert!(h.starts_with("0x") || h.chars().all(|c| c.is_ascii_hexdigit()));
    // tx_hash (announce tx, set by caller) is None here since announcement_from_event doesn't set it
    assert!(ann.tx_hash.is_none());

    // amount should be hex-formatted
    let a = ann.amount.unwrap();
    assert!(a.starts_with("0x") || a.chars().all(|c| c.is_ascii_hexdigit()));

    // Stealth address contains "0x"
    assert!(ann.stealth_address.as_ref().unwrap().contains("0x"));

    // Chain name is explicit
    assert_eq!(ann.chain, Some("monad-testnet".to_string()));
}
