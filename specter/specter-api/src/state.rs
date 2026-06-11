//! App state: registry, ENS resolver, SuiNS resolver, config, chain indexer.

use std::collections::HashMap;
use std::sync::Arc;

use alloy::signers::local::PrivateKeySigner;
use specter_ens::{ResolverConfig, SpecterResolver};
use specter_registry::turso::{ScanPositionStore, TursoRegistry};
use specter_registry::MemoryRegistry;
use specter_suins::{SuinsResolver, SuinsResolverConfig};
use tracing::info;

use specter_core::error::Result;
use specter_core::traits::AnnouncementRegistry;
use specter_core::types::{Announcement, AnnouncementStats};

use crate::pending::PendingPaymentStore;

// ── ApiConfig ─────────────────────────────────────────────────────────────

/// Server-side relayer for gas-sponsored Monad announcements.
///
/// When configured, the backend broadcasts the `announce()` tx on behalf of the
/// user so they never need MON or network switching.
#[derive(Clone, Debug)]
pub struct RelayerConfig {
    /// Pre-parsed Monad signer (holds the relayer private key).
    pub signer: PrivateKeySigner,
    /// Monad JSON-RPC endpoint.
    pub monad_rpc_url: String,
    /// SPECTERAnnouncer contract address (checksummed).
    pub announcer_addr: String,
}

impl RelayerConfig {
    /// Loads relayer config from env. Returns `None` if any required var is missing.
    pub fn from_env() -> Option<Self> {
        let raw_key = std::env::var("RELAYER_PRIVATE_KEY").ok()?.trim().to_string();
        if raw_key.is_empty() {
            return None;
        }
        let signer: PrivateKeySigner = raw_key.parse().ok()?;
        let monad_rpc_url = std::env::var("MONAD_RPC_URL")
            .ok()
            .filter(|s| !s.is_empty())?;
        let announcer_addr = std::env::var("SPECTER_ANNOUNCER_ADDRESS")
            .ok()
            .filter(|s| !s.is_empty())?;
        Some(Self { signer, monad_rpc_url, announcer_addr })
    }
}

/// Configuration for the API service.
#[derive(Clone, Debug)]
pub struct ApiConfig {
    /// Ethereum RPC URL.
    pub rpc_url: String,
    /// When true, use Sepolia ENS (Sepolia RPC default).
    pub use_testnet: bool,
    /// Optional Pinata JWT used for pinning.
    pub pinata_jwt: Option<String>,
    /// Dedicated Pinata gateway (required for IPFS retrieves).
    pub pinata_gateway_url: String,
    /// Gateway token (required for IPFS retrieves).
    pub pinata_gateway_token: String,
    /// Sui RPC URL.
    pub sui_rpc_url: String,
    /// Enables IPFS download caching where safe.
    pub enable_cache: bool,
    /// Security configuration.
    pub security: SecurityConfig,
    /// RPC URLs for payment verification per source chain name.
    /// Keys: "arbitrum", "ethereum", "base", "optimism", "monad-testnet", etc.
    /// Env vars: CHAIN_RPC_ARBITRUM, CHAIN_RPC_ETHEREUM, CHAIN_RPC_BASE, etc.
    pub chain_rpc_map: HashMap<String, String>,
}

/// Production security settings (loaded from environment).
#[derive(Clone, Debug)]
pub struct SecurityConfig {
    /// API key required for POST/PUT/DELETE requests. None = no auth (dev mode).
    pub api_key: Option<String>,
    /// Allowed CORS origins (comma-separated). "*" = allow all (dev mode).
    pub allowed_origins: Vec<String>,
    /// Rate limit: requests per second per IP.
    pub rate_limit_rps: u32,
    /// Rate limit: burst size per IP.
    pub rate_limit_burst: u32,
    /// Max request body size in bytes (default: 1 MB).
    pub max_body_size: usize,
}

const DEFAULT_ETH_MAINNET_RPC: &str = "https://ethereum.publicnode.com";
const DEFAULT_ETH_SEPOLIA_RPC: &str = "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_SUI_MAINNET_RPC: &str = "https://fullnode.mainnet.sui.io:443";
const DEFAULT_SUI_TESTNET_RPC: &str = "https://fullnode.testnet.sui.io:443";

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            allowed_origins: vec!["*".into()],
            rate_limit_rps: 10,
            rate_limit_burst: 30,
            max_body_size: 1024 * 1024,
        }
    }
}

impl SecurityConfig {
    /// Loads security configuration from environment variables.
    pub fn from_env() -> Self {
        let api_key = std::env::var("API_KEY").ok().filter(|k| !k.is_empty());

        let allowed_origins = std::env::var("ALLOWED_ORIGINS")
            .unwrap_or_else(|_| "*".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let rate_limit_rps = std::env::var("RATE_LIMIT_RPS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10);

        let rate_limit_burst = std::env::var("RATE_LIMIT_BURST")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);

        let max_body_size = std::env::var("MAX_BODY_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1024 * 1024);

        if api_key.is_none() {
            eprintln!("⚠️  API_KEY not set — POST endpoints are UNPROTECTED (dev mode)");
        }

        Self {
            api_key,
            allowed_origins,
            rate_limit_rps,
            rate_limit_burst,
            max_body_size,
        }
    }
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            rpc_url: DEFAULT_ETH_MAINNET_RPC.into(),
            use_testnet: false,
            pinata_jwt: None,
            pinata_gateway_url: String::new(),
            pinata_gateway_token: String::new(),
            sui_rpc_url: DEFAULT_SUI_MAINNET_RPC.into(),
            enable_cache: true,
            security: SecurityConfig::default(),
            chain_rpc_map: HashMap::new(),
        }
    }
}

impl ApiConfig {
    /// Loads API configuration from environment variables (optionally via `.env`).
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();
        // If running via cargo from repo root, cwd has no .env; try crate root
        if std::env::var("PINATA_GATEWAY_URL").is_err() {
            if let Ok(exe) = std::env::current_exe() {
                if let Some(crate_root) = exe
                    .parent()
                    .and_then(|p| p.parent())
                    .and_then(|p| p.parent())
                {
                    let _ = dotenvy::from_path(crate_root.join(".env"));
                }
            }
        }

        let use_testnet = std::env::var("USE_TESTNET")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        let default_rpc = if use_testnet {
            DEFAULT_ETH_SEPOLIA_RPC
        } else {
            DEFAULT_ETH_MAINNET_RPC
        };
        let rpc_url = std::env::var("ETH_RPC_URL").unwrap_or_else(|_| default_rpc.into());

        let sui_rpc_url = std::env::var("SUI_RPC_URL").unwrap_or_else(|_| {
            if use_testnet {
                DEFAULT_SUI_TESTNET_RPC.into()
            } else {
                DEFAULT_SUI_MAINNET_RPC.into()
            }
        });

        let pinata_gateway_url = std::env::var("PINATA_GATEWAY_URL").unwrap_or_default();
        let pinata_gateway_token = std::env::var("PINATA_GATEWAY_TOKEN").unwrap_or_default();

        if pinata_gateway_url.is_empty() || pinata_gateway_token.is_empty() {
            eprintln!("⚠️  PINATA_GATEWAY_URL and/or PINATA_GATEWAY_TOKEN not set — IPFS features will be unavailable");
        }

        // Build per-chain RPC map from env vars.
        let mut chain_rpc_map = HashMap::new();
        let chain_env_keys = [
            ("CHAIN_RPC_ETHEREUM", "ethereum"),
            ("CHAIN_RPC_ARBITRUM", "arbitrum"),
            ("CHAIN_RPC_BASE", "base"),
            ("CHAIN_RPC_OPTIMISM", "optimism"),
            ("CHAIN_RPC_POLYGON", "polygon"),
            ("CHAIN_RPC_MONAD_TESTNET", "monad-testnet"),
            ("CHAIN_RPC_SEPOLIA", "sepolia"),
        ];
        for (env_key, chain_name) in chain_env_keys {
            if let Ok(url) = std::env::var(env_key) {
                if !url.is_empty() {
                    chain_rpc_map.insert(chain_name.to_string(), url);
                }
            }
        }

        Self {
            rpc_url,
            use_testnet,
            pinata_jwt: std::env::var("PINATA_JWT").ok(),
            pinata_gateway_url,
            pinata_gateway_token,
            sui_rpc_url,
            enable_cache: std::env::var("ENABLE_CACHE")
                .map(|v| v != "false" && v != "0")
                .unwrap_or(true),
            security: SecurityConfig::from_env(),
            chain_rpc_map,
        }
    }
}

// ── ChainConfig ───────────────────────────────────────────────────────────

/// Configuration for on-chain indexing.
#[derive(Clone, Debug)]
pub struct ChainConfig {
    /// RPC endpoint for Monad chain
    pub rpc_url: String,
    /// SPECTERAnnouncer contract address
    pub announcer_addr: String,
    /// Block number where contract was deployed
    pub deploy_block: u64,
    /// Whether to enable on-chain indexing
    pub enabled: bool,
}

impl ChainConfig {
    /// Loads chain configuration from environment variables.
    ///
    /// Returns Ok with enabled=false if not configured.
    pub fn from_env() -> Result<Self> {
        let announcement_source = std::env::var("ANNOUNCEMENT_SOURCE")
            .unwrap_or_else(|_| "api".to_string());

        let enabled = announcement_source == "chain";

        if !enabled {
            return Ok(Self {
                rpc_url: String::new(),
                announcer_addr: String::new(),
                deploy_block: 0,
                enabled: false,
            });
        }

        let rpc_url = std::env::var("MONAD_RPC_URL")
            .map_err(|_| specter_core::error::SpecterError::ConfigError(
                "MONAD_RPC_URL not set (required when ANNOUNCEMENT_SOURCE=chain)".into()
            ))?;

        let announcer_addr = std::env::var("SPECTER_ANNOUNCER_ADDRESS")
            .map_err(|_| specter_core::error::SpecterError::ConfigError(
                "SPECTER_ANNOUNCER_ADDRESS not set (required when ANNOUNCEMENT_SOURCE=chain)".into()
            ))?;

        let deploy_block_str = std::env::var("SPECTER_ANNOUNCER_DEPLOY_BLOCK")
            .map_err(|_| specter_core::error::SpecterError::ConfigError(
                "SPECTER_ANNOUNCER_DEPLOY_BLOCK not set (required when ANNOUNCEMENT_SOURCE=chain)".into()
            ))?;

        let deploy_block = deploy_block_str.parse::<u64>()
            .map_err(|_| specter_core::error::SpecterError::ConfigError(
                "SPECTER_ANNOUNCER_DEPLOY_BLOCK must be a valid u64".into()
            ))?;

        if rpc_url.is_empty() {
            return Err(specter_core::error::SpecterError::ConfigError(
                "MONAD_RPC_URL is empty".into()
            ).into());
        }

        if announcer_addr.is_empty() {
            return Err(specter_core::error::SpecterError::ConfigError(
                "SPECTER_ANNOUNCER_ADDRESS is empty".into()
            ).into());
        }

        Ok(Self {
            rpc_url,
            announcer_addr,
            deploy_block,
            enabled: true,
        })
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Registry backend abstraction
// ═══════════════════════════════════════════════════════════════════════════════

/// Polymorphic registry backend — wraps either Memory or Turso.
pub enum RegistryBackend {
    /// In-memory (ephemeral, for local dev/testing).
    Memory(MemoryRegistry),
    /// Turso remote database (durable, for production).
    Turso(TursoRegistry),
}

impl RegistryBackend {
    /// Returns all announcements (may be expensive on large datasets).
    pub async fn all_announcements(&self) -> Vec<Announcement> {
        match self {
            Self::Memory(m) => m.all_announcements(),
            Self::Turso(t) => t.all_announcements().await,
        }
    }

    /// Returns registry statistics.
    pub async fn stats(&self) -> AnnouncementStats {
        match self {
            Self::Memory(m) => m.stats(),
            Self::Turso(t) => t.stats().await,
        }
    }

    /// Health check.
    pub async fn health_check(&self) -> Result<()> {
        match self {
            Self::Memory(_) => Ok(()),
            Self::Turso(t) => t.health_check().await,
        }
    }

    /// Flush / optimize (no-op for both backends currently).
    pub async fn flush(&self) -> Result<()> {
        match self {
            Self::Memory(_) => Ok(()),
            Self::Turso(t) => t.flush().await,
        }
    }

    /// Returns the last block processed by the event poller (Turso only).
    pub async fn get_poller_last_block(&self) -> Option<u64> {
        match self {
            Self::Memory(_) => None,
            Self::Turso(t) => t
                .get_metadata("poller_last_block")
                .await
                .ok()
                .flatten()
                .and_then(|s| s.parse::<u64>().ok()),
        }
    }

    /// Writes an internal telemetry event. No-op for the memory backend.
    pub async fn write_telemetry(
        &self,
        event: &str,
        ip: Option<&str>,
        ua: Option<&str>,
        chain: Option<&str>,
        chain_id: Option<u64>,
        view_tag: Option<u8>,
        status: &str,
        err: Option<&str>,
        ms: u64,
    ) {
        if let Self::Turso(t) = self {
            t.write_telemetry(event, ip, ua, chain, chain_id, view_tag, status, err, ms)
                .await;
        }
    }
}

#[async_trait::async_trait]
impl AnnouncementRegistry for RegistryBackend {
    async fn publish(&self, announcement: Announcement) -> Result<u64> {
        match self {
            Self::Memory(m) => m.publish(announcement).await,
            Self::Turso(t) => t.publish(announcement).await,
        }
    }

    async fn get_by_view_tag(&self, view_tag: u8) -> Result<Vec<Announcement>> {
        match self {
            Self::Memory(m) => m.get_by_view_tag(view_tag).await,
            Self::Turso(t) => t.get_by_view_tag(view_tag).await,
        }
    }

    async fn get_by_time_range(&self, start: u64, end: u64) -> Result<Vec<Announcement>> {
        match self {
            Self::Memory(m) => m.get_by_time_range(start, end).await,
            Self::Turso(t) => t.get_by_time_range(start, end).await,
        }
    }

    async fn get_by_id(&self, id: u64) -> Result<Option<Announcement>> {
        match self {
            Self::Memory(m) => m.get_by_id(id).await,
            Self::Turso(t) => t.get_by_id(id).await,
        }
    }

    async fn count(&self) -> Result<u64> {
        match self {
            Self::Memory(m) => m.count().await,
            Self::Turso(t) => t.count().await,
        }
    }

    async fn next_id(&self) -> Result<u64> {
        match self {
            Self::Memory(m) => m.next_id().await,
            Self::Turso(t) => t.next_id().await,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AppState
// ═══════════════════════════════════════════════════════════════════════════════

/// Shared application state for request handlers.
pub struct AppState {
    /// API configuration.
    pub config: ApiConfig,
    /// Announcement registry (memory or Turso).
    pub registry: RegistryBackend,
    /// Scanner checkpoint persistence (only when using Turso).
    pub scan_store: Option<Arc<ScanPositionStore>>,
    /// ENS resolver (Ethereum).
    pub resolver: SpecterResolver,
    /// SuiNS resolver (Sui).
    pub suins_resolver: SuinsResolver,
    /// In-flight stealth payments awaiting their on-chain tx + publish.
    ///
    /// Binds `POST /api/v1/stealth/create` to `POST /api/v1/registry/announcements`
    /// so the protocol view tag is **never** trusted from client input.
    pub pending_payments: Arc<PendingPaymentStore>,
    /// Chain configuration (for Monad indexing).
    pub chain_config: ChainConfig,
    /// Server-side relayer for gas-sponsored announcements.
    /// `None` in dev mode — client supplies tx_hash directly instead.
    pub relayer_config: Option<RelayerConfig>,
}

impl AppState {
    /// Creates a new [`AppState`] from a provided [`ApiConfig`].
    ///
    /// Registry backend is selected via `REGISTRY_BACKEND` env var:
    /// - `"turso"` — durable Turso cloud DB (requires `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`)
    /// - anything else — ephemeral in-memory (default, for local dev)
    ///
    /// If `ANNOUNCEMENT_SOURCE=chain`, spawns a background ChainIndexer task
    /// that polls SPECTERAnnouncer events and publishes to the registry.
    pub async fn new(config: ApiConfig) -> Self {
        let backend = std::env::var("REGISTRY_BACKEND").unwrap_or_default();

        let (registry, scan_store) = if backend == "turso" {
            let url = std::env::var("TURSO_DATABASE_URL")
                .expect("REGISTRY_BACKEND=turso requires TURSO_DATABASE_URL");
            let token = std::env::var("TURSO_AUTH_TOKEN")
                .expect("REGISTRY_BACKEND=turso requires TURSO_AUTH_TOKEN");

            info!("Initializing Turso registry at {url}");

            let turso = TursoRegistry::new(&url, &token)
                .await
                .expect("Failed to connect to Turso database");

            let db = turso.database();
            let scan = Arc::new(ScanPositionStore::new(db));

            (RegistryBackend::Turso(turso), Some(scan))
        } else {
            info!("Initializing in-memory registry (ephemeral — set REGISTRY_BACKEND=turso for production)");
            (RegistryBackend::Memory(MemoryRegistry::new()), None)
        };

        // Load chain configuration
        let chain_config = ChainConfig::from_env().unwrap_or_else(|e| {
            eprintln!("⚠️  Chain configuration error: {} (chain indexing disabled)", e);
            ChainConfig {
                rpc_url: String::new(),
                announcer_addr: String::new(),
                deploy_block: 0,
                enabled: false,
            }
        });

        // Note: Chain indexer spawning deferred to runtime initialization
        // when the registry is fully set up. For now, we just configure it.
        if chain_config.enabled {
            info!(
                "Chain indexing configured for {} at block {}",
                chain_config.announcer_addr, chain_config.deploy_block
            );
            info!(
                "To spawn indexer: create ChainIndexer with configured registry and call tokio::spawn()"
            );
        }

        let relayer_config = RelayerConfig::from_env();
        if relayer_config.is_some() {
            info!("Relayer configured — server-side gas-sponsored announcements enabled");
        } else {
            eprintln!("⚠️  RELAYER_PRIVATE_KEY not set — running in dev mode (client supplies tx_hash)");
        }

        Self {
            config: config.clone(),
            registry,
            scan_store,
            resolver: build_resolver(&config),
            suins_resolver: build_suins_resolver(&config),
            pending_payments: Arc::new(PendingPaymentStore::new()),
            chain_config,
            relayer_config,
        }
    }

    /// Synchronous constructor (always uses in-memory registry). For tests / local dev.
    pub fn new_sync(config: ApiConfig) -> Self {
        Self {
            resolver: build_resolver(&config),
            suins_resolver: build_suins_resolver(&config),
            config,
            registry: RegistryBackend::Memory(MemoryRegistry::new()),
            scan_store: None,
            pending_payments: Arc::new(PendingPaymentStore::new()),
            chain_config: ChainConfig {
                rpc_url: String::new(),
                announcer_addr: String::new(),
                deploy_block: 0,
                enabled: false,
            },
            relayer_config: None,
        }
    }
}

// ── builder helpers ───────────────────────────────────────────────────────

fn build_resolver(config: &ApiConfig) -> SpecterResolver {
    let mut rc = ResolverConfig::new(
        &config.rpc_url,
        &config.pinata_gateway_url,
        &config.pinata_gateway_token,
    );
    if let Some(jwt) = &config.pinata_jwt {
        rc = rc.with_pinata_jwt(jwt);
    }
    if !config.enable_cache {
        rc.ipfs = rc.ipfs.no_cache();
    }
    SpecterResolver::with_config(rc)
}

fn build_suins_resolver(config: &ApiConfig) -> SuinsResolver {
    let mut sc = SuinsResolverConfig::new(
        &config.sui_rpc_url,
        config.use_testnet,
        &config.pinata_gateway_url,
        &config.pinata_gateway_token,
    );
    if let Some(jwt) = &config.pinata_jwt {
        sc = sc.with_pinata_jwt(jwt);
    }
    if !config.enable_cache {
        sc.ipfs = sc.ipfs.no_cache();
    }
    SuinsResolver::with_config(sc)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chain_config_disabled_by_default() {
        // ANNOUNCEMENT_SOURCE not set, should disable chain indexing
        std::env::remove_var("ANNOUNCEMENT_SOURCE");
        std::env::remove_var("MONAD_RPC_URL");
        std::env::remove_var("SPECTER_ANNOUNCER_ADDRESS");
        std::env::remove_var("SPECTER_ANNOUNCER_DEPLOY_BLOCK");

        let config = ChainConfig::from_env().expect("Should load config even when disabled");
        assert!(!config.enabled);
    }

    #[test]
    fn test_chain_config_enabled_requires_env_vars() {
        std::env::set_var("ANNOUNCEMENT_SOURCE", "chain");
        std::env::remove_var("MONAD_RPC_URL");
        std::env::remove_var("SPECTER_ANNOUNCER_ADDRESS");
        std::env::remove_var("SPECTER_ANNOUNCER_DEPLOY_BLOCK");

        let result = ChainConfig::from_env();
        assert!(result.is_err(), "Should fail when required env vars missing");

        std::env::remove_var("ANNOUNCEMENT_SOURCE");
    }

    #[test]
    fn test_chain_config_with_valid_env_vars() {
        std::env::set_var("ANNOUNCEMENT_SOURCE", "chain");
        std::env::set_var("MONAD_RPC_URL", "https://testnet-rpc.monad.xyz");
        std::env::set_var("SPECTER_ANNOUNCER_ADDRESS", "0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC");
        std::env::set_var("SPECTER_ANNOUNCER_DEPLOY_BLOCK", "37571591");

        let config = ChainConfig::from_env().expect("Should load valid config");
        assert!(config.enabled);
        assert_eq!(config.rpc_url, "https://testnet-rpc.monad.xyz");
        assert_eq!(config.announcer_addr, "0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC");
        assert_eq!(config.deploy_block, 37571591);

        std::env::remove_var("ANNOUNCEMENT_SOURCE");
        std::env::remove_var("MONAD_RPC_URL");
        std::env::remove_var("SPECTER_ANNOUNCER_ADDRESS");
        std::env::remove_var("SPECTER_ANNOUNCER_DEPLOY_BLOCK");
    }

    #[test]
    fn test_chain_config_invalid_deploy_block() {
        std::env::set_var("ANNOUNCEMENT_SOURCE", "chain");
        std::env::set_var("MONAD_RPC_URL", "https://testnet-rpc.monad.xyz");
        std::env::set_var("SPECTER_ANNOUNCER_ADDRESS", "0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC");
        std::env::set_var("SPECTER_ANNOUNCER_DEPLOY_BLOCK", "not_a_number");

        let result = ChainConfig::from_env();
        assert!(result.is_err(), "Should fail with invalid block number");

        std::env::remove_var("ANNOUNCEMENT_SOURCE");
        std::env::remove_var("MONAD_RPC_URL");
        std::env::remove_var("SPECTER_ANNOUNCER_ADDRESS");
        std::env::remove_var("SPECTER_ANNOUNCER_DEPLOY_BLOCK");
    }

    #[test]
    fn test_app_state_new_sync_includes_chain_config() {
        let config = ApiConfig::default();
        let state = AppState::new_sync(config);

        // Chain config should be disabled by default in sync mode
        assert!(!state.chain_config.enabled);
    }

    #[test]
    fn test_security_config_defaults() {
        std::env::remove_var("API_KEY");
        std::env::remove_var("ALLOWED_ORIGINS");
        std::env::remove_var("RATE_LIMIT_RPS");
        std::env::remove_var("RATE_LIMIT_BURST");
        std::env::remove_var("MAX_BODY_SIZE");

        let sec_config = SecurityConfig::from_env();

        assert!(sec_config.api_key.is_none());
        assert_eq!(sec_config.allowed_origins, vec!["*"]);
        assert_eq!(sec_config.rate_limit_rps, 10);
        assert_eq!(sec_config.rate_limit_burst, 30);
        assert_eq!(sec_config.max_body_size, 1024 * 1024);
    }

    #[test]
    fn test_api_config_defaults() {
        std::env::remove_var("USE_TESTNET");
        std::env::remove_var("ETH_RPC_URL");
        std::env::remove_var("SUI_RPC_URL");

        let api_config = ApiConfig::default();

        assert_eq!(api_config.rpc_url, DEFAULT_ETH_MAINNET_RPC);
        assert!(!api_config.use_testnet);
    }
}
