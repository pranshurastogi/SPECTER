//! Yellow channel lifecycle persistence.
//!
//! Durably tracks channel creation, status transitions, and closure.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tracing::{debug, info};

use specter_core::error::{Result, SpecterError};

/// A durable Yellow channel record.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[allow(missing_docs)]
pub struct YellowChannelRecord {
    pub id: u64,
    pub channel_id: Vec<u8>,
    pub status: String,
    pub created_at: u64,
    pub closed_at: Option<u64>,
    pub creator_wallet: Option<String>,
    pub chain: Option<String>,
    pub asset_address: Option<String>,
    pub asset_symbol: Option<String>,
    pub amount: String,
    pub announcement_id: Option<u64>,
    pub funding_tx_hash: Option<String>,
    pub closing_tx_hash: Option<String>,
    pub error_reason: Option<String>,
    pub metadata: Option<String>,
}

/// Durable Yellow channel store backed by SQLite.
pub struct YellowChannelStore {
    pool: SqlitePool,
}

impl YellowChannelStore {
    /// Creates a store using the given connection pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Insert a new open channel.
    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        &self,
        channel_id: &[u8],
        creator_wallet: &str,
        chain: &str,
        asset_address: Option<&str>,
        asset_symbol: Option<&str>,
        amount: &str,
        announcement_id: Option<u64>,
    ) -> Result<u64> {
        let result = sqlx::query(
            "INSERT INTO yellow_channels \
             (channel_id, status, creator_wallet, chain, asset_address, asset_symbol, amount, announcement_id) \
             VALUES (?, 'open', ?, ?, ?, ?, ?, ?)",
        )
        .bind(channel_id)
        .bind(creator_wallet)
        .bind(chain)
        .bind(asset_address)
        .bind(asset_symbol)
        .bind(amount)
        .bind(announcement_id.map(|id| id as i64))
        .execute(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("yellow create: {e}")))?;

        let id = result.last_insert_rowid() as u64;
        info!(id, "Created yellow channel record");
        Ok(id)
    }

    /// Get a channel by its 32-byte channel_id.
    pub async fn get(&self, channel_id: &[u8]) -> Result<Option<YellowChannelRecord>> {
        let row = sqlx::query(
            "SELECT id, channel_id, status, created_at, closed_at, creator_wallet, \
                    chain, asset_address, asset_symbol, amount, announcement_id, \
                    funding_tx_hash, closing_tx_hash, error_reason, metadata \
             FROM yellow_channels WHERE channel_id = ? LIMIT 1",
        )
        .bind(channel_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("yellow get: {e}")))?;

        Ok(row.as_ref().map(row_to_channel))
    }

    /// Update channel status.
    pub async fn update_status(&self, channel_id: &[u8], status: &str) -> Result<()> {
        sqlx::query(
            "UPDATE yellow_channels \
             SET status = ?, updated_at = strftime('%s', 'now') \
             WHERE channel_id = ?",
        )
        .bind(status)
        .bind(channel_id)
        .execute(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("yellow update_status: {e}")))?;

        debug!("Updated channel status to {status}");
        Ok(())
    }

    /// Set funding tx hash.
    pub async fn set_funding_tx(&self, channel_id: &[u8], tx_hash: &str) -> Result<()> {
        sqlx::query(
            "UPDATE yellow_channels \
             SET funding_tx_hash = ?, updated_at = strftime('%s', 'now') \
             WHERE channel_id = ?",
        )
        .bind(tx_hash)
        .bind(channel_id)
        .execute(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("yellow set_funding_tx: {e}")))?;
        Ok(())
    }

    /// Close a channel (sets status to 'closed' or 'error').
    pub async fn close(
        &self,
        channel_id: &[u8],
        closing_tx_hash: Option<&str>,
        error_reason: Option<&str>,
    ) -> Result<()> {
        let status = if error_reason.is_some() {
            "error"
        } else {
            "closed"
        };

        sqlx::query(
            "UPDATE yellow_channels \
             SET status = ?, closed_at = strftime('%s', 'now'), \
                 closing_tx_hash = ?, error_reason = ?, \
                 updated_at = strftime('%s', 'now') \
             WHERE channel_id = ?",
        )
        .bind(status)
        .bind(closing_tx_hash)
        .bind(error_reason)
        .bind(channel_id)
        .execute(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("yellow close: {e}")))?;

        info!("Closed channel with status={status}");
        Ok(())
    }

    /// List all open channels.
    pub async fn list_open(&self) -> Result<Vec<YellowChannelRecord>> {
        let rows = sqlx::query(
            "SELECT id, channel_id, status, created_at, closed_at, creator_wallet, \
                    chain, asset_address, asset_symbol, amount, announcement_id, \
                    funding_tx_hash, closing_tx_hash, error_reason, metadata \
             FROM yellow_channels WHERE status = 'open' ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("yellow list_open: {e}")))?;

        Ok(rows.iter().map(row_to_channel).collect())
    }

    /// List all channels (any status).
    pub async fn list_all(&self) -> Result<Vec<YellowChannelRecord>> {
        let rows = sqlx::query(
            "SELECT id, channel_id, status, created_at, closed_at, creator_wallet, \
                    chain, asset_address, asset_symbol, amount, announcement_id, \
                    funding_tx_hash, closing_tx_hash, error_reason, metadata \
             FROM yellow_channels ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| SpecterError::RegistryError(format!("yellow list_all: {e}")))?;

        Ok(rows.iter().map(row_to_channel).collect())
    }
}

fn row_to_channel(row: &sqlx::sqlite::SqliteRow) -> YellowChannelRecord {
    YellowChannelRecord {
        id: row.get::<i64, _>("id") as u64,
        channel_id: row.get("channel_id"),
        status: row.get("status"),
        created_at: row.get::<i64, _>("created_at") as u64,
        closed_at: row.get::<Option<i64>, _>("closed_at").map(|v| v as u64),
        creator_wallet: row.get("creator_wallet"),
        chain: row.get("chain"),
        asset_address: row.get("asset_address"),
        asset_symbol: row.get("asset_symbol"),
        amount: row.get("amount"),
        announcement_id: row
            .get::<Option<i64>, _>("announcement_id")
            .map(|v| v as u64),
        funding_tx_hash: row.get("funding_tx_hash"),
        closing_tx_hash: row.get("closing_tx_hash"),
        error_reason: row.get("error_reason"),
        metadata: row.get("metadata"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::SqliteRegistry;

    async fn setup() -> (SqliteRegistry, YellowChannelStore) {
        let reg = SqliteRegistry::new(":memory:").await.unwrap();
        let store = YellowChannelStore::new(reg.pool());
        (reg, store)
    }

    #[tokio::test]
    async fn test_create_and_get() {
        let (_reg, store) = setup().await;
        let ch_id = vec![0xAA; 32];

        let id = store
            .create(&ch_id, "0xwallet", "ethereum", None, None, "1000000", None)
            .await
            .unwrap();
        assert!(id > 0);

        let record = store.get(&ch_id).await.unwrap().unwrap();
        assert_eq!(record.status, "open");
        assert_eq!(record.amount, "1000000");
        assert_eq!(record.creator_wallet, Some("0xwallet".into()));
    }

    #[tokio::test]
    async fn test_get_nonexistent() {
        let (_reg, store) = setup().await;
        let result = store.get(&[0x00; 32]).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_status_lifecycle() {
        let (_reg, store) = setup().await;
        let ch_id = vec![0xBB; 32];

        store
            .create(&ch_id, "0xwallet", "ethereum", None, None, "500", None)
            .await
            .unwrap();

        // Open -> closing
        store.update_status(&ch_id, "closing").await.unwrap();
        let r = store.get(&ch_id).await.unwrap().unwrap();
        assert_eq!(r.status, "closing");

        // Close normally
        store.close(&ch_id, Some("0xtx123"), None).await.unwrap();
        let r = store.get(&ch_id).await.unwrap().unwrap();
        assert_eq!(r.status, "closed");
        assert!(r.closed_at.is_some());
    }

    #[tokio::test]
    async fn test_close_with_error() {
        let (_reg, store) = setup().await;
        let ch_id = vec![0xCC; 32];

        store
            .create(&ch_id, "0xwallet", "ethereum", None, None, "100", None)
            .await
            .unwrap();

        store.close(&ch_id, None, Some("timeout")).await.unwrap();

        let r = store.get(&ch_id).await.unwrap().unwrap();
        assert_eq!(r.status, "error");
        assert_eq!(r.error_reason, Some("timeout".into()));
    }

    #[tokio::test]
    async fn test_list_open() {
        let (_reg, store) = setup().await;

        store
            .create(&[0x01; 32], "w1", "eth", None, None, "10", None)
            .await
            .unwrap();
        store
            .create(&[0x02; 32], "w2", "eth", None, None, "20", None)
            .await
            .unwrap();

        // Close one
        store.close(&[0x01; 32], None, None).await.unwrap();

        let open = store.list_open().await.unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].channel_id, vec![0x02; 32]);
    }

    #[tokio::test]
    async fn test_set_funding_tx() {
        let (_reg, store) = setup().await;
        let ch_id = vec![0xDD; 32];

        store
            .create(&ch_id, "w1", "eth", None, None, "100", None)
            .await
            .unwrap();

        store.set_funding_tx(&ch_id, "0xfund123").await.unwrap();
        let r = store.get(&ch_id).await.unwrap().unwrap();
        assert_eq!(r.funding_tx_hash, Some("0xfund123".into()));
    }
}
