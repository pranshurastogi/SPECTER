//! SuiNS client for resolving names and reading content hash.
//!
//! Uses Sui JSON-RPC to query SuiNS name records. The content hash
//! field stores the IPFS CID where the SPECTER meta-address lives.

use serde::{Deserialize, Serialize};
use tracing::{debug, instrument};

use specter_core::constants::{
    SUINS_PACKAGE_ID_MAINNET, SUINS_PACKAGE_ID_TESTNET, SUINS_REGISTRY_TABLE_ID_MAINNET,
    SUINS_REGISTRY_TABLE_ID_TESTNET, SUI_MAINNET_RPC_URL,
};
use specter_core::error::{Result, SpecterError};

/// SuiNS client configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SuinsConfig {
    /// Sui RPC URL
    pub rpc_url: String,
    /// Whether to use testnet constants (registry table, package ID)
    pub use_testnet: bool,
    /// Request timeout in seconds
    pub timeout_seconds: u64,
}

impl Default for SuinsConfig {
    fn default() -> Self {
        Self {
            rpc_url: SUI_MAINNET_RPC_URL.into(),
            use_testnet: false,
            timeout_seconds: 30,
        }
    }
}

impl SuinsConfig {
    /// Creates a new configuration with the given RPC URL.
    pub fn new(rpc_url: impl Into<String>, use_testnet: bool) -> Self {
        Self {
            rpc_url: rpc_url.into(),
            use_testnet,
            ..Default::default()
        }
    }

    /// Returns the SuiNS registry table ID for the configured network.
    pub fn registry_table_id(&self) -> &str {
        if self.use_testnet {
            SUINS_REGISTRY_TABLE_ID_TESTNET
        } else {
            SUINS_REGISTRY_TABLE_ID_MAINNET
        }
    }

    /// Returns the SuiNS v1 package ID for the configured network.
    pub fn package_id(&self) -> &str {
        if self.use_testnet {
            SUINS_PACKAGE_ID_TESTNET
        } else {
            SUINS_PACKAGE_ID_MAINNET
        }
    }
}

/// SuiNS client for querying name records via Sui JSON-RPC.
pub struct SuinsClient {
    config: SuinsConfig,
    http_client: reqwest::Client,
}

impl SuinsClient {
    /// Creates a new SuiNS client with custom configuration.
    pub fn with_config(config: SuinsConfig) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_seconds))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            config,
            http_client,
        }
    }

    /// Resolves a SuiNS name to a Sui address.
    ///
    /// Uses `suix_resolveNameServiceAddress` JSON-RPC method.
    ///
    /// # Returns
    ///
    /// The Sui address (hex string), or None if the name is not registered.
    #[instrument(skip(self))]
    pub async fn resolve_address(&self, name: &str) -> Result<Option<String>> {
        let normalized = self.normalize_name(name)?;

        let result = self
            .sui_rpc_call(
                "suix_resolveNameServiceAddress",
                serde_json::json!([normalized]),
            )
            .await?;

        match result {
            Some(serde_json::Value::String(addr)) if !addr.is_empty() => {
                debug!(name, address = %addr, "Resolved SuiNS name to address");
                Ok(Some(addr))
            }
            _ => {
                debug!(name, "SuiNS name not found");
                Ok(None)
            }
        }
    }

    /// Gets the SPECTER content hash for a SuiNS name.
    ///
    /// Reads the `content_hash` field from the SuiNS name record stored in
    /// the registry table. The name record is a dynamic field on the registry
    /// table, keyed by a `Domain` type with reversed labels.
    ///
    /// # Returns
    ///
    /// The content hash string (e.g. "ipfs://Qm..."), or None if not set.
    #[instrument(skip(self))]
    pub async fn get_content_hash(&self, name: &str) -> Result<Option<String>> {
        let normalized = self.normalize_name(name)?;

        // First verify the name exists by resolving it
        let address = self.resolve_address(&normalized).await?;
        if address.is_none() {
            return Ok(None);
        }

        // Build the Domain key. SuiNS stores labels in reverse order:
        // "amangupta.sui" -> labels: ["sui", "amangupta"]
        let labels: Vec<&str> = normalized.split('.').rev().collect();

        let domain_type = format!("{}::domain::Domain", self.config.package_id());

        let result = self
            .sui_rpc_call(
                "suix_getDynamicFieldObject",
                serde_json::json!([
                    self.config.registry_table_id(),
                    {
                        "type": domain_type,
                        "value": {
                            "labels": labels
                        }
                    }
                ]),
            )
            .await?;

        // Parse the name record from the response.
        // Structure: result.data.content.fields.value.fields.data.fields.contents[]
        let content_hash = result
            .as_ref()
            .and_then(|v| v.get("data"))
            .and_then(|v| v.get("content"))
            .and_then(|v| v.get("fields"))
            .and_then(|v| v.get("value"))
            .and_then(|v| v.get("fields"))
            .and_then(|fields| self.extract_content_hash(fields));

        if let Some(ref hash) = content_hash {
            debug!(name, content_hash = %hash, "Found content hash");
        } else {
            debug!(name, "No content hash set");
        }

        Ok(content_hash)
    }

    /// Extracts the content_hash from a SuiNS name record's fields.
    ///
    /// The name record stores user data in a VecMap<String, String>.
    /// We look for the "content_hash" entry. The VecMap is serialized as:
    /// ```json
    /// { "data": { "fields": { "contents": [
    ///     { "fields": { "key": "content_hash", "value": "ipfs://..." } }
    /// ] } } }
    /// ```
    fn extract_content_hash(&self, fields: &serde_json::Value) -> Option<String> {
        let contents = fields
            .get("data")
            .and_then(|d| d.get("fields"))
            .and_then(|f| f.get("contents"))
            .and_then(|c| c.as_array())?;

        for entry in contents {
            let key = entry
                .get("fields")
                .and_then(|f| f.get("key"))
                .and_then(|k| k.as_str());

            let value = entry
                .get("fields")
                .and_then(|f| f.get("value"))
                .and_then(|v| v.as_str());

            if key == Some("content_hash") {
                if let Some(v) = value {
                    if !v.is_empty() {
                        return Some(v.to_string());
                    }
                }
            }
        }

        None
    }

    /// Checks if a SuiNS name has a SPECTER record (content hash set).
    pub async fn has_specter_record(&self, name: &str) -> Result<bool> {
        Ok(self.get_content_hash(name).await?.is_some())
    }

    /// Makes a JSON-RPC call to the Sui fullnode.
    async fn sui_rpc_call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<Option<serde_json::Value>> {
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": 1
        });

        let response = self
            .http_client
            .post(&self.config.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| SpecterError::HttpError(e.to_string()))?;

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| SpecterError::HttpError(e.to_string()))?;

        if let Some(error) = json.get("error") {
            let msg = error
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown RPC error");
            debug!(method, error = %msg, "Sui RPC error");
            return Ok(None);
        }

        Ok(json.get("result").cloned())
    }

    /// Normalizes a SuiNS name (lowercase, validate format).
    fn normalize_name(&self, name: &str) -> Result<String> {
        let normalized = name.trim().to_lowercase();

        if normalized.is_empty() {
            return Err(SpecterError::ValidationError(
                "SuiNS name cannot be empty".into(),
            ));
        }

        if !normalized.ends_with(".sui") {
            return Err(SpecterError::ValidationError(
                "SuiNS name must end with .sui".into(),
            ));
        }

        // Extract the label (part before .sui)
        let label = normalized.strip_suffix(".sui").unwrap_or(&normalized);
        if label.is_empty() {
            return Err(SpecterError::ValidationError(
                "SuiNS name label cannot be empty".into(),
            ));
        }

        if label.contains("..") {
            return Err(SpecterError::ValidationError(
                "SuiNS name cannot contain consecutive dots".into(),
            ));
        }

        Ok(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_client() -> SuinsClient {
        SuinsClient::with_config(SuinsConfig {
            rpc_url: "https://example.com".into(),
            use_testnet: false,
            timeout_seconds: 30,
        })
    }

    #[test]
    fn test_normalize_name() {
        let client = test_client();

        assert_eq!(client.normalize_name("Alice.sui").unwrap(), "alice.sui");
        assert_eq!(client.normalize_name("  BOB.SUI  ").unwrap(), "bob.sui");
    }

    #[test]
    fn test_normalize_rejects_invalid() {
        let client = test_client();

        assert!(client.normalize_name("").is_err());
        assert!(client.normalize_name("no-tld").is_err());
        assert!(client.normalize_name("test.eth").is_err());
        assert!(client.normalize_name(".sui").is_err());
    }

    #[test]
    fn test_normalize_accepts_subnames() {
        let client = test_client();

        assert_eq!(
            client.normalize_name("sub.name.sui").unwrap(),
            "sub.name.sui"
        );
    }

    #[test]
    fn test_suins_config_registry_table() {
        let mainnet = SuinsConfig::new("https://rpc.example.com", false);
        assert_eq!(mainnet.registry_table_id(), SUINS_REGISTRY_TABLE_ID_MAINNET);
        assert_eq!(mainnet.package_id(), SUINS_PACKAGE_ID_MAINNET);

        let testnet = SuinsConfig::new("https://rpc.example.com", true);
        assert_eq!(testnet.registry_table_id(), SUINS_REGISTRY_TABLE_ID_TESTNET);
        assert_eq!(testnet.package_id(), SUINS_PACKAGE_ID_TESTNET);
    }

    #[test]
    fn test_suins_config_default() {
        let config = SuinsConfig::default();
        assert_eq!(config.rpc_url, SUI_MAINNET_RPC_URL);
        assert!(!config.use_testnet);
    }

    #[test]
    fn test_extract_content_hash_from_vec_map() {
        let client = test_client();

        // Real structure from Sui RPC: result.data.content.fields.value.fields
        let fields = serde_json::json!({
            "data": {
                "fields": {
                    "contents": [
                        {
                            "fields": {
                                "key": "content_hash",
                                "value": "ipfs://QmTest123"
                            }
                        }
                    ]
                }
            }
        });

        let result = client.extract_content_hash(&fields);
        assert_eq!(result, Some("ipfs://QmTest123".into()));
    }

    #[test]
    fn test_extract_content_hash_with_multiple_entries() {
        let client = test_client();

        let fields = serde_json::json!({
            "data": {
                "fields": {
                    "contents": [
                        {
                            "fields": {
                                "key": "avatar",
                                "value": "some-avatar"
                            }
                        },
                        {
                            "fields": {
                                "key": "content_hash",
                                "value": "ipfs://bafkreitest"
                            }
                        }
                    ]
                }
            }
        });

        let result = client.extract_content_hash(&fields);
        assert_eq!(result, Some("ipfs://bafkreitest".into()));
    }

    #[test]
    fn test_extract_content_hash_empty() {
        let client = test_client();

        let fields = serde_json::json!({
            "data": {
                "fields": {
                    "contents": []
                }
            }
        });

        let result = client.extract_content_hash(&fields);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_content_hash_no_content_hash_key() {
        let client = test_client();

        let fields = serde_json::json!({
            "data": {
                "fields": {
                    "contents": [
                        {
                            "fields": {
                                "key": "avatar",
                                "value": "some-avatar"
                            }
                        }
                    ]
                }
            }
        });

        let result = client.extract_content_hash(&fields);
        assert!(result.is_none());
    }
}
