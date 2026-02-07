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
                .or_insert_with(Vec::new)
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

        debug!(id, view_tag = announcement.view_tag, "Publishing announcement");

        // Update view tag index
        self.view_tag_index
            .entry(announcement.view_tag)
            .or_insert_with(Vec::new)
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

        debug!(view_tag, count = announcements.len(), "Retrieved by view tag");
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

        debug!(start, end, count = announcements.len(), "Retrieved by time range");
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
        registry.publish(make_test_announcement(0x42)).await.unwrap();
        registry.publish(make_test_announcement(0x42)).await.unwrap();
        registry.publish(make_test_announcement(0x00)).await.unwrap();

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

        registry.publish(make_test_announcement(0x01)).await.unwrap();
        assert_eq!(registry.count().await.unwrap(), 1);

        registry.publish(make_test_announcement(0x02)).await.unwrap();
        assert_eq!(registry.count().await.unwrap(), 2);
    }

    #[tokio::test]
    async fn test_stats() {
        let registry = MemoryRegistry::new();

        registry.publish(make_test_announcement(0x42)).await.unwrap();
        registry.publish(make_test_announcement(0x42)).await.unwrap();
        registry.publish(make_test_announcement(0x00)).await.unwrap();

        let stats = registry.stats();
        assert_eq!(stats.total_count, 3);
        assert_eq!(stats.view_tag_distribution[0x42], 2);
        assert_eq!(stats.view_tag_distribution[0x00], 1);
    }

    #[tokio::test]
    async fn test_clear() {
        let registry = MemoryRegistry::new();

        registry.publish(make_test_announcement(0x01)).await.unwrap();
        registry.publish(make_test_announcement(0x02)).await.unwrap();

        assert_eq!(registry.len(), 2);

        registry.clear();

        assert_eq!(registry.len(), 0);
        assert!(registry.is_empty());
    }

    #[tokio::test]
    async fn test_import_export() {
        let registry1 = MemoryRegistry::new();
        registry1.publish(make_test_announcement(0x01)).await.unwrap();
        registry1.publish(make_test_announcement(0x02)).await.unwrap();

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

        let id1 = registry.publish(make_test_announcement(0x01)).await.unwrap();
        let id2 = registry.publish(make_test_announcement(0x02)).await.unwrap();
        let id3 = registry.publish(make_test_announcement(0x03)).await.unwrap();

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
    }
}
