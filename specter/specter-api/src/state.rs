//! App state: registry, ENS resolver, config.

use specter_registry::MemoryRegistry;
use specter_ens::{SpecterResolver, ResolverConfig};

#[derive(Clone, Debug)]
pub struct ApiConfig {
    pub rpc_url: String,
    /// When true, use Sepolia ENS (Sepolia RPC default)
    pub use_testnet: bool,
    pub pinata_jwt: Option<String>,
    /// Dedicated Pinata gateway (required for IPFS retrieves)
    pub pinata_gateway_url: String,
    /// Gateway token (required for IPFS retrieves)
    pub pinata_gateway_token: String,
    pub enable_cache: bool,
}

const DEFAULT_ETH_MAINNET_RPC: &str = "https://ethereum.publicnode.com";
const DEFAULT_ETH_SEPOLIA_RPC: &str = "https://ethereum-sepolia-rpc.publicnode.com";

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            rpc_url: DEFAULT_ETH_MAINNET_RPC.into(),
            use_testnet: false,
            pinata_jwt: None,
            pinata_gateway_url: String::new(),
            pinata_gateway_token: String::new(),
            enable_cache: true,
        }
    }
}

impl ApiConfig {
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();

        let use_testnet = std::env::var("USE_TESTNET")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        // When use_testnet=true, use Sepolia RPC only (ETH_RPC_URL_SEPOLIA or default)
        let rpc_url = if use_testnet {
            std::env::var("ETH_RPC_URL_SEPOLIA")
                .unwrap_or_else(|_| DEFAULT_ETH_SEPOLIA_RPC.into())
        } else {
            std::env::var("ETH_RPC_URL")
                .unwrap_or_else(|_| DEFAULT_ETH_MAINNET_RPC.into())
        };

        Self {
            rpc_url,
            use_testnet,
            pinata_jwt: std::env::var("PINATA_JWT").ok(),
            pinata_gateway_url: std::env::var("PINATA_GATEWAY_URL")
                .expect("PINATA_GATEWAY_URL required (e.g. beige-hollow-ermine-440.mypinata.cloud)"),
            pinata_gateway_token: std::env::var("PINATA_GATEWAY_TOKEN")
                .expect("PINATA_GATEWAY_TOKEN required for IPFS retrieves"),
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
        let mut resolver_config = ResolverConfig::new(
            &config.rpc_url,
            &config.pinata_gateway_url,
            &config.pinata_gateway_token,
        );
        if let Some(jwt) = &config.pinata_jwt {
            resolver_config = resolver_config.with_pinata_jwt(jwt);
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
