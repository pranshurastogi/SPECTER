//! Raw DB access for the durable `pending_payments` table (v7). Stores opaque
//! BLOBs; wrapping/serialization is the caller's concern (specter-api).

use std::sync::Arc;

use libsql::{params, Database, Value};
use specter_core::error::{Result, SpecterError};

/// Thin DB layer over the v7 `pending_payments` table.
///
/// Holds opaque BLOBs only: it neither serializes the [`Announcement`] nor
/// AEAD-wraps the shared secret. The API layer ([`crate`]-external) owns those
/// concerns. A Turso breach yields only ciphertext for the shared secret.
#[derive(Clone)]
pub struct PendingStore {
    db: Arc<Database>,
}

impl PendingStore {
    /// Wraps a shared `libsql::Database` handle (typically `TursoRegistry::database()`).
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    fn conn(&self) -> Result<libsql::Connection> {
        self.db
            .connect()
            .map_err(|e| SpecterError::RegistryError(format!("pending conn: {e}")))
    }

    /// Inserts a pending payment (opaque blobs + absolute expiry, unix secs).
    pub async fn insert(
        &self,
        payment_id: &str,
        announcement: &[u8],
        wrapped_secret: &[u8],
        expires_at: i64,
    ) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO pending_payments (payment_id, announcement, shared_secret_wrapped, expires_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                payment_id.to_string(),
                Value::Blob(announcement.to_vec()),
                Value::Blob(wrapped_secret.to_vec()),
                expires_at
            ],
        )
        .await
        .map_err(|e| SpecterError::RegistryError(format!("pending insert: {e}")))?;
        Ok(())
    }

    /// Single-use take: returns `(announcement, wrapped_secret)` and DELETES the row.
    /// Returns `None` if missing or expired (and deletes an expired row).
    pub async fn take(&self, payment_id: &str, now: i64) -> Result<Option<(Vec<u8>, Vec<u8>)>> {
        let conn = self.conn()?;
        let mut rows = conn
            .query(
                "SELECT announcement, shared_secret_wrapped, expires_at FROM pending_payments WHERE payment_id = ?1",
                params![payment_id.to_string()],
            )
            .await
            .map_err(|e| SpecterError::RegistryError(format!("pending take query: {e}")))?;
        let row = rows
            .next()
            .await
            .map_err(|e| SpecterError::RegistryError(format!("pending take row: {e}")))?;
        let Some(row) = row else {
            return Ok(None);
        };
        // Always delete (single-use; also cleans an expired row).
        conn.execute(
            "DELETE FROM pending_payments WHERE payment_id = ?1",
            params![payment_id.to_string()],
        )
        .await
        .map_err(|e| SpecterError::RegistryError(format!("pending take delete: {e}")))?;
        let expires_at = match row.get_value(2) {
            Ok(Value::Integer(i)) => i,
            _ => 0,
        };
        if expires_at <= now {
            return Ok(None);
        }
        let ann = match row.get_value(0) {
            Ok(Value::Blob(b)) => b,
            _ => return Ok(None),
        };
        let wrapped = match row.get_value(1) {
            Ok(Value::Blob(b)) => b,
            _ => return Ok(None),
        };
        Ok(Some((ann, wrapped)))
    }

    /// Deletes all expired rows; returns the count.
    pub async fn purge_expired(&self, now: i64) -> Result<u64> {
        let conn = self.conn()?;
        conn.execute(
            "DELETE FROM pending_payments WHERE expires_at <= ?1",
            params![now],
        )
        .await
        .map_err(|e| SpecterError::RegistryError(format!("pending purge: {e}")))?;
        Ok(conn.changes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::turso::TursoRegistry;

    async fn store() -> PendingStore {
        // new_test() runs all migrations (incl. v7), so pending_payments exists.
        let reg = TursoRegistry::new_test().await;
        PendingStore::new(reg.database())
    }

    #[tokio::test]
    async fn pending_insert_take_roundtrip() {
        let s = store().await;
        let ann = vec![0x11u8, 0x22, 0x33];
        let wrapped = vec![0xAAu8; 60];
        s.insert("pid-1", &ann, &wrapped, 9_000_000_000)
            .await
            .unwrap();
        let got = s.take("pid-1", 1_000).await.unwrap().expect("present");
        assert_eq!(got.0, ann);
        assert_eq!(got.1, wrapped);
    }

    #[tokio::test]
    async fn pending_take_is_single_use() {
        let s = store().await;
        s.insert("pid-2", &[1, 2, 3], &[4, 5, 6], 9_000_000_000)
            .await
            .unwrap();
        assert!(s.take("pid-2", 1_000).await.unwrap().is_some());
        assert!(
            s.take("pid-2", 1_000).await.unwrap().is_none(),
            "second take must be None"
        );
    }

    #[tokio::test]
    async fn pending_expired_take_returns_none() {
        let s = store().await;
        // expires_at in the past relative to `now`.
        s.insert("pid-3", &[7, 8, 9], &[1, 1, 1], 100)
            .await
            .unwrap();
        assert!(
            s.take("pid-3", 1_000).await.unwrap().is_none(),
            "expired entry must be None"
        );
        // And the expired row was deleted, so a purge finds nothing extra.
        assert_eq!(s.purge_expired(1_000).await.unwrap(), 0);
    }
}
