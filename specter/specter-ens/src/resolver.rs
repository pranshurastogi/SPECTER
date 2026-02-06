//! Combined ENS + IPFS resolver for fetching meta-addresses.

use serde::{Deserialize, Serialize};
use tracing::{debug, info, instrument, warn};

use specter_core::error::{Result, SpecterError};
use specter_core::types::MetaAddress;

use crate::cache::MetaAddressCache;
use crate::ens::{EnsClient, EnsConfig};
use crate::ipfs::{IpfsClient, IpfsConfig};

/// Resolver configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResolverConfig {
    /// ENS configuration
    pub ens: EnsConfig,
    /// IPFS configuration
    pub ipfs: IpfsConfig,
    /// Whether to use caching
    pub enable_cache: bool,
    /// Cache TTL in seconds
    pub cache_ttl_seconds: u64,
}

impl Default for ResolverConfig {
    fn default() -> Self {
        Self {
            ens: EnsConfig::default(),
            ipfs: IpfsConfig::default(),
            enable_cache: true,
            cache_ttl_seconds: 3600,
        }
    }
}

impl ResolverConfig {
    /// Creates a config with the given RPC URL.
    pub fn with_rpc(rpc_url: impl Into<String>) -> Self {
        Self {
            ens: EnsConfig::new(rpc_url),
            ..Default::default()
        }
    }

    /// Adds Pinata credentials.
    pub fn with_pinata(
        mut self,
        api_key: impl Into<String>,
        secret_key: impl Into<String>,
    ) -> Self {
        self.ipfs.pinata_api_key = Some(api_key.into());
        self.ipfs.pinata_secret_key = Some(secret_key.into());
        self
    }

    /// Disables caching.
    pub fn no_cache(mut self) -> Self {
        self.enable_cache = false;
        self
    }
}

/// SPECTER resolver that combines ENS and IPFS.
///
/// Resolves ENS names to meta-addresses by:
/// 1. Looking up the ENS text record "specter", or
///    if missing, the ENS Content Hash (EIP-1577) from the resolver's contenthash()
/// 2. Parsing the IPFS CID from the record or content hash
/// 3. Fetching the meta-address from IPFS
/// 4. Deserializing and validating the meta-address
pub struct SpecterResolver {
    ens: EnsClient,
    ipfs: IpfsClient,
    cache: Option<MetaAddressCache>,
    config: ResolverConfig,
}

impl SpecterResolver {
    /// Creates a new resolver with default configuration.
    pub fn new() -> Self {
        Self::with_config(ResolverConfig::default())
    }

    /// Creates a resolver with the given RPC URL.
    pub fn with_rpc(rpc_url: impl Into<String>) -> Self {
        Self::with_config(ResolverConfig::with_rpc(rpc_url))
    }

    /// Creates a resolver with custom configuration.
    pub fn with_config(config: ResolverConfig) -> Self {
        let ens = EnsClient::with_config(config.ens.clone());
        let ipfs = IpfsClient::with_config(config.ipfs.clone());
        
        let cache = if config.enable_cache {
            Some(MetaAddressCache::new())
        } else {
            None
        };

        Self {
            ens,
            ipfs,
            cache,
            config,
        }
    }

    /// Resolves an ENS name to a meta-address.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let resolver = SpecterResolver::with_rpc("https://eth-mainnet.g.alchemy.com/v2/KEY");
    /// let meta = resolver.resolve("alice.eth").await?;
    /// ```
    #[instrument(skip(self))]
    pub async fn resolve(&self, ens_name: &str) -> Result<MetaAddress> {
        // Check cache first
        if let Some(cache) = &self.cache {
            if let Some(meta) = cache.get(ens_name) {
                debug!(ens_name, "Cache hit");
                return Ok(meta);
            }
        }

        debug!(ens_name, "Cache miss, resolving");

        // Get IPFS CID: try "specter" text record, then Content Hash (EIP-1577)
        let cid = if let Some(record_value) = self.ens.get_specter_record(ens_name).await? {
            self.parse_cid(&record_value)?
        } else if let Some(content_cid) = self.ens.get_content_hash(ens_name).await? {
            content_cid
        } else {
            return Err(SpecterError::NoSpecterRecord(ens_name.to_string()));
        };

        debug!(ens_name, cid, "Found IPFS CID");

        // Fetch from IPFS
        let data = self.ipfs.download(&cid).await?;

        // Deserialize meta-address
        let meta = MetaAddress::from_bytes(&data)?;

        // Validate
        meta.validate()?;

        info!(ens_name, "Resolved meta-address");

        // Cache if enabled
        if let Some(cache) = &self.cache {
            cache.set(ens_name, meta.clone());
        }

        Ok(meta)
    }

    /// Checks if an ENS name has a SPECTER record.
    #[instrument(skip(self))]
    pub async fn has_record(&self, ens_name: &str) -> Result<bool> {
        self.ens.has_specter_record(ens_name).await
    }

    /// Uploads a meta-address to IPFS.
    ///
    /// Returns the IPFS CID that should be set in the ENS text record.
    #[instrument(skip(self, meta))]
    pub async fn upload(&self, meta: &MetaAddress, name: Option<&str>) -> Result<String> {
        meta.validate()?;
        let data = meta.to_bytes();
        let cid = self.ipfs.upload(&data, name).await?;
        info!(cid, "Uploaded meta-address to IPFS");
        Ok(cid)
    }

    /// Returns the formatted ENS text record value for a CID.
    ///
    /// Returns the CID in the format expected by ENS: "ipfs://CID"
    pub fn format_text_record(&self, cid: &str) -> String {
        if cid.starts_with("ipfs://") {
            cid.to_string()
        } else {
            format!("ipfs://{}", cid)
        }
    }

    /// Clears the resolution cache.
    pub fn clear_cache(&self) {
        if let Some(cache) = &self.cache {
            cache.clear();
        }
    }

    /// Parses a CID from various formats.
    fn parse_cid(&self, raw: &str) -> Result<String> {
        let raw = raw.trim();

        // Handle different CID formats
        if raw.starts_with("ipfs://") {
            Ok(raw.strip_prefix("ipfs://").unwrap().to_string())
        } else if raw.starts_with("/ipfs/") {
            Ok(raw.strip_prefix("/ipfs/").unwrap().to_string())
        } else if raw.starts_with("Qm") || raw.starts_with("bafy") || raw.starts_with("bafk") {
            Ok(raw.to_string())
        } else {
            Err(SpecterError::InvalidEnsRecord(format!(
                "Invalid CID format: {}",
                raw
            )))
        }
    }
}

impl Default for SpecterResolver {
    fn default() -> Self {
        Self::new()
    }
}

/// Result of a resolution with metadata.
#[derive(Clone, Debug)]
pub struct ResolveResult {
    /// The resolved meta-address
    pub meta_address: MetaAddress,
    /// The ENS name that was resolved
    pub ens_name: String,
    /// The IPFS CID where the meta-address is stored
    pub ipfs_cid: String,
    /// Whether the result came from cache
    pub from_cache: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cid_ipfs_prefix() {
        let resolver = SpecterResolver::new();
        
        let cid = resolver.parse_cid("ipfs://QmTest123").unwrap();
        assert_eq!(cid, "QmTest123");
    }

    #[test]
    fn test_parse_cid_path_prefix() {
        let resolver = SpecterResolver::new();
        
        let cid = resolver.parse_cid("/ipfs/QmTest123").unwrap();
        assert_eq!(cid, "QmTest123");
    }

    #[test]
    fn test_parse_cid_raw() {
        let resolver = SpecterResolver::new();
        
        let cid = resolver.parse_cid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG").unwrap();
        assert!(cid.starts_with("Qm"));
    }

    #[test]
    fn test_parse_cid_v1() {
        let resolver = SpecterResolver::new();
        
        let cid = resolver.parse_cid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi").unwrap();
        assert!(cid.starts_with("bafy"));
    }

    #[test]
    fn test_format_text_record() {
        let resolver = SpecterResolver::new();
        
        let record = resolver.format_text_record("QmTest123");
        assert_eq!(record, "ipfs://QmTest123");
        
        // Should not double-prefix
        let record2 = resolver.format_text_record("ipfs://QmTest123");
        assert_eq!(record2, "ipfs://QmTest123");
    }

    #[test]
    fn test_config_builder() {
        let config = ResolverConfig::with_rpc("https://test.com")
            .with_pinata("key", "secret")
            .no_cache();

        assert_eq!(config.ens.rpc_url, "https://test.com");
        assert_eq!(config.ipfs.pinata_api_key, Some("key".into()));
        assert!(!config.enable_cache);
    }
}
