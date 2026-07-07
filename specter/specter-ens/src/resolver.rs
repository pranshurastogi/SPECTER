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

        Self { ens, ipfs, config }
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

    // ── whole-flow: resolve_full over mocked eth_call + IPFS gateway ────────
    //
    // Both `resolver(bytes32)` and `text(bytes32,string)` are eth_call JSON-RPC
    // requests to the same URL, distinguished only by their 4-byte function
    // selector inside the request body — mocks below match on that selector
    // rather than the full ABI-encoded call, since the namehash/key encoding
    // is exercised by ens.rs's own unit tests.

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
        let spending_pub = test_spending_pub(0x77);
        let viewing_pk = KyberPublicKey::from_array([0x88; KYBER_PUBLIC_KEY_SIZE]);
        MetaAddress::new(spending_pub, viewing_pk)
    }

    /// Builds the ABI encoding of a single dynamic `string` return value:
    /// offset word + length word + the string bytes (unpadded — the decoder
    /// only reads exactly `length` bytes past the header).
    fn abi_encode_string_return(s: &str) -> String {
        let bytes = s.as_bytes();
        let mut out = vec![0u8; 64 + bytes.len()];
        out[31] = 0x20; // offset = 32
        out[56..64].copy_from_slice(&(bytes.len() as u64).to_be_bytes());
        out[64..64 + bytes.len()].copy_from_slice(bytes);
        format!("0x{}", hex::encode(out))
    }

    /// A 32-byte ABI address return: 12 zero bytes + the 20-byte address.
    fn abi_encode_address_return(addr_byte: u8) -> String {
        let mut out = [0u8; 32];
        out[12..].fill(addr_byte);
        format!("0x{}", hex::encode(out))
    }

    #[tokio::test]
    async fn test_resolve_full_whole_flow_over_mocked_network() {
        let eth_rpc = MockServer::start().await;
        let ipfs_gateway = MockServer::start().await;

        let cid = "bafkreibopfezkz4lk6ubucbgymspyyhy7ws4pe4zfkdqq6dzo74yzvf3cm";
        let meta = test_meta_address();

        // resolver(bytes32) on the ENS registry — any non-zero resolver address.
        Mock::given(method("POST"))
            .and(body_string_contains("0178b8bf"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": abi_encode_address_return(0x11)
            })))
            .mount(&eth_rpc)
            .await;

        // text(bytes32,string) on the resolver — the "specter" text record.
        Mock::given(method("POST"))
            .and(body_string_contains("59d1d43c"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": abi_encode_string_return(&format!("ipfs://{cid}"))
            })))
            .mount(&eth_rpc)
            .await;

        Mock::given(method("GET"))
            .and(wiremock::matchers::path(format!("/ipfs/{cid}")))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(meta.to_bytes()))
            .mount(&ipfs_gateway)
            .await;

        let resolver = SpecterResolver::with_config(ResolverConfig::new(
            eth_rpc.uri(),
            ipfs_gateway.uri(),
            "test-gateway-token",
        ));

        let result = resolver
            .resolve_full("jeremy.eth")
            .await
            .expect("whole flow must resolve successfully");

        assert_eq!(result.meta_address.to_bytes(), meta.to_bytes());
        assert_eq!(result.ens_name, "jeremy.eth");
        assert_eq!(result.ipfs_cid, cid);
    }

    /// A name whose resolver has no text record and no content hash set must
    /// fail with `NoSpecterRecord`, not some other error.
    #[tokio::test]
    async fn test_resolve_full_no_record_is_no_specter_record() {
        let eth_rpc = MockServer::start().await;
        let ipfs_gateway = MockServer::start().await;

        // Resolver resolves, but both text() and contenthash() come back empty.
        Mock::given(method("POST"))
            .and(body_string_contains("0178b8bf"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": abi_encode_address_return(0x11)
            })))
            .mount(&eth_rpc)
            .await;
        Mock::given(method("POST"))
            .and(body_string_contains("59d1d43c"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": "0x"
            })))
            .mount(&eth_rpc)
            .await;
        Mock::given(method("POST"))
            .and(body_string_contains("bc1c58d1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": "0x"
            })))
            .mount(&eth_rpc)
            .await;

        let resolver = SpecterResolver::with_config(ResolverConfig::new(
            eth_rpc.uri(),
            ipfs_gateway.uri(),
            "test-gateway-token",
        ));

        let err = resolver
            .resolve_full("no-record.eth")
            .await
            .expect_err("a name with no text record or content hash must not resolve");
        assert!(matches!(err, SpecterError::NoSpecterRecord(_)));
    }
}
