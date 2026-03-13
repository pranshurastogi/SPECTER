//! Yellow channel lifecycle persistence (Turso-backed).
//!
//! Durably tracks channel creation, status transitions, and closure.
//! Data survives Cloud Run restarts and scale-to-zero events.

use std::sync::Arc;

use libsql::{params, Database, Value};
use serde::{Deserialize, Serialize};
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

/// Durable Yellow channel store backed by Turso.
pub struct YellowChannelStore {
    db: Arc<Database>,
}

impl YellowChannelStore {
    /// Creates a store using the shared database handle.
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    fn conn(&self) -> Result<libsql::Connection> {
        self.db
            .connect()
            .map_err(|e| SpecterError::RegistryError(format!("yellow conn: {e}")))
    }

    /// Insert a new open channel record.
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
        let conn = self.conn()?;

        conn.execute(
            "INSERT INTO yellow_channels \
             (channel_id, status, creator_wallet, chain, asset_address, asset_symbol, amount, announcement_id) \
             VALUES (?1, 'open', ?2, ?3, ?4, ?5, ?6, ?7)",
            vec![
                Value::Blob(channel_id.to_vec()),
                Value::Text(creator_wallet.to_string()),
                Value::Text(chain.to_string()),
                asset_address.map(|s| Value::Text(s.to_string())).unwrap_or(Value::Null),
                asset_symbol.map(|s| Value::Text(s.to_string())).unwrap_or(Value::Null),
                Value::Text(amount.to_string()),
                announcement_id.map(|id| Value::Integer(id as i64)).unwrap_or(Value::Null),
            ],
        )
        .await
        .map_err(|e| SpecterError::RegistryError(format!("yellow create: {e}")))?;

        let id = conn.last_insert_rowid() as u64;
        info!(id, "Created Yellow channel record");
        Ok(id)
    }

    /// Get a channel by its 32-byte channel_id blob.
    pub async fn get(&self, channel_id: &[u8]) -> Result<Option<YellowChannelRecord>> {
        let conn = self.conn()?;
        let mut rows = conn
            .query(
                "SELECT id, channel_id, status, created_at, closed_at, creator_wallet, \
                        chain, asset_address, asset_symbol, amount, announcement_id, \
                        funding_tx_hash, closing_tx_hash, error_reason, metadata \
                 FROM yellow_channels WHERE channel_id = ?1 LIMIT 1",
                params![channel_id.to_vec()],
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("yellow get: {e}")))?;

        let row = rows
            .next()
            .await
            .map_err(|e| SpecterError::RegistryError(format!("yellow get row: {e}")))?;

        Ok(row.as_ref().map(row_to_channel))
    }

    /// Update channel status (e.g. open → closing → closed/error).
    pub async fn update_status(&self, channel_id: &[u8], status: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE yellow_channels \
             SET status = ?1, updated_at = strftime('%s', 'now') \
             WHERE channel_id = ?2",
            vec![
                Value::Text(status.to_string()),
                Value::Blob(channel_id.to_vec()),
            ],
        )
        .await
        .map_err(|e| SpecterError::RegistryError(format!("yellow update_status: {e}")))?;

        debug!("Updated yellow channel status to {status}");
        Ok(())
    }

    /// Record the on-chain funding transaction hash.
    pub async fn set_funding_tx(&self, channel_id: &[u8], tx_hash: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE yellow_channels \
             SET funding_tx_hash = ?1, updated_at = strftime('%s', 'now') \
             WHERE channel_id = ?2",
            vec![
                Value::Text(tx_hash.to_string()),
                Value::Blob(channel_id.to_vec()),
            ],
        )
        .await
        .map_err(|e| SpecterError::RegistryError(format!("yellow set_funding_tx: {e}")))?;
        Ok(())
    }

    /// Mark a channel closed or errored.
    pub async fn close(
        &self,
        channel_id: &[u8],
        closing_tx_hash: Option<&str>,
        error_reason: Option<&str>,
    ) -> Result<()> {
        let status = if error_reason.is_some() { "error" } else { "closed" };
        let conn = self.conn()?;

        conn.execute(
            "UPDATE yellow_channels \
             SET status = ?1, closed_at = strftime('%s', 'now'), \
                 closing_tx_hash = ?2, error_reason = ?3, \
                 updated_at = strftime('%s', 'now') \
             WHERE channel_id = ?4",
            vec![
                Value::Text(status.to_string()),
                closing_tx_hash.map(|s| Value::Text(s.to_string())).unwrap_or(Value::Null),
                error_reason.map(|s| Value::Text(s.to_string())).unwrap_or(Value::Null),
                Value::Blob(channel_id.to_vec()),
            ],
        )
        .await
        .map_err(|e| SpecterError::RegistryError(format!("yellow close: {e}")))?;

        info!("Closed Yellow channel (status={status})");
        Ok(())
    }

    /// List all open channels ordered by creation time.
    pub async fn list_open(&self) -> Result<Vec<YellowChannelRecord>> {
        let conn = self.conn()?;
        let mut rows = conn
            .query(
                "SELECT id, channel_id, status, created_at, closed_at, creator_wallet, \
                        chain, asset_address, asset_symbol, amount, announcement_id, \
                        funding_tx_hash, closing_tx_hash, error_reason, metadata \
                 FROM yellow_channels WHERE status = 'open' ORDER BY created_at DESC",
                (),
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("yellow list_open: {e}")))?;

        collect_channels(&mut rows).await
    }

    /// List all channels regardless of status.
    pub async fn list_all(&self) -> Result<Vec<YellowChannelRecord>> {
        let conn = self.conn()?;
        let mut rows = conn
            .query(
                "SELECT id, channel_id, status, created_at, closed_at, creator_wallet, \
                        chain, asset_address, asset_symbol, amount, announcement_id, \
                        funding_tx_hash, closing_tx_hash, error_reason, metadata \
                 FROM yellow_channels ORDER BY created_at DESC",
                (),
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("yellow list_all: {e}")))?;

        collect_channels(&mut rows).await
    }
}

// ── row helpers ───────────────────────────────────────────────────────────

/// Column order must match every SELECT in this file:
///   0=id  1=channel_id  2=status  3=created_at  4=closed_at
///   5=creator_wallet  6=chain  7=asset_address  8=asset_symbol
///   9=amount  10=announcement_id  11=funding_tx_hash
///   12=closing_tx_hash  13=error_reason  14=metadata
fn row_to_channel(row: &libsql::Row) -> YellowChannelRecord {
    YellowChannelRecord {
        id:           row.get::<i64>(0).unwrap_or(0) as u64,
        channel_id:   row.get::<Vec<u8>>(1).unwrap_or_default(),
        status:       row.get::<String>(2).unwrap_or_default(),
        created_at:   row.get::<i64>(3).unwrap_or(0) as u64,
        closed_at:    opt_int_col(row, 4).map(|v| v as u64),
        creator_wallet: opt_text_col(row, 5),
        chain:          opt_text_col(row, 6),
        asset_address:  opt_text_col(row, 7),
        asset_symbol:   opt_text_col(row, 8),
        amount:         row.get::<String>(9).unwrap_or_default(),
        announcement_id: opt_int_col(row, 10).map(|v| v as u64),
        funding_tx_hash: opt_text_col(row, 11),
        closing_tx_hash: opt_text_col(row, 12),
        error_reason:    opt_text_col(row, 13),
        metadata:        opt_text_col(row, 14),
    }
}

async fn collect_channels(rows: &mut libsql::Rows) -> Result<Vec<YellowChannelRecord>> {
    let mut out = Vec::new();
    while let Some(row) = rows
        .next()
        .await
        .map_err(|e| SpecterError::RegistryError(format!("yellow row: {e}")))?
    {
        out.push(row_to_channel(&row));
    }
    Ok(out)
}

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

// ── tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::turso::TursoRegistry;

    async fn setup() -> (TursoRegistry, YellowChannelStore) {
        let reg = TursoRegistry::new_test().await;
        let store = YellowChannelStore::new(reg.database());
        (reg, store)
    }

    #[tokio::test]
    async fn test_create_and_get() {
        let (_reg, store) = setup().await;
        let ch = vec![0xAAu8; 32];
        let id = store.create(&ch, "0xwallet", "ethereum", None, None, "1000000", None).await.unwrap();
        assert!(id > 0);
        let r = store.get(&ch).await.unwrap().unwrap();
        assert_eq!(r.status, "open");
        assert_eq!(r.amount, "1000000");
    }

    #[tokio::test]
    async fn test_get_nonexistent() {
        let (_reg, store) = setup().await;
        assert!(store.get(&[0x00; 32]).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_status_lifecycle() {
        let (_reg, store) = setup().await;
        let ch = vec![0xBBu8; 32];
        store.create(&ch, "0xwallet", "ethereum", None, None, "500", None).await.unwrap();
        store.update_status(&ch, "closing").await.unwrap();
        assert_eq!(store.get(&ch).await.unwrap().unwrap().status, "closing");
        store.close(&ch, Some("0xtx123"), None).await.unwrap();
        let r = store.get(&ch).await.unwrap().unwrap();
        assert_eq!(r.status, "closed");
        assert!(r.closed_at.is_some());
    }

    #[tokio::test]
    async fn test_close_with_error() {
        let (_reg, store) = setup().await;
        let ch = vec![0xCCu8; 32];
        store.create(&ch, "0xwallet", "ethereum", None, None, "100", None).await.unwrap();
        store.close(&ch, None, Some("timeout")).await.unwrap();
        let r = store.get(&ch).await.unwrap().unwrap();
        assert_eq!(r.status, "error");
        assert_eq!(r.error_reason, Some("timeout".into()));
    }

    #[tokio::test]
    async fn test_list_open() {
        let (_reg, store) = setup().await;
        store.create(&[0x01; 32], "w1", "eth", None, None, "10", None).await.unwrap();
        store.create(&[0x02; 32], "w2", "eth", None, None, "20", None).await.unwrap();
        store.close(&[0x01; 32], None, None).await.unwrap();
        let open = store.list_open().await.unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].channel_id, vec![0x02; 32]);
    }

    #[tokio::test]
    async fn test_set_funding_tx() {
        let (_reg, store) = setup().await;
        let ch = vec![0xDDu8; 32];
        store.create(&ch, "w1", "eth", None, None, "100", None).await.unwrap();
        store.set_funding_tx(&ch, "0xfund123").await.unwrap();
        let r = store.get(&ch).await.unwrap().unwrap();
        assert_eq!(r.funding_tx_hash, Some("0xfund123".into()));
    }
}
