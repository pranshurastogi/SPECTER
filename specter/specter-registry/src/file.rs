//! File-based announcement registry with persistence.
//!
//! Stores announcements in a binary file with automatic saves.
//! Suitable for single-node deployments where durability is needed.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicBool, Ordering};

use async_trait::async_trait;
use parking_lot::RwLock;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::{debug, info, instrument, warn};

use specter_core::error::{Result, SpecterError};
use specter_core::traits::AnnouncementRegistry;
use specter_core::types::{Announcement, AnnouncementStats};

use crate::MemoryRegistry;

/// File-based announcement registry.
///
/// Uses a memory registry internally with periodic persistence to disk.
///
/// # File Format
///
/// ```text
/// magic (4 bytes): "SPEC"
/// version (1 byte): 1
/// count (8 bytes): number of announcements
/// announcements (variable): bincode-serialized announcements
/// ```
pub struct FileRegistry {
    /// Path to the storage file
    path: PathBuf,
    /// In-memory storage
    memory: MemoryRegistry,
    /// Whether there are unsaved changes
    dirty: AtomicBool,
    /// Auto-save threshold (save after N writes)
    auto_save_threshold: u64,
    /// Writes since last save
    writes_since_save: AtomicU64,
}

/// File format magic bytes
const MAGIC: &[u8; 4] = b"SPEC";
/// Current file format version
const VERSION: u8 = 1;

impl FileRegistry {
    /// Creates a new file registry at the given path.
    ///
    /// If the file exists, it will be loaded. Otherwise, an empty registry
    /// is created and the file will be created on first save.
    pub async fn new(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let memory = MemoryRegistry::new();

        let registry = Self {
            path,
            memory,
            dirty: AtomicBool::new(false),
            auto_save_threshold: 100,
            writes_since_save: AtomicU64::new(0),
        };

        // Load existing data if file exists
        if registry.path.exists() {
            registry.load().await?;
        }

        Ok(registry)
    }

    /// Creates a file registry with custom auto-save threshold.
    pub async fn with_auto_save(path: impl AsRef<Path>, threshold: u64) -> Result<Self> {
        let mut registry = Self::new(path).await?;
        registry.auto_save_threshold = threshold;
        Ok(registry)
    }

    /// Loads announcements from the file.
    #[instrument(skip(self))]
    async fn load(&self) -> Result<()> {
        let mut file = fs::File::open(&self.path).await.map_err(|e| {
            SpecterError::IoError(std::io::Error::new(e.kind(), format!("Failed to open registry file: {}", e)))
        })?;

        let mut contents = Vec::new();
        file.read_to_end(&mut contents).await?;

        if contents.len() < 13 {
            return Err(SpecterError::RegistryError("File too short".into()));
        }

        // Verify magic
        if &contents[0..4] != MAGIC {
            return Err(SpecterError::RegistryError("Invalid magic bytes".into()));
        }

        // Check version
        let version = contents[4];
        if version != VERSION {
            return Err(SpecterError::VersionMismatch {
                expected: VERSION,
                actual: version,
            });
        }

        // Read count
        let count = u64::from_le_bytes(contents[5..13].try_into().unwrap());
        info!(count, "Loading announcements from file");

        // Deserialize announcements
        if contents.len() > 13 {
            let json_str = String::from_utf8(contents[13..].to_vec())
                .map_err(|e| SpecterError::BinarySerializationError(e.to_string()))?;
            let announcements: Vec<Announcement> = serde_json::from_str(&json_str)
                .map_err(|e| SpecterError::BinarySerializationError(e.to_string()))?;

            self.memory.import(announcements)?;
        }

        self.dirty.store(false, Ordering::SeqCst);
        debug!("Registry loaded successfully");

        Ok(())
    }

    /// Saves announcements to the file.
    #[instrument(skip(self))]
    pub async fn save(&self) -> Result<()> {
        let announcements = self.memory.all_announcements();
        let count = announcements.len() as u64;

        info!(count, path = ?self.path, "Saving registry to file");

        // Serialize with serde_json (bincode doesn't work well with hex-serialized fields)
        let serialized = serde_json::to_vec(&announcements)
            .map_err(|e| SpecterError::BinarySerializationError(e.to_string()))?;

        // Build file contents
        let mut contents = Vec::with_capacity(13 + serialized.len());
        contents.extend_from_slice(MAGIC);
        contents.push(VERSION);
        contents.extend_from_slice(&count.to_le_bytes());
        contents.extend_from_slice(&serialized);

        // Write atomically (write to temp, then rename)
        let temp_path = self.path.with_extension("tmp");
        let mut file = fs::File::create(&temp_path).await?;
        file.write_all(&contents).await?;
        file.sync_all().await?;

        fs::rename(&temp_path, &self.path).await?;

        self.dirty.store(false, Ordering::SeqCst);
        self.writes_since_save.store(0, Ordering::SeqCst);

        debug!("Registry saved successfully");
        Ok(())
    }

    /// Checks if there are unsaved changes.
    pub fn is_dirty(&self) -> bool {
        self.dirty.load(Ordering::SeqCst)
    }

    /// Forces a save if dirty.
    pub async fn flush(&self) -> Result<()> {
        if self.is_dirty() {
            self.save().await?;
        }
        Ok(())
    }

    /// Returns the file path.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns the underlying memory registry for direct access.
    pub fn memory(&self) -> &MemoryRegistry {
        &self.memory
    }

    /// Returns statistics.
    pub fn stats(&self) -> AnnouncementStats {
        self.memory.stats()
    }

    /// Returns the number of announcements.
    pub fn len(&self) -> usize {
        self.memory.len()
    }

    /// Returns true if empty.
    pub fn is_empty(&self) -> bool {
        self.memory.is_empty()
    }

    /// Checks if auto-save threshold is reached and saves if needed.
    async fn maybe_auto_save(&self) -> Result<()> {
        let writes = self.writes_since_save.fetch_add(1, Ordering::SeqCst);
        if writes >= self.auto_save_threshold {
            self.save().await?;
        }
        Ok(())
    }
}

impl Drop for FileRegistry {
    fn drop(&mut self) {
        // Try to save on drop if dirty
        // Note: This is best-effort since we're in Drop
        if self.is_dirty() {
            warn!("FileRegistry dropped with unsaved changes");
        }
    }
}

#[async_trait]
impl AnnouncementRegistry for FileRegistry {
    async fn publish(&self, announcement: Announcement) -> Result<u64> {
        let id = self.memory.publish(announcement).await?;
        self.dirty.store(true, Ordering::SeqCst);
        self.maybe_auto_save().await?;
        Ok(id)
    }

    async fn get_by_view_tag(&self, view_tag: u8) -> Result<Vec<Announcement>> {
        self.memory.get_by_view_tag(view_tag).await
    }

    async fn get_by_time_range(&self, start: u64, end: u64) -> Result<Vec<Announcement>> {
        self.memory.get_by_time_range(start, end).await
    }

    async fn get_by_id(&self, id: u64) -> Result<Option<Announcement>> {
        self.memory.get_by_id(id).await
    }

    async fn count(&self) -> Result<u64> {
        self.memory.count().await
    }

    async fn next_id(&self) -> Result<u64> {
        self.memory.next_id().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::constants::KYBER_CIPHERTEXT_SIZE;
    use tempfile::tempdir;

    fn make_test_announcement(view_tag: u8) -> Announcement {
        Announcement::new(vec![0x42u8; KYBER_CIPHERTEXT_SIZE], view_tag)
    }

    #[tokio::test]
    async fn test_new_empty_registry() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("registry.bin");

        let registry = FileRegistry::new(&path).await.unwrap();
        assert!(registry.is_empty());
        assert!(!path.exists()); // File not created until save
    }

    #[tokio::test]
    async fn test_save_and_load() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("registry.bin");

        // Create and populate
        {
            let registry = FileRegistry::new(&path).await.unwrap();
            registry.publish(make_test_announcement(0x01)).await.unwrap();
            registry.publish(make_test_announcement(0x02)).await.unwrap();
            registry.save().await.unwrap();
        }

        // Load in new instance
        {
            let registry = FileRegistry::new(&path).await.unwrap();
            assert_eq!(registry.len(), 2);

            let ann1 = registry.get_by_view_tag(0x01).await.unwrap();
            assert_eq!(ann1.len(), 1);

            let ann2 = registry.get_by_view_tag(0x02).await.unwrap();
            assert_eq!(ann2.len(), 1);
        }
    }

    #[tokio::test]
    async fn test_dirty_tracking() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("registry.bin");

        let registry = FileRegistry::new(&path).await.unwrap();
        assert!(!registry.is_dirty());

        registry.publish(make_test_announcement(0x01)).await.unwrap();
        assert!(registry.is_dirty());

        registry.save().await.unwrap();
        assert!(!registry.is_dirty());
    }

    #[tokio::test]
    async fn test_auto_save() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("registry.bin");

        // Create with low auto-save threshold (auto-saves when writes_since_save >= 2)
        // So auto-save triggers on the 3rd write (when counter reaches 2)
        let registry = FileRegistry::with_auto_save(&path, 2).await.unwrap();

        // First two writes - no save
        registry.publish(make_test_announcement(0x01)).await.unwrap();
        registry.publish(make_test_announcement(0x02)).await.unwrap();
        assert!(!path.exists() || registry.is_dirty());

        // Third write triggers auto-save
        registry.publish(make_test_announcement(0x03)).await.unwrap();

        // Load in new instance to verify
        let registry2 = FileRegistry::new(&path).await.unwrap();
        assert_eq!(registry2.len(), 3);
    }

    #[tokio::test]
    async fn test_flush() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("registry.bin");

        let registry = FileRegistry::new(&path).await.unwrap();
        registry.publish(make_test_announcement(0x01)).await.unwrap();

        // Flush should save
        registry.flush().await.unwrap();
        assert!(!registry.is_dirty());
        assert!(path.exists());
    }

    #[tokio::test]
    async fn test_get_by_view_tag() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("registry.bin");

        let registry = FileRegistry::new(&path).await.unwrap();
        registry.publish(make_test_announcement(0x42)).await.unwrap();
        registry.publish(make_test_announcement(0x42)).await.unwrap();
        registry.publish(make_test_announcement(0x00)).await.unwrap();

        let matching = registry.get_by_view_tag(0x42).await.unwrap();
        assert_eq!(matching.len(), 2);
    }

    #[tokio::test]
    async fn test_get_by_id() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("registry.bin");

        let registry = FileRegistry::new(&path).await.unwrap();
        let id = registry.publish(make_test_announcement(0x42)).await.unwrap();

        let ann = registry.get_by_id(id).await.unwrap().unwrap();
        assert_eq!(ann.view_tag, 0x42);
    }

    #[tokio::test]
    async fn test_stats() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("registry.bin");

        let registry = FileRegistry::new(&path).await.unwrap();
        registry.publish(make_test_announcement(0x42)).await.unwrap();
        registry.publish(make_test_announcement(0x42)).await.unwrap();

        let stats = registry.stats();
        assert_eq!(stats.total_count, 2);
        assert_eq!(stats.view_tag_distribution[0x42], 2);
    }

    #[tokio::test]
    async fn test_invalid_file_rejected() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("registry.bin");

        // Write invalid content
        fs::write(&path, b"invalid data").await.unwrap();

        let result = FileRegistry::new(&path).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_atomic_save() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("registry.bin");
        let temp_path = path.with_extension("tmp");

        let registry = FileRegistry::new(&path).await.unwrap();
        registry.publish(make_test_announcement(0x01)).await.unwrap();
        registry.save().await.unwrap();

        // Temp file should not exist after save
        assert!(!temp_path.exists());
        // Main file should exist
        assert!(path.exists());
    }
}
