//! In-memory TTL cache for meta-addresses.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

use specter_core::types::MetaAddress;

/// Cache entry with TTL.
#[derive(Clone)]
struct CacheEntry {
    meta_address: MetaAddress,
    inserted_at: Instant,
    ttl: Duration,
}

impl CacheEntry {
    fn is_expired(&self) -> bool {
        self.inserted_at.elapsed() > self.ttl
    }
}

/// Cache configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CacheConfig {
    /// Maximum number of entries
    pub max_entries: usize,
    /// Default TTL in seconds
    pub default_ttl_seconds: u64,
    /// Whether to auto-cleanup expired entries
    pub auto_cleanup: bool,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            max_entries: 1000,
            default_ttl_seconds: 3600,
            auto_cleanup: true,
        }
    }
}

/// In-memory cache for meta-addresses.
///
/// Thread-safe and supports TTL-based expiration.
pub struct MetaAddressCache {
    entries: RwLock<HashMap<String, CacheEntry>>,
    config: CacheConfig,
}

impl MetaAddressCache {
    /// Creates a new cache with default configuration.
    pub fn new() -> Self {
        Self::with_config(CacheConfig::default())
    }

    /// Creates a cache with custom configuration.
    pub fn with_config(config: CacheConfig) -> Self {
        Self {
            entries: RwLock::new(HashMap::with_capacity(config.max_entries)),
            config,
        }
    }

    /// Gets a cached meta-address by key (e.g. ENS name).
    pub fn get(&self, key: &str) -> Option<MetaAddress> {
        let normalized = key.trim().to_lowercase();
        let entries = self.entries.read();
        entries.get(&normalized).and_then(|e| {
            if e.is_expired() {
                None
            } else {
                Some(e.meta_address.clone())
            }
        })
    }

    /// Caches a meta-address with the default TTL.
    pub fn set(&self, key: &str, meta_address: MetaAddress) {
        self.set_with_ttl(key, meta_address, Duration::from_secs(self.config.default_ttl_seconds));
    }

    /// Caches a meta-address with a custom TTL.
    pub fn set_with_ttl(&self, key: &str, meta_address: MetaAddress, ttl: Duration) {
        let normalized = key.trim().to_lowercase();
        let mut entries = self.entries.write();

        if self.config.auto_cleanup && entries.len() >= self.config.max_entries {
            entries.retain(|_, e| !e.is_expired());
        }
        if entries.len() >= self.config.max_entries {
            if let Some(oldest_key) = entries
                .iter()
                .min_by_key(|(_, e)| e.inserted_at)
                .map(|(k, _)| k.clone())
            {
                entries.remove(&oldest_key);
            }
        }

        entries.insert(normalized, CacheEntry {
            meta_address,
            inserted_at: Instant::now(),
            ttl,
        });
    }

    /// Removes a cached entry.
    pub fn remove(&self, key: &str) {
        let normalized = key.trim().to_lowercase();
        self.entries.write().remove(&normalized);
    }

    /// Clears all cached entries.
    pub fn clear(&self) {
        self.entries.write().clear();
    }

    /// Removes all expired entries.
    pub fn cleanup_expired(&self) {
        self.entries.write().retain(|_, e| !e.is_expired());
    }

    /// Returns the number of cached entries.
    pub fn len(&self) -> usize {
        self.entries.read().len()
    }

    /// Returns true if the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.read().is_empty()
    }

    /// Returns cache statistics.
    pub fn stats(&self) -> CacheStats {
        let entries = self.entries.read();
        let expired = entries.values().filter(|e| e.is_expired()).count();
        CacheStats {
            total_entries: entries.len(),
            expired_entries: expired,
            valid_entries: entries.len().saturating_sub(expired),
            capacity: self.config.max_entries,
        }
    }
}

impl Default for MetaAddressCache {
    fn default() -> Self {
        Self::new()
    }
}

/// Cache statistics.
#[derive(Clone, Debug)]
pub struct CacheStats {
    pub total_entries: usize,
    pub expired_entries: usize,
    pub valid_entries: usize,
    pub capacity: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::constants::KYBER_PUBLIC_KEY_SIZE;
    use specter_core::types::KyberPublicKey;

    fn make_test_meta() -> MetaAddress {
        MetaAddress::new(
            KyberPublicKey::from_array([1u8; KYBER_PUBLIC_KEY_SIZE]),
            KyberPublicKey::from_array([2u8; KYBER_PUBLIC_KEY_SIZE]),
        )
    }

    #[test]
    fn test_cache_set_get() {
        let cache = MetaAddressCache::new();
        let meta = make_test_meta();
        cache.set("alice.eth", meta.clone());
        let retrieved = cache.get("alice.eth").unwrap();
        assert_eq!(retrieved.version, meta.version);
    }

    #[test]
    fn test_cache_normalize_name() {
        let cache = MetaAddressCache::new();
        cache.set("ALICE.ETH", make_test_meta());
        assert!(cache.get("alice.eth").is_some());
        assert!(cache.get("  ALICE.eth  ").is_some());
    }

    #[test]
    fn test_cache_miss() {
        let cache = MetaAddressCache::new();
        assert!(cache.get("nonexistent.eth").is_none());
    }

    #[test]
    fn test_cache_remove() {
        let cache = MetaAddressCache::new();
        cache.set("alice.eth", make_test_meta());
        cache.remove("alice.eth");
        assert!(cache.get("alice.eth").is_none());
    }

    #[test]
    fn test_cache_clear() {
        let cache = MetaAddressCache::new();
        cache.set("alice.eth", make_test_meta());
        cache.set("bob.eth", make_test_meta());
        cache.clear();
        assert!(cache.is_empty());
    }

    #[test]
    fn test_cache_ttl_expiration() {
        let cache = MetaAddressCache::new();
        cache.set_with_ttl("alice.eth", make_test_meta(), Duration::from_millis(1));
        std::thread::sleep(Duration::from_millis(10));
        assert!(cache.get("alice.eth").is_none());
    }

    #[test]
    fn test_cache_capacity_eviction() {
        let config = CacheConfig {
            max_entries: 2,
            default_ttl_seconds: 3600,
            auto_cleanup: true,
        };
        let cache = MetaAddressCache::with_config(config);
        cache.set("alice.eth", make_test_meta());
        cache.set("bob.eth", make_test_meta());
        cache.set("charlie.eth", make_test_meta());
        assert_eq!(cache.len(), 2);
    }

    #[test]
    fn test_cache_stats() {
        let cache = MetaAddressCache::new();
        cache.set("alice.eth", make_test_meta());
        cache.set("bob.eth", make_test_meta());
        let stats = cache.stats();
        assert_eq!(stats.total_entries, 2);
        assert_eq!(stats.valid_entries, 2);
    }

    #[test]
    fn test_cache_cleanup_expired() {
        let cache = MetaAddressCache::new();
        cache.set_with_ttl("alice.eth", make_test_meta(), Duration::from_millis(1));
        cache.set("bob.eth", make_test_meta());
        std::thread::sleep(Duration::from_millis(10));
        cache.cleanup_expired();
        assert_eq!(cache.len(), 1);
        assert!(cache.get("bob.eth").is_some());
    }
}
