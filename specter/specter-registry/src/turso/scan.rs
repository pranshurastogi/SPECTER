//! Scanner checkpoint persistence (Turso-backed).
//!
//! Stores per-wallet scan progress so scans can resume incrementally
//! after process restarts or Cloud Run scale-to-zero events.

use std::sync::Arc;

use libsql::{params, Database, Value};
use serde::{Deserialize, Serialize};
use tracing::debug;

use specter_core::error::{Result, SpecterError};

/// A scanner checkpoint for one wallet.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ScanPosition {
    /// Resume scanning from announcements with id > this value.
    pub last_announcement_id: u64,
    /// Fallback timestamp (if id-based resume isn't possible).
    pub last_timestamp: u64,
    /// Cumulative announcements scanned.
    pub total_scanned: u64,
    /// Cumulative discoveries found.
    pub total_discoveries: u64,
    /// Duration of last scan in milliseconds.
    pub scan_duration_ms: Option<u64>,
    /// Number of scan errors encountered.
    pub error_count: u64,
    /// Last error message (for diagnostics).
    pub last_error: Option<String>,
    /// Unix timestamp of last successful scan.
    pub last_scan_at: Option<u64>,
}

/// Durable scan-position storage backed by Turso.
pub struct ScanPositionStore {
    db: Arc<Database>,
}

impl ScanPositionStore {
    /// Creates a store using the shared database handle.
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    fn conn(&self) -> Result<libsql::Connection> {
        self.db
            .connect()
            .map_err(|e| SpecterError::RegistryError(format!("scan conn: {e}")))
    }

    /// Load the checkpoint for `wallet_id`. Returns `None` if no prior scan.
    pub async fn load(&self, wallet_id: &str) -> Result<Option<ScanPosition>> {
        let conn = self.conn()?;
        let mut rows = conn
            .query(
                "SELECT last_announcement_id, last_timestamp, total_scanned, total_discoveries, \
                        scan_duration_ms, error_count, last_error, last_scan_at \
                 FROM scan_positions WHERE wallet_id = ?1 LIMIT 1",
                params![wallet_id],
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("scan load: {e}")))?;

        let row = rows
            .next()
            .await
            .map_err(|e| SpecterError::RegistryError(format!("scan load row: {e}")))?;

        Ok(row.map(|r| ScanPosition {
            last_announcement_id: r.get::<i64>(0).unwrap_or(0) as u64,
            last_timestamp:       r.get::<i64>(1).unwrap_or(0) as u64,
            total_scanned:        r.get::<i64>(2).unwrap_or(0) as u64,
            total_discoveries:    r.get::<i64>(3).unwrap_or(0) as u64,
            scan_duration_ms: opt_int_col(&r, 4).map(|v| v as u64),
            error_count:      r.get::<i64>(5).unwrap_or(0) as u64,
            last_error:       opt_text_col(&r, 6),
            last_scan_at:     opt_int_col(&r, 7).map(|v| v as u64),
        }))
    }

    /// Upsert a checkpoint for `wallet_id`.
    pub async fn save(&self, wallet_id: &str, position: &ScanPosition) -> Result<()> {
        let now = unix_now();
        let conn = self.conn()?;

        conn.execute(
            "INSERT INTO scan_positions \
             (wallet_id, last_announcement_id, last_timestamp, total_scanned, \
              total_discoveries, scan_duration_ms, error_count, last_error, last_scan_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
             ON CONFLICT(wallet_id) DO UPDATE SET \
              last_announcement_id = excluded.last_announcement_id, \
              last_timestamp       = excluded.last_timestamp, \
              total_scanned        = excluded.total_scanned, \
              total_discoveries    = excluded.total_discoveries, \
              scan_duration_ms     = excluded.scan_duration_ms, \
              error_count          = excluded.error_count, \
              last_error           = excluded.last_error, \
              last_scan_at         = excluded.last_scan_at, \
              updated_at           = excluded.updated_at",
            vec![
                Value::Text(wallet_id.to_string()),
                Value::Integer(position.last_announcement_id as i64),
                Value::Integer(position.last_timestamp as i64),
                Value::Integer(position.total_scanned as i64),
                Value::Integer(position.total_discoveries as i64),
                position
                    .scan_duration_ms
                    .map(|v| Value::Integer(v as i64))
                    .unwrap_or(Value::Null),
                Value::Integer(position.error_count as i64),
                position
                    .last_error
                    .clone()
                    .map(Value::Text)
                    .unwrap_or(Value::Null),
                Value::Integer(position.last_scan_at.unwrap_or(now) as i64),
                Value::Integer(now as i64),
            ],
        )
        .await
        .map_err(|e| SpecterError::RegistryError(format!("scan save: {e}")))?;

        debug!(
            wallet_id,
            last_id = position.last_announcement_id,
            discoveries = position.total_discoveries,
            "Saved scan checkpoint"
        );
        Ok(())
    }

    /// Delete a checkpoint.
    pub async fn delete(&self, wallet_id: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "DELETE FROM scan_positions WHERE wallet_id = ?1",
            params![wallet_id],
        )
        .await
        .map_err(|e| SpecterError::RegistryError(format!("scan delete: {e}")))?;
        Ok(())
    }

    /// List all checkpoints (admin/diagnostics).
    pub async fn list_all(&self) -> Result<Vec<(String, ScanPosition)>> {
        let conn = self.conn()?;
        let mut rows = conn
            .query(
                "SELECT wallet_id, last_announcement_id, last_timestamp, total_scanned, \
                        total_discoveries, scan_duration_ms, error_count, last_error, last_scan_at \
                 FROM scan_positions ORDER BY updated_at DESC",
                (),
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("scan list: {e}")))?;

        let mut out = Vec::new();
        while let Some(r) = rows
            .next()
            .await
            .map_err(|e| SpecterError::RegistryError(format!("scan list row: {e}")))?
        {
            let wallet_id: String = r.get(0).unwrap_or_default();
            let pos = ScanPosition {
                last_announcement_id: r.get::<i64>(1).unwrap_or(0) as u64,
                last_timestamp:       r.get::<i64>(2).unwrap_or(0) as u64,
                total_scanned:        r.get::<i64>(3).unwrap_or(0) as u64,
                total_discoveries:    r.get::<i64>(4).unwrap_or(0) as u64,
                scan_duration_ms: opt_int_col(&r, 5).map(|v| v as u64),
                error_count:      r.get::<i64>(6).unwrap_or(0) as u64,
                last_error:       opt_text_col(&r, 7),
                last_scan_at:     opt_int_col(&r, 8).map(|v| v as u64),
            };
            out.push((wallet_id, pos));
        }
        Ok(out)
    }
}

// ── row helpers ───────────────────────────────────────────────────────────

fn opt_int_col(row: &libsql::Row, idx: i32) -> Option<i64> {
    match row.get_value(idx) {
        Ok(Value::Integer(i)) => Some(i),
        _ => None,
    }
}

fn opt_text_col(row: &libsql::Row, idx: i32) -> Option<String> {
    match row.get_value(idx) {
        Ok(Value::Text(s)) => Some(s),
        _ => None,
    }
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
    use crate::turso::TursoRegistry;

    async fn setup() -> (TursoRegistry, ScanPositionStore) {
        let reg = TursoRegistry::new_test().await;
        let store = ScanPositionStore::new(reg.database());
        (reg, store)
    }

    #[tokio::test]
    async fn test_save_and_load() {
        let (_reg, store) = setup().await;
        let pos = ScanPosition {
            last_announcement_id: 100,
            last_timestamp: 1234567890,
            total_scanned: 500,
            total_discoveries: 10,
            scan_duration_ms: Some(1234),
            error_count: 0,
            last_error: None,
            last_scan_at: Some(1234567890),
        };
        store.save("wallet_abc", &pos).await.unwrap();
        let loaded = store.load("wallet_abc").await.unwrap().unwrap();
        assert_eq!(loaded.last_announcement_id, 100);
        assert_eq!(loaded.total_scanned, 500);
        assert_eq!(loaded.scan_duration_ms, Some(1234));
    }

    #[tokio::test]
    async fn test_load_nonexistent() {
        let (_reg, store) = setup().await;
        assert!(store.load("nonexistent").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_upsert() {
        let (_reg, store) = setup().await;
        store
            .save("w", &ScanPosition { last_announcement_id: 50, total_scanned: 50, ..Default::default() })
            .await
            .unwrap();
        store
            .save("w", &ScanPosition { last_announcement_id: 100, total_scanned: 100, total_discoveries: 5, ..Default::default() })
            .await
            .unwrap();
        let loaded = store.load("w").await.unwrap().unwrap();
        assert_eq!(loaded.last_announcement_id, 100);
        assert_eq!(loaded.total_discoveries, 5);
    }

    #[tokio::test]
    async fn test_delete() {
        let (_reg, store) = setup().await;
        store.save("del", &ScanPosition::default()).await.unwrap();
        assert!(store.load("del").await.unwrap().is_some());
        store.delete("del").await.unwrap();
        assert!(store.load("del").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_list_all() {
        let (_reg, store) = setup().await;
        store.save("w1", &ScanPosition::default()).await.unwrap();
        store.save("w2", &ScanPosition::default()).await.unwrap();
        assert_eq!(store.list_all().await.unwrap().len(), 2);
    }
}
