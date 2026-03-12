//! Scanner checkpoint persistence.
//!
//! Stores per-wallet scan progress so scans can resume incrementally
//! after process restarts.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
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

/// Durable scan-position storage backed by SQLite.
pub struct ScanPositionStore {
    pool: SqlitePool,
}

impl ScanPositionStore {
    /// Creates a store using the given connection pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Load the checkpoint for `wallet_id`. Returns `None` if no prior scan.
    pub async fn load(&self, wallet_id: &str) -> Result<Option<ScanPosition>> {
        let row = sqlx::query(
            "SELECT last_announcement_id, last_timestamp, total_scanned, total_discoveries, \
                    scan_duration_ms, error_count, last_error, last_scan_at \
             FROM scan_positions WHERE wallet_id = ? LIMIT 1",
        )
        .bind(wallet_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("scan load: {e}")))?;

        Ok(row.map(|r| ScanPosition {
            last_announcement_id: r.get::<i64, _>("last_announcement_id") as u64,
            last_timestamp: r.get::<i64, _>("last_timestamp") as u64,
            total_scanned: r.get::<i64, _>("total_scanned") as u64,
            total_discoveries: r.get::<i64, _>("total_discoveries") as u64,
            scan_duration_ms: r
                .get::<Option<i64>, _>("scan_duration_ms")
                .map(|v| v as u64),
            error_count: r.get::<i64, _>("error_count") as u64,
            last_error: r.get("last_error"),
            last_scan_at: r.get::<Option<i64>, _>("last_scan_at").map(|v| v as u64),
        }))
    }

    /// Save (upsert) a checkpoint for `wallet_id`.
    pub async fn save(&self, wallet_id: &str, position: &ScanPosition) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        sqlx::query(
            "INSERT INTO scan_positions \
             (wallet_id, last_announcement_id, last_timestamp, total_scanned, \
              total_discoveries, scan_duration_ms, error_count, last_error, last_scan_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
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
        )
        .bind(wallet_id)
        .bind(position.last_announcement_id as i64)
        .bind(position.last_timestamp as i64)
        .bind(position.total_scanned as i64)
        .bind(position.total_discoveries as i64)
        .bind(position.scan_duration_ms.map(|v| v as i64))
        .bind(position.error_count as i64)
        .bind(&position.last_error)
        .bind(position.last_scan_at.unwrap_or(now) as i64)
        .bind(now as i64)
        .execute(&self.pool)
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
        sqlx::query("DELETE FROM scan_positions WHERE wallet_id = ?")
            .bind(wallet_id)
            .execute(&self.pool)
            .await
            .map_err(|e| SpecterError::RegistryError(format!("scan delete: {e}")))?;
        Ok(())
    }

    /// List all checkpoints (for admin/diagnostics).
    pub async fn list_all(&self) -> Result<Vec<(String, ScanPosition)>> {
        let rows = sqlx::query(
            "SELECT wallet_id, last_announcement_id, last_timestamp, total_scanned, \
                    total_discoveries, scan_duration_ms, error_count, last_error, last_scan_at \
             FROM scan_positions ORDER BY updated_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("scan list: {e}")))?;

        Ok(rows
            .iter()
            .map(|r| {
                let wallet_id: String = r.get("wallet_id");
                let pos = ScanPosition {
                    last_announcement_id: r.get::<i64, _>("last_announcement_id") as u64,
                    last_timestamp: r.get::<i64, _>("last_timestamp") as u64,
                    total_scanned: r.get::<i64, _>("total_scanned") as u64,
                    total_discoveries: r.get::<i64, _>("total_discoveries") as u64,
                    scan_duration_ms: r
                        .get::<Option<i64>, _>("scan_duration_ms")
                        .map(|v| v as u64),
                    error_count: r.get::<i64, _>("error_count") as u64,
                    last_error: r.get("last_error"),
                    last_scan_at: r.get::<Option<i64>, _>("last_scan_at").map(|v| v as u64),
                };
                (wallet_id, pos)
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::SqliteRegistry;

    async fn setup() -> (SqliteRegistry, ScanPositionStore) {
        let reg = SqliteRegistry::new(":memory:").await.unwrap();
        let store = ScanPositionStore::new(reg.pool());
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
        assert_eq!(loaded.total_discoveries, 10);
        assert_eq!(loaded.scan_duration_ms, Some(1234));
    }

    #[tokio::test]
    async fn test_load_nonexistent() {
        let (_reg, store) = setup().await;
        let result = store.load("nonexistent").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_upsert() {
        let (_reg, store) = setup().await;

        let pos1 = ScanPosition {
            last_announcement_id: 50,
            total_scanned: 50,
            ..Default::default()
        };
        store.save("wallet_x", &pos1).await.unwrap();

        let pos2 = ScanPosition {
            last_announcement_id: 100,
            total_scanned: 100,
            total_discoveries: 5,
            ..Default::default()
        };
        store.save("wallet_x", &pos2).await.unwrap();

        let loaded = store.load("wallet_x").await.unwrap().unwrap();
        assert_eq!(loaded.last_announcement_id, 100);
        assert_eq!(loaded.total_discoveries, 5);
    }

    #[tokio::test]
    async fn test_delete() {
        let (_reg, store) = setup().await;
        store
            .save("wallet_del", &ScanPosition::default())
            .await
            .unwrap();
        assert!(store.load("wallet_del").await.unwrap().is_some());

        store.delete("wallet_del").await.unwrap();
        assert!(store.load("wallet_del").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_list_all() {
        let (_reg, store) = setup().await;
        store.save("w1", &ScanPosition::default()).await.unwrap();
        store.save("w2", &ScanPosition::default()).await.unwrap();

        let all = store.list_all().await.unwrap();
        assert_eq!(all.len(), 2);
    }
}
