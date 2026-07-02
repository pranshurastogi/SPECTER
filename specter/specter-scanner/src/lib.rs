//! # SPECTER Scanner
//!
//! Efficient batch scanning of announcements to discover payments.
//!
//! ## Features
//!
//! - **Batch Processing**: Scans announcements in configurable batches
//! - **Progress Reporting**: Callbacks for UI progress updates
//! - **Resumable Scans**: Track position to resume interrupted scans
//! - **Concurrent Scanning**: Optional parallel processing for speed
//!
//! ## Example
//!
//! ```rust,ignore
//! use specter_scanner::{Scanner, ScannerConfig};
//! use specter_registry::MemoryRegistry;
//!
//! // Create scanner with wallet keys
//! let scanner = Scanner::new(wallet.viewing_sk(), wallet.spending_pub());
//!
//! // Scan all announcements
//! let discoveries = scanner.scan_all(&registry).await?;
//!
//! for payment in discoveries {
//!     println!("Found payment at: {}", payment.address);
//! }
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs, rust_2018_idioms)]

use std::time::Instant;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::{debug, info, instrument, warn};

use specter_core::error::Result;
use specter_core::traits::AnnouncementRegistry;
use specter_core::types::Announcement;
use specter_stealth::discovery::{scan_announcement, DiscoveredPayment, ScanResult, ScanStats};

/// Scanner configuration.
#[derive(Clone)]
pub struct ScannerConfig {
    /// Batch size for scanning
    pub batch_size: usize,
    /// Whether to stop on first discovery
    pub stop_on_first: bool,
    /// Minimum timestamp to scan from (inclusive)
    pub from_timestamp: Option<u64>,
    /// Maximum timestamp to scan to (inclusive)
    pub to_timestamp: Option<u64>,
    /// Specific view tags to scan (None = all)
    pub view_tag_filter: Option<Vec<u8>>,
    /// Resolves the ciphertext for chain-indexed (hash-only) announcements by
    /// fetching+verifying it from `announce()` calldata. `None` ⇒ hash-only
    /// announcements are skipped with a warning (already-resolved rows scan normally).
    pub resolver: Option<std::sync::Arc<dyn specter_core::resolver::EphemeralKeyResolver>>,
}

impl std::fmt::Debug for ScannerConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ScannerConfig")
            .field("batch_size", &self.batch_size)
            .field("stop_on_first", &self.stop_on_first)
            .field("from_timestamp", &self.from_timestamp)
            .field("to_timestamp", &self.to_timestamp)
            .field("view_tag_filter", &self.view_tag_filter)
            .field("resolver", &self.resolver.as_ref().map(|_| "<resolver>"))
            .finish()
    }
}

impl Default for ScannerConfig {
    fn default() -> Self {
        Self {
            batch_size: 1000,
            stop_on_first: false,
            from_timestamp: None,
            to_timestamp: None,
            view_tag_filter: None,
            resolver: None,
        }
    }
}

impl ScannerConfig {
    /// Creates a new default configuration.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the batch size.
    pub fn batch_size(mut self, size: usize) -> Self {
        self.batch_size = size;
        self
    }

    /// Enables stopping on first discovery.
    pub fn stop_on_first(mut self) -> Self {
        self.stop_on_first = true;
        self
    }

    /// Sets the time range filter.
    pub fn time_range(mut self, from: u64, to: u64) -> Self {
        self.from_timestamp = Some(from);
        self.to_timestamp = Some(to);
        self
    }

    /// Sets specific view tags to scan.
    pub fn view_tags(mut self, tags: Vec<u8>) -> Self {
        self.view_tag_filter = Some(tags);
        self
    }

    /// Sets the resolver used to fetch ciphertexts for hash-only announcements.
    pub fn resolver(
        mut self,
        r: std::sync::Arc<dyn specter_core::resolver::EphemeralKeyResolver>,
    ) -> Self {
        self.resolver = Some(r);
        self
    }
}

/// Progress callback type.
pub type ProgressCallback = Box<dyn Fn(ScanProgress) + Send + Sync>;

/// Scan progress information.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScanProgress {
    /// Total announcements to scan
    pub total: u64,
    /// Announcements scanned so far
    pub scanned: u64,
    /// Discoveries found so far
    pub discoveries: u64,
    /// Current scan rate (announcements per second)
    pub rate: f64,
    /// Estimated time remaining in seconds
    pub eta_seconds: Option<f64>,
    /// Percentage complete (0-100)
    pub percent: f64,
}

impl ScanProgress {
    /// Creates a new progress tracker.
    pub fn new(total: u64) -> Self {
        Self {
            total,
            scanned: 0,
            discoveries: 0,
            rate: 0.0,
            eta_seconds: None,
            percent: 0.0,
        }
    }

    /// Updates progress with new values.
    pub fn update(&mut self, scanned: u64, discoveries: u64, elapsed_ms: u64) {
        self.scanned = scanned;
        self.discoveries = discoveries;

        if elapsed_ms > 0 {
            self.rate = (scanned as f64 / elapsed_ms as f64) * 1000.0;
        }

        if self.total > 0 {
            self.percent = (scanned as f64 / self.total as f64) * 100.0;

            if self.rate > 0.0 {
                let remaining = self.total.saturating_sub(scanned);
                self.eta_seconds = Some(remaining as f64 / self.rate);
            }
        }
    }
}

/// Scan position for resumable scanning.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ScanPosition {
    /// Last scanned announcement ID
    pub last_id: u64,
    /// Last scanned timestamp
    pub last_timestamp: u64,
    /// Total announcements scanned in this session
    pub total_scanned: u64,
    /// Total discoveries in this session
    pub total_discoveries: u64,
}

impl ScanPosition {
    /// Creates a new scan position.
    pub fn new() -> Self {
        Self::default()
    }

    /// Updates position after scanning an announcement.
    pub fn update(&mut self, announcement: &Announcement, discovered: bool) {
        self.last_id = announcement.id;
        self.last_timestamp = announcement.timestamp;
        self.total_scanned += 1;
        if discovered {
            self.total_discoveries += 1;
        }
    }
}

/// Main scanner for discovering payments.
///
/// Detection is **view-only**: it needs the ML-KEM viewing secret key and the
/// secp256k1 spending *public* key. It never touches the spending secret key —
/// deriving the spend key is a separate, device-local step
/// ([`specter_stealth::discovery::derive_spend_keys`]).
pub struct Scanner {
    /// Viewing secret key (ML-KEM, for decapsulation)
    viewing_sk: Vec<u8>,
    /// Spending public key (secp256k1 compressed, 33 bytes, for address derivation)
    spending_pub: Vec<u8>,
    /// Current scan position
    position: RwLock<ScanPosition>,
    /// Scan statistics
    stats: RwLock<ScanStats>,
}

impl Scanner {
    /// Creates a new view-only scanner.
    ///
    /// # Arguments
    ///
    /// * `viewing_sk` - The ML-KEM viewing secret key (2400 bytes)
    /// * `spending_pub` - The secp256k1 spending public key (33 bytes compressed)
    pub fn new(viewing_sk: Vec<u8>, spending_pub: Vec<u8>) -> Self {
        Self {
            viewing_sk,
            spending_pub,
            position: RwLock::new(ScanPosition::new()),
            stats: RwLock::new(ScanStats::new()),
        }
    }

    /// Creates a scanner from a wallet.
    pub fn from_wallet(_wallet: &specter_stealth::SpecterWallet) -> Self {
        // Note: This requires exposing secret keys from wallet
        // In production, you might want a different approach
        todo!("Implement from_wallet with proper key access")
    }

    /// Returns the current scan position.
    pub fn position(&self) -> ScanPosition {
        self.position.read().clone()
    }

    /// Returns the current statistics.
    pub fn stats(&self) -> ScanStats {
        self.stats.read().clone()
    }

    /// Resets the scan position.
    pub fn reset_position(&self) {
        *self.position.write() = ScanPosition::new();
        *self.stats.write() = ScanStats::new();
    }

    /// Scans all announcements in the registry.
    #[instrument(skip(self, registry))]
    pub async fn scan_all(
        &self,
        registry: &dyn AnnouncementRegistry,
    ) -> Result<Vec<DiscoveredPayment>> {
        self.scan_with_config(registry, ScannerConfig::default())
            .await
    }

    /// Scans with custom configuration.
    #[instrument(skip(self, registry, config))]
    pub async fn scan_with_config(
        &self,
        registry: &dyn AnnouncementRegistry,
        config: ScannerConfig,
    ) -> Result<Vec<DiscoveredPayment>> {
        let start = Instant::now();
        let mut discoveries = Vec::new();

        let resolver = config.resolver.clone();

        // Get view tags to scan
        let view_tags: Vec<u8> = match config.view_tag_filter {
            Some(tags) => tags,
            None => (0..=255).collect(),
        };

        info!(view_tags_count = view_tags.len(), "Starting scan");

        for view_tag in view_tags {
            // Get announcements for this view tag
            let announcements = registry.get_by_view_tag(view_tag).await?;

            debug!(
                view_tag,
                count = announcements.len(),
                "Scanning view tag bucket"
            );

            for announcement in announcements {
                // Apply time filter
                if let Some(from) = config.from_timestamp {
                    if announcement.timestamp < from {
                        continue;
                    }
                }
                if let Some(to) = config.to_timestamp {
                    if announcement.timestamp > to {
                        continue;
                    }
                }

                // Chain-indexed rows arrive hash-only; fetch+verify the ciphertext
                // from calldata before decapsulation. Already-resolved rows pass through.
                let mut announcement = announcement;
                if !announcement.is_resolved() {
                    let (Some(resolver), Some(tx), Some(hash)) = (
                        resolver.as_ref(),
                        announcement.tx_hash.as_deref(),
                        announcement.ephemeral_key_hash.as_deref(),
                    ) else {
                        debug!(
                            view_tag,
                            "skipping hash-only announcement (no resolver / missing tx or hash)"
                        );
                        continue;
                    };
                    match resolver.resolve(tx, hash).await {
                        Ok(ct) => announcement.ephemeral_key = ct,
                        Err(e) => {
                            warn!(view_tag, error = %e, "ephemeral key resolution failed; skipping");
                            continue;
                        }
                    }
                }

                // Scan the announcement
                let result = scan_announcement(
                    &announcement,
                    &self.viewing_sk,
                    &self.spending_pub,
                );

                // Record stats
                self.stats.write().record(&result);

                // Update position
                let discovered = matches!(result, ScanResult::Discovered(_));
                self.position.write().update(&announcement, discovered);

                // Handle result
                if let ScanResult::Discovered(payment) = result {
                    discoveries.push(payment);

                    if config.stop_on_first {
                        info!("Stopping on first discovery");
                        return Ok(discoveries);
                    }
                }
            }
        }

        let duration = start.elapsed();
        let mut stats = self.stats.write();
        stats.duration_ms = duration.as_millis() as u64;

        info!(
            discoveries = discoveries.len(),
            scanned = stats.total_scanned,
            duration_ms = stats.duration_ms,
            rate = format!("{:.2}/s", stats.rate()),
            "Scan complete"
        );

        Ok(discoveries)
    }

    /// Scans with progress reporting.
    #[instrument(skip(self, registry, config, progress_callback))]
    pub async fn scan_with_progress(
        &self,
        registry: &dyn AnnouncementRegistry,
        config: ScannerConfig,
        progress_callback: ProgressCallback,
    ) -> Result<Vec<DiscoveredPayment>> {
        let start = Instant::now();
        let mut discoveries = Vec::new();

        // Get total count for progress
        let total = registry.count().await?;
        let mut progress = ScanProgress::new(total);

        let resolver = config.resolver.clone();

        // Get view tags to scan
        let view_tags: Vec<u8> = match config.view_tag_filter {
            Some(tags) => tags,
            None => (0..=255).collect(),
        };

        let mut scanned = 0u64;

        for view_tag in view_tags {
            let announcements = registry.get_by_view_tag(view_tag).await?;

            for announcement in announcements {
                // Apply filters
                if let Some(from) = config.from_timestamp {
                    if announcement.timestamp < from {
                        continue;
                    }
                }
                if let Some(to) = config.to_timestamp {
                    if announcement.timestamp > to {
                        continue;
                    }
                }

                // Chain-indexed rows arrive hash-only; fetch+verify the ciphertext
                // from calldata before decapsulation. Already-resolved rows pass through.
                let mut announcement = announcement;
                if !announcement.is_resolved() {
                    let (Some(resolver), Some(tx), Some(hash)) = (
                        resolver.as_ref(),
                        announcement.tx_hash.as_deref(),
                        announcement.ephemeral_key_hash.as_deref(),
                    ) else {
                        debug!(
                            view_tag,
                            "skipping hash-only announcement (no resolver / missing tx or hash)"
                        );
                        continue;
                    };
                    match resolver.resolve(tx, hash).await {
                        Ok(ct) => announcement.ephemeral_key = ct,
                        Err(e) => {
                            warn!(view_tag, error = %e, "ephemeral key resolution failed; skipping");
                            continue;
                        }
                    }
                }

                // Scan
                let result = scan_announcement(
                    &announcement,
                    &self.viewing_sk,
                    &self.spending_pub,
                );

                self.stats.write().record(&result);
                scanned += 1;

                if let ScanResult::Discovered(payment) = result {
                    discoveries.push(payment);
                }

                // Update progress every 100 announcements
                if scanned.is_multiple_of(100) {
                    progress.update(
                        scanned,
                        discoveries.len() as u64,
                        start.elapsed().as_millis() as u64,
                    );
                    progress_callback(progress.clone());
                }

                if config.stop_on_first && !discoveries.is_empty() {
                    return Ok(discoveries);
                }
            }
        }

        // Final progress update
        progress.update(
            scanned,
            discoveries.len() as u64,
            start.elapsed().as_millis() as u64,
        );
        progress_callback(progress);

        Ok(discoveries)
    }

    /// Scans a single announcement.
    pub fn scan_one(&self, announcement: &Announcement) -> ScanResult {
        let result = scan_announcement(
            announcement,
            &self.viewing_sk,
            &self.spending_pub,
        );

        self.stats.write().record(&result);
        result
    }
}

/// Scan result summary.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScanSummary {
    /// Number of announcements scanned
    pub total_scanned: u64,
    /// Number of view tag matches
    pub view_tag_matches: u64,
    /// Number of payments discovered
    pub discoveries: u64,
    /// Number of errors
    pub errors: u64,
    /// Duration in milliseconds
    pub duration_ms: u64,
    /// Scan rate (announcements per second)
    pub rate: f64,
    /// Filter efficiency (% filtered by view tag)
    pub filter_efficiency: f64,
}

impl From<ScanStats> for ScanSummary {
    fn from(stats: ScanStats) -> Self {
        Self {
            total_scanned: stats.total_scanned,
            view_tag_matches: stats.view_tag_matches,
            discoveries: stats.discoveries,
            errors: stats.errors,
            duration_ms: stats.duration_ms,
            rate: stats.rate(),
            filter_efficiency: stats.filter_efficiency(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use async_trait::async_trait;
    use specter_core::constants::KYBER_CIPHERTEXT_SIZE;
    use specter_core::resolver::EphemeralKeyResolver;
    use specter_crypto::{compute_view_tag, encapsulate, generate_keypair, generate_spending_keypair};
    use specter_registry::MemoryRegistry;

    struct StubResolver {
        ciphertext: Vec<u8>,
    }
    #[async_trait]
    impl EphemeralKeyResolver for StubResolver {
        async fn resolve(
            &self,
            _tx: &str,
            _expected: &[u8],
        ) -> specter_core::error::Result<Vec<u8>> {
            Ok(self.ciphertext.clone())
        }
    }

    fn setup_scanner_and_registry() -> (Scanner, MemoryRegistry, Vec<u8>) {
        let spending = generate_spending_keypair();
        let viewing = generate_keypair();

        let scanner = Scanner::new(
            viewing.secret.as_bytes().to_vec(),
            spending.public.as_bytes().to_vec(),
        );

        let registry = MemoryRegistry::new();

        (scanner, registry, viewing.public.as_bytes().to_vec())
    }

    fn create_announcement_for_key(viewing_pk: &[u8]) -> Announcement {
        let pk = specter_core::types::KyberPublicKey::from_bytes(viewing_pk).unwrap();
        let (ciphertext, shared_secret) = encapsulate(&pk).unwrap();
        let view_tag = compute_view_tag(&shared_secret);
        Announcement::new(ciphertext.into_bytes(), view_tag)
    }

    fn create_random_announcement() -> Announcement {
        Announcement::new(vec![0x42u8; KYBER_CIPHERTEXT_SIZE], rand::random())
    }

    #[tokio::test]
    async fn test_scan_empty_registry() {
        let (scanner, registry, _) = setup_scanner_and_registry();

        let discoveries = scanner.scan_all(&registry).await.unwrap();
        assert!(discoveries.is_empty());
    }

    #[tokio::test]
    async fn test_scan_finds_payment() {
        let (scanner, registry, viewing_pk) = setup_scanner_and_registry();

        // Add an announcement for our keys
        let ann = create_announcement_for_key(&viewing_pk);
        registry.publish(ann).await.unwrap();

        let discoveries = scanner.scan_all(&registry).await.unwrap();
        assert_eq!(discoveries.len(), 1);
    }

    #[tokio::test]
    async fn test_scan_ignores_other_payments() {
        let (scanner, registry, viewing_pk) = setup_scanner_and_registry();

        // Add announcement for us
        let our_ann = create_announcement_for_key(&viewing_pk);
        let our_view_tag = our_ann.view_tag;
        registry.publish(our_ann).await.unwrap();

        // Add announcements for others - use view tags different from ours to avoid false positives
        let other_view_tag = ((our_view_tag as u16) + 1) % 256;
        for i in 0..10u16 {
            let view_tag = ((other_view_tag + i) % 256) as u8;
            let ann = Announcement::new(vec![0x42u8; KYBER_CIPHERTEXT_SIZE], view_tag);
            registry.publish(ann).await.unwrap();
        }

        let discoveries = scanner.scan_all(&registry).await.unwrap();
        assert_eq!(discoveries.len(), 1);
    }

    #[tokio::test]
    async fn test_scan_multiple_payments() {
        let (scanner, registry, viewing_pk) = setup_scanner_and_registry();

        // Add multiple announcements for us
        for _ in 0..5 {
            let ann = create_announcement_for_key(&viewing_pk);
            registry.publish(ann).await.unwrap();
        }

        let discoveries = scanner.scan_all(&registry).await.unwrap();
        assert_eq!(discoveries.len(), 5);
    }

    #[tokio::test]
    async fn test_scan_stop_on_first() {
        let (scanner, registry, viewing_pk) = setup_scanner_and_registry();

        // Add multiple announcements
        for _ in 0..5 {
            let ann = create_announcement_for_key(&viewing_pk);
            registry.publish(ann).await.unwrap();
        }

        let config = ScannerConfig::new().stop_on_first();
        let discoveries = scanner.scan_with_config(&registry, config).await.unwrap();
        assert_eq!(discoveries.len(), 1);
    }

    #[tokio::test]
    async fn test_scan_time_filter() {
        let (scanner, registry, viewing_pk) = setup_scanner_and_registry();

        // Add announcements with different timestamps
        let mut ann1 = create_announcement_for_key(&viewing_pk);
        ann1.timestamp = 100;
        registry.publish(ann1).await.unwrap();

        let mut ann2 = create_announcement_for_key(&viewing_pk);
        ann2.timestamp = 200;
        registry.publish(ann2).await.unwrap();

        let mut ann3 = create_announcement_for_key(&viewing_pk);
        ann3.timestamp = 300;
        registry.publish(ann3).await.unwrap();

        // Scan only middle range
        let config = ScannerConfig::new().time_range(150, 250);
        let discoveries = scanner.scan_with_config(&registry, config).await.unwrap();
        assert_eq!(discoveries.len(), 1);
    }

    #[tokio::test]
    async fn test_scan_stats() {
        let (scanner, registry, viewing_pk) = setup_scanner_and_registry();

        // Add mix of our announcements and others
        let ann = create_announcement_for_key(&viewing_pk);
        registry.publish(ann).await.unwrap();

        for _ in 0..10 {
            registry
                .publish(create_random_announcement())
                .await
                .unwrap();
        }

        scanner.scan_all(&registry).await.unwrap();

        let stats = scanner.stats();
        assert_eq!(stats.discoveries, 1);
        assert!(stats.total_scanned > 0);
    }

    #[tokio::test]
    async fn test_scan_progress_callback() {
        let (scanner, registry, viewing_pk) = setup_scanner_and_registry();

        // Add some announcements
        for _ in 0..150 {
            let ann = create_announcement_for_key(&viewing_pk);
            registry.publish(ann).await.unwrap();
        }

        let progress_updates = Arc::new(RwLock::new(Vec::new()));
        let updates_clone = progress_updates.clone();

        let callback: ProgressCallback = Box::new(move |progress| {
            updates_clone.write().push(progress);
        });

        let config = ScannerConfig::new();
        scanner
            .scan_with_progress(&registry, config, callback)
            .await
            .unwrap();

        let updates = progress_updates.read();
        assert!(!updates.is_empty());

        // Last update should show 100%
        let last = updates.last().unwrap();
        assert!(last.percent >= 99.0);
    }

    #[tokio::test]
    async fn test_scan_position_tracking() {
        let (scanner, registry, viewing_pk) = setup_scanner_and_registry();

        let ann = create_announcement_for_key(&viewing_pk);
        registry.publish(ann).await.unwrap();

        scanner.scan_all(&registry).await.unwrap();

        let pos = scanner.position();
        assert!(pos.total_scanned > 0);
        assert_eq!(pos.total_discoveries, 1);
    }

    #[tokio::test]
    async fn test_reset_position() {
        let (scanner, registry, viewing_pk) = setup_scanner_and_registry();

        let ann = create_announcement_for_key(&viewing_pk);
        registry.publish(ann).await.unwrap();

        scanner.scan_all(&registry).await.unwrap();
        scanner.reset_position();

        let pos = scanner.position();
        assert_eq!(pos.total_scanned, 0);
        assert_eq!(pos.total_discoveries, 0);
    }

    #[tokio::test]
    async fn scanner_resolves_hash_only_announcement() {
        let (scanner, registry, viewing_pk) = setup_scanner_and_registry();

        // Encapsulate to our viewing key → ciphertext + shared secret → view_tag.
        let pk = specter_core::types::KyberPublicKey::from_bytes(&viewing_pk).unwrap();
        let (ciphertext, shared_secret) = encapsulate(&pk).unwrap();
        let view_tag = compute_view_tag(&shared_secret);
        let ct_bytes = ciphertext.into_bytes();

        // Build a HASH-ONLY announcement (empty ciphertext, hash + tx present).
        let mut ann = Announcement::new(Vec::new(), view_tag);
        ann.ephemeral_key_hash = Some(vec![0x11u8; 32]);
        ann.tx_hash = Some(format!("0x{}", "aa".repeat(32)));
        registry.publish(ann).await.unwrap();

        // With a resolver that returns the real ciphertext, the payment is discovered.
        let config = ScannerConfig::default().resolver(Arc::new(StubResolver {
            ciphertext: ct_bytes,
        }));
        let discoveries = scanner.scan_with_config(&registry, config).await.unwrap();
        assert_eq!(discoveries.len(), 1);
    }

    #[tokio::test]
    async fn scanner_skips_hash_only_without_resolver() {
        let (scanner, registry, viewing_pk) = setup_scanner_and_registry();
        let pk = specter_core::types::KyberPublicKey::from_bytes(&viewing_pk).unwrap();
        let (_ciphertext, shared_secret) = encapsulate(&pk).unwrap();
        let view_tag = compute_view_tag(&shared_secret);
        let mut ann = Announcement::new(Vec::new(), view_tag);
        ann.ephemeral_key_hash = Some(vec![0x11u8; 32]);
        ann.tx_hash = Some(format!("0x{}", "aa".repeat(32)));
        registry.publish(ann).await.unwrap();

        // No resolver configured → hash-only row is skipped, no discoveries, no panic.
        let discoveries = scanner.scan_all(&registry).await.unwrap();
        assert_eq!(discoveries.len(), 0);
    }

    #[test]
    fn test_scan_progress_eta() {
        let mut progress = ScanProgress::new(1000);

        // Simulate 500 scanned in 1000ms (500/s rate)
        progress.update(500, 2, 1000);

        assert!((progress.percent - 50.0).abs() < 0.1);
        assert!((progress.rate - 500.0).abs() < 1.0);

        // ETA should be ~1 second for remaining 500
        assert!(progress.eta_seconds.is_some());
        assert!((progress.eta_seconds.unwrap() - 1.0).abs() < 0.1);
    }
}
