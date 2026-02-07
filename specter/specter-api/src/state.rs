//! App state: registry, ENS resolver, SuiNS resolver, config.

use specter_registry::MemoryRegistry;
use specter_ens::{SpecterResolver, ResolverConfig};
use specter_suins::{SuinsResolver, SuinsResolverConfig};

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
    pub sui_rpc_url: String,
    pub enable_cache: bool,
}

const DEFAULT_ETH_MAINNET_RPC: &str = "https://ethereum.publicnode.com";
const DEFAULT_ETH_SEPOLIA_RPC: &str = "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_SUI_MAINNET_RPC: &str = "https://fullnode.mainnet.sui.io:443";
const DEFAULT_SUI_TESTNET_RPC: &str = "https://fullnode.testnet.sui.io:443";

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
        }
    }
}

impl ApiConfig {
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();
        // If running via cargo from repo root, cwd has no .env; try crate root (specter/.env)
        if std::env::var("PINATA_GATEWAY_URL").is_err() {
            if let Ok(exe) = std::env::current_exe() {
                // exe is e.g. .../specter/target/debug/specter -> parent 3 times = .../specter
                if let Some(crate_root) = exe.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
                    let env_path = crate_root.join(".env");
                    let _ = dotenvy::from_path(env_path);
                }
            }
        }

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

        let sui_rpc_url = std::env::var("SUI_RPC_URL").unwrap_or_else(|_| {
            if use_testnet {
                DEFAULT_SUI_TESTNET_RPC.into()
            } else {
                DEFAULT_SUI_MAINNET_RPC.into()
            }
        });

        Self {
            rpc_url,
            use_testnet,
            pinata_jwt: std::env::var("PINATA_JWT").ok(),
            pinata_gateway_url: std::env::var("PINATA_GATEWAY_URL")
                .expect("PINATA_GATEWAY_URL required (e.g. beige-hollow-ermine-440.mypinata.cloud)"),
            pinata_gateway_token: std::env::var("PINATA_GATEWAY_TOKEN")
                .expect("PINATA_GATEWAY_TOKEN required for IPFS retrieves"),
            sui_rpc_url,
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
    pub suins_resolver: SuinsResolver,
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

        Self {
            config,
            registry: MemoryRegistry::new(),
            resolver: SpecterResolver::with_config(resolver_config),
            suins_resolver: SuinsResolver::with_config(suins_config),
        }
    }
}
