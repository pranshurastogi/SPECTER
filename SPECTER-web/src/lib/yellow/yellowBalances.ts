/**
 * Yellow Network Token Balance Utilities
 * 
 * Fetch token balances for Yellow supported tokens (native ETH or ERC20).
 * Supports both Sandbox (testnet) and Production (mainnet) environments.
 */

import {
  type Address,
  type PublicClient,
  formatUnits,
  getAddress,
  createPublicClient,
  http,
} from "viem";
import { publicClient as defaultPublicClient } from "../blockchain/viemClient";
import {
  type YellowEnvironment,
  type YellowAssetConfig,
  getYellowConfig,
  getNetworkConfig,
  getViemChain,
  SANDBOX_CONFIG,
  PRODUCTION_CONFIG,
} from "./yellowConfig";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/** Threshold below which we show faucet (in token units, e.g. 10 USDC = 10) */
export const LOW_BALANCE_THRESHOLD = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Faucet URLs by Environment
// ─────────────────────────────────────────────────────────────────────────────

/** Sandbox faucet URLs */
export const SANDBOX_FAUCETS = {
  /** Yellow Test USD faucet (ytest.usd) */
  YTEST_USD: "https://clearnet-sandbox.yellow.com/faucet/requestTokens",
  /** Sepolia ETH faucet */
  SEPOLIA_ETH: "https://faucets.chain.link/sepolia",
  /** Base Sepolia ETH faucet */
  BASE_SEPOLIA_ETH: "https://www.alchemy.com/faucets/base-sepolia",
  /** Polygon Amoy faucet */
  POLYGON_AMOY: "https://faucet.polygon.technology/",
} as const;

/** Legacy exports for backward compatibility */
export const YTEST_USD_FAUCET = SANDBOX_FAUCETS.YTEST_USD;
export const SEPOLIA_ETH_FAUCET = SANDBOX_FAUCETS.SEPOLIA_ETH;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenBalance {
  balance: bigint;
  formatted: string;
  symbol: string;
  decimals: number;
  address: string;
}

export interface EnvironmentTokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  address: Address;
  chainId: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Client Factory
// ─────────────────────────────────────────────────────────────────────────────

const publicClientCache: Map<number, PublicClient> = new Map();

/**
 * Get or create a public client for a specific chain
 */
export function getPublicClientForChain(
  environment: YellowEnvironment,
  chainId: number
): PublicClient {
  const cacheKey = chainId;
  if (publicClientCache.has(cacheKey)) {
    return publicClientCache.get(cacheKey)!;
  }

  const networkConfig = getNetworkConfig(environment, chainId);
  if (!networkConfig) {
    return defaultPublicClient;
  }

  const viemChain = getViemChain(chainId);
  const client = createPublicClient({
    chain: viemChain ?? {
      id: chainId,
      name: networkConfig.chainName,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [networkConfig.rpcUrl] } },
    } as any,
    transport: http(networkConfig.rpcUrl),
  });

  publicClientCache.set(cacheKey, client);
  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Balance Fetching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a single token balance
 */
export async function fetchTokenBalance(
  tokenAddress: string,
  userAddress: Address,
  decimals: number,
  symbol: string,
  client?: PublicClient
): Promise<TokenBalance> {
  const pubClient = client ?? defaultPublicClient;
  const addr = getAddress(tokenAddress);
  const isNative = addr === ZERO_ADDRESS || addr.toLowerCase() === ZERO_ADDRESS.toLowerCase();

  let balance: bigint;
  if (isNative) {
    balance = await pubClient.getBalance({ address: userAddress });
  } else {
    balance = await pubClient.readContract({
      address: addr,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [userAddress],
    });
  }

  return {
    balance,
    formatted: formatUnits(balance, decimals),
    symbol,
    decimals,
    address: tokenAddress,
  };
}

/**
 * Fetch balances for multiple tokens
 */
export async function fetchBalancesForTokens(
  tokens: { address: string; symbol: string; decimals: number }[],
  userAddress: Address,
  client?: PublicClient
): Promise<Record<string, TokenBalance>> {
  const out: Record<string, TokenBalance> = {};
  await Promise.all(
    tokens.map(async (t) => {
      try {
        const tb = await fetchTokenBalance(
          t.address,
          userAddress,
          t.decimals,
          t.symbol,
          client
        );
        out[t.address.toLowerCase()] = tb;
      } catch {
        out[t.address.toLowerCase()] = {
          balance: 0n,
          formatted: "0",
          symbol: t.symbol,
          decimals: t.decimals,
          address: t.address,
        };
      }
    })
  );
  return out;
}

/**
 * Fetch all Yellow-supported token balances for a given environment and chain
 */
export async function fetchYellowTokenBalances(
  environment: YellowEnvironment,
  chainId: number,
  userAddress: Address
): Promise<Record<string, TokenBalance>> {
  const config = getYellowConfig(environment);
  const client = getPublicClientForChain(environment, chainId);

  const tokens = config.assets
    .filter((asset) => asset.addresses[chainId])
    .map((asset) => ({
      address: asset.addresses[chainId],
      symbol: asset.symbol,
      decimals: asset.decimals,
    }));

  return fetchBalancesForTokens(tokens, userAddress, client);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a balance is below threshold
 */
export function isLowBalance(
  formatted: string,
  decimals: number,
  threshold: number = LOW_BALANCE_THRESHOLD
): boolean {
  const num = parseFloat(formatted);
  return num < threshold;
}

/**
 * Get tokens available for a specific chain in an environment
 */
export function getTokensForChain(
  environment: YellowEnvironment,
  chainId: number
): EnvironmentTokenInfo[] {
  const config = getYellowConfig(environment);
  return config.assets
    .filter((asset) => asset.addresses[chainId])
    .map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      decimals: asset.decimals,
      address: asset.addresses[chainId],
      chainId,
    }));
}

/**
 * Get primary asset for an environment
 */
export function getPrimaryAssetInfo(
  environment: YellowEnvironment,
  chainId: number
): EnvironmentTokenInfo | null {
  const tokens = getTokensForChain(environment, chainId);
  const primarySymbol = environment === "sandbox" ? "ytest.usd" : "usdc";
  return tokens.find((t) => t.symbol.toLowerCase() === primarySymbol) ?? tokens[0] ?? null;
}

/**
 * Get faucet URL for an environment/chain
 */
export function getFaucetUrl(
  environment: YellowEnvironment,
  chainId: number,
  assetType: "native" | "token" = "token"
): string | null {
  if (environment === "production") {
    return null;
  }

  if (assetType === "native") {
    switch (chainId) {
      case 11155111:
        return SANDBOX_FAUCETS.SEPOLIA_ETH;
      case 84532:
        return SANDBOX_FAUCETS.BASE_SEPOLIA_ETH;
      case 80002:
        return SANDBOX_FAUCETS.POLYGON_AMOY;
      default:
        return null;
    }
  }

  return SANDBOX_FAUCETS.YTEST_USD;
}

/**
 * Get native currency info for a chain
 */
export function getNativeCurrencyInfo(chainId: number): {
  symbol: string;
  name: string;
  decimals: number;
} {
  switch (chainId) {
    case 56:
      return { symbol: "BNB", name: "BNB", decimals: 18 };
    case 137:
    case 80002:
      return { symbol: "MATIC", name: "Polygon", decimals: 18 };
    case 1440000:
      return { symbol: "XRP", name: "XRP", decimals: 18 };
    default:
      return { symbol: "ETH", name: "Ether", decimals: 18 };
  }
}
