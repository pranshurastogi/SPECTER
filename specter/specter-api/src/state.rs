//! App state: registry, ENS resolver, SuiNS resolver, config.

use std::sync::Arc;

use specter_ens::{ResolverConfig, SpecterResolver};
use specter_registry::turso::{ScanPositionStore, TursoRegistry, YellowChannelStore};
use specter_registry::MemoryRegistry;
use specter_suins::{SuinsResolver, SuinsResolverConfig};
use specter_yellow::types::YellowConfig;
use tracing::info;

use specter_core::error::Result;
use specter_core::traits::AnnouncementRegistry;
use specter_core::types::{Announcement, AnnouncementStats};

// ── ApiConfig ─────────────────────────────────────────────────────────────

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
        }
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
    /// Yellow channel persistence (only when using Turso).
    pub yellow_store: Option<Arc<YellowChannelStore>>,
    /// ENS resolver (Ethereum).
    pub resolver: SpecterResolver,
    /// SuiNS resolver (Sui).
    pub suins_resolver: SuinsResolver,
    /// Yellow Network configuration.
    pub yellow_config: YellowConfig,
}

impl AppState {
    /// Creates a new [`AppState`] from a provided [`ApiConfig`].
    ///
    /// Registry backend is selected via `REGISTRY_BACKEND` env var:
    /// - `"turso"` — durable Turso cloud DB (requires `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`)
    /// - anything else — ephemeral in-memory (default, for local dev)
    pub async fn new(config: ApiConfig) -> Self {
        let backend = std::env::var("REGISTRY_BACKEND").unwrap_or_default();

        let (registry, scan_store, yellow_store) = if backend == "turso" {
            let url = std::env::var("TURSO_DATABASE_URL")
                .expect("REGISTRY_BACKEND=turso requires TURSO_DATABASE_URL");
            let token = std::env::var("TURSO_AUTH_TOKEN")
                .expect("REGISTRY_BACKEND=turso requires TURSO_AUTH_TOKEN");

            info!("Initializing Turso registry at {url}");

            let turso = TursoRegistry::new(&url, &token)
                .await
                .expect("Failed to connect to Turso database");

            let db = turso.database();
            let scan = Arc::new(ScanPositionStore::new(db.clone()));
            let yellow = Arc::new(YellowChannelStore::new(db));

            (RegistryBackend::Turso(turso), Some(scan), Some(yellow))
        } else {
            info!("Initializing in-memory registry (ephemeral — set REGISTRY_BACKEND=turso for production)");
            (RegistryBackend::Memory(MemoryRegistry::new()), None, None)
        };

        Self {
            config: config.clone(),
            registry,
            scan_store,
            yellow_store,
            resolver: build_resolver(&config),
            suins_resolver: build_suins_resolver(&config),
            yellow_config: build_yellow_config(),
        }
    }

    /// Synchronous constructor (always uses in-memory registry). For backward compat / tests.
    pub fn new_sync(config: ApiConfig) -> Self {
        Self {
            resolver: build_resolver(&config),
            suins_resolver: build_suins_resolver(&config),
            yellow_config: build_yellow_config(),
            config,
            registry: RegistryBackend::Memory(MemoryRegistry::new()),
            scan_store: None,
            yellow_store: None,
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

fn build_yellow_config() -> YellowConfig {
    YellowConfig {
        ws_url: std::env::var("YELLOW_WS_URL")
            .unwrap_or_else(|_| "wss://clearnet.yellow.com/ws".into()),
        rpc_url: std::env::var("ALCHEMY_RPC_URL")
            .or_else(|_| std::env::var("ETH_RPC_URL"))
            .unwrap_or_else(|_| "https://ethereum-sepolia-rpc.publicnode.com".into()),
        chain_id: std::env::var("YELLOW_CHAIN_ID")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(11155111),
        custody_address: std::env::var("YELLOW_CUSTODY_ADDRESS")
            .unwrap_or_else(|_| "0x019B65A265EB3363822f2752141b3dF16131b262".into()),
        adjudicator_address: std::env::var("YELLOW_ADJUDICATOR_ADDRESS")
            .unwrap_or_else(|_| "0x7c7ccbc98469190849BCC6c926307794fDfB11F2".into()),
        challenge_duration: 3600,
    }
}
