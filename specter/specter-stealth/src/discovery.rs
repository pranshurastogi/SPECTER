//! Payment discovery (recipient scan).
//!
//! ## Trust split (protocol v2)
//!
//! **Detection** — finding which announcements are yours and at what address —
//! requires only the *viewing* secret key and the *spending public* key. It does
//! NOT require the spending secret key. This is what a watch-only client, an
//! auditor, or a server-side scanner runs.
//!
//! **Spending** — deriving the one-time private key to move funds — is a separate
//! step ([`derive_spend_keys`]) that additionally requires the spending *secret*
//! key. That secret should only ever exist on the owner's device.
//!
//! Concretely: scanning yields a [`DiscoveredPayment`] carrying the stealth
//! address and the per-payment `shared_secret`; the holder later feeds that
//! `shared_secret` plus their spending secret key into [`derive_spend_keys`].

use zeroize::Zeroize;

use specter_core::error::{Result, SpecterError};
use specter_core::types::{Announcement, EthAddress, SuiAddress};
use specter_crypto::derive::{derive_stealth_address, derive_stealth_sui_address, StealthKeys};
use specter_crypto::{compute_view_tag, decapsulate, KyberCiphertext};

// Re-export the spend-key derivation so callers get it from the discovery module.
pub use specter_crypto::derive::derive_stealth_keys as derive_spend_keys;

/// A payment discovered during a view-only scan.
///
/// Contains everything needed to *recognise* the payment. To spend it, pass
/// `shared_secret` (with your spending secret key) to [`derive_spend_keys`].
#[derive(Clone)]
pub struct DiscoveredPayment {
    /// The one-time stealth Ethereum address funds were sent to.
    pub address: EthAddress,
    /// The matching one-time Sui address (same secp256k1 key).
    pub sui_address: SuiAddress,
    /// The per-payment ML-KEM shared secret. Needed to derive the spend key.
    /// Knowing this does NOT allow spending without the spending secret key.
    pub shared_secret: [u8; 32],
}

impl Drop for DiscoveredPayment {
    fn drop(&mut self) {
        self.shared_secret.zeroize();
    }
}

impl std::fmt::Debug for DiscoveredPayment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DiscoveredPayment")
            .field("address", &self.address)
            .field("sui_address", &self.sui_address)
            .field("shared_secret", &"[REDACTED]")
            .finish()
    }
}

/// Result of scanning a single announcement.
#[derive(Debug)]
pub enum ScanResult {
    /// View tag didn't match - not for this recipient.
    NotForUs,
    /// View tag matched and decapsulation succeeded - payment discovered.
    Discovered(DiscoveredPayment),
    /// View tag matched but decapsulation/derivation failed (shouldn't happen normally).
    DecapsulationFailed(SpecterError),
}

impl ScanResult {
    /// Returns true if a payment was discovered.
    pub fn is_discovered(&self) -> bool {
        matches!(self, ScanResult::Discovered(_))
    }

    /// Returns the discovered payment if present.
    pub fn into_payment(self) -> Option<DiscoveredPayment> {
        match self {
            ScanResult::Discovered(p) => Some(p),
            _ => None,
        }
    }
}

/// Statistics for scanning operations.
#[derive(Debug, Clone, Default)]
pub struct ScanStats {
    /// Total announcements scanned.
    pub total_scanned: u64,
    /// Number of view tag matches.
    pub view_tag_matches: u64,
    /// Number of payments discovered.
    pub discoveries: u64,
    /// Number of errors during scanning.
    pub errors: u64,
    /// Duration of the scan in milliseconds.
    pub duration_ms: u64,
}

impl ScanStats {
    /// Creates a new stats tracker.
    pub fn new() -> Self {
        Self::default()
    }

    /// Records a scan result.
    pub fn record(&mut self, result: &ScanResult) {
        self.total_scanned += 1;
        match result {
            ScanResult::Discovered(_) => {
                self.view_tag_matches += 1;
                self.discoveries += 1;
            }
            ScanResult::DecapsulationFailed(_) => {
                self.errors += 1;
            }
            ScanResult::NotForUs => {}
        }
    }

    /// Returns the scan rate (announcements per second).
    pub fn rate(&self) -> f64 {
        if self.duration_ms == 0 {
            0.0
        } else {
            (self.total_scanned as f64 / self.duration_ms as f64) * 1000.0
        }
    }

    /// Returns the filter efficiency (percentage of announcements filtered).
    pub fn filter_efficiency(&self) -> f64 {
        if self.total_scanned == 0 {
            0.0
        } else {
            ((self.total_scanned - self.view_tag_matches) as f64 / self.total_scanned as f64)
                * 100.0
        }
    }
}

/// Decapsulate with `viewing_sk`; if the view tag matches, derive the stealth
/// address from the *public* spending key. View-only: no spending secret needed.
pub fn scan_announcement(
    announcement: &Announcement,
    viewing_sk: &[u8],
    spending_pub: &[u8],
) -> ScanResult {
    if let Err(e) = announcement.validate() {
        return ScanResult::DecapsulationFailed(e);
    }

    let ciphertext = match KyberCiphertext::from_bytes(&announcement.ephemeral_key) {
        Ok(ct) => ct,
        Err(e) => return ScanResult::DecapsulationFailed(e),
    };

    let viewing_secret = match specter_core::types::KyberSecretKey::from_bytes(viewing_sk) {
        Ok(sk) => sk,
        Err(e) => return ScanResult::DecapsulationFailed(e),
    };

    let shared_secret = match decapsulate(&ciphertext, &viewing_secret) {
        Ok(ss) => ss,
        Err(e) => return ScanResult::DecapsulationFailed(e),
    };

    let expected_view_tag = compute_view_tag(&shared_secret);
    if expected_view_tag != announcement.view_tag {
        return ScanResult::NotForUs;
    }

    match build_discovered_payment(spending_pub, &shared_secret) {
        Ok(p) => ScanResult::Discovered(p),
        Err(e) => ScanResult::DecapsulationFailed(e),
    }
}

/// Builds a [`DiscoveredPayment`] from public spending key + shared secret.
fn build_discovered_payment(spending_pub: &[u8], shared_secret: &[u8]) -> Result<DiscoveredPayment> {
    let address = derive_stealth_address(spending_pub, shared_secret)?;
    let sui_address = derive_stealth_sui_address(spending_pub, shared_secret)?;
    let mut ss = [0u8; 32];
    ss.copy_from_slice(shared_secret);
    Ok(DiscoveredPayment {
        address,
        sui_address,
        shared_secret: ss,
    })
}

/// Scans a list of announcements and returns `(index, payment)` for each match.
pub fn scan_announcements(
    announcements: &[Announcement],
    viewing_sk: &[u8],
    spending_pub: &[u8],
) -> Vec<(usize, DiscoveredPayment)> {
    announcements
        .iter()
        .enumerate()
        .filter_map(
            |(idx, ann)| match scan_announcement(ann, viewing_sk, spending_pub) {
                ScanResult::Discovered(p) => Some((idx, p)),
                _ => None,
            },
        )
        .collect()
}

/// Result of scanning announcements with additional context.
#[derive(Debug)]
pub struct DiscoveryResult {
    /// The matching announcement (enriched with decrypted metadata).
    pub announcement: Announcement,
    /// The discovered payment (address + shared secret).
    pub payment: DiscoveredPayment,
    /// Index of the announcement in the input slice.
    pub index: usize,
}

/// Scans announcements and returns full context for each discovered payment.
pub fn scan_with_context(
    announcements: &[Announcement],
    viewing_sk: &[u8],
    spending_pub: &[u8],
) -> Vec<DiscoveryResult> {
    let (results, _stats) = scan_with_context_and_stats(announcements, viewing_sk, spending_pub);
    results
}

/// Scans announcements and returns both discoveries and accurate scan statistics.
///
/// View-only: requires the viewing secret key and the spending *public* key.
pub fn scan_with_context_and_stats(
    announcements: &[Announcement],
    viewing_sk: &[u8],
    spending_pub: &[u8],
) -> (Vec<DiscoveryResult>, ScanStats) {
    use specter_core::types::KyberSecretKey;

    let mut stats = ScanStats::new();
    let mut results = Vec::new();

    // Parse the viewing secret once. If it fails, every announcement counts
    // as a structural error and we bail out early with the right totals.
    let viewing_secret = match KyberSecretKey::from_bytes(viewing_sk) {
        Ok(sk) => sk,
        Err(_) => {
            stats.total_scanned = announcements.len() as u64;
            stats.errors = announcements.len() as u64;
            return (results, stats);
        }
    };

    for (idx, ann) in announcements.iter().enumerate() {
        stats.total_scanned += 1;

        if ann.validate().is_err() {
            stats.errors += 1;
            continue;
        }

        let ciphertext = match KyberCiphertext::from_bytes(&ann.ephemeral_key) {
            Ok(ct) => ct,
            Err(_) => {
                stats.errors += 1;
                continue;
            }
        };

        let shared_secret = match decapsulate(&ciphertext, &viewing_secret) {
            Ok(ss) => ss,
            Err(_) => {
                stats.errors += 1;
                continue;
            }
        };

        let expected_view_tag = compute_view_tag(&shared_secret);
        if expected_view_tag != ann.view_tag {
            // NotForUs: filtered out by view tag.
            continue;
        }

        // View tag matched — count it before attempting derive so the metric
        // reflects filter efficiency, not derivation success.
        stats.view_tag_matches += 1;

        match build_discovered_payment(spending_pub, &shared_secret) {
            Ok(payment) => {
                stats.discoveries += 1;
                // Repopulate payment fields by decrypting the on-chain
                // metadata blob with the per-announcement shared secret.
                // Decryption failure (tampered/foreign blob) is silently
                // ignored — the announcement is still returned, just without
                // enrichment.
                let mut enriched = ann.clone();
                if let Some(blob) = &ann.metadata_blob {
                    if let Ok(pt) =
                        specter_crypto::decrypt_announcement_metadata(blob, &shared_secret)
                    {
                        let meta = specter_core::types::AnnouncementMetadata::decode(&pt);
                        if let Some(h) = meta.tx_hash {
                            enriched.payment_tx_hash = Some(format!("0x{}", hex::encode(h)));
                        }
                        if let Some(a) = meta.amount {
                            enriched.amount = Some(format!("0x{}", hex::encode(a)));
                        }
                        if meta.source_chain_id.is_some() {
                            enriched.source_chain_id = meta.source_chain_id;
                        }
                    }
                }
                enriched.stealth_address = Some(payment.address.to_checksum_string());
                results.push(DiscoveryResult {
                    announcement: enriched,
                    payment,
                    index: idx,
                });
            }
            Err(_) => {
                stats.errors += 1;
            }
        }
    }

    (results, stats)
}

/// Verifies that a given announcement derives to an expected stealth address.
pub fn verify_address_from_announcement(
    announcement: &Announcement,
    viewing_sk: &[u8],
    spending_pub: &[u8],
    expected_address: &EthAddress,
) -> Result<bool> {
    let ciphertext = KyberCiphertext::from_bytes(&announcement.ephemeral_key)?;
    let viewing_secret = specter_core::types::KyberSecretKey::from_bytes(viewing_sk)?;
    let shared_secret = decapsulate(&ciphertext, &viewing_secret)?;
    let derived_address = derive_stealth_address(spending_pub, &shared_secret)?;
    Ok(derived_address == *expected_address)
}

/// Convenience: for a discovered payment, derive the full spend keys using the
/// recipient's secret spending key. This is the step that requires the secret.
pub fn spend_keys_for(
    payment: &DiscoveredPayment,
    spending_pub: &[u8],
    spending_sk: &[u8],
) -> Result<StealthKeys> {
    derive_spend_keys(spending_pub, spending_sk, &payment.shared_secret)
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::types::KyberPublicKey;
    use specter_crypto::{encapsulate, generate_keypair, generate_spending_keypair};

    /// Returns `(spending_pub_bytes, spending_sk_bytes, viewing_pk_bytes, viewing_sk_bytes)`.
    fn create_test_keys() -> (Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) {
        let spending = generate_spending_keypair();
        let viewing = generate_keypair();
        (
            spending.public.as_bytes().to_vec(),
            spending.secret.as_bytes().to_vec(),
            viewing.public.as_bytes().to_vec(),
            viewing.secret.as_bytes().to_vec(),
        )
    }

    fn create_announcement_for(viewing_pk: &[u8]) -> Announcement {
        let pk = KyberPublicKey::from_bytes(viewing_pk).unwrap();
        let (ciphertext, shared_secret) = encapsulate(&pk).unwrap();
        let view_tag = compute_view_tag(&shared_secret);
        Announcement::new(ciphertext.into_bytes(), view_tag)
    }

    #[test]
    fn test_scan_announcement_discovery() {
        let (spending_pub, _spending_sk, viewing_pk, viewing_sk) = create_test_keys();
        let announcement = create_announcement_for(&viewing_pk);
        let result = scan_announcement(&announcement, &viewing_sk, &spending_pub);
        assert!(result.is_discovered());
        let p = result.into_payment().unwrap();
        assert!(!p.address.is_zero());
    }

    #[test]
    fn test_scan_announcement_not_for_us() {
        let (spending_pub, _spending_sk, _viewing_pk, viewing_sk) = create_test_keys();
        let other_viewing = generate_keypair();
        let announcement = create_announcement_for(other_viewing.public.as_bytes());
        let result = scan_announcement(&announcement, &viewing_sk, &spending_pub);
        assert!(!result.is_discovered());
    }

    /// A discovered payment's shared secret + spending secret must derive keys
    /// whose address matches what the view-only scan reported.
    #[test]
    fn discovered_payment_derives_matching_spend_key() {
        let (spending_pub, spending_sk, viewing_pk, viewing_sk) = create_test_keys();
        let ann = create_announcement_for(&viewing_pk);
        let payment = scan_announcement(&ann, &viewing_sk, &spending_pub)
            .into_payment()
            .unwrap();
        let keys = spend_keys_for(&payment, &spending_pub, &spending_sk).unwrap();
        assert_eq!(keys.address, payment.address);
        // The eth private key controls that address.
        let from_pk = specter_crypto::derive::derive_eth_address_from_seed(
            &keys.private_key.to_eth_private_key(),
        )
        .unwrap();
        assert_eq!(from_pk, payment.address);
    }

    #[test]
    fn test_scan_stats_count_view_tag_matches_independently() {
        let (spending_pub, _spending_sk, viewing_pk, viewing_sk) = create_test_keys();

        let mut anns = Vec::new();
        for _ in 0..3 {
            anns.push(create_announcement_for(&viewing_pk));
        }
        for _ in 0..7 {
            anns.push(create_announcement_for(
                generate_keypair().public.as_bytes(),
            ));
        }

        let (results, stats) = scan_with_context_and_stats(&anns, &viewing_sk, &spending_pub);

        assert_eq!(stats.total_scanned, 10);
        assert_eq!(stats.discoveries, 3);
        assert!(stats.view_tag_matches >= 3);
        assert_eq!(results.len(), 3);
        assert!(stats.view_tag_matches >= stats.discoveries);
    }

    #[test]
    fn test_scan_stats_skip_invalid_announcements() {
        let (spending_pub, _spending_sk, _viewing_pk, viewing_sk) = create_test_keys();

        let bad = Announcement::new(
            vec![0xFFu8; specter_core::constants::KYBER_CIPHERTEXT_SIZE],
            0,
        );
        let (results, stats) = scan_with_context_and_stats(&[bad], &viewing_sk, &spending_pub);

        assert_eq!(stats.total_scanned, 1);
        assert_eq!(stats.discoveries, 0);
        assert!(stats.view_tag_matches <= 1);
        assert!(results.is_empty());
    }

    #[test]
    fn test_scan_multiple_announcements() {
        let (spending_pub, _spending_sk, viewing_pk, viewing_sk) = create_test_keys();
        let ann1 = create_announcement_for(&viewing_pk);
        let ann2 = create_announcement_for(generate_keypair().public.as_bytes());
        let ann3 = create_announcement_for(&viewing_pk);
        let announcements = vec![ann1, ann2, ann3];
        let discoveries = scan_announcements(&announcements, &viewing_sk, &spending_pub);
        assert_eq!(discoveries.len(), 2);
    }

    #[test]
    fn scan_empty_list_returns_empty() {
        let (spending_pub, _spending_sk, _vk, viewing_sk) = create_test_keys();
        let discoveries = scan_announcements(&[], &viewing_sk, &spending_pub);
        assert!(discoveries.is_empty());
    }

    #[test]
    fn scan_with_context_and_stats_empty_list() {
        let (spending_pub, _spending_sk, _vk, viewing_sk) = create_test_keys();
        let (results, stats) = scan_with_context_and_stats(&[], &viewing_sk, &spending_pub);
        assert!(results.is_empty());
        assert_eq!(stats.total_scanned, 0);
        assert_eq!(stats.discoveries, 0);
        assert_eq!(stats.errors, 0);
        assert_eq!(stats.view_tag_matches, 0);
    }

    #[test]
    fn scan_with_context_and_stats_invalid_viewing_sk() {
        let (spending_pub, _spending_sk, viewing_pk, _) = create_test_keys();
        let ann = create_announcement_for(&viewing_pk);
        let bad_viewing_sk = vec![0u8; 16]; // wrong size

        let (results, stats) = scan_with_context_and_stats(&[ann], &bad_viewing_sk, &spending_pub);

        assert!(results.is_empty());
        assert_eq!(stats.total_scanned, 1);
        assert_eq!(stats.errors, 1);
    }

    #[test]
    fn scan_with_context_returns_same_count_as_scan_announcements() {
        let (spending_pub, _spending_sk, viewing_pk, viewing_sk) = create_test_keys();
        let mut anns = vec![
            create_announcement_for(&viewing_pk),
            create_announcement_for(generate_keypair().public.as_bytes()),
            create_announcement_for(&viewing_pk),
        ];
        for _ in 0..5 {
            anns.push(create_announcement_for(
                generate_keypair().public.as_bytes(),
            ));
        }

        let flat = scan_announcements(&anns, &viewing_sk, &spending_pub);
        let ctx = scan_with_context(&anns, &viewing_sk, &spending_pub);
        assert_eq!(flat.len(), ctx.len());
        assert_eq!(flat.len(), 2);
    }

    #[test]
    fn scan_result_not_for_us_is_not_discovered() {
        let not_for_us = ScanResult::NotForUs;
        assert!(!not_for_us.is_discovered());
        assert!(not_for_us.into_payment().is_none());
    }

    #[test]
    fn scan_stats_record_discovery_increments_all_counters() {
        let (spending_pub, _spending_sk, viewing_pk, viewing_sk) = create_test_keys();
        let ann = create_announcement_for(&viewing_pk);
        let result = scan_announcement(&ann, &viewing_sk, &spending_pub);
        assert!(result.is_discovered());

        let mut stats = ScanStats::new();
        stats.record(&result);
        assert_eq!(stats.total_scanned, 1);
        assert_eq!(stats.view_tag_matches, 1);
        assert_eq!(stats.discoveries, 1);
        assert_eq!(stats.errors, 0);
    }

    #[test]
    fn scan_stats_record_not_for_us_only_increments_total() {
        let mut stats = ScanStats::new();
        stats.record(&ScanResult::NotForUs);
        assert_eq!(stats.total_scanned, 1);
        assert_eq!(stats.view_tag_matches, 0);
        assert_eq!(stats.discoveries, 0);
        assert_eq!(stats.errors, 0);
    }

    #[test]
    fn scan_stats_rate_is_zero_when_duration_zero() {
        let stats = ScanStats {
            total_scanned: 100,
            duration_ms: 0,
            ..ScanStats::default()
        };
        assert_eq!(stats.rate(), 0.0);
    }

    #[test]
    fn scan_stats_filter_efficiency_reflects_fraction() {
        let stats = ScanStats {
            total_scanned: 256,
            view_tag_matches: 1,
            ..ScanStats::default()
        };
        let expected = (255.0 / 256.0) * 100.0;
        assert!((stats.filter_efficiency() - expected).abs() < 0.01);
    }

    #[test]
    fn discovery_result_index_is_correct() {
        let (spending_pub, _spending_sk, viewing_pk, viewing_sk) = create_test_keys();
        let noise = create_announcement_for(generate_keypair().public.as_bytes());
        let ours = create_announcement_for(&viewing_pk);
        let anns = vec![noise, ours];

        let ctx = scan_with_context(&anns, &viewing_sk, &spending_pub);
        assert_eq!(ctx.len(), 1);
        assert_eq!(ctx[0].index, 1, "our announcement was at index 1");
    }

    #[test]
    fn verify_address_from_announcement_correct_key() {
        let (spending_pub, _spending_sk, viewing_pk, viewing_sk) = create_test_keys();
        let ann = create_announcement_for(&viewing_pk);

        let ciphertext = specter_crypto::KyberCiphertext::from_bytes(&ann.ephemeral_key).unwrap();
        let vsk = specter_core::types::KyberSecretKey::from_bytes(&viewing_sk).unwrap();
        let shared_secret = specter_crypto::decapsulate(&ciphertext, &vsk).unwrap();
        let expected_addr = derive_stealth_address(&spending_pub, &shared_secret).unwrap();

        let ok =
            verify_address_from_announcement(&ann, &viewing_sk, &spending_pub, &expected_addr)
                .unwrap();
        assert!(ok, "correct key should verify address");
    }

    #[test]
    fn verify_address_from_announcement_wrong_address() {
        let (spending_pub, _spending_sk, viewing_pk, viewing_sk) = create_test_keys();
        let ann = create_announcement_for(&viewing_pk);

        let wrong_addr = EthAddress::zero();

        let ok =
            verify_address_from_announcement(&ann, &viewing_sk, &spending_pub, &wrong_addr).unwrap();
        assert!(!ok, "wrong address should not verify");
    }

    /// During scanning, the recipient must decrypt the on-chain `metadata_blob`
    /// using the per-announcement ML-KEM shared secret and repopulate the
    /// payment fields.
    #[test]
    fn scan_decrypts_metadata_blob_into_payment_fields() {
        use specter_core::types::AnnouncementMetadata;
        use specter_crypto::encrypt_announcement_metadata;

        let viewing = generate_keypair();
        let spending = generate_spending_keypair();
        let pk = KyberPublicKey::from_bytes(viewing.public.as_bytes()).unwrap();
        let (ciphertext, shared_secret) = encapsulate(&pk).unwrap();
        let view_tag = compute_view_tag(&shared_secret);

        let tx = [0xAAu8; 32];
        let mut amount = [0u8; 32];
        amount[31] = 1; // 1 wei
        let plaintext = AnnouncementMetadata::new(view_tag)
            .with_tx_hash(tx)
            .with_amount(amount)
            .with_source_chain_id(42161)
            .encode();
        let blob = encrypt_announcement_metadata(&plaintext, &shared_secret).to_vec();

        let mut ann = Announcement::new(ciphertext.into_bytes(), view_tag);
        ann.metadata_blob = Some(blob);

        let (results, _stats) = scan_with_context_and_stats(
            &[ann],
            viewing.secret.as_bytes(),
            spending.public.as_bytes(),
        );

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].announcement.source_chain_id, Some(42161));
        assert_eq!(
            results[0].announcement.payment_tx_hash,
            Some(format!("0x{}", hex::encode(tx)))
        );
        assert!(results[0].announcement.amount.is_some());
    }
}
