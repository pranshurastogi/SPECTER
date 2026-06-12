//! In-memory announcement registry.
//!
//! Fast, thread-safe storage suitable for development, testing,
//! and single-process deployments.

use std::sync::atomic::{AtomicU64, Ordering};

use async_trait::async_trait;
use dashmap::DashMap;
use parking_lot::RwLock;
use tracing::{debug, instrument};

use specter_core::error::{Result, SpecterError};
use specter_core::traits::AnnouncementRegistry;
use specter_core::types::{Announcement, AnnouncementStats};

/// In-memory announcement registry.
///
/// Uses concurrent data structures for thread-safe access without
/// requiring external synchronization.
///
/// # Indexing
///
/// Announcements are indexed by:
/// - ID: For direct lookup
/// - View tag: For efficient scanning (O(1) bucket lookup)
/// - Timestamp: For time-range queries
/// - Tx hash: For duplicate detection (when provided)
///
/// # Thread Safety
///
/// All operations are thread-safe and can be called concurrently.
#[derive(Debug)]
pub struct MemoryRegistry {
    /// Primary storage: ID → Announcement
    announcements: DashMap<u64, Announcement>,
    /// View tag index: tag → [announcement IDs]
    view_tag_index: DashMap<u8, Vec<u64>>,
    /// Tx hash index: normalized tx_hash → announcement ID (for duplicate rejection)
    tx_hash_index: DashMap<String, u64>,
    /// Payment HMAC dedup index: payment_tx_hash_hmac → announcement ID
    /// (mirrors the Turso UNIQUE index used by the reserve flow).
    payment_hmac_index: DashMap<Vec<u8>, u64>,
    /// Next announcement ID
    next_id: AtomicU64,
    /// Registry statistics
    stats: RwLock<AnnouncementStats>,
}

impl MemoryRegistry {
    /// Creates a new empty in-memory registry.
    pub fn new() -> Self {
        Self {
            announcements: DashMap::new(),
            view_tag_index: DashMap::new(),
            tx_hash_index: DashMap::new(),
            payment_hmac_index: DashMap::new(),
            next_id: AtomicU64::new(1),
            stats: RwLock::new(AnnouncementStats::new()),
        }
    }

    /// Creates a registry with preallocated capacity.
    ///
    /// Use this when you know the expected number of announcements.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            announcements: DashMap::with_capacity(capacity),
            view_tag_index: DashMap::with_capacity(256), // One bucket per view tag
            tx_hash_index: DashMap::new(),
            payment_hmac_index: DashMap::new(),
            next_id: AtomicU64::new(1),
            stats: RwLock::new(AnnouncementStats::new()),
        }
    }

    /// Normalizes a tx hash for indexing (lowercase, trimmed).
    fn normalize_tx_hash(hash: &str) -> String {
        hash.trim().to_lowercase()
    }

    /// Returns the current statistics.
    pub fn stats(&self) -> AnnouncementStats {
        self.stats.read().clone()
    }

    /// Clears all announcements.
    pub fn clear(&self) {
        self.announcements.clear();
        self.view_tag_index.clear();
        self.tx_hash_index.clear();
        self.payment_hmac_index.clear();
        self.next_id.store(1, Ordering::SeqCst);
        *self.stats.write() = AnnouncementStats::new();
    }

    /// Returns the number of announcements.
    pub fn len(&self) -> usize {
        self.announcements.len()
    }

    /// Returns true if the registry is empty.
    pub fn is_empty(&self) -> bool {
        self.announcements.is_empty()
    }

    /// Returns all announcements (for export/backup).
    pub fn all_announcements(&self) -> Vec<Announcement> {
        self.announcements
            .iter()
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// Imports announcements from a list.
    ///
    /// Useful for restoring from backup or syncing from another source.
    pub fn import(&self, announcements: Vec<Announcement>) -> Result<usize> {
        let mut imported = 0;

        for mut ann in announcements {
            // Assign new ID if needed
            if ann.id == 0 {
                ann.id = self.next_id.fetch_add(1, Ordering::SeqCst);
            } else {
                // Update next_id if imported ID is higher
                let current = self.next_id.load(Ordering::SeqCst);
                if ann.id >= current {
                    self.next_id.store(ann.id + 1, Ordering::SeqCst);
                }
            }

            // Validate
            ann.validate()?;

            // Update view tag index
            self.view_tag_index
                .entry(ann.view_tag)
                .or_default()
                .push(ann.id);

            // Update tx hash index
            if let Some(ref hash) = ann.tx_hash {
                let normalized = Self::normalize_tx_hash(hash);
                self.tx_hash_index.insert(normalized, ann.id);
            }

            // Update stats
            self.stats.write().add(&ann);

            // Store
            self.announcements.insert(ann.id, ann);
            imported += 1;
        }

        Ok(imported)
    }

    /// Reserves a dedup slot (parity with the Turso reserve flow). Inserts the
    /// announcement with `tx_hash = None`; a duplicate `payment_tx_hash_hmac`
    /// returns `SpecterError::DuplicatePayment`.
    pub async fn reserve_announcement(&self, ann: &Announcement) -> Result<u64> {
        if let Some(hmac) = &ann.payment_tx_hash_hmac {
            if self.payment_hmac_index.contains_key(hmac) {
                return Err(SpecterError::DuplicatePayment);
            }
        }

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let mut stored = ann.clone();
        stored.id = id;
        stored.tx_hash = None;

        self.view_tag_index
            .entry(stored.view_tag)
            .or_default()
            .push(id);
        if let Some(hmac) = &stored.payment_tx_hash_hmac {
            self.payment_hmac_index.insert(hmac.clone(), id);
        }
        self.stats.write().add(&stored);
        self.announcements.insert(id, stored);
        Ok(id)
    }

    /// Finalizes a reserved announcement by recording the relay tx hash.
    pub async fn finalize_announcement(
        &self,
        id: u64,
        _view_tag: u8,
        monad_tx_hash: &str,
    ) -> Result<()> {
        match self.announcements.get_mut(&id) {
            Some(mut entry) => {
                let normalized = Self::normalize_tx_hash(monad_tx_hash);
                entry.tx_hash = Some(normalized.clone());
                self.tx_hash_index.insert(normalized, id);
                Ok(())
            }
            None => Err(SpecterError::AnnouncementNotFound(id.to_string())),
        }
    }
}

impl Default for MemoryRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AnnouncementRegistry for MemoryRegistry {
    /// Publishes a new announcement.
    ///
    /// The announcement is validated, assigned an ID, indexed by view tag,
    /// and stored in memory.
    #[instrument(skip(self, announcement), fields(view_tag = announcement.view_tag))]
    async fn publish(&self, mut announcement: Announcement) -> Result<u64> {
        // Validate
        announcement.validate()?;

        // Reject duplicate tx_hash if provided
        if let Some(ref hash) = announcement.tx_hash {
            let normalized = Self::normalize_tx_hash(hash);
            if normalized.is_empty() {
                return Err(SpecterError::InvalidAnnouncement(
                    "tx_hash cannot be empty".into(),
                ));
            }
            if self.tx_hash_index.contains_key(&normalized) {
                return Err(SpecterError::InvalidAnnouncement(
                    "announcement with this transaction hash already exists".into(),
                ));
            }
        }

        // Assign ID
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        announcement.id = id;

        debug!(
            id,
            view_tag = announcement.view_tag,
            "Publishing announcement"
        );

        // Update view tag index
        self.view_tag_index
            .entry(announcement.view_tag)
            .or_default()
            .push(id);

        // Update tx hash index
        if let Some(ref hash) = announcement.tx_hash {
            let normalized = Self::normalize_tx_hash(hash);
            self.tx_hash_index.insert(normalized, id);
        }

        // Update stats
        self.stats.write().add(&announcement);

        // Store
        self.announcements.insert(id, announcement);

        Ok(id)
    }

    /// Retrieves announcements by view tag.
    ///
    /// This is the primary query pattern and is O(1) for the bucket lookup,
    /// then O(n) for the announcements in that bucket (typically small).
    #[instrument(skip(self))]
    async fn get_by_view_tag(&self, view_tag: u8) -> Result<Vec<Announcement>> {
        let ids = match self.view_tag_index.get(&view_tag) {
            Some(ids) => ids.clone(),
            None => return Ok(Vec::new()),
        };

        let mut announcements = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(ann) = self.announcements.get(&id) {
                announcements.push(ann.clone());
            }
        }

        debug!(
            view_tag,
            count = announcements.len(),
            "Retrieved by view tag"
        );
        Ok(announcements)
    }

    /// Retrieves announcements within a time range.
    #[instrument(skip(self))]
    async fn get_by_time_range(&self, start: u64, end: u64) -> Result<Vec<Announcement>> {
        let mut announcements: Vec<Announcement> = self
            .announcements
            .iter()
            .filter(|entry| {
                let ts = entry.value().timestamp;
                ts >= start && ts <= end
            })
            .map(|entry| entry.value().clone())
            .collect();

        // Sort by timestamp
        announcements.sort_by_key(|a| a.timestamp);

        debug!(
            start,
            end,
            count = announcements.len(),
            "Retrieved by time range"
        );
        Ok(announcements)
    }

    /// Retrieves a specific announcement by ID.
    #[instrument(skip(self))]
    async fn get_by_id(&self, id: u64) -> Result<Option<Announcement>> {
        Ok(self.announcements.get(&id).map(|entry| entry.clone()))
    }

    /// Returns the total announcement count.
    async fn count(&self) -> Result<u64> {
        Ok(self.announcements.len() as u64)
    }

    /// Returns the next available announcement ID.
    async fn next_id(&self) -> Result<u64> {
        Ok(self.next_id.load(Ordering::SeqCst))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::constants::KYBER_CIPHERTEXT_SIZE;

    fn make_test_announcement(view_tag: u8) -> Announcement {
        Announcement::new(vec![0x42u8; KYBER_CIPHERTEXT_SIZE], view_tag)
    }

    #[tokio::test]
    async fn test_publish_and_get_by_id() {
        let registry = MemoryRegistry::new();
        let ann = make_test_announcement(0x42);

        let id = registry.publish(ann.clone()).await.unwrap();
        assert_eq!(id, 1);

        let retrieved = registry.get_by_id(id).await.unwrap().unwrap();
        assert_eq!(retrieved.view_tag, 0x42);
        assert_eq!(retrieved.id, 1);
    }

    #[tokio::test]
    async fn test_get_by_view_tag() {
        let registry = MemoryRegistry::new();

        // Publish announcements with different view tags
        registry
            .publish(make_test_announcement(0x42))
            .await
            .unwrap();
        registry
            .publish(make_test_announcement(0x42))
            .await
            .unwrap();
        registry
            .publish(make_test_announcement(0x00))
            .await
            .unwrap();

        // Query by view tag
        let matching = registry.get_by_view_tag(0x42).await.unwrap();
        assert_eq!(matching.len(), 2);

        let other = registry.get_by_view_tag(0x00).await.unwrap();
        assert_eq!(other.len(), 1);

        let none = registry.get_by_view_tag(0xFF).await.unwrap();
        assert!(none.is_empty());
    }

    #[tokio::test]
    async fn test_get_by_time_range() {
        let registry = MemoryRegistry::new();

        let mut ann1 = make_test_announcement(0x01);
        ann1.timestamp = 100;
        registry.publish(ann1).await.unwrap();

        let mut ann2 = make_test_announcement(0x02);
        ann2.timestamp = 200;
        registry.publish(ann2).await.unwrap();

        let mut ann3 = make_test_announcement(0x03);
        ann3.timestamp = 300;
        registry.publish(ann3).await.unwrap();

        // Query range [150, 250] should return only ann2
        let results = registry.get_by_time_range(150, 250).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].view_tag, 0x02);

        // Query range [0, 500] should return all
        let all = registry.get_by_time_range(0, 500).await.unwrap();
        assert_eq!(all.len(), 3);
    }

    #[tokio::test]
    async fn test_count() {
        let registry = MemoryRegistry::new();

        assert_eq!(registry.count().await.unwrap(), 0);

        registry
            .publish(make_test_announcement(0x01))
            .await
            .unwrap();
        assert_eq!(registry.count().await.unwrap(), 1);

        registry
            .publish(make_test_announcement(0x02))
            .await
            .unwrap();
        assert_eq!(registry.count().await.unwrap(), 2);
    }

    #[tokio::test]
    async fn test_stats() {
        let registry = MemoryRegistry::new();

        registry
            .publish(make_test_announcement(0x42))
            .await
            .unwrap();
        registry
            .publish(make_test_announcement(0x42))
            .await
            .unwrap();
        registry
            .publish(make_test_announcement(0x00))
            .await
            .unwrap();

        let stats = registry.stats();
        assert_eq!(stats.total_count, 3);
        assert_eq!(stats.view_tag_distribution[0x42], 2);
        assert_eq!(stats.view_tag_distribution[0x00], 1);
    }

    #[tokio::test]
    async fn test_clear() {
        let registry = MemoryRegistry::new();

        registry
            .publish(make_test_announcement(0x01))
            .await
            .unwrap();
        registry
            .publish(make_test_announcement(0x02))
            .await
            .unwrap();

        assert_eq!(registry.len(), 2);

        registry.clear();

        assert_eq!(registry.len(), 0);
        assert!(registry.is_empty());
    }

    #[tokio::test]
    async fn test_import_export() {
        let registry1 = MemoryRegistry::new();
        registry1
            .publish(make_test_announcement(0x01))
            .await
            .unwrap();
        registry1
            .publish(make_test_announcement(0x02))
            .await
            .unwrap();

        // Export
        let announcements = registry1.all_announcements();
        assert_eq!(announcements.len(), 2);

        // Import into new registry
        let registry2 = MemoryRegistry::new();
        let imported = registry2.import(announcements).unwrap();
        assert_eq!(imported, 2);
        assert_eq!(registry2.len(), 2);
    }

    #[tokio::test]
    async fn test_concurrent_publish() {
        use std::sync::Arc;
        use tokio::task::JoinSet;

        let registry = Arc::new(MemoryRegistry::new());
        let mut tasks = JoinSet::new();

        // Spawn 100 concurrent publish tasks
        for i in 0..100u8 {
            let reg = registry.clone();
            tasks.spawn(async move {
                let ann = make_test_announcement(i);
                reg.publish(ann).await.unwrap()
            });
        }

        // Wait for all to complete
        while let Some(result) = tasks.join_next().await {
            result.unwrap();
        }

        // All 100 should be stored
        assert_eq!(registry.len(), 100);
    }

    #[tokio::test]
    async fn test_invalid_announcement_rejected() {
        let registry = MemoryRegistry::new();

        // All-zero ephemeral key is invalid
        let invalid = Announcement::new(vec![0u8; KYBER_CIPHERTEXT_SIZE], 0x00);
        let result = registry.publish(invalid).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_nonexistent() {
        let registry = MemoryRegistry::new();

        let result = registry.get_by_id(999).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_ids_are_sequential() {
        let registry = MemoryRegistry::new();

        let id1 = registry
            .publish(make_test_announcement(0x01))
            .await
            .unwrap();
        let id2 = registry
            .publish(make_test_announcement(0x02))
            .await
            .unwrap();
        let id3 = registry
            .publish(make_test_announcement(0x03))
            .await
            .unwrap();

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
    }

    #[tokio::test]
    async fn duplicate_tx_hash_is_rejected() {
        let registry = MemoryRegistry::new();
        let mut ann1 = make_test_announcement(0x01);
        ann1.tx_hash = Some("0xdeadbeef".to_string());

        let mut ann2 = make_test_announcement(0x02);
        ann2.tx_hash = Some("0xdeadbeef".to_string()); // same hash

        registry.publish(ann1).await.unwrap();
        let result = registry.publish(ann2).await;
        assert!(result.is_err(), "duplicate tx_hash must be rejected");
    }

    #[tokio::test]
    async fn duplicate_tx_hash_case_insensitive() {
        let registry = MemoryRegistry::new();
        let mut ann1 = make_test_announcement(0x01);
        ann1.tx_hash = Some("0xDEADBEEF".to_string());

        let mut ann2 = make_test_announcement(0x02);
        ann2.tx_hash = Some("0xdeadbeef".to_string()); // same, different case

        registry.publish(ann1).await.unwrap();
        let result = registry.publish(ann2).await;
        assert!(result.is_err(), "tx_hash matching must be case-insensitive");
    }

    #[tokio::test]
    async fn empty_tx_hash_is_rejected() {
        let registry = MemoryRegistry::new();
        let mut ann = make_test_announcement(0x01);
        ann.tx_hash = Some("".to_string()); // empty
        let result = registry.publish(ann).await;
        assert!(result.is_err(), "empty tx_hash must be rejected");
    }

    #[tokio::test]
    async fn whitespace_only_tx_hash_is_rejected() {
        let registry = MemoryRegistry::new();
        let mut ann = make_test_announcement(0x01);
        ann.tx_hash = Some("   ".to_string()); // whitespace only
        let result = registry.publish(ann).await;
        assert!(result.is_err(), "whitespace-only tx_hash must be rejected");
    }

    #[tokio::test]
    async fn announcements_without_tx_hash_can_coexist() {
        let registry = MemoryRegistry::new();
        // Neither has a tx_hash — both must succeed
        let id1 = registry.publish(make_test_announcement(0x01)).await.unwrap();
        let id2 = registry.publish(make_test_announcement(0x02)).await.unwrap();
        assert_ne!(id1, id2);
        assert_eq!(registry.len(), 2);
    }

    #[tokio::test]
    async fn time_range_equal_start_end_returns_matching() {
        let registry = MemoryRegistry::new();
        let mut ann = make_test_announcement(0x01);
        ann.timestamp = 500;
        registry.publish(ann).await.unwrap();

        // A range where from == to == timestamp should include the entry
        let results = registry.get_by_time_range(500, 500).await.unwrap();
        assert!(!results.is_empty(), "entry with timestamp==from==to should match");
    }

    #[tokio::test]
    async fn time_range_exclusive_boundaries() {
        let registry = MemoryRegistry::new();
        let mut ann = make_test_announcement(0x01);
        ann.timestamp = 100;
        registry.publish(ann).await.unwrap();

        // Range [101, 200] should NOT include timestamp=100
        let results = registry.get_by_time_range(101, 200).await.unwrap();
        assert!(results.is_empty(), "timestamp 100 should be outside [101, 200]");
    }

    #[tokio::test]
    async fn stats_on_empty_registry() {
        let registry = MemoryRegistry::new();
        let stats = registry.stats();
        assert_eq!(stats.total_count, 0);
        // All view tag buckets should be zero
        for count in &stats.view_tag_distribution {
            assert_eq!(*count, 0);
        }
    }

    #[tokio::test]
    async fn stats_view_tag_distribution_all_256_values() {
        let registry = MemoryRegistry::new();
        // Publish one announcement for every possible view tag
        for tag in 0u8..=255 {
            registry.publish(make_test_announcement(tag)).await.unwrap();
        }
        let stats = registry.stats();
        assert_eq!(stats.total_count, 256);
        for (tag, &count) in stats.view_tag_distribution.iter().enumerate() {
            assert_eq!(count, 1, "view tag {} should have exactly 1 entry", tag);
        }
    }

    #[tokio::test]
    async fn get_by_view_tag_after_clear_returns_empty() {
        let registry = MemoryRegistry::new();
        registry.publish(make_test_announcement(0x42)).await.unwrap();
        registry.clear();
        let result = registry.get_by_view_tag(0x42).await.unwrap();
        assert!(result.is_empty(), "after clear, view tag index must be empty");
    }

    #[tokio::test]
    async fn publish_after_clear_restarts_ids_at_1() {
        let registry = MemoryRegistry::new();
        registry.publish(make_test_announcement(0x01)).await.unwrap();
        registry.publish(make_test_announcement(0x02)).await.unwrap();
        registry.clear();
        let new_id = registry.publish(make_test_announcement(0x03)).await.unwrap();
        assert_eq!(new_id, 1, "IDs should restart at 1 after clear");
    }

    #[tokio::test]
    async fn count_matches_len() {
        let registry = MemoryRegistry::new();
        registry.publish(make_test_announcement(0x01)).await.unwrap();
        registry.publish(make_test_announcement(0x02)).await.unwrap();
        registry.publish(make_test_announcement(0x03)).await.unwrap();
        let count = registry.count().await.unwrap();
        assert_eq!(count, registry.len() as u64);
    }

    #[tokio::test]
    async fn announcement_retrieved_by_id_has_correct_fields() {
        let registry = MemoryRegistry::new();
        let mut ann = make_test_announcement(0xab);
        ann.tx_hash = Some("0xcafe".to_string());
        ann.timestamp = 999_999;
        let id = registry.publish(ann).await.unwrap();

        let retrieved = registry.get_by_id(id).await.unwrap().unwrap();
        assert_eq!(retrieved.view_tag, 0xab);
        assert_eq!(retrieved.tx_hash.as_deref(), Some("0xcafe"));
        assert_eq!(retrieved.timestamp, 999_999);
        assert_eq!(retrieved.id, id);
    }
}
