//! SQLite-backed announcement registry.
//!
//! Implements `AnnouncementRegistry` with full persistence, WAL mode for
//! concurrent reads, and an LRU cache for hot view-tag lookups.

use std::num::NonZeroUsize;
use std::sync::Arc;

use async_trait::async_trait;
use lru::LruCache;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Row, SqlitePool};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use specter_core::error::{Result, SpecterError};
use specter_core::traits::AnnouncementRegistry;
use specter_core::types::{Announcement, AnnouncementStats};

use super::schema;

/// Production SQLite-backed announcement registry.
pub struct SqliteRegistry {
    pool: SqlitePool,
    /// LRU cache: view_tag -> Vec<Announcement> for hot lookups.
    cache: Arc<RwLock<LruCache<u8, Vec<Announcement>>>>,
}

impl std::fmt::Debug for SqliteRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SqliteRegistry")
            .field("pool", &"SqlitePool")
            .finish()
    }
}

impl SqliteRegistry {
    /// Opens (or creates) a SQLite database at `db_path`.
    ///
    /// Pass `":memory:"` for an ephemeral in-memory database (useful in tests).
    pub async fn new(db_path: &str) -> Result<Self> {
        let is_memory = db_path == ":memory:";

        let connect_opts = if is_memory {
            // For in-memory DBs, use a unique name so pool connections share one DB
            // but different SqliteRegistry instances get separate databases.
            use std::sync::atomic::{AtomicU64, Ordering};
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let id = COUNTER.fetch_add(1, Ordering::Relaxed);
            let uri = format!("file:memdb_{id}?mode=memory&cache=shared");
            SqliteConnectOptions::new()
                .filename(&uri)
                .create_if_missing(true)
                .shared_cache(true)
        } else {
            SqliteConnectOptions::new()
                .filename(db_path)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Normal)
                .busy_timeout(std::time::Duration::from_secs(5))
        };

        let pool = SqlitePoolOptions::new()
            .max_connections(if is_memory { 2 } else { 10 })
            .connect_with(connect_opts)
            .await
            .map_err(|e| SpecterError::RegistryError(format!("SQLite connect: {e}")))?;

        // Enable foreign keys
        sqlx::query("PRAGMA foreign_keys = ON;")
            .execute(&pool)
            .await
            .map_err(|e| SpecterError::RegistryError(format!("PRAGMA foreign_keys: {e}")))?;

        let registry = Self {
            pool,
            cache: Arc::new(RwLock::new(LruCache::new(
                NonZeroUsize::new(256).unwrap(), // one slot per view tag
            ))),
        };

        registry.init_schema().await?;
        Ok(registry)
    }

    /// Returns a clone of the connection pool (for scan/yellow stores).
    pub fn pool(&self) -> SqlitePool {
        self.pool.clone()
    }

    /// Initialize schema and metadata.
    async fn init_schema(&self) -> Result<()> {
        // Execute each DDL statement individually
        for statement in schema::SCHEMA_STATEMENTS {
            sqlx::query(statement)
                .execute(&self.pool)
                .await
                .map_err(|e| {
                    SpecterError::RegistryError(format!("Schema init: {e}\nSQL: {statement}"))
                })?;
        }

        // Seed metadata if first run
        let row = sqlx::query(
            "SELECT COUNT(*) as cnt FROM registry_metadata WHERE key = 'schema_version'",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("metadata check: {e}")))?;
        let count: i64 = row.get("cnt");

        if count == 0 {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            sqlx::query("INSERT INTO registry_metadata (key, value) VALUES ('schema_version', ?)")
                .bind(schema::SCHEMA_VERSION.to_string())
                .execute(&self.pool)
                .await
                .map_err(|e| SpecterError::RegistryError(format!("seed version: {e}")))?;

            sqlx::query(
                "INSERT INTO registry_metadata (key, value) VALUES ('db_initialized_at', ?)",
            )
            .bind(now.to_string())
            .execute(&self.pool)
            .await
            .map_err(|e| SpecterError::RegistryError(format!("seed init time: {e}")))?;

            info!(
                "SQLite registry initialized (schema v{})",
                schema::SCHEMA_VERSION
            );
        }

        Ok(())
    }

    /// Health check — verifies the database is accessible.
    pub async fn health_check(&self) -> Result<()> {
        sqlx::query("SELECT 1")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| SpecterError::RegistryError(format!("health check: {e}")))?;
        Ok(())
    }

    /// Ask SQLite to optimize (checkpoint WAL, analyze indexes).
    pub async fn flush(&self) -> Result<()> {
        sqlx::query("PRAGMA optimize;")
            .execute(&self.pool)
            .await
            .map_err(|e| SpecterError::RegistryError(format!("optimize: {e}")))?;
        Ok(())
    }

    /// Returns all announcements (use sparingly on large datasets).
    pub async fn all_announcements(&self) -> Vec<Announcement> {
        match self.fetch_all_inner().await {
            Ok(v) => v,
            Err(e) => {
                warn!("all_announcements failed: {e}");
                Vec::new()
            }
        }
    }

    async fn fetch_all_inner(&self) -> Result<Vec<Announcement>> {
        let rows = sqlx::query(
            "SELECT id, view_tag, timestamp, ephemeral_key, channel_id, \
                    block_number, tx_hash, amount, chain \
             FROM announcements ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("fetch all: {e}")))?;

        Ok(rows.iter().map(row_to_announcement).collect())
    }

    /// Compute live statistics.
    pub async fn stats(&self) -> AnnouncementStats {
        match self.stats_inner().await {
            Ok(s) => s,
            Err(e) => {
                warn!("stats query failed: {e}");
                AnnouncementStats::default()
            }
        }
    }

    async fn stats_inner(&self) -> Result<AnnouncementStats> {
        let count_row = sqlx::query("SELECT COUNT(*) as cnt FROM announcements")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| SpecterError::RegistryError(format!("stats count: {e}")))?;
        let total_count: i64 = count_row.get("cnt");

        let ts_row = sqlx::query(
            "SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM announcements",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("stats ts: {e}")))?;

        let earliest: Option<i64> = ts_row.get("earliest");
        let latest: Option<i64> = ts_row.get("latest");

        let yellow_row =
            sqlx::query("SELECT COUNT(*) as cnt FROM announcements WHERE channel_id IS NOT NULL")
                .fetch_one(&self.pool)
                .await
                .map_err(|e| SpecterError::RegistryError(format!("stats yellow: {e}")))?;
        let yellow_count: i64 = yellow_row.get("cnt");

        // View tag distribution
        let dist_rows =
            sqlx::query("SELECT view_tag, COUNT(*) as cnt FROM announcements GROUP BY view_tag")
                .fetch_all(&self.pool)
                .await
                .map_err(|e| SpecterError::RegistryError(format!("stats dist: {e}")))?;

        let mut distribution = vec![0u64; 256];
        for row in &dist_rows {
            let tag: i32 = row.get("view_tag");
            let cnt: i64 = row.get("cnt");
            if (0..256).contains(&tag) {
                distribution[tag as usize] = cnt as u64;
            }
        }

        Ok(AnnouncementStats {
            total_count: total_count as u64,
            view_tag_distribution: distribution,
            earliest_timestamp: earliest.map(|t| t as u64),
            latest_timestamp: latest.map(|t| t as u64),
            yellow_channel_count: yellow_count as u64,
        })
    }

    /// Import a batch of announcements (for migration from MemoryRegistry/FileRegistry).
    pub async fn import(&self, announcements: Vec<Announcement>) -> Result<usize> {
        let mut imported = 0usize;
        for ann in announcements {
            // Use a savepoint so one bad row doesn't abort the whole batch
            match self.insert_announcement(&ann).await {
                Ok(_) => imported += 1,
                Err(e) => {
                    debug!("import skip (id={}): {e}", ann.id);
                }
            }
        }
        // Invalidate entire cache after bulk import
        self.cache.write().await.clear();
        info!("Imported {imported} announcements into SQLite");
        Ok(imported)
    }

    /// Insert a single announcement row, returning the new rowid.
    async fn insert_announcement(&self, ann: &Announcement) -> Result<u64> {
        let channel_blob: Option<Vec<u8>> = ann.channel_id.map(|c| c.to_vec());

        let result = sqlx::query(
            "INSERT INTO announcements \
             (view_tag, timestamp, ephemeral_key, channel_id, block_number, tx_hash, amount, chain) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(ann.view_tag as i32)
        .bind(ann.timestamp as i64)
        .bind(&ann.ephemeral_key)
        .bind(&channel_blob)
        .bind(ann.block_number.map(|b| b as i64))
        .bind(&ann.tx_hash)
        .bind(&ann.amount)
        .bind(&ann.chain)
        .execute(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("insert: {e}")))?;

        Ok(result.last_insert_rowid() as u64)
    }

    fn normalize_tx_hash(hash: &str) -> String {
        hash.trim().to_lowercase()
    }
}

/// Map a sqlx Row to an Announcement.
fn row_to_announcement(row: &sqlx::sqlite::SqliteRow) -> Announcement {
    let id: i64 = row.get("id");
    let view_tag: i32 = row.get("view_tag");
    let timestamp: i64 = row.get("timestamp");
    let ephemeral_key: Vec<u8> = row.get("ephemeral_key");
    let channel_blob: Option<Vec<u8>> = row.get("channel_id");
    let block_number: Option<i64> = row.get("block_number");
    let tx_hash: Option<String> = row.get("tx_hash");
    let amount: Option<String> = row.get("amount");
    let chain: Option<String> = row.get("chain");

    let channel_id = channel_blob.and_then(|b| {
        if b.len() == 32 {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&b);
            Some(arr)
        } else {
            None
        }
    });

    Announcement {
        id: id as u64,
        view_tag: view_tag as u8,
        timestamp: timestamp as u64,
        ephemeral_key,
        channel_id,
        block_number: block_number.map(|b| b as u64),
        tx_hash,
        amount,
        chain,
    }
}

#[async_trait]
impl AnnouncementRegistry for SqliteRegistry {
    async fn publish(&self, mut announcement: Announcement) -> Result<u64> {
        announcement.validate()?;

        // Reject duplicate tx_hash
        if let Some(ref hash) = announcement.tx_hash {
            let normalized = Self::normalize_tx_hash(hash);
            if normalized.is_empty() {
                return Err(SpecterError::InvalidAnnouncement(
                    "tx_hash cannot be empty".into(),
                ));
            }

            let row = sqlx::query("SELECT id FROM announcements WHERE tx_hash = ? LIMIT 1")
                .bind(&normalized)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| SpecterError::RegistryError(format!("dup check: {e}")))?;

            if row.is_some() {
                return Err(SpecterError::InvalidAnnouncement(
                    "announcement with this transaction hash already exists".into(),
                ));
            }

            // Store normalized tx_hash
            announcement.tx_hash = Some(normalized);
        }

        let id = self.insert_announcement(&announcement).await?;

        // Invalidate cache for this view_tag
        self.cache.write().await.pop(&announcement.view_tag);

        debug!(
            id,
            view_tag = announcement.view_tag,
            "Published announcement (SQLite)"
        );
        Ok(id)
    }

    async fn get_by_view_tag(&self, view_tag: u8) -> Result<Vec<Announcement>> {
        // Check cache
        {
            let cache = self.cache.read().await;
            if let Some(cached) = cache.peek(&view_tag) {
                return Ok(cached.clone());
            }
        }

        let rows = sqlx::query(
            "SELECT id, view_tag, timestamp, ephemeral_key, channel_id, \
                    block_number, tx_hash, amount, chain \
             FROM announcements WHERE view_tag = ? ORDER BY timestamp DESC",
        )
        .bind(view_tag as i32)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("get_by_view_tag: {e}")))?;

        let announcements: Vec<Announcement> = rows.iter().map(row_to_announcement).collect();

        // Update cache
        self.cache
            .write()
            .await
            .put(view_tag, announcements.clone());

        Ok(announcements)
    }

    async fn get_by_time_range(&self, start: u64, end: u64) -> Result<Vec<Announcement>> {
        let rows = sqlx::query(
            "SELECT id, view_tag, timestamp, ephemeral_key, channel_id, \
                    block_number, tx_hash, amount, chain \
             FROM announcements WHERE timestamp BETWEEN ? AND ? \
             ORDER BY timestamp",
        )
        .bind(start as i64)
        .bind(end as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("get_by_time_range: {e}")))?;

        Ok(rows.iter().map(row_to_announcement).collect())
    }

    async fn get_by_id(&self, id: u64) -> Result<Option<Announcement>> {
        let row = sqlx::query(
            "SELECT id, view_tag, timestamp, ephemeral_key, channel_id, \
                    block_number, tx_hash, amount, chain \
             FROM announcements WHERE id = ? LIMIT 1",
        )
        .bind(id as i64)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("get_by_id: {e}")))?;

        Ok(row.as_ref().map(row_to_announcement))
    }

    async fn count(&self) -> Result<u64> {
        let row = sqlx::query("SELECT COUNT(*) as cnt FROM announcements")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| SpecterError::RegistryError(format!("count: {e}")))?;
        let cnt: i64 = row.get("cnt");
        Ok(cnt as u64)
    }

    async fn next_id(&self) -> Result<u64> {
        let row = sqlx::query("SELECT MAX(id) as max_id FROM announcements")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| SpecterError::RegistryError(format!("next_id: {e}")))?;
        let max_id: Option<i64> = row.get("max_id");
        Ok(max_id.map(|m| (m + 1) as u64).unwrap_or(1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::constants::KYBER_CIPHERTEXT_SIZE;

    fn make_test_announcement(view_tag: u8) -> Announcement {
        Announcement::new(vec![0x42u8; KYBER_CIPHERTEXT_SIZE], view_tag)
    }

    async fn setup() -> SqliteRegistry {
        SqliteRegistry::new(":memory:").await.unwrap()
    }

    #[tokio::test]
    async fn test_publish_and_get_by_id() {
        let reg = setup().await;
        let ann = make_test_announcement(0x42);

        let id = reg.publish(ann).await.unwrap();
        assert!(id > 0);

        let retrieved = reg.get_by_id(id).await.unwrap().unwrap();
        assert_eq!(retrieved.view_tag, 0x42);
        assert_eq!(retrieved.id, id);
    }

    #[tokio::test]
    async fn test_get_by_view_tag() {
        let reg = setup().await;
        reg.publish(make_test_announcement(0x42)).await.unwrap();
        reg.publish(make_test_announcement(0x42)).await.unwrap();
        reg.publish(make_test_announcement(0x00)).await.unwrap();

        let matching = reg.get_by_view_tag(0x42).await.unwrap();
        assert_eq!(matching.len(), 2);

        let other = reg.get_by_view_tag(0x00).await.unwrap();
        assert_eq!(other.len(), 1);

        let none = reg.get_by_view_tag(0xFF).await.unwrap();
        assert!(none.is_empty());
    }

    #[tokio::test]
    async fn test_get_by_time_range() {
        let reg = setup().await;

        let mut ann1 = make_test_announcement(0x01);
        ann1.timestamp = 100;
        reg.publish(ann1).await.unwrap();

        let mut ann2 = make_test_announcement(0x02);
        ann2.timestamp = 200;
        reg.publish(ann2).await.unwrap();

        let mut ann3 = make_test_announcement(0x03);
        ann3.timestamp = 300;
        reg.publish(ann3).await.unwrap();

        let results = reg.get_by_time_range(150, 250).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].view_tag, 0x02);

        let all = reg.get_by_time_range(0, 500).await.unwrap();
        assert_eq!(all.len(), 3);
    }

    #[tokio::test]
    async fn test_count_and_next_id() {
        let reg = setup().await;
        assert_eq!(reg.count().await.unwrap(), 0);
        assert_eq!(reg.next_id().await.unwrap(), 1);

        reg.publish(make_test_announcement(0x01)).await.unwrap();
        assert_eq!(reg.count().await.unwrap(), 1);

        let id2 = reg.publish(make_test_announcement(0x02)).await.unwrap();
        assert_eq!(reg.count().await.unwrap(), 2);
        assert_eq!(reg.next_id().await.unwrap(), id2 + 1);
    }

    #[tokio::test]
    async fn test_duplicate_tx_hash_rejected() {
        let reg = setup().await;

        let mut ann = make_test_announcement(0x42);
        ann.tx_hash = Some("0xabc123".into());
        reg.publish(ann).await.unwrap();

        let mut dup = make_test_announcement(0x42);
        dup.tx_hash = Some("0xABC123".into()); // different case — same normalized
        let result = reg.publish(dup).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_channel_id_roundtrip() {
        let reg = setup().await;
        let channel = [0xCC; 32];
        let ann = Announcement::with_channel(vec![0x42u8; KYBER_CIPHERTEXT_SIZE], 0x01, channel);

        let id = reg.publish(ann).await.unwrap();
        let retrieved = reg.get_by_id(id).await.unwrap().unwrap();
        assert_eq!(retrieved.channel_id, Some(channel));
    }

    #[tokio::test]
    async fn test_stats() {
        let reg = setup().await;
        reg.publish(make_test_announcement(0x42)).await.unwrap();
        reg.publish(make_test_announcement(0x42)).await.unwrap();
        reg.publish(make_test_announcement(0x00)).await.unwrap();

        let stats = reg.stats().await;
        assert_eq!(stats.total_count, 3);
        assert_eq!(stats.view_tag_distribution[0x42], 2);
        assert_eq!(stats.view_tag_distribution[0x00], 1);
    }

    #[tokio::test]
    async fn test_all_announcements() {
        let reg = setup().await;
        reg.publish(make_test_announcement(0x01)).await.unwrap();
        reg.publish(make_test_announcement(0x02)).await.unwrap();

        let all = reg.all_announcements().await;
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn test_import() {
        let reg = setup().await;

        let anns = vec![
            make_test_announcement(0x01),
            make_test_announcement(0x02),
            make_test_announcement(0x03),
        ];

        let imported = reg.import(anns).await.unwrap();
        assert_eq!(imported, 3);
        assert_eq!(reg.count().await.unwrap(), 3);
    }

    #[tokio::test]
    async fn test_invalid_announcement_rejected() {
        let reg = setup().await;
        let invalid = Announcement::new(vec![0u8; KYBER_CIPHERTEXT_SIZE], 0x00);
        assert!(reg.publish(invalid).await.is_err());
    }

    #[tokio::test]
    async fn test_ids_are_sequential() {
        let reg = setup().await;
        let id1 = reg.publish(make_test_announcement(0x01)).await.unwrap();
        let id2 = reg.publish(make_test_announcement(0x02)).await.unwrap();
        let id3 = reg.publish(make_test_announcement(0x03)).await.unwrap();
        assert_eq!(id2, id1 + 1);
        assert_eq!(id3, id2 + 1);
    }

    #[tokio::test]
    async fn test_concurrent_publish() {
        let reg = Arc::new(setup().await);
        let mut tasks = tokio::task::JoinSet::new();

        for i in 0..50u8 {
            let r = reg.clone();
            tasks.spawn(async move {
                r.publish(make_test_announcement(i)).await.unwrap();
            });
        }

        while let Some(result) = tasks.join_next().await {
            result.unwrap();
        }

        assert_eq!(reg.count().await.unwrap(), 50);
    }

    #[tokio::test]
    async fn test_health_check() {
        let reg = setup().await;
        assert!(reg.health_check().await.is_ok());
    }

    #[tokio::test]
    async fn test_persistence_across_instances() {
        // Use a temp file to test real persistence
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let path_str = path.to_str().unwrap();

        // Instance 1: publish
        {
            let reg = SqliteRegistry::new(path_str).await.unwrap();
            reg.publish(make_test_announcement(0x42)).await.unwrap();
            reg.publish(make_test_announcement(0x43)).await.unwrap();
        }

        // Instance 2: verify data survives
        {
            let reg = SqliteRegistry::new(path_str).await.unwrap();
            assert_eq!(reg.count().await.unwrap(), 2);
            let anns = reg.get_by_view_tag(0x42).await.unwrap();
            assert_eq!(anns.len(), 1);
        }
    }
}
