//! Payment discovery (recipient scan).

use specter_core::error::{Result, SpecterError};
use specter_core::types::{Announcement, EthAddress};
use specter_crypto::{decapsulate, compute_view_tag, KyberCiphertext};
use specter_crypto::derive::{derive_stealth_keys, derive_stealth_address, StealthKeys};

/// Result of scanning a single announcement.
#[derive(Debug)]
pub enum ScanResult {
    /// View tag didn't match - not for this recipient
    NotForUs,
    /// View tag matched and decapsulation succeeded - payment discovered
    Discovered(StealthKeys),
    /// View tag matched but decapsulation failed (shouldn't happen normally)
    DecapsulationFailed(SpecterError),
}

impl ScanResult {
    /// Returns true if a payment was discovered.
    pub fn is_discovered(&self) -> bool {
        matches!(self, ScanResult::Discovered(_))
    }

    /// Returns the discovered keys if present.
    pub fn into_keys(self) -> Option<StealthKeys> {
        match self {
            ScanResult::Discovered(keys) => Some(keys),
            _ => None,
        }
    }
}

/// A discovered payment (alias for StealthKeys for semantic clarity).
pub type DiscoveredPayment = StealthKeys;

/// Statistics for scanning operations.
#[derive(Debug, Clone, Default)]
pub struct ScanStats {
    /// Total announcements scanned
    pub total_scanned: u64,
    /// Number of view tag matches
    pub view_tag_matches: u64,
    /// Number of payments discovered
    pub discoveries: u64,
    /// Number of errors during scanning
    pub errors: u64,
    /// Duration of the scan in milliseconds
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
            ((self.total_scanned - self.view_tag_matches) as f64 / self.total_scanned as f64) * 100.0
        }
    }
}


/// Decapsulate with viewing_sk; if view tag matches, derive stealth keys.
pub fn scan_announcement(
    announcement: &Announcement,
    viewing_sk: &[u8],
    spending_pk: &[u8],
    spending_sk: &[u8],
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

    match derive_stealth_keys(spending_pk, spending_sk, &shared_secret) {
        Ok(keys) => ScanResult::Discovered(keys),
        Err(e) => ScanResult::DecapsulationFailed(e),
    }
}

pub fn scan_announcements(
    announcements: &[Announcement],
    viewing_sk: &[u8],
    spending_pk: &[u8],
    spending_sk: &[u8],
) -> Vec<(usize, StealthKeys)> {
    announcements
        .iter()
        .enumerate()
        .filter_map(|(idx, ann)| {
            match scan_announcement(ann, viewing_sk, spending_pk, spending_sk) {
                ScanResult::Discovered(keys) => Some((idx, keys)),
                _ => None,
            }
        })
        .collect()
}

#[derive(Debug)]
pub struct DiscoveryResult {
    pub announcement: Announcement,
    pub keys: StealthKeys,
    pub index: usize,
}

pub fn scan_with_context(
    announcements: &[Announcement],
    viewing_sk: &[u8],
    spending_pk: &[u8],
    spending_sk: &[u8],
) -> Vec<DiscoveryResult> {
    announcements
        .iter()
        .enumerate()
        .filter_map(|(idx, ann)| {
            match scan_announcement(ann, viewing_sk, spending_pk, spending_sk) {
                ScanResult::Discovered(keys) => Some(DiscoveryResult {
                    announcement: ann.clone(),
                    keys,
                    index: idx,
                }),
                _ => None,
            }
        })
        .collect()
}

pub fn verify_address_from_announcement(
    announcement: &Announcement,
    viewing_sk: &[u8],
    spending_pk: &[u8],
    expected_address: &EthAddress,
) -> Result<bool> {
    let ciphertext = KyberCiphertext::from_bytes(&announcement.ephemeral_key)?;
    let viewing_secret = specter_core::types::KyberSecretKey::from_bytes(viewing_sk)?;
    let shared_secret = decapsulate(&ciphertext, &viewing_secret)?;
    let derived_address = derive_stealth_address(spending_pk, &shared_secret)?;
    Ok(derived_address == *expected_address)
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::types::KyberPublicKey;
    use specter_crypto::{generate_keypair, encapsulate};

    fn create_test_keys() -> (Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) {
        let spending = generate_keypair();
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
        let (spending_pk, spending_sk, viewing_pk, viewing_sk) = create_test_keys();
        let announcement = create_announcement_for(&viewing_pk);
        let result = scan_announcement(&announcement, &viewing_sk, &spending_pk, &spending_sk);
        assert!(result.is_discovered());
        let keys = result.into_keys().unwrap();
        assert!(!keys.address.is_zero());
    }

    #[test]
    fn test_scan_announcement_not_for_us() {
        let (spending_pk, spending_sk, _viewing_pk, viewing_sk) = create_test_keys();
        let other_viewing = generate_keypair();
        let announcement = create_announcement_for(other_viewing.public.as_bytes());
        let result = scan_announcement(&announcement, &viewing_sk, &spending_pk, &spending_sk);
        assert!(!result.is_discovered());
    }

    #[test]
    fn test_scan_multiple_announcements() {
        let (spending_pk, spending_sk, viewing_pk, viewing_sk) = create_test_keys();
        let ann1 = create_announcement_for(&viewing_pk);
        let ann2 = create_announcement_for(generate_keypair().public.as_bytes());
        let ann3 = create_announcement_for(&viewing_pk);
        let announcements = vec![ann1, ann2, ann3];
        let discoveries = scan_announcements(&announcements, &viewing_sk, &spending_pk, &spending_sk);
        assert_eq!(discoveries.len(), 2);
    }
}
