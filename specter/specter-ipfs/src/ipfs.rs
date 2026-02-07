//! IPFS client implementation.
//!
//! Uses a dedicated Pinata gateway with token for all IPFS retrieves.
//! Uploads via Pinata v3 API.
//!
//! Downloads are cached in-memory by CID. IPFS content is content-addressed
//! (immutable), so caching by CID is always safe and never stale.

use std::collections::HashMap;

use parking_lot::RwLock;
use serde::Deserialize;
use tracing::{debug, instrument, warn};

use specter_core::error::{Result, SpecterError};

/// IPFS client configuration.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct IpfsConfig {
    /// Dedicated Pinata gateway domain (e.g. "beige-hollow-ermine-440.mypinata.cloud")
    pub gateway_url: String,
    /// Token for gateway access (?pinataGatewayToken=...)
    pub gateway_token: String,
    /// Pinata JWT for uploads (v3 API)
    pub pinata_jwt: Option<String>,
    /// Request timeout in seconds
    pub timeout_seconds: u64,
    /// Whether to cache IPFS downloads in memory (default: true)
    pub enable_download_cache: bool,
    /// Maximum number of cached downloads (default: 500)
    pub max_cache_entries: usize,
}

impl IpfsConfig {
    /// Creates config with dedicated gateway URL and token (required for retrieves).
    pub fn new(gateway_url: impl Into<String>, gateway_token: impl Into<String>) -> Self {
        Self {
            gateway_url: gateway_url.into(),
            gateway_token: gateway_token.into(),
            pinata_jwt: None,
            timeout_seconds: 30,
            enable_download_cache: true,
            max_cache_entries: 500,
        }
    }

    /// Adds Pinata JWT for uploads (v3 API).
    pub fn with_pinata_jwt(mut self, jwt: impl Into<String>) -> Self {
        self.pinata_jwt = Some(jwt.into());
        self
    }

    /// Disables the download cache.
    pub fn no_cache(mut self) -> Self {
        self.enable_download_cache = false;
        self
    }
}

/// IPFS client for upload/download operations.
///
/// Downloads are cached in-memory keyed by CID. Since IPFS content is
/// content-addressed, the same CID always returns the same bytes,
/// making this cache always correct.
pub struct IpfsClient {
    config: IpfsConfig,
    http_client: reqwest::Client,
    /// CID → downloaded bytes
    download_cache: Option<RwLock<HashMap<String, Vec<u8>>>>,
}

impl IpfsClient {
    /// Creates a new IPFS client with the given config.
    pub fn with_config(config: IpfsConfig) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_seconds))
            .build()
            .expect("Failed to create HTTP client");

        let download_cache = if config.enable_download_cache {
            Some(RwLock::new(HashMap::new()))
        } else {
            None
        };

        Self {
            config,
            http_client,
            download_cache,
        }
    }

    /// Returns the number of cached downloads.
    pub fn cache_len(&self) -> usize {
        self.download_cache
            .as_ref()
            .map(|c| c.read().len())
            .unwrap_or(0)
    }

    /// Clears the download cache.
    pub fn clear_cache(&self) {
        if let Some(cache) = &self.download_cache {
            cache.write().clear();
        }
    }

    /// Uploads data to IPFS via Pinata v3 API.
    ///
    /// Uses https://uploads.pinata.cloud/v3/files with JWT Bearer auth.
    #[instrument(skip(self, data))]
    pub async fn upload(&self, data: &[u8], name: Option<&str>) -> Result<String> {
        let jwt = self.config.pinata_jwt.as_ref()
            .ok_or_else(|| SpecterError::ConfigError("Pinata JWT not configured".into()))?;

        let file_part = reqwest::multipart::Part::bytes(data.to_vec())
            .file_name(name.unwrap_or("specter-meta-address.bin").to_string())
            .mime_str("application/octet-stream")
            .map_err(|e| SpecterError::IpfsUploadFailed(e.to_string()))?;

        let mut form = reqwest::multipart::Form::new()
            .part("file", file_part)
            .text("network", "public");

        if let Some(n) = name {
            form = form.text("name", n.to_string());
            // Pinata keyvalues: object with string values only
            let keyvalues = serde_json::json!({
                "type": "specter-meta-address"
            });
            form = form.text("keyvalues", keyvalues.to_string());
        }

        let response = self
            .http_client
            .post("https://uploads.pinata.cloud/v3/files")
            .header("Authorization", format!("Bearer {}", jwt))
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

        let json: PinataV3Response = response
            .json()
            .await
            .map_err(|e| SpecterError::IpfsUploadFailed(e.to_string()))?;

        debug!(cid = %json.data.cid, "Uploaded to IPFS");
        Ok(json.data.cid)
    }

    /// Downloads data from IPFS via the configured dedicated gateway.
    ///
    /// Results are cached in memory by CID (content-addressed = immutable).
    #[instrument(skip(self))]
    pub async fn download(&self, cid: &str) -> Result<Vec<u8>> {
        self.validate_cid(cid)?;

        // Check cache first
        if let Some(cache) = &self.download_cache {
            let entries = cache.read();
            if let Some(data) = entries.get(cid) {
                debug!(cid, "IPFS cache hit");
                return Ok(data.clone());
            }
        }

        let base = self.config.gateway_url.trim_end_matches('/');
        let base = if base.starts_with("http://") || base.starts_with("https://") {
            base.to_string()
        } else {
            format!("https://{}", base)
        };
        let url = format!(
            "{}/ipfs/{}?pinataGatewayToken={}",
            base, cid, self.config.gateway_token
        );

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

        let data = response
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| SpecterError::HttpError(e.to_string()))?;

        debug!(cid, bytes = data.len(), "Downloaded from Pinata gateway");

        // Store in cache
        if let Some(cache) = &self.download_cache {
            let mut entries = cache.write();
            // Evict oldest if at capacity
            if entries.len() >= self.config.max_cache_entries {
                if let Some(key) = entries.keys().next().cloned() {
                    entries.remove(&key);
                }
            }
            entries.insert(cid.to_string(), data.clone());
        }

        Ok(data)
    }

    pub(crate) fn validate_cid(&self, cid: &str) -> Result<()> {
        if cid.is_empty() {
            return Err(SpecterError::InvalidIpfsCid("CID cannot be empty".into()));
        }

        if cid.starts_with("Qm") {
            if cid.len() != 46 {
                return Err(SpecterError::InvalidIpfsCid(format!(
                    "Invalid CIDv0 length: expected 46, got {}",
                    cid.len()
                )));
            }
        } else if cid.starts_with("bafy") || cid.starts_with("bafk") {
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

    #[instrument(skip(self))]
    pub async fn pin(&self, cid: &str) -> Result<()> {
        let jwt = self.config.pinata_jwt.as_ref()
            .ok_or_else(|| SpecterError::ConfigError("Pinata JWT not configured".into()))?;

        self.validate_cid(cid)?;

        let body = serde_json::json!({ "hashToPin": cid });

        let response = self
            .http_client
            .post("https://api.pinata.cloud/pinning/pinByHash")
            .header("Authorization", format!("Bearer {}", jwt))
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

    #[instrument(skip(self))]
    pub async fn unpin(&self, cid: &str) -> Result<()> {
        let jwt = self.config.pinata_jwt.as_ref()
            .ok_or_else(|| SpecterError::ConfigError("Pinata JWT not configured".into()))?;

        self.validate_cid(cid)?;

        let response = self
            .http_client
            .delete(&format!("https://api.pinata.cloud/pinning/unpin/{}", cid))
            .header("Authorization", format!("Bearer {}", jwt))
            .send()
            .await
            .map_err(|e| SpecterError::HttpError(e.to_string()))?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            warn!(cid, error = %text, "Failed to unpin");
        }

        Ok(())
    }
}

/// Convenience type alias for Pinata-specific client.
pub type PinataClient = IpfsClient;

#[derive(Debug, Deserialize)]
struct PinataV3Response {
    data: PinataV3Data,
}

#[derive(Debug, Deserialize)]
struct PinataV3Data {
    cid: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> IpfsConfig {
        IpfsConfig::new("gateway.example.com", "test_token")
    }

    #[test]
    fn test_validate_cid_v0() {
        let client = IpfsClient::with_config(test_config());
        assert!(client.validate_cid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG").is_ok());
        assert!(client.validate_cid("QmInvalid").is_err());
    }

    #[test]
    fn test_validate_cid_v1() {
        let client = IpfsClient::with_config(test_config());
        assert!(client
            .validate_cid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
            .is_ok());
    }

    #[test]
    fn test_validate_cid_empty() {
        let client = IpfsClient::with_config(test_config());
        assert!(client.validate_cid("").is_err());
    }

    #[test]
    fn test_config_with_jwt() {
        let config = test_config().with_pinata_jwt("my_jwt_token");
        assert_eq!(config.pinata_jwt, Some("my_jwt_token".into()));
    }
}
