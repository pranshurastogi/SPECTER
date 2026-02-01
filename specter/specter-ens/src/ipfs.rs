//! IPFS client for storing and retrieving meta-addresses.
//!
//! Supports multiple IPFS gateways and Pinata for pinning.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tracing::{debug, instrument, warn};

use specter_core::error::{Result, SpecterError};

/// IPFS client configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IpfsConfig {
    /// Gateway URL for reading (e.g., "https://gateway.pinata.cloud")
    pub gateway_url: String,
    /// Pinata API key (optional, for uploads)
    pub pinata_api_key: Option<String>,
    /// Pinata secret key (optional, for uploads)
    pub pinata_secret_key: Option<String>,
    /// Request timeout in seconds
    pub timeout_seconds: u64,
    /// Fallback gateways for reliability
    pub fallback_gateways: Vec<String>,
}

impl Default for IpfsConfig {
    fn default() -> Self {
        Self {
            gateway_url: "https://gateway.pinata.cloud".into(),
            pinata_api_key: None,
            pinata_secret_key: None,
            timeout_seconds: 30,
            fallback_gateways: vec![
                "https://ipfs.io".into(),
                "https://cloudflare-ipfs.com".into(),
                "https://dweb.link".into(),
            ],
        }
    }
}

impl IpfsConfig {
    /// Creates a config with Pinata credentials.
    pub fn pinata(api_key: impl Into<String>, secret_key: impl Into<String>) -> Self {
        Self {
            pinata_api_key: Some(api_key.into()),
            pinata_secret_key: Some(secret_key.into()),
            ..Default::default()
        }
    }
}

/// IPFS client for upload/download operations.
pub struct IpfsClient {
    config: IpfsConfig,
    http_client: reqwest::Client,
}

impl IpfsClient {
    /// Creates a new IPFS client with default configuration.
    pub fn new() -> Self {
        Self::with_config(IpfsConfig::default())
    }

    /// Creates a new IPFS client with Pinata credentials.
    pub fn pinata(api_key: impl Into<String>, secret_key: impl Into<String>) -> Self {
        Self::with_config(IpfsConfig::pinata(api_key, secret_key))
    }

    /// Creates a new IPFS client with custom configuration.
    pub fn with_config(config: IpfsConfig) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_seconds))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            config,
            http_client,
        }
    }

    /// Uploads data to IPFS via Pinata.
    ///
    /// # Arguments
    ///
    /// * `data` - Raw bytes to upload
    /// * `name` - Optional name for the pin
    ///
    /// # Returns
    ///
    /// The IPFS CID of the uploaded content.
    #[instrument(skip(self, data))]
    pub async fn upload(&self, data: &[u8], name: Option<&str>) -> Result<String> {
        let api_key = self.config.pinata_api_key.as_ref()
            .ok_or_else(|| SpecterError::ConfigError("Pinata API key not configured".into()))?;
        let secret_key = self.config.pinata_secret_key.as_ref()
            .ok_or_else(|| SpecterError::ConfigError("Pinata secret key not configured".into()))?;

        // Build multipart form
        let file_part = reqwest::multipart::Part::bytes(data.to_vec())
            .file_name(name.unwrap_or("specter-meta-address.bin").to_string())
            .mime_str("application/octet-stream")
            .map_err(|e| SpecterError::IpfsUploadFailed(e.to_string()))?;

        let mut form = reqwest::multipart::Form::new()
            .part("file", file_part);

        // Add metadata if name provided
        if let Some(n) = name {
            let metadata = serde_json::json!({
                "name": n,
                "keyvalues": {
                    "type": "specter-meta-address"
                }
            });
            form = form.text("pinataMetadata", metadata.to_string());
        }

        let response = self
            .http_client
            .post("https://api.pinata.cloud/pinning/pinFileToIPFS")
            .header("pinata_api_key", api_key)
            .header("pinata_secret_api_key", secret_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| SpecterError::IpfsUploadFailed(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(SpecterError::IpfsUploadFailed(format!(
                "Upload failed with status {}: {}",
                status, text
            )));
        }

        let json: PinataResponse = response
            .json()
            .await
            .map_err(|e| SpecterError::IpfsUploadFailed(e.to_string()))?;

        debug!(cid = %json.ipfs_hash, "Uploaded to IPFS");
        Ok(json.ipfs_hash)
    }

    /// Downloads data from IPFS.
    ///
    /// Tries the primary gateway first, then falls back to alternates.
    #[instrument(skip(self))]
    pub async fn download(&self, cid: &str) -> Result<Vec<u8>> {
        // Validate CID format
        self.validate_cid(cid)?;

        // Try primary gateway
        match self.download_from_gateway(&self.config.gateway_url, cid).await {
            Ok(data) => return Ok(data),
            Err(e) => warn!(cid, error = %e, "Primary gateway failed"),
        }

        // Try fallback gateways
        for gateway in &self.config.fallback_gateways {
            match self.download_from_gateway(gateway, cid).await {
                Ok(data) => {
                    debug!(cid, gateway, "Downloaded from fallback gateway");
                    return Ok(data);
                }
                Err(e) => {
                    warn!(cid, gateway, error = %e, "Fallback gateway failed");
                }
            }
        }

        Err(SpecterError::IpfsDownloadFailed {
            cid: cid.to_string(),
            reason: "All gateways failed".into(),
        })
    }

    /// Downloads from a specific gateway.
    async fn download_from_gateway(&self, gateway: &str, cid: &str) -> Result<Vec<u8>> {
        let url = format!("{}/ipfs/{}", gateway.trim_end_matches('/'), cid);

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(|e| SpecterError::HttpError(e.to_string()))?;

        if !response.status().is_success() {
            return Err(SpecterError::IpfsDownloadFailed {
                cid: cid.to_string(),
                reason: format!("HTTP {}", response.status()),
            });
        }

        response
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| SpecterError::HttpError(e.to_string()))
    }

    /// Validates a CID format.
    fn validate_cid(&self, cid: &str) -> Result<()> {
        // Basic CID validation
        if cid.is_empty() {
            return Err(SpecterError::InvalidIpfsCid("CID cannot be empty".into()));
        }

        // CIDv0 starts with "Qm" and is 46 chars
        // CIDv1 starts with "b" (for base32) and varies in length
        if cid.starts_with("Qm") {
            if cid.len() != 46 {
                return Err(SpecterError::InvalidIpfsCid(format!(
                    "Invalid CIDv0 length: expected 46, got {}",
                    cid.len()
                )));
            }
        } else if cid.starts_with("bafy") || cid.starts_with("bafk") {
            // CIDv1 with base32
            if cid.len() < 50 {
                return Err(SpecterError::InvalidIpfsCid(format!(
                    "CIDv1 too short: {}",
                    cid.len()
                )));
            }
        } else if !cid.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(SpecterError::InvalidIpfsCid(
                "CID contains invalid characters".into(),
            ));
        }

        Ok(())
    }

    /// Pins an existing CID (if not already pinned).
    #[instrument(skip(self))]
    pub async fn pin(&self, cid: &str) -> Result<()> {
        let api_key = self.config.pinata_api_key.as_ref()
            .ok_or_else(|| SpecterError::ConfigError("Pinata API key not configured".into()))?;
        let secret_key = self.config.pinata_secret_key.as_ref()
            .ok_or_else(|| SpecterError::ConfigError("Pinata secret key not configured".into()))?;

        self.validate_cid(cid)?;

        let body = serde_json::json!({
            "hashToPin": cid
        });

        let response = self
            .http_client
            .post("https://api.pinata.cloud/pinning/pinByHash")
            .header("pinata_api_key", api_key)
            .header("pinata_secret_api_key", secret_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| SpecterError::HttpError(e.to_string()))?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(SpecterError::IpfsUploadFailed(format!("Pin failed: {}", text)));
        }

        debug!(cid, "Pinned to Pinata");
        Ok(())
    }

    /// Unpins a CID.
    #[instrument(skip(self))]
    pub async fn unpin(&self, cid: &str) -> Result<()> {
        let api_key = self.config.pinata_api_key.as_ref()
            .ok_or_else(|| SpecterError::ConfigError("Pinata API key not configured".into()))?;
        let secret_key = self.config.pinata_secret_key.as_ref()
            .ok_or_else(|| SpecterError::ConfigError("Pinata secret key not configured".into()))?;

        self.validate_cid(cid)?;

        let response = self
            .http_client
            .delete(&format!("https://api.pinata.cloud/pinning/unpin/{}", cid))
            .header("pinata_api_key", api_key)
            .header("pinata_secret_api_key", secret_key)
            .send()
            .await
            .map_err(|e| SpecterError::HttpError(e.to_string()))?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            warn!(cid, error = %text, "Failed to unpin");
            // Don't error on unpin failure
        }

        Ok(())
    }
}

impl Default for IpfsClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Convenience type alias for Pinata-specific client.
pub type PinataClient = IpfsClient;

/// Pinata API response.
#[derive(Debug, Deserialize)]
struct PinataResponse {
    #[serde(rename = "IpfsHash")]
    ipfs_hash: String,
    #[serde(rename = "PinSize")]
    #[allow(dead_code)]
    pin_size: u64,
    #[serde(rename = "Timestamp")]
    #[allow(dead_code)]
    timestamp: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_cid_v0() {
        let client = IpfsClient::new();
        
        // Valid CIDv0
        assert!(client.validate_cid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG").is_ok());
        
        // Invalid length
        assert!(client.validate_cid("QmInvalid").is_err());
    }

    #[test]
    fn test_validate_cid_v1() {
        let client = IpfsClient::new();
        
        // Valid CIDv1
        assert!(client.validate_cid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi").is_ok());
    }

    #[test]
    fn test_validate_cid_empty() {
        let client = IpfsClient::new();
        assert!(client.validate_cid("").is_err());
    }

    #[test]
    fn test_config_pinata() {
        let config = IpfsConfig::pinata("my_key", "my_secret");
        
        assert_eq!(config.pinata_api_key, Some("my_key".into()));
        assert_eq!(config.pinata_secret_key, Some("my_secret".into()));
    }

    #[test]
    fn test_default_fallback_gateways() {
        let config = IpfsConfig::default();
        assert!(!config.fallback_gateways.is_empty());
    }
}
