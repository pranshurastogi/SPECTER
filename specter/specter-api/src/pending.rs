//! Server-authoritative pending-payment store.
//!
//! When a sender calls `POST /api/v1/stealth/create`, the server holds the
//! resulting [`Announcement`] (ephemeral key + protocol view tag) in memory
//! against a freshly-generated `payment_id` (UUID v4). The frontend then sends
//! the on-chain transaction and calls `POST /api/v1/registry/announcements`
//! with that `payment_id` plus the verified `tx_hash`/`amount`/`chain`. The
//! server attaches the metadata and publishes the **server-built** announcement
//! to the registry.
//!
//! This eliminates the previous "trust the client `view_tag`" footgun: the
//! protocol view tag (derived from the ML-KEM shared secret at create time)
//! can never be tampered with between create and publish.
//!
//! ## Storage
//!
//! Per-instance in-memory map with a TTL ([`DEFAULT_PENDING_TTL`]). The map is
//! sharded across the runtime by [`DashMap`] for lock-free reads/writes. A
//! background task ([`spawn_cleanup_task`]) sweeps expired entries every
//! [`CLEANUP_INTERVAL`].
//!
//! The store does **not** persist across restarts. Senders that crash between
//! create and publish must re-create. For an end-to-end backup the frontend
//! also receives the full [`AnnouncementDto`] in the create response and may
//! republish via the `announcement` fallback path on `PublishAnnouncementRequest`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use specter_core::types::Announcement;
use tracing::{debug, info};
use uuid::Uuid;

/// Default TTL for a pending payment (24h is generous enough for slow wallets
/// while bounding memory).
pub const DEFAULT_PENDING_TTL: Duration = Duration::from_secs(60 * 60 * 24);

/// How often the background sweeper purges expired entries.
pub const CLEANUP_INTERVAL: Duration = Duration::from_secs(60 * 5);

/// Hard cap on number of pending payments held in memory (to bound DoS).
const MAX_PENDING_PAYMENTS: usize = 100_000;

/// A pending payment awaiting an on-chain transaction + publish.
#[derive(Clone, Debug)]
pub struct PendingPayment {
    /// The server-built announcement (correct ephemeral key + view tag).
    pub announcement: Announcement,
    /// When this entry was created (used for TTL expiry).
    pub created_at: Instant,
}

impl PendingPayment {
    /// Returns `true` if this entry has lived longer than `ttl`.
    pub fn is_expired(&self, ttl: Duration) -> bool {
        self.created_at.elapsed() > ttl
    }
}

/// Thread-safe map of `payment_id → PendingPayment`.
pub struct PendingPaymentStore {
    inner: DashMap<Uuid, PendingPayment>,
    ttl: Duration,
}

impl PendingPaymentStore {
    /// Creates a new store with [`DEFAULT_PENDING_TTL`].
    pub fn new() -> Self {
        Self::with_ttl(DEFAULT_PENDING_TTL)
    }

    /// Creates a new store with a custom TTL.
    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            inner: DashMap::new(),
            ttl,
        }
    }

    /// Inserts a freshly-created announcement and returns the new `payment_id`.
    ///
    /// If the store is over capacity, the oldest entries are purged first to
    /// keep memory bounded under abusive traffic.
    pub fn insert(&self, announcement: Announcement) -> Uuid {
        if self.inner.len() >= MAX_PENDING_PAYMENTS {
            self.purge_expired();
        }
        let id = Uuid::new_v4();
        self.inner.insert(
            id,
            PendingPayment {
                announcement,
                created_at: Instant::now(),
            },
        );
        debug!(payment_id = %id, pending_count = self.inner.len(), "Stored pending payment");
        id
    }

    /// Atomically consumes a pending payment by id. Returns `None` if the id
    /// is unknown or the entry has expired (expired entries are also removed).
    pub fn take(&self, id: &Uuid) -> Option<PendingPayment> {
        let entry = self.inner.remove(id).map(|(_, v)| v)?;
        if entry.is_expired(self.ttl) {
            debug!(payment_id = %id, "Dropped expired pending payment on take");
            return None;
        }
        Some(entry)
    }

    /// Returns current number of pending entries (useful for `/health`).
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// Returns `true` when no pending entries are held.
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Removes all expired entries. Cheap, safe to call frequently.
    pub fn purge_expired(&self) {
        let ttl = self.ttl;
        let before = self.inner.len();
        self.inner.retain(|_, v| !v.is_expired(ttl));
        let after = self.inner.len();
        if before != after {
            debug!(removed = before - after, "Purged expired pending payments");
        }
    }
}

impl Default for PendingPaymentStore {
    fn default() -> Self {
        Self::new()
    }
}

/// Spawns a background task that periodically purges expired pending payments.
///
/// The task lives for the lifetime of the Arc reference (which is normally the
/// lifetime of the API server process).
pub fn spawn_cleanup_task(store: Arc<PendingPaymentStore>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(CLEANUP_INTERVAL);
        // Don't run immediately on startup (registered Instant::now() is fresh).
        interval.tick().await;
        info!(
            ttl_secs = store.ttl.as_secs(),
            "Pending-payment cleanup task started"
        );
        loop {
            interval.tick().await;
            store.purge_expired();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::constants::KYBER_CIPHERTEXT_SIZE;

    fn mk_announcement() -> Announcement {
        Announcement::new(vec![0x42u8; KYBER_CIPHERTEXT_SIZE], 0x42)
    }

    #[test]
    fn insert_then_take_returns_announcement() {
        let store = PendingPaymentStore::new();
        let id = store.insert(mk_announcement());
        let taken = store.take(&id).expect("must be present");
        assert_eq!(taken.announcement.view_tag, 0x42);
    }

    #[test]
    fn take_is_single_use() {
        let store = PendingPaymentStore::new();
        let id = store.insert(mk_announcement());
        assert!(store.take(&id).is_some());
        assert!(store.take(&id).is_none(), "second take must be None");
    }

    #[test]
    fn take_unknown_id_is_none() {
        let store = PendingPaymentStore::new();
        let id = Uuid::new_v4();
        assert!(store.take(&id).is_none());
    }

    #[test]
    fn expired_entries_are_purged() {
        let store = PendingPaymentStore::with_ttl(Duration::from_millis(1));
        let id = store.insert(mk_announcement());
        std::thread::sleep(Duration::from_millis(5));
        assert!(store.take(&id).is_none(), "expired entry must be dropped");
    }

    #[test]
    fn purge_expired_removes_only_old_entries() {
        let store = PendingPaymentStore::with_ttl(Duration::from_millis(20));
        let _old = store.insert(mk_announcement());
        std::thread::sleep(Duration::from_millis(25));
        let fresh = store.insert(mk_announcement());
        store.purge_expired();
        assert_eq!(store.len(), 1);
        assert!(store.take(&fresh).is_some());
    }
}
