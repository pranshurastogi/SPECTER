//! Combined ENS + IPFS resolver for fetching meta-addresses.
//!
//! ENS lookups are never cached (records can change at any time).
//! IPFS downloads are cached at the `IpfsClient` layer (content-addressed = immutable).

use serde::{Deserialize, Serialize};
use tracing::{debug, info, instrument};

use specter_core::error::{Result, SpecterError};
use specter_core::types::MetaAddress;

use specter_ipfs::{IpfsClient, IpfsConfig};

use crate::ens::{EnsClient, EnsConfig};

/// Resolver configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResolverConfig {
    /// ENS configuration
    pub ens: EnsConfig,
    /// IPFS configuration (requires dedicated gateway + token)
    pub ipfs: IpfsConfig,
}

impl ResolverConfig {
    /// Creates a config with RPC URL and dedicated Pinata gateway (required for IPFS retrieves).
    pub fn new(
        rpc_url: impl Into<String>,
        gateway_url: impl Into<String>,
        gateway_token: impl Into<String>,
    ) -> Self {
        Self {
            ens: EnsConfig::new(rpc_url),
            ipfs: IpfsConfig::new(gateway_url, gateway_token),
        }
    }

    /// Adds Pinata JWT for uploads (v3 API).
    pub fn with_pinata_jwt(mut self, jwt: impl Into<String>) -> Self {
        self.ipfs = self.ipfs.with_pinata_jwt(jwt);
        self
    }
}

/// SPECTER resolver that combines ENS and IPFS.
///
/// Resolves ENS names to meta-addresses by:
/// 1. Looking up the ENS text record "specter", or
///    if missing, the ENS Content Hash (EIP-1577) from the resolver's contenthash()
/// 2. Parsing the IPFS CID from the record or content hash
/// 3. Fetching the meta-address from IPFS (cached by CID in IpfsClient)
/// 4. Deserializing and validating the meta-address
///
/// ENS lookups are always fresh (no caching) since records can change.
/// IPFS downloads are cached at the IpfsClient layer since content is immutable.
pub struct SpecterResolver {
    ens: EnsClient,
    ipfs: IpfsClient,
    #[allow(dead_code)]
    config: ResolverConfig,
}

impl SpecterResolver {
    /// Creates a resolver with custom configuration.
    pub fn with_config(config: ResolverConfig) -> Self {
        let ens = EnsClient::with_config(config.ens.clone());
        let ipfs = IpfsClient::with_config(config.ipfs.clone());

        Self {
            ens,
            ipfs,
            config,
        }
    }

    /// Resolves an ENS name to a meta-address.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let config = ResolverConfig::new(rpc_url, gateway_url, gateway_token);
    /// let resolver = SpecterResolver::with_config(config);
    /// let meta = resolver.resolve("alice.eth").await?;
    /// ```
    #[instrument(skip(self))]
    pub async fn resolve(&self, ens_name: &str) -> Result<MetaAddress> {
        let result = self.resolve_full(ens_name).await?;
        Ok(result.meta_address)
    }

    /// Resolves an ENS name to a meta-address with metadata.
    ///
    /// Always performs a fresh ENS lookup. IPFS downloads are cached by CID.
    #[instrument(skip(self))]
    pub async fn resolve_full(&self, ens_name: &str) -> Result<ResolveResult> {
        debug!(ens_name, "Resolving ENS name (no cache)");

        // Get IPFS CID: try "specter" text record first, then Content Hash (EIP-1577)
        let cid = if let Some(record_value) = self.ens.get_specter_record(ens_name).await? {
            self.parse_cid(&record_value)?
        } else if let Some(content_cid) = self.ens.get_content_hash(ens_name).await? {
            content_cid
        } else {
            return Err(SpecterError::NoSpecterRecord(ens_name.to_string()));
        };

        debug!(ens_name, cid, "Found IPFS CID");

        // Fetch from IPFS (cached by CID inside IpfsClient)
        let data = self.ipfs.download(&cid).await?;

        // Deserialize meta-address
        let meta = MetaAddress::from_bytes(&data)?;

        // Validate
        meta.validate()?;

        info!(ens_name, cid, "Resolved meta-address");

        Ok(ResolveResult {
            meta_address: meta,
            ens_name: ens_name.to_string(),
            ipfs_cid: cid,
        })
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

    /// Retrieves a meta-address from IPFS by CID.
    ///
    /// Uses the configured gateway (including dedicated Pinata gateway with token if set).
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

    /// Clears the IPFS download cache.
    pub fn clear_cache(&self) {
        self.ipfs.clear_cache();
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


/// Result of a resolution with metadata.
#[derive(Clone, Debug)]
pub struct ResolveResult {
    /// The resolved meta-address
    pub meta_address: MetaAddress,
    /// The ENS name that was resolved
    pub ens_name: String,
    /// The IPFS CID where the meta-address is stored
    pub ipfs_cid: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_resolver() -> SpecterResolver {
        SpecterResolver::with_config(ResolverConfig::new(
            "https://x",
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
        
        let cid = resolver.parse_cid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG").unwrap();
        assert!(cid.starts_with("Qm"));
    }

    #[test]
    fn test_parse_cid_v1() {
        let resolver = test_resolver();
        
        let cid = resolver.parse_cid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi").unwrap();
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
        let config = ResolverConfig::new("https://test.com", "gateway.test", "token")
            .with_pinata_jwt("my_jwt");

        assert_eq!(config.ens.rpc_url, "https://test.com");
        assert_eq!(config.ipfs.gateway_url, "gateway.test");
        assert_eq!(config.ipfs.pinata_jwt, Some("my_jwt".into()));
    }

    #[test]
    fn test_parse_cid_invalid() {
        let resolver = test_resolver();
        assert!(resolver.parse_cid("invalid").is_err());
        assert!(resolver.parse_cid("http://example.com").is_err());
        assert!(resolver.parse_cid("").is_err());
    }
}
