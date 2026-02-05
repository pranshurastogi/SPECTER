//! App state: registry, ENS resolver, config.

use specter_registry::MemoryRegistry;
use specter_ens::{SpecterResolver, ResolverConfig};

#[derive(Clone, Debug)]
pub struct ApiConfig {
    pub rpc_url: String,
    pub pinata_api_key: Option<String>,
    pub pinata_secret_key: Option<String>,
    pub enable_cache: bool,
}

const DEFAULT_ETH_RPC_URL: &str = "https://ethereum.publicnode.com";

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            rpc_url: DEFAULT_ETH_RPC_URL.into(),
            pinata_api_key: None,
            pinata_secret_key: None,
            enable_cache: true,
        }
    }
}

impl ApiConfig {
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();
        
        Self {
            rpc_url: std::env::var("ETH_RPC_URL")
                .unwrap_or_else(|_| DEFAULT_ETH_RPC_URL.into()),
            pinata_api_key: std::env::var("PINATA_API_KEY").ok(),
            pinata_secret_key: std::env::var("PINATA_SECRET_KEY").ok(),
            enable_cache: std::env::var("ENABLE_CACHE")
                .map(|v| v != "false" && v != "0")
                .unwrap_or(true),
        }
    }
}

pub struct AppState {
    pub config: ApiConfig,
    pub registry: MemoryRegistry,
    pub resolver: SpecterResolver,
}

impl AppState {
    pub fn new(config: ApiConfig) -> Self {
        let mut resolver_config = ResolverConfig::with_rpc(&config.rpc_url);
        
        if let (Some(api_key), Some(secret)) = (&config.pinata_api_key, &config.pinata_secret_key) {
            resolver_config = resolver_config.with_pinata(api_key, secret);
        }
        
        if !config.enable_cache {
            resolver_config = resolver_config.no_cache();
        }

        Self {
            config,
            registry: MemoryRegistry::new(),
            resolver: SpecterResolver::with_config(resolver_config),
        }
    }
}
