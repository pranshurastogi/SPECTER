//! Server-authoritative pending-payment store.
//!
//! When a sender calls `POST /api/v1/stealth/create`, the server holds the
//! resulting [`Announcement`] (ephemeral key + protocol view tag) against a
//! freshly-generated `payment_id` (UUID v4). The frontend then sends the
//! on-chain transaction and calls `POST /api/v1/registry/announcements` with
//! that `payment_id` plus the verified `tx_hash`/`amount`/`chain`. The server
//! attaches the metadata and publishes the **server-built** announcement to the
//! registry.
//!
//! This eliminates the previous "trust the client `view_tag`" footgun: the
//! protocol view tag (derived from the ML-KEM shared secret at create time)
//! can never be tampered with between create and publish.
//!
//! ## Storage
//!
//! Two backends, selected at construction:
//!
//! - **Turso** (production): the row survives API restarts. The
//!   [`Announcement`] is JSON-serialized and the ML-KEM `shared_secret` is
//!   AEAD-wrapped under the server key ([`DbKeys`]) **before** it touches the
//!   DB — a Turso breach alone cannot decrypt the secret.
//! - **Memory** (dev fallback): a per-instance [`DashMap`] with a TTL; used when
//!   no server key is available or the registry backend is in-memory. Does
//!   **not** persist across restarts.
//!
//! A background task ([`spawn_cleanup_task`]) sweeps expired entries every
//! [`CLEANUP_INTERVAL`].

use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use specter_core::error::SpecterError;
use specter_core::types::Announcement;
use specter_crypto::DbKeys;
use specter_registry::turso::PendingStore;
use tracing::{debug, info};
use uuid::Uuid;

/// Default TTL for a pending payment (24h is generous enough for slow wallets
/// while bounding storage).
pub const DEFAULT_PENDING_TTL: Duration = Duration::from_secs(60 * 60 * 24);

/// How often the background sweeper purges expired entries.
pub const CLEANUP_INTERVAL: Duration = Duration::from_secs(60 * 5);

/// A pending payment awaiting an on-chain transaction + publish.
#[derive(Clone, Debug)]
pub struct PendingPayment {
    /// The server-built announcement (correct ephemeral key + view tag).
    pub announcement: Announcement,
    /// ML-KEM shared secret for encrypting on-chain metadata at publish time.
    pub shared_secret: [u8; 32],
    /// Absolute expiry as unix **milliseconds**.
    ///
    /// Carried so [`PendingPaymentStore::restore`] can put the entry back with
    /// its original lifetime: a publish that fails and retries must not be able
    /// to keep a pending payment alive indefinitely.
    ///
    /// Milliseconds rather than seconds because the in-memory backend is used
    /// with sub-second TTLs in tests; the Turso column stays in seconds, and the
    /// conversion happens at that boundary.
    pub expires_at_ms: u64,
}

/// Server-authoritative store for in-flight stealth payments.
///
/// `Turso` persists durably (wrapping the secret first); `Memory` is the dev
/// fallback.
pub enum PendingPaymentStore {
    /// Durable, restart-surviving Turso backend.
    Turso {
        /// Raw DB layer (opaque blobs only).
        store: PendingStore,
        /// Server key material; wraps/unwraps the shared secret at rest.
        db_keys: Arc<DbKeys>,
        /// Time-to-live applied to newly inserted rows.
        ttl: Duration,
    },
    /// In-memory dev fallback (ephemeral; does not survive restarts).
    Memory {
        /// `payment_id → payment` (the payment carries its own absolute expiry).
        inner: DashMap<Uuid, PendingPayment>,
        /// Time-to-live for entries.
        ttl: Duration,
    },
}

impl PendingPaymentStore {
    /// Builds a durable Turso-backed store. The shared secret is AEAD-wrapped
    /// under `db_keys` before storage.
    pub fn turso(store: PendingStore, db_keys: Arc<DbKeys>, ttl: Duration) -> Self {
        Self::Turso {
            store,
            db_keys,
            ttl,
        }
    }

    /// Builds an in-memory dev fallback store.
    pub fn memory(ttl: Duration) -> Self {
        Self::Memory {
            inner: DashMap::new(),
            ttl,
        }
    }

    /// Inserts a freshly-created announcement and returns the new `payment_id`.
    ///
    /// `shared_secret` is the ML-KEM shared secret produced during encapsulation.
    /// On the Turso backend it is wrapped under the server key before storage.
    pub async fn insert(
        &self,
        announcement: Announcement,
        shared_secret: [u8; 32],
    ) -> Result<Uuid, SpecterError> {
        let id = Uuid::new_v4();
        match self {
            Self::Turso {
                store,
                db_keys,
                ttl,
            } => {
                let blob = serde_json::to_vec(&announcement)
                    .map_err(|e| SpecterError::RegistryError(format!("pending serialize: {e}")))?;
                let wrapped = db_keys.wrap_secret(&shared_secret);
                let expires_at = (now_secs() + ttl.as_secs()) as i64;
                store
                    .insert(&id.to_string(), &blob, &wrapped, expires_at)
                    .await?;
            }
            Self::Memory { inner, ttl } => {
                inner.insert(
                    id,
                    PendingPayment {
                        announcement,
                        shared_secret,
                        expires_at_ms: now_millis() + ttl.as_millis() as u64,
                    },
                );
            }
        }
        debug!(payment_id = %id, "Stored pending payment");
        Ok(id)
    }

    /// Atomically consumes a pending payment by id. Returns `None` if the id is
    /// unknown or the entry has expired (expired entries are also removed).
    pub async fn take(&self, id: &Uuid) -> Result<Option<PendingPayment>, SpecterError> {
        match self {
            Self::Turso { store, db_keys, .. } => {
                let now = now_secs() as i64;
                let Some((blob, wrapped, expires_at)) = store.take(&id.to_string(), now).await?
                else {
                    return Ok(None);
                };
                let announcement: Announcement = serde_json::from_slice(&blob).map_err(|e| {
                    SpecterError::RegistryError(format!("pending deserialize: {e}"))
                })?;
                let shared_secret = db_keys.unwrap_secret(&wrapped)?;
                Ok(Some(PendingPayment {
                    announcement,
                    shared_secret,
                    expires_at_ms: expires_at.max(0) as u64 * 1_000,
                }))
            }
            Self::Memory { inner, .. } => {
                let Some((_, p)) = inner.remove(id) else {
                    return Ok(None);
                };
                if p.expires_at_ms <= now_millis() {
                    return Ok(None);
                }
                Ok(Some(p))
            }
        }
    }

    /// Puts a previously [`Self::take`]n entry back, unchanged.
    ///
    /// Called when the publish the entry was taken for did not commit, so a
    /// retry can still use the server-held shared secret and publish encrypted
    /// metadata. Without this, any transient failure after the take (an RPC
    /// blip, a throttled relayer) permanently burns the `payment_id` and forces
    /// the client onto the unencrypted fallback path.
    ///
    /// Restoring an already-expired entry is a no-op: there is nothing useful to
    /// put back, and re-inserting would resurrect a row the sweeper just cleared.
    pub async fn restore(&self, id: &Uuid, payment: PendingPayment) -> Result<(), SpecterError> {
        if payment.expires_at_ms <= now_millis() {
            debug!(payment_id = %id, "Not restoring an expired pending payment");
            return Ok(());
        }
        match self {
            Self::Turso { store, db_keys, .. } => {
                let blob = serde_json::to_vec(&payment.announcement)
                    .map_err(|e| SpecterError::RegistryError(format!("pending serialize: {e}")))?;
                let wrapped = db_keys.wrap_secret(&payment.shared_secret);
                store
                    .restore(
                        &id.to_string(),
                        &blob,
                        &wrapped,
                        (payment.expires_at_ms / 1_000) as i64,
                    )
                    .await?;
            }
            Self::Memory { inner, .. } => {
                inner.insert(*id, payment);
            }
        }
        debug!(payment_id = %id, "Restored pending payment after a failed publish");
        Ok(())
    }

    /// Removes all expired entries. Cheap, safe to call frequently.
    pub async fn purge_expired(&self) -> Result<(), SpecterError> {
        match self {
            Self::Turso { store, .. } => {
                store.purge_expired(now_secs() as i64).await?;
            }
            Self::Memory { inner, .. } => {
                let now = now_millis();
                inner.retain(|_, p| p.expires_at_ms > now);
            }
        }
        Ok(())
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Spawns a background task that periodically purges expired pending payments.
///
/// The task lives for the lifetime of the Arc reference (normally the lifetime
/// of the API server process).
pub fn spawn_cleanup_task(store: Arc<PendingPaymentStore>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(CLEANUP_INTERVAL);
        // Don't run immediately on startup.
        interval.tick().await;
        info!("Pending-payment cleanup task started");
        loop {
            interval.tick().await;
            if let Err(e) = store.purge_expired().await {
                debug!("pending purge failed: {e}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::constants::KYBER_CIPHERTEXT_SIZE;
    use specter_registry::turso::TursoRegistry;

    fn mk_announcement() -> Announcement {
        Announcement::new(vec![0x42u8; KYBER_CIPHERTEXT_SIZE], 0x42)
    }

    fn mk_secret() -> [u8; 32] {
        [0x07u8; 32]
    }

    fn mk_keys() -> Arc<DbKeys> {
        Arc::new(DbKeys::from_master(&[0u8; 32]))
    }

    // ── memory backend ───────────────────────────────────────────────────────

    #[tokio::test]
    async fn insert_then_take_returns_announcement() {
        let store = PendingPaymentStore::memory(Duration::from_secs(60));
        let id = store.insert(mk_announcement(), mk_secret()).await.unwrap();
        let taken = store.take(&id).await.unwrap().expect("must be present");
        assert_eq!(taken.announcement.view_tag, 0x42);
        assert_eq!(taken.shared_secret, mk_secret());
    }

    #[tokio::test]
    async fn take_is_single_use() {
        let store = PendingPaymentStore::memory(Duration::from_secs(60));
        let id = store.insert(mk_announcement(), mk_secret()).await.unwrap();
        assert!(store.take(&id).await.unwrap().is_some());
        assert!(
            store.take(&id).await.unwrap().is_none(),
            "second take must be None"
        );
    }

    #[tokio::test]
    async fn take_unknown_id_is_none() {
        let store = PendingPaymentStore::memory(Duration::from_secs(60));
        assert!(store.take(&Uuid::new_v4()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn expired_entries_are_dropped_on_take() {
        let store = PendingPaymentStore::memory(Duration::from_millis(1));
        let id = store.insert(mk_announcement(), mk_secret()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(5)).await;
        assert!(store.take(&id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn purge_expired_removes_only_old_entries() {
        let store = PendingPaymentStore::memory(Duration::from_millis(20));
        let _old = store.insert(mk_announcement(), mk_secret()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(25)).await;
        let fresh = store.insert(mk_announcement(), mk_secret()).await.unwrap();
        store.purge_expired().await.unwrap();
        assert!(store.take(&fresh).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn insert_produces_unique_ids() {
        let store = PendingPaymentStore::memory(Duration::from_secs(60));
        let mut ids = std::collections::HashSet::new();
        for _ in 0..100 {
            ids.insert(store.insert(mk_announcement(), mk_secret()).await.unwrap());
        }
        assert_eq!(ids.len(), 100, "all 100 payment IDs must be unique");
    }

    // ── turso backend (durability) ────────────────────────────────────────────

    #[tokio::test]
    async fn turso_insert_take_roundtrip_unwraps_secret() {
        let reg = TursoRegistry::new_test().await;
        let store = PendingPaymentStore::turso(
            PendingStore::new(reg.database()),
            mk_keys(),
            Duration::from_secs(60),
        );
        let secret = [0xABu8; 32];
        let id = store.insert(mk_announcement(), secret).await.unwrap();
        let taken = store.take(&id).await.unwrap().expect("present");
        assert_eq!(taken.announcement.view_tag, 0x42);
        assert_eq!(taken.shared_secret, secret, "secret must round-trip");
    }

    /// Durability: a NEW store instance over the SAME database can take a
    /// payment inserted by a prior instance. Proves the row (not just process
    /// memory) holds the state.
    #[tokio::test]
    async fn turso_survives_new_store_instance() {
        let reg = TursoRegistry::new_test().await;
        let db = reg.database();
        let secret = [0x5Cu8; 32];

        let id = {
            let s1 = PendingPaymentStore::turso(
                PendingStore::new(db.clone()),
                mk_keys(),
                Duration::from_secs(3600),
            );
            s1.insert(mk_announcement(), secret).await.unwrap()
        };

        // Fresh store + fresh DbKeys (same master) over the same DB.
        let s2 = PendingPaymentStore::turso(
            PendingStore::new(db.clone()),
            mk_keys(),
            Duration::from_secs(3600),
        );
        let taken = s2
            .take(&id)
            .await
            .unwrap()
            .expect("durable across store instances");
        assert_eq!(taken.shared_secret, secret);
        // Single-use even across instances.
        assert!(s2.take(&id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn turso_expired_take_returns_none() {
        let reg = TursoRegistry::new_test().await;
        let store = PendingPaymentStore::turso(
            PendingStore::new(reg.database()),
            mk_keys(),
            Duration::from_secs(0), // expires immediately
        );
        let id = store.insert(mk_announcement(), mk_secret()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(1100)).await;
        assert!(store.take(&id).await.unwrap().is_none());
    }

    // ── restore-on-failed-publish ─────────────────────────────────────────
    //
    // The publish handler takes a pending entry before it verifies the payment
    // and relays. A transient failure in between used to burn the payment_id
    // permanently, pushing the client's retry onto the no-secret publish path.

    #[tokio::test]
    async fn restore_makes_a_taken_entry_usable_again() {
        let store = PendingPaymentStore::memory(Duration::from_secs(60));
        let secret = [0x11u8; 32];
        let id = store.insert(mk_announcement(), secret).await.unwrap();

        let taken = store.take(&id).await.unwrap().expect("present");
        assert!(
            store.take(&id).await.unwrap().is_none(),
            "take must be single-use"
        );

        store.restore(&id, taken).await.unwrap();

        let again = store.take(&id).await.unwrap().expect("restored");
        assert_eq!(
            again.shared_secret, secret,
            "the shared secret must survive a restore — without it the retry \
             cannot encrypt metadata, which is the whole point"
        );
        assert_eq!(again.announcement.view_tag, 0x42);
    }

    #[tokio::test]
    async fn restore_is_still_single_use_afterwards() {
        let store = PendingPaymentStore::memory(Duration::from_secs(60));
        let id = store.insert(mk_announcement(), mk_secret()).await.unwrap();
        let taken = store.take(&id).await.unwrap().unwrap();
        store.restore(&id, taken).await.unwrap();
        assert!(store.take(&id).await.unwrap().is_some());
        assert!(
            store.take(&id).await.unwrap().is_none(),
            "restoring must not make the id reusable more than once"
        );
    }

    #[tokio::test]
    async fn restore_does_not_extend_the_original_ttl() {
        // A client that repeatedly fails a publish must not be able to keep a
        // pending payment alive forever by racking up restores.
        let store = PendingPaymentStore::memory(Duration::from_millis(40));
        let id = store.insert(mk_announcement(), mk_secret()).await.unwrap();
        let taken = store.take(&id).await.unwrap().unwrap();
        let original_expiry = taken.expires_at_ms;

        store.restore(&id, taken).await.unwrap();
        tokio::time::sleep(Duration::from_millis(60)).await;

        assert!(
            store.take(&id).await.unwrap().is_none(),
            "restored entry must still expire on its original schedule"
        );
        assert!(original_expiry > 0);
    }

    #[tokio::test]
    async fn restoring_an_expired_entry_is_a_noop() {
        let store = PendingPaymentStore::memory(Duration::from_secs(60));
        let id = store.insert(mk_announcement(), mk_secret()).await.unwrap();
        let mut taken = store.take(&id).await.unwrap().unwrap();
        taken.expires_at_ms = 1; // long past

        store.restore(&id, taken).await.unwrap();
        assert!(
            store.take(&id).await.unwrap().is_none(),
            "an expired entry must not be resurrected by a restore"
        );
    }

    #[tokio::test]
    async fn restore_of_an_unknown_id_is_harmless() {
        let store = PendingPaymentStore::memory(Duration::from_secs(60));
        let id = store.insert(mk_announcement(), mk_secret()).await.unwrap();
        let taken = store.take(&id).await.unwrap().unwrap();
        // Restore under a different id — should simply create that entry, never panic.
        let other = Uuid::new_v4();
        store.restore(&other, taken).await.unwrap();
        assert!(store.take(&other).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn turso_restore_round_trips_through_the_database() {
        let reg = TursoRegistry::new_test().await;
        let store = PendingPaymentStore::turso(
            PendingStore::new(reg.database()),
            mk_keys(),
            Duration::from_secs(600),
        );
        let secret = [0x7Eu8; 32];
        let id = store.insert(mk_announcement(), secret).await.unwrap();

        let taken = store.take(&id).await.unwrap().expect("present");
        let expiry = taken.expires_at_ms;
        assert!(store.take(&id).await.unwrap().is_none(), "row was consumed");

        store.restore(&id, taken).await.unwrap();

        let again = store.take(&id).await.unwrap().expect("restored row");
        assert_eq!(
            again.shared_secret, secret,
            "KEK-wrapped secret must survive"
        );
        assert_eq!(
            again.expires_at_ms / 1_000,
            expiry / 1_000,
            "expiry must be preserved to the second the column stores"
        );
    }

    #[tokio::test]
    async fn turso_restore_survives_a_new_store_instance() {
        let reg = TursoRegistry::new_test().await;
        let db = reg.database();
        let secret = [0x3Du8; 32];

        let id = {
            let s1 = PendingPaymentStore::turso(
                PendingStore::new(db.clone()),
                mk_keys(),
                Duration::from_secs(600),
            );
            let id = s1.insert(mk_announcement(), secret).await.unwrap();
            let taken = s1.take(&id).await.unwrap().unwrap();
            s1.restore(&id, taken).await.unwrap();
            id
        };

        let s2 =
            PendingPaymentStore::turso(PendingStore::new(db), mk_keys(), Duration::from_secs(600));
        let taken = s2
            .take(&id)
            .await
            .unwrap()
            .expect("durable across instances");
        assert_eq!(taken.shared_secret, secret);
    }
}
