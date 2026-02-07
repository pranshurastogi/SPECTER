//! TTL cache for SPECTER meta-addresses.
//!
//! Generic in-memory cache with configurable capacity and expiration.

mod cache;

pub use cache::{CacheConfig, CacheStats, MetaAddressCache};
