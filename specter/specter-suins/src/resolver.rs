//! Combined SuiNS + IPFS resolver for fetching meta-addresses.

use serde::{Deserialize, Serialize};
use tracing::{debug, info, instrument};

use specter_core::error::{Result, SpecterError};
use specter_core::types::MetaAddress;

use specter_ipfs::{IpfsClient, IpfsConfig};

use specter_cache::MetaAddressCache;
use crate::suins::{SuinsClient, SuinsConfig};

/// Resolver configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SuinsResolverConfig {
    /// SuiNS configuration
    pub suins: SuinsConfig,
    /// IPFS configuration (requires dedicated gateway + token)
    pub ipfs: IpfsConfig,
    /// Whether to use caching
    pub enable_cache: bool,
    /// Cache TTL in seconds
    pub cache_ttl_seconds: u64,
}

impl SuinsResolverConfig {
    /// Creates a config with Sui RPC URL and dedicated Pinata gateway (required for IPFS retrieves).
    pub fn new(
        rpc_url: impl Into<String>,
        use_testnet: bool,
        gateway_url: impl Into<String>,
        gateway_token: impl Into<String>,
    ) -> Self {
        Self {
            suins: SuinsConfig::new(rpc_url, use_testnet),
            ipfs: IpfsConfig::new(gateway_url, gateway_token),
            enable_cache: true,
            cache_ttl_seconds: 3600,
        }
    }

    /// Adds Pinata JWT for uploads (v3 API).
    pub fn with_pinata_jwt(mut self, jwt: impl Into<String>) -> Self {
        self.ipfs = self.ipfs.with_pinata_jwt(jwt);
        self
    }

    /// Disables caching.
    pub fn no_cache(mut self) -> Self {
        self.enable_cache = false;
        self
    }
}

/// SPECTER resolver that combines SuiNS and IPFS.
///
/// Resolves SuiNS names to meta-addresses by:
/// 1. Looking up the SuiNS content hash field
/// 2. Parsing the IPFS CID from the content hash
/// 3. Fetching the meta-address from IPFS
/// 4. Deserializing and validating the meta-address
pub struct SuinsResolver {
    suins: SuinsClient,
    ipfs: IpfsClient,
    cache: Option<MetaAddressCache>,
    #[allow(dead_code)]
    config: SuinsResolverConfig,
}

impl SuinsResolver {
    /// Creates a resolver with custom configuration.
    pub fn with_config(config: SuinsResolverConfig) -> Self {
        let suins = SuinsClient::with_config(config.suins.clone());
        let ipfs = IpfsClient::with_config(config.ipfs.clone());

        let cache = if config.enable_cache {
            Some(MetaAddressCache::new())
        } else {
            None
        };

        Self {
            suins,
            ipfs,
            cache,
            config,
        }
    }

    /// Resolves a SuiNS name to a meta-address.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let config = SuinsResolverConfig::new(rpc_url, gateway_url, gateway_token);
    /// let resolver = SuinsResolver::with_config(config);
    /// let meta = resolver.resolve("alice.sui").await?;
    /// ```
    #[instrument(skip(self))]
    pub async fn resolve(&self, suins_name: &str) -> Result<MetaAddress> {
        let result = self.resolve_full(suins_name).await?;
        Ok(result.meta_address)
    }

    /// Resolves a SuiNS name to a meta-address with metadata (CID, cache status).
    #[instrument(skip(self))]
    pub async fn resolve_full(&self, suins_name: &str) -> Result<SuinsResolveResult> {
        // Check cache first
        if let Some(cache) = &self.cache {
            if let Some(meta) = cache.get(suins_name) {
                debug!(suins_name, "Cache hit");
                return Ok(SuinsResolveResult {
                    meta_address: meta,
                    suins_name: suins_name.to_string(),
                    ipfs_cid: String::new(),
                    from_cache: true,
                });
            }
        }

        debug!(suins_name, "Cache miss, resolving");

        // Get IPFS CID from SuiNS content hash
        let content_hash = self
            .suins
            .get_content_hash(suins_name)
            .await?
            .ok_or_else(|| SpecterError::NoSuinsSpecterRecord(suins_name.to_string()))?;

        let cid = self.parse_cid(&content_hash)?;

        debug!(suins_name, cid, "Found IPFS CID");

        // Fetch from IPFS
        let data = self.ipfs.download(&cid).await?;

        // Deserialize meta-address
        let meta = MetaAddress::from_bytes(&data)?;

        // Validate
        meta.validate()?;

        info!(suins_name, "Resolved meta-address");

        // Cache if enabled
        if let Some(cache) = &self.cache {
            cache.set(suins_name, meta.clone());
        }

        Ok(SuinsResolveResult {
            meta_address: meta,
            suins_name: suins_name.to_string(),
            ipfs_cid: cid,
            from_cache: false,
        })
    }

    /// Checks if a SuiNS name has a SPECTER record.
    #[instrument(skip(self))]
    pub async fn has_record(&self, suins_name: &str) -> Result<bool> {
        self.suins.has_specter_record(suins_name).await
    }

    /// Uploads a meta-address to IPFS.
    ///
    /// Returns the IPFS CID that should be set as the SuiNS content hash.
    #[instrument(skip(self, meta))]
    pub async fn upload(&self, meta: &MetaAddress, name: Option<&str>) -> Result<String> {
        meta.validate()?;
        let data = meta.to_bytes();
        let cid = self.ipfs.upload(&data, name).await?;
        info!(cid, "Uploaded meta-address to IPFS");
        Ok(cid)
    }

    /// Retrieves a meta-address from IPFS by CID.
    #[instrument(skip(self))]
    pub async fn retrieve(&self, cid: &str) -> Result<MetaAddress> {
        let data = self.download_raw(cid).await?;
        let meta = MetaAddress::from_bytes(&data)?;
        meta.validate()?;
        info!(cid, "Retrieved meta-address from IPFS");
        Ok(meta)
    }

    /// Downloads raw bytes from IPFS by CID (for proxying to frontend).
    #[instrument(skip(self))]
    pub async fn download_raw(&self, cid: &str) -> Result<Vec<u8>> {
        let cid = self.parse_cid(cid)?;
        self.ipfs.download(&cid).await
    }

    /// Returns the formatted content hash value for a CID.
    ///
    /// Returns the CID in the format expected by SuiNS: "ipfs://CID"
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

        if raw.starts_with("ipfs://") {
            Ok(raw.strip_prefix("ipfs://").unwrap().to_string())
        } else if raw.starts_with("/ipfs/") {
            Ok(raw.strip_prefix("/ipfs/").unwrap().to_string())
        } else if raw.starts_with("Qm") || raw.starts_with("bafy") || raw.starts_with("bafk") {
            Ok(raw.to_string())
        } else {
            Err(SpecterError::InvalidIpfsCid(format!(
                "Invalid CID format: {}",
                raw
            )))
        }
    }
}

/// Result of a SuiNS resolution with metadata.
#[derive(Clone, Debug)]
pub struct SuinsResolveResult {
    /// The resolved meta-address
    pub meta_address: MetaAddress,
    /// The SuiNS name that was resolved
    pub suins_name: String,
    /// The IPFS CID where the meta-address is stored
    pub ipfs_cid: String,
    /// Whether the result came from cache
    pub from_cache: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_resolver() -> SuinsResolver {
        SuinsResolver::with_config(SuinsResolverConfig::new(
            "https://x",
            false,
            "https://gateway.test",
            "token",
        ))
    }

    #[test]
    fn test_parse_cid_ipfs_prefix() {
        let resolver = test_resolver();

        let cid = resolver.parse_cid("ipfs://QmTest123").unwrap();
        assert_eq!(cid, "QmTest123");
    }

    #[test]
    fn test_parse_cid_path_prefix() {
        let resolver = test_resolver();

        let cid = resolver.parse_cid("/ipfs/QmTest123").unwrap();
        assert_eq!(cid, "QmTest123");
    }

    #[test]
    fn test_parse_cid_raw() {
        let resolver = test_resolver();

        let cid = resolver
            .parse_cid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")
            .unwrap();
        assert!(cid.starts_with("Qm"));
    }

    #[test]
    fn test_parse_cid_v1() {
        let resolver = test_resolver();

        let cid = resolver
            .parse_cid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
            .unwrap();
        assert!(cid.starts_with("bafy"));
    }

    #[test]
    fn test_format_text_record() {
        let resolver = test_resolver();

        let record = resolver.format_text_record("QmTest123");
        assert_eq!(record, "ipfs://QmTest123");

        // Should not double-prefix
        let record2 = resolver.format_text_record("ipfs://QmTest123");
        assert_eq!(record2, "ipfs://QmTest123");
    }

    #[test]
    fn test_config_builder() {
        let config = SuinsResolverConfig::new("https://test.com", false, "gateway.test", "token")
            .with_pinata_jwt("my_jwt")
            .no_cache();

        assert_eq!(config.suins.rpc_url, "https://test.com");
        assert_eq!(config.ipfs.gateway_url, "gateway.test");
        assert_eq!(config.ipfs.pinata_jwt, Some("my_jwt".into()));
        assert!(!config.enable_cache);
    }

    #[test]
    fn test_parse_cid_invalid() {
        let resolver = test_resolver();
        assert!(resolver.parse_cid("invalid").is_err());
        assert!(resolver.parse_cid("http://example.com").is_err());
        assert!(resolver.parse_cid("").is_err());
    }
}
