//! Turso-backed announcement registry.
//!
//! Connects to a remote Turso (libSQL) database over HTTP — no local file,
//! survives Cloud Run restarts, redeploys, and scale-to-zero events.

use std::num::NonZeroUsize;
use std::sync::Arc;

use async_trait::async_trait;
use libsql::{params, Builder, Connection, Database, Value};
use lru::LruCache;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use specter_core::error::{Result, SpecterError};
use specter_core::traits::AnnouncementRegistry;
use specter_core::types::{Announcement, AnnouncementStats};

use super::schema;

// ── helper converters ──────────────────────────────────────────────────────

fn opt_blob(v: Option<Vec<u8>>) -> Value {
    v.map(Value::Blob).unwrap_or(Value::Null)
}

fn opt_int(v: Option<i64>) -> Value {
    v.map(Value::Integer).unwrap_or(Value::Null)
}

fn opt_text(v: Option<String>) -> Value {
    v.map(Value::Text).unwrap_or(Value::Null)
}

fn get_opt_blob(row: &libsql::Row, idx: i32) -> Option<Vec<u8>> {
    match row.get_value(idx) {
        Ok(Value::Blob(b)) => Some(b),
        _ => None,
    }
}

fn get_opt_int(row: &libsql::Row, idx: i32) -> Option<i64> {
    match row.get_value(idx) {
        Ok(Value::Integer(i)) => Some(i),
        _ => None,
    }
}

fn get_opt_text(row: &libsql::Row, idx: i32) -> Option<String> {
    match row.get_value(idx) {
        Ok(Value::Text(s)) => Some(s),
        _ => None,
    }
}

// ── TursoRegistry ─────────────────────────────────────────────────────────

/// Production Turso-backed announcement registry.
///
/// Thread-safe: `Arc<Database>` is `Send + Sync`. A fresh lightweight
/// `Connection` (HTTP session) is obtained per operation — the underlying
/// HTTP/2 client is reused internally by the libsql SDK.
pub struct TursoRegistry {
    db: Arc<Database>,
    /// LRU cache: view_tag → Vec<Announcement> for hot tag lookups.
    cache: Arc<RwLock<LruCache<u8, Vec<Announcement>>>>,
}

impl std::fmt::Debug for TursoRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TursoRegistry")
            .field("db", &"libsql::Database (Turso remote)")
            .finish()
    }
}

impl TursoRegistry {
    /// Connects to a remote Turso database and runs schema migrations.
    pub async fn new(url: &str, auth_token: &str) -> Result<Self> {
        let db = Builder::new_remote(url.to_string(), auth_token.to_string())
            .build()
            .await
            .map_err(|e| SpecterError::RegistryError(format!("Turso connect failed: {e}")))?;

        let registry = Self {
            db: Arc::new(db),
            cache: Arc::new(RwLock::new(LruCache::new(
                NonZeroUsize::new(256).unwrap(), // one slot per possible view tag
            ))),
        };

        registry.init_schema().await?;
        Ok(registry)
    }

    /// Returns a clone of the shared database handle (for scan/yellow stores).
    pub fn database(&self) -> Arc<Database> {
        self.db.clone()
    }

    /// Open a fresh logical connection (lightweight — reuses HTTP/2 client).
    fn conn(&self) -> Result<Connection> {
        self.db
            .connect()
            .map_err(|e| SpecterError::RegistryError(format!("get connection: {e}")))
    }

    // ── schema ───────────────────────────────────────────────────────────

    async fn init_schema(&self) -> Result<()> {
        let conn = self.conn()?;

        for statement in schema::SCHEMA_STATEMENTS {
            conn.execute(statement, ())
                .await
                .map_err(|e| {
                    SpecterError::RegistryError(format!("Schema init: {e}\nSQL: {statement}"))
                })?;
        }

        // Seed metadata on first run
        let mut rows = conn
            .query(
                "SELECT COUNT(*) FROM registry_metadata WHERE key = 'schema_version'",
                (),
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("metadata check: {e}")))?;

        let count: i64 = rows
            .next()
            .await
            .map_err(|e| SpecterError::RegistryError(format!("metadata row: {e}")))?
            .map(|r| r.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);

        if count == 0 {
            let now = unix_now();

            conn.execute(
                "INSERT OR IGNORE INTO registry_metadata (key, value) VALUES (?1, ?2)",
                params![schema::SCHEMA_VERSION.to_string(), schema::SCHEMA_VERSION.to_string()],
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("seed version: {e}")))?;

            conn.execute(
                "INSERT OR IGNORE INTO registry_metadata (key, value) VALUES (?1, ?2)",
                params!["db_initialized_at", now.to_string()],
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("seed init_at: {e}")))?;

            info!(
                "Turso registry initialized (schema v{})",
                schema::SCHEMA_VERSION
            );
        }

        Ok(())
    }

    // ── public helpers ───────────────────────────────────────────────────

    /// Verifies database connectivity.
    pub async fn health_check(&self) -> Result<()> {
        let conn = self.conn()?;
        conn.query("SELECT 1", ())
            .await
            .map_err(|e| SpecterError::RegistryError(format!("health check: {e}")))?;
        Ok(())
    }

    /// No-op for Turso — the remote database is always durable.
    pub async fn flush(&self) -> Result<()> {
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
        let conn = self.conn()?;
        let mut rows = conn
            .query(
                "SELECT id, view_tag, timestamp, ephemeral_key, channel_id, \
                        block_number, tx_hash, amount, chain \
                 FROM announcements ORDER BY id",
                (),
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("fetch all: {e}")))?;

        collect_announcements(&mut rows).await
    }

    /// Computes live statistics from the database.
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
        let conn = self.conn()?;

        let total_count = query_i64(&conn, "SELECT COUNT(*) FROM announcements", ()).await?;

        let mut ts_rows = conn
            .query(
                "SELECT MIN(timestamp), MAX(timestamp) FROM announcements",
                (),
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("stats ts: {e}")))?;

        let (earliest, latest) = match ts_rows
            .next()
            .await
            .map_err(|e| SpecterError::RegistryError(format!("stats ts row: {e}")))?
        {
            Some(row) => (get_opt_int(&row, 0), get_opt_int(&row, 1)),
            None => (None, None),
        };

        let yellow_count = query_i64(
            &conn,
            "SELECT COUNT(*) FROM announcements WHERE channel_id IS NOT NULL",
            (),
        )
        .await?;

        let mut dist_rows = conn
            .query(
                "SELECT view_tag, COUNT(*) FROM announcements GROUP BY view_tag",
                (),
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("stats dist: {e}")))?;

        let mut distribution = vec![0u64; 256];
        while let Some(row) = dist_rows
            .next()
            .await
            .map_err(|e| SpecterError::RegistryError(format!("stats dist row: {e}")))?
        {
            let tag: i64 = row.get(0).unwrap_or(0);
            let cnt: i64 = row.get(1).unwrap_or(0);
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

    /// Bulk import (migration helper). Skips rows that violate constraints.
    pub async fn import(&self, announcements: Vec<Announcement>) -> Result<usize> {
        let mut imported = 0usize;
        for ann in announcements {
            match self.insert_announcement(&ann).await {
                Ok(_) => imported += 1,
                Err(e) => debug!("import skip (id={}): {e}", ann.id),
            }
        }
        self.cache.write().await.clear();
        info!("Imported {imported} announcements into Turso");
        Ok(imported)
    }

    // ── internal ─────────────────────────────────────────────────────────

    async fn insert_announcement(&self, ann: &Announcement) -> Result<u64> {
        let conn = self.conn()?;

        conn.execute(
            "INSERT INTO announcements \
             (view_tag, timestamp, ephemeral_key, channel_id, block_number, tx_hash, amount, chain) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            vec![
                Value::Integer(ann.view_tag as i64),
                Value::Integer(ann.timestamp as i64),
                Value::Blob(ann.ephemeral_key.clone()),
                opt_blob(ann.channel_id.map(|c| c.to_vec())),
                opt_int(ann.block_number.map(|b| b as i64)),
                opt_text(ann.tx_hash.clone()),
                opt_text(ann.amount.clone()),
                opt_text(ann.chain.clone()),
            ],
        )
        .await
        .map_err(|e| SpecterError::RegistryError(format!("insert: {e}")))?;

        Ok(conn.last_insert_rowid() as u64)
    }

    fn normalize_tx_hash(hash: &str) -> String {
        hash.trim().to_lowercase()
    }

    // ── test constructor (local file-backed, requires "core" feature) ────────
    //
    // NOTE: libsql local in-memory databases are per-connection — each
    // `db.connect()` call would get a blank DB. We use a unique temp file so
    // all connections share the same persistent schema.

    #[cfg(test)]
    pub async fn new_test() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("specter_test_{n}.db"));

        let db = Builder::new_local(&path)
            .build()
            .await
            .expect("local test DB");
        let registry = Self {
            db: Arc::new(db),
            cache: Arc::new(RwLock::new(LruCache::new(
                NonZeroUsize::new(256).unwrap(),
            ))),
        };
        registry.init_schema().await.expect("schema init");
        registry
    }
}

// ── AnnouncementRegistry impl ─────────────────────────────────────────────

#[async_trait]
impl AnnouncementRegistry for TursoRegistry {
    async fn publish(&self, mut announcement: Announcement) -> Result<u64> {
        announcement.validate()?;

        if let Some(ref hash) = announcement.tx_hash {
            let normalized = Self::normalize_tx_hash(hash);

            if normalized.is_empty() {
                return Err(SpecterError::InvalidAnnouncement(
                    "tx_hash cannot be empty".into(),
                ));
            }

            // Reject duplicate tx_hash
            let conn = self.conn()?;
            let mut rows = conn
                .query(
                    "SELECT id FROM announcements WHERE tx_hash = ?1 LIMIT 1",
                    params![normalized.clone()],
                )
                .await
                .map_err(|e| SpecterError::RegistryError(format!("dup check: {e}")))?;

            if rows
                .next()
                .await
                .map_err(|e| SpecterError::RegistryError(format!("dup check row: {e}")))?
                .is_some()
            {
                return Err(SpecterError::InvalidAnnouncement(
                    "announcement with this transaction hash already exists".into(),
                ));
            }

            announcement.tx_hash = Some(normalized);
        }

        let id = self.insert_announcement(&announcement).await?;

        // Invalidate LRU cache for this view_tag
        self.cache.write().await.pop(&announcement.view_tag);

        debug!(
            id,
            view_tag = announcement.view_tag,
            "Published announcement (Turso)"
        );
        Ok(id)
    }

    async fn get_by_view_tag(&self, view_tag: u8) -> Result<Vec<Announcement>> {
        // Hot path: check LRU cache first
        {
            let cache = self.cache.read().await;
            if let Some(cached) = cache.peek(&view_tag) {
                return Ok(cached.clone());
            }
        }

        let conn = self.conn()?;
        let mut rows = conn
            .query(
                "SELECT id, view_tag, timestamp, ephemeral_key, channel_id, \
                        block_number, tx_hash, amount, chain \
                 FROM announcements WHERE view_tag = ?1 ORDER BY timestamp DESC",
                params![view_tag as i64],
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("get_by_view_tag: {e}")))?;

        let announcements = collect_announcements(&mut rows).await?;

        // Populate cache
        self.cache
            .write()
            .await
            .put(view_tag, announcements.clone());

        Ok(announcements)
    }

    async fn get_by_time_range(&self, start: u64, end: u64) -> Result<Vec<Announcement>> {
        let conn = self.conn()?;
        let mut rows = conn
            .query(
                "SELECT id, view_tag, timestamp, ephemeral_key, channel_id, \
                        block_number, tx_hash, amount, chain \
                 FROM announcements WHERE timestamp BETWEEN ?1 AND ?2 ORDER BY timestamp",
                params![start as i64, end as i64],
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("get_by_time_range: {e}")))?;

        collect_announcements(&mut rows).await
    }

    async fn get_by_id(&self, id: u64) -> Result<Option<Announcement>> {
        let conn = self.conn()?;
        let mut rows = conn
            .query(
                "SELECT id, view_tag, timestamp, ephemeral_key, channel_id, \
                        block_number, tx_hash, amount, chain \
                 FROM announcements WHERE id = ?1 LIMIT 1",
                params![id as i64],
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("get_by_id: {e}")))?;

        match rows
            .next()
            .await
            .map_err(|e| SpecterError::RegistryError(format!("get_by_id row: {e}")))?
        {
            Some(row) => Ok(Some(row_to_announcement(&row)?)),
            None => Ok(None),
        }
    }

    async fn count(&self) -> Result<u64> {
        let conn = self.conn()?;
        let n = query_i64(&conn, "SELECT COUNT(*) FROM announcements", ()).await?;
        Ok(n as u64)
    }

    async fn next_id(&self) -> Result<u64> {
        let conn = self.conn()?;
        let mut rows = conn
            .query("SELECT MAX(id) FROM announcements", ())
            .await
            .map_err(|e| SpecterError::RegistryError(format!("next_id: {e}")))?;

        let max_id = rows
            .next()
            .await
            .map_err(|e| SpecterError::RegistryError(format!("next_id row: {e}")))?
            .and_then(|r| get_opt_int(&r, 0));

        Ok(max_id.map(|m| (m + 1) as u64).unwrap_or(1))
    }
}

// ── row helpers ───────────────────────────────────────────────────────────

/// Map a libsql Row to an Announcement.
///
/// Column order must match every SELECT that fetches announcements:
///   0=id  1=view_tag  2=timestamp  3=ephemeral_key  4=channel_id
///   5=block_number  6=tx_hash  7=amount  8=chain
fn row_to_announcement(row: &libsql::Row) -> Result<Announcement> {
    let id: i64 = row
        .get(0)
        .map_err(|e| SpecterError::RegistryError(format!("row[id]: {e}")))?;
    let view_tag: i64 = row
        .get(1)
        .map_err(|e| SpecterError::RegistryError(format!("row[view_tag]: {e}")))?;
    let timestamp: i64 = row
        .get(2)
        .map_err(|e| SpecterError::RegistryError(format!("row[timestamp]: {e}")))?;
    let ephemeral_key: Vec<u8> = row
        .get(3)
        .map_err(|e| SpecterError::RegistryError(format!("row[ephemeral_key]: {e}")))?;

    let channel_id = get_opt_blob(row, 4).and_then(|b| {
        if b.len() == 32 {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&b);
            Some(arr)
        } else {
            None
        }
    });

    Ok(Announcement {
        id: id as u64,
        view_tag: view_tag as u8,
        timestamp: timestamp as u64,
        ephemeral_key,
        channel_id,
        block_number: get_opt_int(row, 5).map(|b| b as u64),
        tx_hash: get_opt_text(row, 6),
        amount: get_opt_text(row, 7),
        chain: get_opt_text(row, 8),
    })
}

/// Drain a `Rows` cursor into a `Vec<Announcement>`.
async fn collect_announcements(rows: &mut libsql::Rows) -> Result<Vec<Announcement>> {
    let mut out = Vec::new();
    while let Some(row) = rows
        .next()
        .await
        .map_err(|e| SpecterError::RegistryError(format!("row iter: {e}")))?
    {
        out.push(row_to_announcement(&row)?);
    }
    Ok(out)
}

/// Execute a query that returns a single `i64` from column 0.
async fn query_i64(conn: &Connection, sql: &str, params: impl libsql::params::IntoParams) -> Result<i64> {
    let mut rows = conn
        .query(sql, params)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("query_i64 ({sql}): {e}")))?;

    Ok(rows
        .next()
        .await
        .map_err(|e| SpecterError::RegistryError(format!("query_i64 row: {e}")))?
        .map(|r| r.get::<i64>(0).unwrap_or(0))
        .unwrap_or(0))
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ── tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::constants::KYBER_CIPHERTEXT_SIZE;

    fn make_ann(view_tag: u8) -> Announcement {
        Announcement::new(vec![0x42u8; KYBER_CIPHERTEXT_SIZE], view_tag)
    }

    async fn setup() -> TursoRegistry {
        TursoRegistry::new_test().await
    }

    #[tokio::test]
    async fn test_publish_and_get_by_id() {
        let reg = setup().await;
        let id = reg.publish(make_ann(0x42)).await.unwrap();
        assert!(id > 0);
        let r = reg.get_by_id(id).await.unwrap().unwrap();
        assert_eq!(r.view_tag, 0x42);
        assert_eq!(r.id, id);
    }

    #[tokio::test]
    async fn test_get_by_view_tag() {
        let reg = setup().await;
        reg.publish(make_ann(0x42)).await.unwrap();
        reg.publish(make_ann(0x42)).await.unwrap();
        reg.publish(make_ann(0x00)).await.unwrap();

        assert_eq!(reg.get_by_view_tag(0x42).await.unwrap().len(), 2);
        assert_eq!(reg.get_by_view_tag(0x00).await.unwrap().len(), 1);
        assert!(reg.get_by_view_tag(0xFF).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_by_time_range() {
        let reg = setup().await;

        let mut a1 = make_ann(0x01);
        a1.timestamp = 100;
        reg.publish(a1).await.unwrap();

        let mut a2 = make_ann(0x02);
        a2.timestamp = 200;
        reg.publish(a2).await.unwrap();

        let mut a3 = make_ann(0x03);
        a3.timestamp = 300;
        reg.publish(a3).await.unwrap();

        let r = reg.get_by_time_range(150, 250).await.unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].view_tag, 0x02);
    }

    #[tokio::test]
    async fn test_count_and_next_id() {
        let reg = setup().await;
        assert_eq!(reg.count().await.unwrap(), 0);
        assert_eq!(reg.next_id().await.unwrap(), 1);
        reg.publish(make_ann(0x01)).await.unwrap();
        assert_eq!(reg.count().await.unwrap(), 1);
        let id2 = reg.publish(make_ann(0x02)).await.unwrap();
        assert_eq!(reg.count().await.unwrap(), 2);
        assert_eq!(reg.next_id().await.unwrap(), id2 + 1);
    }

    #[tokio::test]
    async fn test_duplicate_tx_hash_rejected() {
        let reg = setup().await;
        let mut a = make_ann(0x42);
        a.tx_hash = Some("0xabc123".into());
        reg.publish(a).await.unwrap();

        let mut dup = make_ann(0x42);
        dup.tx_hash = Some("0xABC123".into()); // normalized = same
        assert!(reg.publish(dup).await.is_err());
    }

    #[tokio::test]
    async fn test_channel_id_roundtrip() {
        let reg = setup().await;
        let ch = [0xCC; 32];
        let ann = Announcement::with_channel(vec![0x42u8; KYBER_CIPHERTEXT_SIZE], 0x01, ch);
        let id = reg.publish(ann).await.unwrap();
        let r = reg.get_by_id(id).await.unwrap().unwrap();
        assert_eq!(r.channel_id, Some(ch));
    }

    #[tokio::test]
    async fn test_stats() {
        let reg = setup().await;
        reg.publish(make_ann(0x42)).await.unwrap();
        reg.publish(make_ann(0x42)).await.unwrap();
        reg.publish(make_ann(0x00)).await.unwrap();

        let s = reg.stats().await;
        assert_eq!(s.total_count, 3);
        assert_eq!(s.view_tag_distribution[0x42], 2);
        assert_eq!(s.view_tag_distribution[0x00], 1);
    }

    #[tokio::test]
    async fn test_all_announcements() {
        let reg = setup().await;
        reg.publish(make_ann(0x01)).await.unwrap();
        reg.publish(make_ann(0x02)).await.unwrap();
        assert_eq!(reg.all_announcements().await.len(), 2);
    }

    #[tokio::test]
    async fn test_import() {
        let reg = setup().await;
        let imported = reg
            .import(vec![make_ann(0x01), make_ann(0x02), make_ann(0x03)])
            .await
            .unwrap();
        assert_eq!(imported, 3);
        assert_eq!(reg.count().await.unwrap(), 3);
    }

    #[tokio::test]
    async fn test_health_check() {
        let reg = setup().await;
        assert!(reg.health_check().await.is_ok());
    }

    #[tokio::test]
    async fn test_ids_are_sequential() {
        let reg = setup().await;
        let id1 = reg.publish(make_ann(0x01)).await.unwrap();
        let id2 = reg.publish(make_ann(0x02)).await.unwrap();
        let id3 = reg.publish(make_ann(0x03)).await.unwrap();
        assert_eq!(id2, id1 + 1);
        assert_eq!(id3, id2 + 1);
    }

    #[tokio::test]
    async fn test_concurrent_publish() {
        let reg = Arc::new(setup().await);
        let mut tasks = tokio::task::JoinSet::new();
        for i in 0..50u8 {
            let r = reg.clone();
            tasks.spawn(async move { r.publish(make_ann(i)).await.unwrap() });
        }
        while let Some(r) = tasks.join_next().await {
            r.unwrap();
        }
        assert_eq!(reg.count().await.unwrap(), 50);
    }
}
