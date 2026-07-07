//! Durable claim-flow history: the `sweep_records` table.
//!
//! One row per swept stealth address, grouped by `receipt_id`. Everything
//! stored here is public-after-broadcast data (addresses, amounts, tx hashes)
//! plus a pre-hashed identity key — no secret material ever reaches this
//! table. Inserts are idempotent on the client-supplied row `id`.

use std::sync::Arc;

use libsql::{params, Database, Value};
use specter_core::error::{Result, SpecterError};

/// A single sweep row (one stealth address → destination transfer).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SweepRecord {
    /// Client-generated UUID for this row (idempotency key).
    pub id: String,
    /// Groups the rows of one claim operation into a receipt.
    pub receipt_id: String,
    /// SHA-256 of the meta-address bytes, lowercase hex (64 chars).
    pub identity_hash: String,
    /// Backend chain name (e.g. "sepolia", "arbitrum", "monad-testnet").
    pub chain: String,
    /// Swept stealth address (0x…).
    pub stealth_address: String,
    /// Resolved destination address (0x…).
    pub destination: String,
    /// What the user typed (ENS name or the address itself).
    pub destination_input: String,
    /// Amount transferred, base units (wei) as a decimal string.
    pub amount_base: String,
    /// Network fee paid, base units (wei) as a decimal string.
    pub fee_base: String,
    /// Broadcast transaction hash (empty for skipped rows).
    pub tx_hash: String,
    /// "confirmed" | "failed" | "skipped_dust".
    pub status: String,
    /// Unix seconds (set by the DB on insert; 0 on input).
    pub created_at: i64,
}

/// Thin DB layer over the `sweep_records` table.
#[derive(Clone)]
pub struct SweepStore {
    db: Arc<Database>,
}

impl SweepStore {
    /// Wraps a shared `libsql::Database` handle (typically `TursoRegistry::database()`).
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    fn conn(&self) -> Result<libsql::Connection> {
        self.db
            .connect()
            .map_err(|e| SpecterError::RegistryError(format!("sweeps conn: {e}")))
    }

    /// Inserts a batch of sweep rows. Idempotent: rows whose `id` already
    /// exists are ignored. Returns the number of newly inserted rows.
    pub async fn insert_batch(&self, records: &[SweepRecord]) -> Result<u64> {
        let conn = self.conn()?;
        let mut inserted = 0u64;
        for r in records {
            conn.execute(
                "INSERT OR IGNORE INTO sweep_records \
                 (id, receipt_id, identity_hash, chain, stealth_address, destination, \
                  destination_input, amount_base, fee_base, tx_hash, status) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    r.id.clone(),
                    r.receipt_id.clone(),
                    r.identity_hash.clone(),
                    r.chain.clone(),
                    r.stealth_address.clone(),
                    r.destination.clone(),
                    r.destination_input.clone(),
                    r.amount_base.clone(),
                    r.fee_base.clone(),
                    r.tx_hash.clone(),
                    r.status.clone()
                ],
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("sweep insert: {e}")))?;
            inserted += conn.changes();
        }
        Ok(inserted)
    }

    /// Returns all sweep rows for an identity, newest first, capped at `limit`.
    pub async fn list_by_identity(
        &self,
        identity_hash: &str,
        limit: u64,
    ) -> Result<Vec<SweepRecord>> {
        let conn = self.conn()?;
        let mut rows = conn
            .query(
                "SELECT id, receipt_id, identity_hash, chain, stealth_address, destination, \
                        destination_input, amount_base, fee_base, tx_hash, status, created_at \
                 FROM sweep_records WHERE identity_hash = ?1 \
                 ORDER BY created_at DESC, id DESC LIMIT ?2",
                params![identity_hash.to_string(), limit as i64],
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("sweep list query: {e}")))?;

        let mut out = Vec::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| SpecterError::RegistryError(format!("sweep list row: {e}")))?
        {
            out.push(SweepRecord {
                id: text(&row, 0),
                receipt_id: text(&row, 1),
                identity_hash: text(&row, 2),
                chain: text(&row, 3),
                stealth_address: text(&row, 4),
                destination: text(&row, 5),
                destination_input: text(&row, 6),
                amount_base: text(&row, 7),
                fee_base: text(&row, 8),
                tx_hash: text(&row, 9),
                status: text(&row, 10),
                created_at: int(&row, 11),
            });
        }
        Ok(out)
    }
}

fn text(row: &libsql::Row, idx: i32) -> String {
    match row.get_value(idx) {
        Ok(Value::Text(s)) => s,
        _ => String::new(),
    }
}

fn int(row: &libsql::Row, idx: i32) -> i64 {
    match row.get_value(idx) {
        Ok(Value::Integer(i)) => i,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::turso::TursoRegistry;

    async fn store() -> SweepStore {
        let reg = TursoRegistry::new_test().await;
        SweepStore::new(reg.database())
    }

    fn record(id: &str, identity: &str) -> SweepRecord {
        SweepRecord {
            id: id.to_string(),
            receipt_id: "rcpt-1".to_string(),
            identity_hash: identity.to_string(),
            chain: "sepolia".to_string(),
            stealth_address: "0x1111111111111111111111111111111111111111".to_string(),
            destination: "0x2222222222222222222222222222222222222222".to_string(),
            destination_input: "alice.eth".to_string(),
            amount_base: "1000000000000000".to_string(),
            fee_base: "31500000000000".to_string(),
            tx_hash: "0xabc".to_string(),
            status: "confirmed".to_string(),
            created_at: 0,
        }
    }

    #[tokio::test]
    async fn sweep_insert_list_roundtrip() {
        let s = store().await;
        let inserted = s
            .insert_batch(&[record("row-1", "aa".repeat(32).as_str())])
            .await
            .unwrap();
        assert_eq!(inserted, 1);

        let rows = s.list_by_identity(&"aa".repeat(32), 100).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "row-1");
        assert_eq!(rows[0].receipt_id, "rcpt-1");
        assert_eq!(rows[0].destination_input, "alice.eth");
        assert_eq!(rows[0].status, "confirmed");
        assert!(rows[0].created_at > 0, "created_at set by the DB");
    }

    #[tokio::test]
    async fn sweep_insert_is_idempotent_on_id() {
        let s = store().await;
        let identity = "bb".repeat(32);
        assert_eq!(
            s.insert_batch(&[record("dup", &identity)]).await.unwrap(),
            1
        );
        assert_eq!(
            s.insert_batch(&[record("dup", &identity)]).await.unwrap(),
            0,
            "second insert with the same id must be ignored"
        );
        assert_eq!(s.list_by_identity(&identity, 100).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn sweep_list_filters_by_identity() {
        let s = store().await;
        let a = "cc".repeat(32);
        let b = "dd".repeat(32);
        s.insert_batch(&[record("r-a", &a), record("r-b", &b)])
            .await
            .unwrap();
        let rows = s.list_by_identity(&a, 100).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "r-a");
    }
}
