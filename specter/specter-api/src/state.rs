//! App state: registry, ENS resolver, SuiNS resolver, config.

use specter_ens::{ResolverConfig, SpecterResolver};
use specter_registry::MemoryRegistry;
use specter_suins::{SuinsResolver, SuinsResolverConfig};
use specter_yellow::types::YellowConfig;

#[derive(Clone, Debug)]
/// Configuration for the API service.
pub struct ApiConfig {
    /// Ethereum RPC URL.
    pub rpc_url: String,
    /// When true, use Sepolia ENS (Sepolia RPC default)
    pub use_testnet: bool,
    /// Optional Pinata JWT used for pinning.
    pub pinata_jwt: Option<String>,
    /// Dedicated Pinata gateway (required for IPFS retrieves)
    pub pinata_gateway_url: String,
    /// Gateway token (required for IPFS retrieves)
    pub pinata_gateway_token: String,
    /// Sui RPC URL.
    pub sui_rpc_url: String,
    /// Enables IPFS download caching where safe.
    pub enable_cache: bool,
    /// Security configuration
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
            max_body_size: 1024 * 1024, // 1 MB
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
        // If running via cargo from repo root, cwd has no .env; try crate root (specter/.env)
        if std::env::var("PINATA_GATEWAY_URL").is_err() {
            if let Ok(exe) = std::env::current_exe() {
                // exe is e.g. .../specter/target/debug/specter -> parent 3 times = .../specter
                if let Some(crate_root) = exe
                    .parent()
                    .and_then(|p| p.parent())
                    .and_then(|p| p.parent())
                {
                    let env_path = crate_root.join(".env");
                    let _ = dotenvy::from_path(env_path);
                }
            }
        }

        let use_testnet = std::env::var("USE_TESTNET")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        // ETH_RPC_URL is the primary env var for both testnet and mainnet;
        // the user sets the appropriate URL based on USE_TESTNET.
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

/// Shared application state for request handlers.
pub struct AppState {
    /// API configuration.
    pub config: ApiConfig,
    /// In-memory announcement registry.
    pub registry: MemoryRegistry,
    /// ENS resolver (Ethereum).
    pub resolver: SpecterResolver,
    /// SuiNS resolver (Sui).
    pub suins_resolver: SuinsResolver,
    /// Yellow Network configuration.
    pub yellow_config: YellowConfig,
}

impl AppState {
    /// Creates a new [`AppState`] from a provided [`ApiConfig`].
    pub fn new(config: ApiConfig) -> Self {
        let mut resolver_config = ResolverConfig::new(
            &config.rpc_url,
            &config.pinata_gateway_url,
            &config.pinata_gateway_token,
        );
        if let Some(jwt) = &config.pinata_jwt {
            resolver_config = resolver_config.with_pinata_jwt(jwt);
        }
        // IPFS download cache (content-addressed = safe to cache)
        if !config.enable_cache {
            resolver_config.ipfs = resolver_config.ipfs.no_cache();
        }

        // SuiNS resolver (reuses same IPFS gateway config)
        let mut suins_config = SuinsResolverConfig::new(
            &config.sui_rpc_url,
            config.use_testnet,
            &config.pinata_gateway_url,
            &config.pinata_gateway_token,
        );
        if let Some(jwt) = &config.pinata_jwt {
            suins_config = suins_config.with_pinata_jwt(jwt);
        }
        if !config.enable_cache {
            suins_config.ipfs = suins_config.ipfs.no_cache();
        }

        // Yellow Network config
        let yellow_config = YellowConfig {
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
        };

        Self {
            config,
            registry: MemoryRegistry::new(),
            resolver: SpecterResolver::with_config(resolver_config),
            suins_resolver: SuinsResolver::with_config(suins_config),
            yellow_config,
        }
    }
}
