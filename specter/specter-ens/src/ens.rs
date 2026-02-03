//! ENS client for resolving text records.
//!
//! Provides functionality to query ENS text records to retrieve
//! SPECTER meta-address CIDs stored on IPFS.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tracing::{debug, instrument, warn};

use specter_core::constants::{ENS_TEXT_KEY, ENS_TEXT_KEY_ALT};
use specter_core::error::{Result, SpecterError};

/// ENS client configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EnsConfig {
    /// Ethereum RPC URL
    pub rpc_url: String,
    /// Request timeout in seconds
    pub timeout_seconds: u64,
    /// Whether to use the public resolver
    pub use_public_resolver: bool,
}

/// Default Ethereum RPC URL when none is provided.
const DEFAULT_ETH_RPC_URL: &str = "https://ethereum.publicnode.com";

impl Default for EnsConfig {
    fn default() -> Self {
        Self {
            rpc_url: DEFAULT_ETH_RPC_URL.into(),
            timeout_seconds: 30,
            use_public_resolver: true,
        }
    }
}

impl EnsConfig {
    /// Creates a new configuration with the given RPC URL.
    pub fn new(rpc_url: impl Into<String>) -> Self {
        Self {
            rpc_url: rpc_url.into(),
            ..Default::default()
        }
    }
}

/// ENS client for querying text records.
pub struct EnsClient {
    config: EnsConfig,
    http_client: reqwest::Client,
}

impl EnsClient {
    /// Creates a new ENS client with default configuration.
    pub fn new(rpc_url: impl Into<String>) -> Self {
        Self::with_config(EnsConfig::new(rpc_url))
    }

    /// Creates a new ENS client with custom configuration.
    pub fn with_config(config: EnsConfig) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_seconds))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            config,
            http_client,
        }
    }

    /// Gets the SPECTER text record for an ENS name.
    ///
    /// Tries the primary key first ("specter"), then falls back to
    /// the alternate key ("pq-stealth").
    ///
    /// # Returns
    ///
    /// The IPFS CID stored in the text record, or None if not found.
    #[instrument(skip(self))]
    pub async fn get_specter_record(&self, name: &str) -> Result<Option<String>> {
        // Try primary key
        if let Some(value) = self.get_text_record(name, ENS_TEXT_KEY).await? {
            debug!(name, key = ENS_TEXT_KEY, "Found SPECTER record");
            return Ok(Some(value));
        }

        // Try alternate key
        if let Some(value) = self.get_text_record(name, ENS_TEXT_KEY_ALT).await? {
            debug!(name, key = ENS_TEXT_KEY_ALT, "Found SPECTER record (alternate key)");
            return Ok(Some(value));
        }

        debug!(name, "No SPECTER record found");
        Ok(None)
    }

    /// Gets a specific text record for an ENS name.
    #[instrument(skip(self))]
    pub async fn get_text_record(&self, name: &str, key: &str) -> Result<Option<String>> {
        // Normalize ENS name
        let normalized = self.normalize_name(name)?;

        // Build the JSON-RPC request
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [
                {
                    "to": "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63", // Universal Resolver
                    "data": self.encode_resolve_call(&normalized, key)
                },
                "latest"
            ],
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

        // Parse response
        if let Some(error) = json.get("error") {
            warn!(name, key, error = ?error, "ENS resolution error");
            return Ok(None);
        }

        let result = json
            .get("result")
            .and_then(|v| v.as_str())
            .unwrap_or("0x");

        // Decode the text record from ABI-encoded response
        self.decode_text_response(result)
    }

    /// Checks if an ENS name has a SPECTER record.
    pub async fn has_specter_record(&self, name: &str) -> Result<bool> {
        Ok(self.get_specter_record(name).await?.is_some())
    }

    /// Normalizes an ENS name (lowercase, validate format).
    fn normalize_name(&self, name: &str) -> Result<String> {
        let normalized = name.trim().to_lowercase();

        // Basic validation
        if normalized.is_empty() {
            return Err(SpecterError::ValidationError("ENS name cannot be empty".into()));
        }

        if !normalized.ends_with(".eth") && !normalized.contains('.') {
            return Err(SpecterError::ValidationError(
                "ENS name must end with .eth or be a full domain".into(),
            ));
        }

        Ok(normalized)
    }

    /// Encodes the resolve() call for Universal Resolver.
    fn encode_resolve_call(&self, name: &str, key: &str) -> String {
        // This is a simplified encoding - in production, use proper ABI encoding
        // The Universal Resolver accepts: resolve(bytes name, bytes data)
        // where data is the encoded getText(bytes32,string) call
        
        // For now, return placeholder - actual implementation would use ethers-rs
        let namehash = self.compute_namehash(name);
        format!("0x9061b923{}{}", hex::encode(&namehash), self.encode_string(key))
    }

    /// Computes the namehash for an ENS name.
    fn compute_namehash(&self, name: &str) -> [u8; 32] {
        use sha3::{Keccak256, Digest};

        let mut node = [0u8; 32];

        for label in name.rsplit('.') {
            if label.is_empty() {
                continue;
            }

            let label_hash = Keccak256::digest(label.as_bytes());
            
            let mut combined = [0u8; 64];
            combined[..32].copy_from_slice(&node);
            combined[32..].copy_from_slice(&label_hash);
            
            node = Keccak256::digest(&combined).into();
        }

        node
    }

    /// ABI-encodes a string.
    fn encode_string(&self, s: &str) -> String {
        // Simplified ABI encoding for string
        let bytes = s.as_bytes();
        let len = bytes.len();
        let padded_len = ((len + 31) / 32) * 32;
        
        let mut encoded = vec![0u8; 64 + padded_len];
        // Offset (32 bytes)
        encoded[31] = 0x20;
        // Length (32 bytes)
        encoded[63] = len as u8;
        // Data (padded to 32 bytes)
        encoded[64..64 + len].copy_from_slice(bytes);
        
        hex::encode(&encoded)
    }

    /// Decodes a text response from ABI encoding.
    fn decode_text_response(&self, hex_data: &str) -> Result<Option<String>> {
        let data = hex_data.strip_prefix("0x").unwrap_or(hex_data);
        
        if data.is_empty() || data == "0" || data.len() < 128 {
            return Ok(None);
        }

        let bytes = hex::decode(data).map_err(|e| SpecterError::HexError(e))?;
        
        if bytes.len() < 64 {
            return Ok(None);
        }

        // Parse ABI-encoded string
        // Skip offset (32 bytes), read length (32 bytes), then data
        let length = u64::from_be_bytes(bytes[56..64].try_into().unwrap_or_default()) as usize;
        
        if length == 0 || bytes.len() < 64 + length {
            return Ok(None);
        }

        let text = String::from_utf8(bytes[64..64 + length].to_vec())
            .map_err(|e| SpecterError::ValidationError(e.to_string()))?;

        if text.is_empty() {
            Ok(None)
        } else {
            Ok(Some(text))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_name() {
        let client = EnsClient::new("https://example.com");
        
        assert_eq!(
            client.normalize_name("Alice.eth").unwrap(),
            "alice.eth"
        );
        
        assert_eq!(
            client.normalize_name("  BOB.ETH  ").unwrap(),
            "bob.eth"
        );
        
        assert!(client.normalize_name("").is_err());
    }

    #[test]
    fn test_compute_namehash() {
        let client = EnsClient::new("https://example.com");
        
        // Known namehash for "eth"
        let namehash = client.compute_namehash("eth");
        let expected = hex::decode(
            "93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae"
        ).unwrap();
        
        assert_eq!(namehash.as_slice(), expected.as_slice());
    }

    #[test]
    fn test_decode_empty_response() {
        let client = EnsClient::new("https://example.com");
        
        assert!(client.decode_text_response("0x").unwrap().is_none());
        assert!(client.decode_text_response("").unwrap().is_none());
    }
}
