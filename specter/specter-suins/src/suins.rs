//! SuiNS client for resolving names and reading content hash.
//!
//! Uses Sui JSON-RPC to query SuiNS name records. The content hash
//! field stores the IPFS CID where the SPECTER meta-address lives.

use serde::{Deserialize, Serialize};
use tracing::{debug, instrument};

use specter_core::constants::{
    SUINS_PACKAGE_ID_MAINNET, SUINS_PACKAGE_ID_TESTNET, SUINS_REGISTRY_TABLE_ID_MAINNET,
    SUINS_REGISTRY_TABLE_ID_TESTNET, SUI_MAINNET_RPC_FALLBACKS, SUI_MAINNET_RPC_URL,
    SUI_TESTNET_RPC_FALLBACKS,
};
use specter_core::error::{Result, SpecterError};
use specter_core::redact::{redact_url, sanitize_error};

/// What one Sui RPC endpoint had to say about a call.
enum SuiCallOutcome {
    /// The node answered. `None`/`null` means the name is not registered.
    Answered(Option<serde_json::Value>),
    /// The endpoint itself is unusable and the call should be retried elsewhere.
    EndpointFailed(String),
}

/// Returns the default fallback endpoints for the given network.
pub fn default_sui_fallbacks(use_testnet: bool) -> Vec<String> {
    let list = if use_testnet {
        SUI_TESTNET_RPC_FALLBACKS
    } else {
        SUI_MAINNET_RPC_FALLBACKS
    };
    list.iter().map(|s| (*s).to_string()).collect()
}

fn default_sui_mainnet_fallbacks() -> Vec<String> {
    default_sui_fallbacks(false)
}

/// SuiNS client configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SuinsConfig {
    /// Sui RPC URL tried first.
    pub rpc_url: String,
    /// Endpoints tried, in order, when [`Self::rpc_url`] fails.
    ///
    /// This matters more on Sui than on Ethereum: the official public
    /// fullnodes have disabled JSON-RPC entirely, so an endpoint that looks
    /// healthy can still answer `-32601 Method not found` for every SuiNS
    /// lookup. Without fallbacks that reads as "name not registered".
    #[serde(default = "default_sui_mainnet_fallbacks")]
    pub fallback_rpc_urls: Vec<String>,
    /// Whether to use testnet constants (registry table, package ID)
    pub use_testnet: bool,
    /// Request timeout in seconds
    pub timeout_seconds: u64,
}

impl Default for SuinsConfig {
    fn default() -> Self {
        Self {
            rpc_url: SUI_MAINNET_RPC_URL.into(),
            fallback_rpc_urls: default_sui_fallbacks(false),
            use_testnet: false,
            timeout_seconds: 30,
        }
    }
}

impl SuinsConfig {
    /// Creates a new configuration with the given RPC URL.
    ///
    /// Fallbacks default to the public endpoints for the selected network.
    pub fn new(rpc_url: impl Into<String>, use_testnet: bool) -> Self {
        Self {
            rpc_url: rpc_url.into(),
            fallback_rpc_urls: default_sui_fallbacks(use_testnet),
            use_testnet,
            ..Default::default()
        }
    }

    /// Replaces the fallback endpoint list.
    pub fn with_fallbacks<I, S>(mut self, urls: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.fallback_rpc_urls = urls.into_iter().map(Into::into).collect();
        self
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

        let endpoints = self.endpoints();
        let total = endpoints.len();
        let mut last_error = String::from("no endpoints configured");

        // One budget for the whole call. The Sui list is the longest in the
        // codebase, so without a shared deadline a single SuiNS lookup could
        // block for timeout x endpoints, twice over (resolve + content hash).
        let deadline = tokio::time::Instant::now()
            + std::time::Duration::from_secs(self.config.timeout_seconds);

        for (idx, url) in endpoints.iter().enumerate() {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                last_error = format!(
                    "endpoint budget of {}s exhausted",
                    self.config.timeout_seconds
                );
                break;
            }
            match tokio::time::timeout(remaining, self.sui_rpc_call_once(url, &request))
                .await
                .unwrap_or_else(|_| SuiCallOutcome::EndpointFailed("timed out".into()))
            {
                SuiCallOutcome::Answered(result) => {
                    if idx > 0 {
                        debug!(
                            method,
                            endpoint = %redact_url(url),
                            attempt = idx + 1,
                            "Sui RPC served by fallback endpoint"
                        );
                    }
                    return Ok(result);
                }
                SuiCallOutcome::EndpointFailed(err) => {
                    debug!(
                        method,
                        endpoint = %redact_url(url),
                        attempt = idx + 1,
                        of = total,
                        error = %err,
                        "Sui RPC endpoint failed; trying next"
                    );
                    last_error = err;
                }
            }
        }

        Err(SpecterError::RpcError(format!(
            "all {total} Sui RPC endpoint(s) failed for {method}; last error: {last_error}"
        )))
    }

    /// Endpoints to try, in order: the configured primary, then the fallbacks.
    fn endpoints(&self) -> Vec<&str> {
        let mut out = vec![self.config.rpc_url.as_str()];
        for url in &self.config.fallback_rpc_urls {
            if !url.is_empty() && !out.contains(&url.as_str()) {
                out.push(url.as_str());
            }
        }
        out
    }

    /// Issues the call against exactly one endpoint and classifies the result.
    ///
    /// Unlike `eth_call`, the SuiNS read methods have no revert concept: a
    /// healthy node reports an unregistered name as `"result": null`, so every
    /// JSON-RPC *error* is an endpoint problem and is worth retrying elsewhere.
    async fn sui_rpc_call_once(&self, url: &str, request: &serde_json::Value) -> SuiCallOutcome {
        let response = match self.http_client.post(url).json(request).send().await {
            Ok(r) => r,
            Err(e) => return SuiCallOutcome::EndpointFailed(sanitize_error(&e.to_string())),
        };

        let status = response.status();
        if !status.is_success() {
            return SuiCallOutcome::EndpointFailed(format!("HTTP {status}"));
        }

        let json: serde_json::Value = match response.json().await {
            Ok(j) => j,
            Err(e) => {
                return SuiCallOutcome::EndpointFailed(sanitize_error(&format!(
                    "malformed JSON: {e}"
                )))
            }
        };

        if let Some(error) = json.get("error") {
            let msg = error
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown JSON-RPC error");
            return SuiCallOutcome::EndpointFailed(sanitize_error(msg));
        }

        SuiCallOutcome::Answered(json.get("result").cloned())
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
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_client() -> SuinsClient {
        SuinsClient::with_config(SuinsConfig {
            rpc_url: "https://example.com".into(),
            fallback_rpc_urls: Vec::new(),
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
    // ── RPC fallback + error semantics ──────────────────────────────────
    //
    // Regression coverage for a production outage: Sui disabled JSON-RPC on
    // its public fullnodes, so `suix_*` began answering `-32601 Method not
    // found`. The old client mapped every JSON-RPC error to `Ok(None)`, which
    // the API layer rendered as "No SPECTER record found for SuiNS name" — a
    // broken endpoint was reported to users as an unregistered name.

    /// The exact error a deprecated Sui public fullnode returns.
    fn method_not_found() -> serde_json::Value {
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": {
                "code": -32601,
                "message": "Method not found. JSON-RPC on public fullnodes has been deprecated. \
                            Please migrate to gRPC or GraphQL endpoints."
            }
        })
    }

    #[tokio::test]
    async fn resolve_address_falls_over_to_a_healthy_fallback() {
        let dead = MockServer::start().await;
        let healthy = MockServer::start().await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(method_not_found()))
            .mount(&dead)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 1, "result": "0xabc123"
            })))
            .mount(&healthy)
            .await;

        let client = SuinsClient::with_config(
            SuinsConfig::new(dead.uri(), false).with_fallbacks([healthy.uri()]),
        );

        let got = client.resolve_address("alice.sui").await.unwrap();
        assert_eq!(
            got,
            Some("0xabc123".to_string()),
            "a deprecated primary must not stop resolution when a fallback is healthy"
        );
    }

    #[tokio::test]
    async fn all_endpoints_failing_is_an_error_not_a_missing_record() {
        let dead_a = MockServer::start().await;
        let dead_b = MockServer::start().await;
        for server in [&dead_a, &dead_b] {
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(200).set_body_json(method_not_found()))
                .mount(server)
                .await;
        }

        let client = SuinsClient::with_config(
            SuinsConfig::new(dead_a.uri(), false).with_fallbacks([dead_b.uri()]),
        );

        let err = client
            .resolve_address("alice.sui")
            .await
            .expect_err("exhausting every endpoint must surface as an error");

        assert!(
            matches!(err, SpecterError::RpcError(_)),
            "expected RpcError so the API returns 5xx, got {err:?} — an Ok(None) here is \
             the masking bug: users are told their name has no SPECTER record"
        );
    }

    #[tokio::test]
    async fn unregistered_name_is_still_a_clean_none() {
        let healthy = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 1, "result": null
            })))
            .mount(&healthy)
            .await;

        let client = SuinsClient::with_config(
            SuinsConfig::new(healthy.uri(), false).with_fallbacks(Vec::<String>::new()),
        );

        assert_eq!(
            client.resolve_address("nobody.sui").await.unwrap(),
            None,
            "a healthy node answering null means the name is genuinely unregistered"
        );
    }

    #[tokio::test]
    async fn http_5xx_also_rolls_over_to_the_next_endpoint() {
        let flaky = MockServer::start().await;
        let healthy = MockServer::start().await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&flaky)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0", "id": 1, "result": "0xdeadbeef"
            })))
            .mount(&healthy)
            .await;

        let client = SuinsClient::with_config(
            SuinsConfig::new(flaky.uri(), false).with_fallbacks([healthy.uri()]),
        );

        assert_eq!(
            client.resolve_address("alice.sui").await.unwrap(),
            Some("0xdeadbeef".to_string())
        );
    }

    #[test]
    fn endpoint_list_dedupes_and_drops_blanks() {
        let cfg = SuinsConfig::new("https://primary.example", false).with_fallbacks([
            "https://primary.example",
            "",
            "https://backup.example",
        ]);
        let client = SuinsClient::with_config(cfg);
        assert_eq!(
            client.endpoints(),
            vec!["https://primary.example", "https://backup.example"]
        );
    }

    #[test]
    fn redact_url_strips_the_api_key_path() {
        assert_eq!(
            redact_url("https://sepolia.infura.io/v3/deadbeefdeadbeefdeadbeef"),
            "https://sepolia.infura.io"
        );
    }

    #[test]
    fn testnet_and_mainnet_get_different_default_fallbacks() {
        let main = SuinsConfig::new("https://x.example", false);
        let test = SuinsConfig::new("https://x.example", true);
        assert!(!main.fallback_rpc_urls.is_empty());
        assert!(!test.fallback_rpc_urls.is_empty());
        assert_ne!(main.fallback_rpc_urls, test.fallback_rpc_urls);
    }

    // ── audit: latency budget and credential leakage ────────────────────

    #[tokio::test]
    async fn a_slow_endpoint_list_cannot_multiply_request_latency() {
        let mut servers = Vec::new();
        for _ in 0..4 {
            let s = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_delay(std::time::Duration::from_secs(5))
                        .set_body_json(serde_json::json!({
                            "jsonrpc": "2.0", "id": 1, "result": "0xabc"
                        })),
                )
                .mount(&s)
                .await;
            servers.push(s);
        }

        let mut cfg = SuinsConfig::new(servers[0].uri(), false).with_fallbacks([
            servers[1].uri(),
            servers[2].uri(),
            servers[3].uri(),
        ]);
        cfg.timeout_seconds = 1;
        let client = SuinsClient::with_config(cfg);

        let started = std::time::Instant::now();
        let result = client.resolve_address("slow.sui").await;
        let elapsed = started.elapsed();

        assert!(result.is_err());
        assert!(
            elapsed < std::time::Duration::from_millis(2_000),
            "budget not enforced: {elapsed:?}. Without a shared deadline this would be \
             ~4s (1s timeout x 4 endpoints); with one it must stay near 1s"
        );
    }

    #[tokio::test]
    async fn the_returned_error_never_contains_the_provider_api_key() {
        const KEY: &str = "491b68b60b4e432ab0fee1febb9278f3";
        let mut cfg = SuinsConfig::new(
            format!("https://unreachable-host-xyz.invalid/v3/{KEY}"),
            false,
        )
        .with_fallbacks(Vec::<String>::new());
        cfg.timeout_seconds = 5;
        let client = SuinsClient::with_config(cfg);

        let err = client.resolve_address("leak.sui").await.unwrap_err();
        let rendered = err.to_string();
        assert!(
            !rendered.contains(KEY),
            "API key leaked into the error surfaced to callers: {rendered}"
        );
    }
}
