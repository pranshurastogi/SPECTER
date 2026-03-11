/**
 * Centralized Yellow Network Configuration
 * 
 * This module contains all constants for Yellow Network integration including:
 * - Contract addresses for all supported chains (Sandbox & Production)
 * - WebSocket endpoints
 * - Supported assets and their addresses
 * - RPC URLs
 * 
 * Reference: https://docs.yellow.org/docs/learn/introduction/supported-chains/
 */

import type { Address } from "viem";
import {
  mainnet,
  sepolia,
  base,
  baseSepolia,
  polygon,
  polygonAmoy,
  bsc,
  linea,
} from "viem/chains";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type YellowEnvironment = "sandbox" | "production";

export interface YellowNetworkConfig {
  chainId: number;
  chainName: string;
  custody: Address;
  adjudicator: Address;
  rpcUrl: string;
  blockExplorer: string;
  isTestnet: boolean;
}

export interface YellowAssetConfig {
  symbol: string;
  name: string;
  decimals: number;
  /** Chain ID to token address mapping */
  addresses: Record<number, Address>;
}

export interface YellowEnvironmentConfig {
  environment: YellowEnvironment;
  wsUrl: string;
  networks: YellowNetworkConfig[];
  assets: YellowAssetConfig[];
  faucetUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants - WebSocket URLs
// ─────────────────────────────────────────────────────────────────────────────

export const YELLOW_WS_SANDBOX = "wss://clearnet-sandbox.yellow.com/ws";
export const YELLOW_WS_PRODUCTION = "wss://clearnet.yellow.com/ws";

// ─────────────────────────────────────────────────────────────────────────────
// Constants - Application
// ─────────────────────────────────────────────────────────────────────────────

export const YELLOW_APP_NAME = "yellow_demo";
export const YELLOW_AUTH_SCOPE = "console";
export const YELLOW_CHALLENGE_DURATION = 3600n; // 1 hour in seconds

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox Configuration (Testnet)
// ─────────────────────────────────────────────────────────────────────────────

const SANDBOX_NETWORKS: YellowNetworkConfig[] = [
  {
    chainId: sepolia.id, // 11155111
    chainName: "Ethereum Sepolia",
    custody: "0x019B65A265EB3363822f2752141b3dF16131b262",
    adjudicator: "0x7c7ccbc98469190849BCC6c926307794fDfB11F2",
    rpcUrl: import.meta.env.VITE_YELLOW_SANDBOX_RPC_SEPOLIA || "https://ethereum-sepolia-rpc.publicnode.com",
    blockExplorer: "https://sepolia.etherscan.io",
    isTestnet: true,
  },
  {
    chainId: baseSepolia.id, // 84532
    chainName: "Base Sepolia",
    custody: "0x019B65A265EB3363822f2752141b3dF16131b262",
    adjudicator: "0x7c7ccbc98469190849BCC6c926307794fDfB11F2",
    rpcUrl: import.meta.env.VITE_YELLOW_SANDBOX_RPC_BASE || "https://sepolia.base.org",
    blockExplorer: "https://sepolia.basescan.org",
    isTestnet: true,
  },
  {
    chainId: polygonAmoy.id, // 80002
    chainName: "Polygon Amoy",
    custody: "0x019B65A265EB3363822f2752141b3dF16131b262",
    adjudicator: "0x7c7ccbc98469190849BCC6c926307794fDfB11F2",
    rpcUrl: import.meta.env.VITE_YELLOW_SANDBOX_RPC_POLYGON || "https://rpc-amoy.polygon.technology",
    blockExplorer: "https://amoy.polygonscan.com",
    isTestnet: true,
  },
];

const SANDBOX_ASSETS: YellowAssetConfig[] = [
  {
    symbol: "ytest.usd",
    name: "Yellow Test USD",
    decimals: 6,
    addresses: {
      [sepolia.id]: "0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb",
      [baseSepolia.id]: "0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb",
      [polygonAmoy.id]: "0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb",
    },
  },
];

export const SANDBOX_CONFIG: YellowEnvironmentConfig = {
  environment: "sandbox",
  wsUrl: YELLOW_WS_SANDBOX,
  networks: SANDBOX_NETWORKS,
  assets: SANDBOX_ASSETS,
  faucetUrl: "https://clearnet-sandbox.yellow.com/faucet/requestTokens",
};

// ─────────────────────────────────────────────────────────────────────────────
// Production Configuration (Mainnet)
// ─────────────────────────────────────────────────────────────────────────────

const PRODUCTION_NETWORKS: YellowNetworkConfig[] = [
  {
    chainId: mainnet.id, // 1
    chainName: "Ethereum",
    custody: "0x6F71a38d919ad713D0AfE0eB712b95064Fc2616f",
    adjudicator: "0x14980dF216722f14c42CA7357b06dEa7eB408b10",
    rpcUrl: import.meta.env.VITE_YELLOW_MAINNET_RPC_ETH || "https://eth.llamarpc.com",
    blockExplorer: "https://etherscan.io",
    isTestnet: false,
  },
  {
    chainId: base.id, // 8453
    chainName: "Base",
    custody: "0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6",
    adjudicator: "0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C",
    rpcUrl: import.meta.env.VITE_YELLOW_MAINNET_RPC_BASE || "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    isTestnet: false,
  },
  {
    chainId: polygon.id, // 137
    chainName: "Polygon",
    custody: "0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6",
    adjudicator: "0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C",
    rpcUrl: import.meta.env.VITE_YELLOW_MAINNET_RPC_POLYGON || "https://polygon-rpc.com",
    blockExplorer: "https://polygonscan.com",
    isTestnet: false,
  },
  {
    chainId: bsc.id, // 56
    chainName: "BNB Smart Chain",
    custody: "0x6F71a38d919ad713D0AfE0eB712b95064Fc2616f",
    adjudicator: "0x14980dF216722f14c42CA7357b06dEa7eB408b10",
    rpcUrl: import.meta.env.VITE_YELLOW_MAINNET_RPC_BSC || "https://bsc-dataseed.binance.org",
    blockExplorer: "https://bscscan.com",
    isTestnet: false,
  },
  {
    chainId: linea.id, // 59144
    chainName: "Linea",
    custody: "0x6F71a38d919ad713D0AfE0eB712b95064Fc2616f",
    adjudicator: "0x14980dF216722f14c42CA7357b06dEa7eB408b10",
    rpcUrl: import.meta.env.VITE_YELLOW_MAINNET_RPC_LINEA || "https://rpc.linea.build",
    blockExplorer: "https://lineascan.build",
    isTestnet: false,
  },
  {
    chainId: 480, // World Chain
    chainName: "World Chain",
    custody: "0x6F71a38d919ad713D0AfE0eB712b95064Fc2616f",
    adjudicator: "0x14980dF216722f14c42CA7357b06dEa7eB408b10",
    rpcUrl: import.meta.env.VITE_YELLOW_MAINNET_RPC_WORLD || "https://worldchain-mainnet.g.alchemy.com/public",
    blockExplorer: "https://worldchain-mainnet.explorer.alchemy.com",
    isTestnet: false,
  },
  {
    chainId: 1440000, // XRPL EVM Sidechain
    chainName: "XRPL EVM Sidechain",
    custody: "0x6F71a38d919ad713D0AfE0eB712b95064Fc2616f",
    adjudicator: "0x14980dF216722f14c42CA7357b06dEa7eB408b10",
    rpcUrl: import.meta.env.VITE_YELLOW_MAINNET_RPC_XRPL || "https://rpc-evm-sidechain.xrpl.org",
    blockExplorer: "https://evm-sidechain.xrpl.org",
    isTestnet: false,
  },
];

/** USDC contract addresses by chain */
const USDC_ADDRESSES: Record<number, Address> = {
  [mainnet.id]: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [polygon.id]: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  [bsc.id]: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  [linea.id]: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
  480: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", // World Chain
  1440000: "0x0000000000000000000000000000000000000000", // XRPL - TBD
};

/** USDT contract addresses by chain */
const USDT_ADDRESSES: Record<number, Address> = {
  [bsc.id]: "0x55d398326f99059fF775485246999027B3197955",
  [base.id]: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  [linea.id]: "0xA219439258ca9da29E9Cc4cE5596924745e12B93",
};

/** ETH (native) addresses by chain */
const ETH_ADDRESSES: Record<number, Address> = {
  [base.id]: "0x0000000000000000000000000000000000000000",
  [linea.id]: "0x0000000000000000000000000000000000000000",
};

/** WETH contract addresses by chain */
const WETH_ADDRESSES: Record<number, Address> = {
  [bsc.id]: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
  [polygon.id]: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
};

const PRODUCTION_ASSETS: YellowAssetConfig[] = [
  {
    symbol: "usdc",
    name: "USD Coin",
    decimals: 6,
    addresses: USDC_ADDRESSES,
  },
  {
    symbol: "usdt",
    name: "Tether USD",
    decimals: 6,
    addresses: USDT_ADDRESSES,
  },
  {
    symbol: "eth",
    name: "Ethereum",
    decimals: 18,
    addresses: ETH_ADDRESSES,
  },
  {
    symbol: "weth",
    name: "Wrapped Ether",
    decimals: 18,
    addresses: WETH_ADDRESSES,
  },
  {
    symbol: "bnb",
    name: "BNB",
    decimals: 18,
    addresses: {
      [bsc.id]: "0x0000000000000000000000000000000000000000",
    },
  },
  {
    symbol: "link",
    name: "Chainlink",
    decimals: 18,
    addresses: {
      [bsc.id]: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD",
    },
  },
  {
    symbol: "xrp",
    name: "XRP",
    decimals: 18,
    addresses: {
      1440000: "0x0000000000000000000000000000000000000000",
    },
  },
];

export const PRODUCTION_CONFIG: YellowEnvironmentConfig = {
  environment: "production",
  wsUrl: YELLOW_WS_PRODUCTION,
  networks: PRODUCTION_NETWORKS,
  assets: PRODUCTION_ASSETS,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get Yellow configuration for a specific environment
 */
export function getYellowConfig(environment: YellowEnvironment): YellowEnvironmentConfig {
  return environment === "sandbox" ? SANDBOX_CONFIG : PRODUCTION_CONFIG;
}

/**
 * Get network configuration for a specific chain
 */
export function getNetworkConfig(
  environment: YellowEnvironment,
  chainId: number
): YellowNetworkConfig | undefined {
  const config = getYellowConfig(environment);
  return config.networks.find((n) => n.chainId === chainId);
}

/**
 * Get asset configuration by symbol
 */
export function getAssetConfig(
  environment: YellowEnvironment,
  symbol: string
): YellowAssetConfig | undefined {
  const config = getYellowConfig(environment);
  return config.assets.find((a) => a.symbol.toLowerCase() === symbol.toLowerCase());
}

/**
 * Get token address for a specific asset on a specific chain
 */
export function getTokenAddress(
  environment: YellowEnvironment,
  symbol: string,
  chainId: number
): Address | undefined {
  const asset = getAssetConfig(environment, symbol);
  return asset?.addresses[chainId];
}

/**
 * Get all supported chain IDs for an environment
 */
export function getSupportedChainIds(environment: YellowEnvironment): number[] {
  const config = getYellowConfig(environment);
  return config.networks.map((n) => n.chainId);
}

/**
 * Check if a chain is supported in an environment
 */
export function isChainSupported(environment: YellowEnvironment, chainId: number): boolean {
  return getSupportedChainIds(environment).includes(chainId);
}

/**
 * Get the primary asset symbol for an environment
 */
export function getPrimaryAsset(environment: YellowEnvironment): string {
  return environment === "sandbox" ? "ytest.usd" : "usdc";
}

/**
 * Get the default chain for an environment
 * For production, default to Ethereum Mainnet (1)
 */
export function getDefaultChainId(environment: YellowEnvironment): number {
  return environment === "sandbox" ? sepolia.id : mainnet.id;
}

/**
 * Get block explorer URL for a transaction
 */
export function getExplorerTxUrl(
  environment: YellowEnvironment,
  chainId: number,
  txHash: string
): string {
  const network = getNetworkConfig(environment, chainId);
  if (!network) return "";
  return `${network.blockExplorer}/tx/${txHash}`;
}

/**
 * Get block explorer URL for an address
 */
export function getExplorerAddressUrl(
  environment: YellowEnvironment,
  chainId: number,
  address: string
): string {
  const network = getNetworkConfig(environment, chainId);
  if (!network) return "";
  return `${network.blockExplorer}/address/${address}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Viem Chain Objects
// ─────────────────────────────────────────────────────────────────────────────

import type { Chain } from "viem";

/** Map chain IDs to viem chain objects */
export const CHAIN_MAP: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
  [polygon.id]: polygon,
  [polygonAmoy.id]: polygonAmoy,
  [bsc.id]: bsc,
  [linea.id]: linea,
};

/**
 * Get viem chain object for a chain ID
 */
export function getViemChain(chainId: number): Chain | undefined {
  return CHAIN_MAP[chainId];
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  sandbox: SANDBOX_CONFIG,
  production: PRODUCTION_CONFIG,
  getConfig: getYellowConfig,
  getNetwork: getNetworkConfig,
  getAsset: getAssetConfig,
  getToken: getTokenAddress,
};
