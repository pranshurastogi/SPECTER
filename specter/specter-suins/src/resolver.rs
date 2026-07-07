//! Combined SuiNS + IPFS resolver for fetching meta-addresses.
//!
//! SuiNS lookups are never cached (records can change at any time).
//! IPFS downloads are cached at the `IpfsClient` layer (content-addressed = immutable).

use serde::{Deserialize, Serialize};
use tracing::{debug, info, instrument};

use specter_core::error::{Result, SpecterError};
use specter_core::types::MetaAddress;

use specter_ipfs::{IpfsClient, IpfsConfig};

use crate::suins::{SuinsClient, SuinsConfig};

/// Resolver configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SuinsResolverConfig {
    /// SuiNS configuration
    pub suins: SuinsConfig,
    /// IPFS configuration (requires dedicated gateway + token)
    pub ipfs: IpfsConfig,
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
        }
    }

    /// Adds Pinata JWT for uploads (v3 API).
    pub fn with_pinata_jwt(mut self, jwt: impl Into<String>) -> Self {
        self.ipfs = self.ipfs.with_pinata_jwt(jwt);
        self
    }
}

/// SPECTER resolver that combines SuiNS and IPFS.
///
/// Resolves SuiNS names to meta-addresses by:
/// 1. Looking up the SuiNS content hash field
/// 2. Parsing the IPFS CID from the content hash
/// 3. Fetching the meta-address from IPFS (cached by CID in IpfsClient)
/// 4. Deserializing and validating the meta-address
///
/// SuiNS lookups are always fresh (no caching) since records can change.
/// IPFS downloads are cached at the IpfsClient layer since content is immutable.
pub struct SuinsResolver {
    suins: SuinsClient,
    ipfs: IpfsClient,
    #[allow(dead_code)]
    config: SuinsResolverConfig,
}

impl SuinsResolver {
    /// Creates a resolver with custom configuration.
    pub fn with_config(config: SuinsResolverConfig) -> Self {
        let suins = SuinsClient::with_config(config.suins.clone());
        let ipfs = IpfsClient::with_config(config.ipfs.clone());

        Self {
            suins,
            ipfs,
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

    /// Resolves a SuiNS name to a meta-address with metadata.
    ///
    /// Always performs a fresh SuiNS lookup. IPFS downloads are cached by CID.
    #[instrument(skip(self))]
    pub async fn resolve_full(&self, suins_name: &str) -> Result<SuinsResolveResult> {
        debug!(suins_name, "Resolving SuiNS name (no cache)");

        // Get IPFS CID from SuiNS content hash
        let content_hash = self
            .suins
            .get_content_hash(suins_name)
            .await?
            .ok_or_else(|| SpecterError::NoSuinsSpecterRecord(suins_name.to_string()))?;

        let cid = self.parse_cid(&content_hash)?;

        debug!(suins_name, cid, "Found IPFS CID");

        // Fetch from IPFS (cached by CID inside IpfsClient)
        let data = self.ipfs.download(&cid).await?;

        // Deserialize meta-address
        let meta = MetaAddress::from_bytes(&data)?;

        // Validate
        meta.validate()?;

        info!(suins_name, cid, "Resolved meta-address");

        Ok(SuinsResolveResult {
            meta_address: meta,
            suins_name: suins_name.to_string(),
            ipfs_cid: cid,
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

    /// Clears the IPFS download cache.
    pub fn clear_cache(&self) {
        self.ipfs.clear_cache();
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
            .with_pinata_jwt("my_jwt");

        assert_eq!(config.suins.rpc_url, "https://test.com");
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

    // ── whole-flow: resolve_full over mocked Sui RPC + IPFS gateway ─────────
    //
    // Response shapes below are copied verbatim from a real `suix_*` RPC
    // session (captured resolving a live testnet SuiNS name), not invented,
    // so a change to the parsing logic that would break on real network
    // shapes breaks this test too.

    use specter_core::constants::KYBER_PUBLIC_KEY_SIZE;
    use specter_core::types::{KyberPublicKey, MetaAddress, Secp256k1PublicKey};
    use wiremock::matchers::{body_string_contains, method};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// A deterministic, valid compressed secp256k1 public key for tests.
    fn test_spending_pub(seed: u8) -> Secp256k1PublicKey {
        let sk = k256::SecretKey::from_slice(&[seed; 32]).unwrap();
        let compressed = sk.public_key().to_sec1_bytes();
        Secp256k1PublicKey::from_bytes(&compressed).unwrap()
    }

    fn test_meta_address() -> MetaAddress {
        let spending_pub = test_spending_pub(0x42);
        let viewing_pk = KyberPublicKey::from_array([0x24; KYBER_PUBLIC_KEY_SIZE]);
        MetaAddress::new(spending_pub, viewing_pk)
    }

    #[tokio::test]
    async fn test_resolve_full_whole_flow_over_mocked_network() {
        let sui_rpc = MockServer::start().await;
        let ipfs_gateway = MockServer::start().await;

        // Real CID captured from a live SuiNS name-record content_hash field.
        let cid = "bafkreibopfezkz4lk6ubucbgymspyyhy7ws4pe4zfkdqq6dzo74yzvf3cm";
        let meta = test_meta_address();

        // suix_resolveNameServiceAddress — confirms the name is registered.
        Mock::given(method("POST"))
            .and(body_string_contains("suix_resolveNameServiceAddress"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": "0x75047637442dbc560a5efaf031eb29ff530e84587f200ad1cf90e5feba99f849"
            })))
            .mount(&sui_rpc)
            .await;

        // suix_getDynamicFieldObject — the name record holding content_hash.
        // Structure matches the real Sui RPC response exactly (see suins.rs
        // module docs): result.data.content.fields.value.fields.data.fields.contents[].
        Mock::given(method("POST"))
            .and(body_string_contains("suix_getDynamicFieldObject"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "data": {
                        "content": {
                            "fields": {
                                "value": {
                                    "fields": {
                                        "data": {
                                            "fields": {
                                                "contents": [
                                                    {
                                                        "fields": {
                                                            "key": "content_hash",
                                                            "value": format!("ipfs://{cid}")
                                                        }
                                                    }
                                                ]
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            })))
            .mount(&sui_rpc)
            .await;

        // IPFS gateway serves the meta-address bytes for that CID.
        Mock::given(method("GET"))
            .and(wiremock::matchers::path(format!("/ipfs/{cid}")))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(meta.to_bytes()))
            .mount(&ipfs_gateway)
            .await;

        let resolver = SuinsResolver::with_config(SuinsResolverConfig::new(
            sui_rpc.uri(),
            false,
            ipfs_gateway.uri(),
            "test-gateway-token",
        ));

        let result = resolver
            .resolve_full("jeremy.sui")
            .await
            .expect("whole flow must resolve successfully");

        assert_eq!(result.meta_address.to_bytes(), meta.to_bytes());
        assert_eq!(result.suins_name, "jeremy.sui");
        assert_eq!(result.ipfs_cid, cid);
    }

    /// A name with no SuiNS registration at all must fail with
    /// `NoSuinsSpecterRecord`, not some other error — this is exactly the
    /// failure mode a wrong-network RPC endpoint produces in production.
    #[tokio::test]
    async fn test_resolve_full_unregistered_name_is_no_specter_record() {
        let sui_rpc = MockServer::start().await;
        let ipfs_gateway = MockServer::start().await;

        Mock::given(method("POST"))
            .and(body_string_contains("suix_resolveNameServiceAddress"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": null
            })))
            .mount(&sui_rpc)
            .await;

        let resolver = SuinsResolver::with_config(SuinsResolverConfig::new(
            sui_rpc.uri(),
            false,
            ipfs_gateway.uri(),
            "test-gateway-token",
        ));

        let err = resolver
            .resolve_full("unregistered-name.sui")
            .await
            .expect_err("an unregistered name must not resolve");
        assert!(matches!(err, SpecterError::NoSuinsSpecterRecord(_)));
    }
}
