//! End-to-end flow test: stealth payment → on-chain announcement → Turso registry → scanner scan.
//!
//! This test simulates the full SPECTER lifecycle without any network calls:
//!
//! 1. Sender derives recipient's stealth address via ML-KEM
//! 2. Sender builds 77-byte metadata (source_chain_id, amount, tx_hash)
//! 3. On-chain event is simulated via `announcement_from_event`
//! 4. Announcement is stored in TursoRegistry (local test DB)
//! 5. Recipient scans the registry with their view tag
//! 6. Scanner finds and returns the correct announcement

use specter_chain::announcement_from_event;
use specter_core::constants::KYBER_CIPHERTEXT_SIZE;
use specter_core::types::AnnouncementMetadata;
use specter_core::traits::AnnouncementRegistry;
use specter_registry::turso::TursoRegistry;

// ── Helpers ────────────────────────────────────────────────────────────────

fn make_ephemeral_key() -> Vec<u8> {
    // All-0x42 simulates a real ML-KEM ciphertext (1088 bytes)
    vec![0x42u8; KYBER_CIPHERTEXT_SIZE]
}

fn make_stealth_addr() -> alloy::primitives::Address {
    "0x1111111111111111111111111111111111111111".parse().unwrap()
}

/// Simulate what the sender encodes into the on-chain metadata bytes.
/// `nonce` makes the tx_hash unique per announcement so UNIQUE constraints are not violated.
fn build_metadata(view_tag: u8, source_chain_id: u64, nonce: u8) -> [u8; 77] {
    let mut tx_hash = [0u8; 32];
    tx_hash[0] = nonce;
    tx_hash[1] = view_tag;
    tx_hash[2..10].copy_from_slice(&source_chain_id.to_be_bytes());

    AnnouncementMetadata::new(view_tag)
        .with_tx_hash(tx_hash)
        .with_amount([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]) // 1 wei
        .with_source_chain_id(source_chain_id)
        .encode()
}

// ── Tests ──────────────────────────────────────────────────────────────────

/// Full pipeline: metadata encode → announcement_from_event → Turso store → scan by view_tag
#[tokio::test]
async fn test_full_announcement_to_scan_flow() {
    let registry: TursoRegistry = TursoRegistry::new_test().await;

    // ── Step 1: Sender builds metadata for a payment from Arbitrum ─────────
    let recipient_view_tag = 0x42u8;
    let source_chain_id = 42161u64; // Arbitrum One
    let metadata = build_metadata(recipient_view_tag, source_chain_id, 1);

    // ── Step 2: Simulate on-chain Announcement event (Monad block 36_200_000) ─
    let monad_block = 36_200_000u64;
    let announcement = announcement_from_event(
        make_ephemeral_key(),
        metadata.to_vec(),
        make_stealth_addr(),
        monad_block,
    )
    .expect("announcement_from_event should succeed");

    // Verify what the indexer decoded
    assert_eq!(announcement.view_tag, recipient_view_tag);
    assert_eq!(announcement.source_chain_id, Some(source_chain_id));
    assert!(announcement.tx_hash.is_some(), "tx_hash should be decoded from metadata");
    assert!(announcement.amount.is_some(), "amount should be decoded from metadata");
    assert_eq!(announcement.block_number, Some(monad_block));
    assert_eq!(announcement.chain, Some("monad-testnet".to_string()));
    assert!(announcement.stealth_address.is_some());

    // ── Step 3: Store in Turso registry (on-chain path: on_chain = 1) ──────
    let id = registry
        .insert_onchain_announcement(&announcement)
        .await
        .expect("insert_onchain_announcement should succeed");
    assert!(id > 0, "assigned id should be > 0");

    // ── Step 4: Retrieve by ID and verify all fields ────────────────────────
    let stored = registry
        .get_by_id(id)
        .await
        .expect("get_by_id should succeed")
        .expect("announcement should exist");

    assert_eq!(stored.id, id);
    assert_eq!(stored.view_tag, recipient_view_tag);
    assert_eq!(stored.source_chain_id, Some(source_chain_id));
    assert_eq!(stored.block_number, Some(monad_block));
    assert!(stored.tx_hash.is_some());
    assert!(stored.amount.is_some());
    assert!(stored.stealth_address.is_some());

    // ── Step 5: Recipient scans by view_tag ─────────────────────────────────
    let matches = registry
        .get_by_view_tag(recipient_view_tag)
        .await
        .expect("get_by_view_tag should succeed");

    assert_eq!(matches.len(), 1, "should find exactly 1 announcement");
    assert_eq!(matches[0].view_tag, recipient_view_tag);
    assert_eq!(matches[0].source_chain_id, Some(source_chain_id));

    // ── Step 6: View tag filtering — wrong tag returns nothing ──────────────
    let no_matches = registry
        .get_by_view_tag(0xFF)
        .await
        .expect("get_by_view_tag(0xFF) should succeed");
    assert!(no_matches.is_empty(), "wrong view_tag should return no results");
}

/// Multiple senders, multiple chains → recipient only finds their own
#[tokio::test]
async fn test_multichain_sender_single_recipient_scan() {
    let registry: TursoRegistry = TursoRegistry::new_test().await;

    let recipient_tag = 0x77u8;
    let chains = [
        (42161u64, 36_100_001u64, 0xAAu8), // Arbitrum, block 1, different view_tag
        (10143u64, 36_100_002u64, recipient_tag), // Monad itself, recipient's tag
        (1u64,    36_100_003u64, 0xBBu8), // Ethereum, different view_tag
        (137u64,  36_100_004u64, recipient_tag), // Polygon, also recipient's tag
    ];

    for (i, (chain_id, block, view_tag)) in chains.iter().enumerate() {
        let metadata = build_metadata(*view_tag, *chain_id, i as u8 + 1);
        let ann = announcement_from_event(
            make_ephemeral_key(),
            metadata.to_vec(),
            make_stealth_addr(),
            *block,
        )
        .unwrap();

        registry.insert_onchain_announcement(&ann).await.unwrap();
    }

    // Total: 4 announcements
    assert_eq!(registry.count().await.unwrap(), 4);

    // Recipient scans with their view_tag — finds 2 (Monad + Polygon)
    let recipient_matches = registry
        .get_by_view_tag(recipient_tag)
        .await
        .unwrap();
    assert_eq!(recipient_matches.len(), 2);
    // Both should have the recipient's view_tag
    assert!(recipient_matches.iter().all(|a| a.view_tag == recipient_tag));

    // Get by source chain — only Arbitrum announcements
    let arb_anns = registry.get_by_source_chain(42161).await.unwrap();
    assert_eq!(arb_anns.len(), 1);
    assert_eq!(arb_anns[0].source_chain_id, Some(42161));

    // Get by source chain — only Polygon announcements
    let matic_anns = registry.get_by_source_chain(137).await.unwrap();
    assert_eq!(matic_anns.len(), 1);
    assert_eq!(matic_anns[0].source_chain_id, Some(137));
}

/// On-chain deduplication: replaying the same Monad event does not double-store
#[tokio::test]
async fn test_envio_replay_deduplication() {
    let registry: TursoRegistry = TursoRegistry::new_test().await;

    let metadata = build_metadata(0x55, 10143, 99);
    let mut ann = announcement_from_event(
        make_ephemeral_key(),
        metadata.to_vec(),
        make_stealth_addr(),
        36_300_000,
    )
    .unwrap();
    // Envio sets the Monad tx hash as the dedup key
    ann.tx_hash = Some("0xdeadbeef12345678deadbeef12345678deadbeef12345678deadbeef12345678".into());

    let id1 = registry.insert_onchain_announcement(&ann).await.unwrap();
    let id2 = registry.insert_onchain_announcement(&ann).await.unwrap();

    // Second insert returns same id — idempotent
    assert_eq!(id1, id2, "replay should return same id, not create a duplicate");
    assert_eq!(registry.count().await.unwrap(), 1, "only one row should exist");
}

/// Metadata encoding is correct: view_tag byte is first, chain ID at [65..73]
#[tokio::test]
async fn test_metadata_byte_layout_correctness() {
    let view_tag = 0xCC;
    let chain_id = 42161u64; // 0x0000_0000_0000_A4B1

    let metadata = build_metadata(view_tag, chain_id, 0);

    assert_eq!(metadata[0], view_tag, "byte 0 must be view_tag");

    // Bytes [65..73] = chain_id big-endian
    let encoded_chain = u64::from_be_bytes(metadata[65..73].try_into().unwrap());
    assert_eq!(encoded_chain, chain_id, "bytes [65..73] must be source_chain_id big-endian");

    // Bytes [73..77] = reserved zeros
    assert!(
        metadata[73..77].iter().all(|&b| b == 0),
        "reserved bytes [73..77] must be zero"
    );
}

/// Time-range scan covers all announcements between two blocks
#[tokio::test]
async fn test_time_range_scan() {
    let registry: TursoRegistry = TursoRegistry::new_test().await;

    // Publish 3 announcements with different timestamps
    for (nonce, (ts, chain)) in [(1000u64, 1u64), (2000, 42161), (3000, 137)].iter().enumerate() {
        let metadata = build_metadata(0xAA, *chain, nonce as u8 + 10);
        let mut ann = announcement_from_event(
            make_ephemeral_key(),
            metadata.to_vec(),
            make_stealth_addr(),
            ts / 100, // block number
        )
        .unwrap();
        ann.timestamp = *ts;
        registry.publish(ann).await.unwrap();
    }

    // Scan only the middle window
    let range = registry.get_by_time_range(1500, 2500).await.unwrap();
    assert_eq!(range.len(), 1, "only the 2000-timestamp announcement should match");
    assert_eq!(range[0].source_chain_id, Some(42161));
}
