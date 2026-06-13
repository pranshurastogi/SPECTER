/**
 * Chain registry — the single source of truth for chain identity.
 *
 * Every chain identifier the app uses lives here, expressed in the
 * industry-standard formats:
 *
 *   - EIP-155 numeric chain IDs   (e.g. 10143 for Monad Testnet)
 *   - CAIP-2 chain identifiers    (e.g. "eip155:10143", "sui:testnet")
 *   - SPECTER backend chain names (the server's `CHAIN_RPC_<NAME>` keys)
 *
 * Nothing else in the codebase should hard-code a chain ID, backend name,
 * or native-currency decimals — import from here (directly or via the
 * re-exports in `sendChains.ts`).
 */

import { sendUseTestnet } from "./chainConfig";

export type EvmTxChain = "ethereum" | "arbitrum" | "monad";
export type TxChain = EvmTxChain | "sui";

/** CAIP-2 namespaces (https://chainagnostic.org/CAIPs/caip-2). */
export type ChainNamespace = "eip155" | "sui";

/** EIP-155 chain IDs (https://chainlist.org). */
export const EIP155_CHAIN_IDS = {
  ETHEREUM_MAINNET: 1,
  ETHEREUM_SEPOLIA: 11155111,
  ARBITRUM_ONE: 42161,
  ARBITRUM_SEPOLIA: 421614,
  MONAD_MAINNET: 143,
  MONAD_TESTNET: 10143,
} as const;

/**
 * SPECTER backend chain names — MUST match the server's `CHAIN_RPC_<NAME>`
 * map keys (see `specter-api/src/state.rs`). The server uses these to pick
 * the payment-verification RPC, so a mismatch silently disables
 * server-side verification.
 */
export const BACKEND_CHAIN_NAMES = {
  ETHEREUM_MAINNET: "ethereum",
  ETHEREUM_SEPOLIA: "sepolia",
  ARBITRUM: "arbitrum",
  MONAD_TESTNET: "monad-testnet",
  SUI: "sui",
} as const;

/** Native currency decimals: EVM wei = 18, Sui MIST = 9. */
export const NATIVE_DECIMALS = {
  EVM: 18,
  SUI: 9,
} as const;

export interface ChainStandard {
  /** Frontend chain key used across components. */
  id: TxChain;
  /** CAIP-2 namespace. */
  namespace: ChainNamespace;
  /** EIP-155 numeric chain ID (null for non-EVM chains). */
  chainId: number | null;
  /** CAIP-2 identifier, e.g. "eip155:10143" or "sui:testnet". */
  caip2: string;
  /** SPECTER backend chain name (`CHAIN_RPC_<NAME>` key). */
  backendName: string;
  /** Native currency decimals for base-unit ↔ display conversion. */
  decimals: number;
  currencySymbol: string;
  label: string;
  shortLabel: string;
}

/**
 * Canonical descriptor per frontend chain, resolved for the current
 * environment (`VITE_SEND_USE_TESTNET`).
 */
export const CHAIN_STANDARDS: Record<TxChain, ChainStandard> = {
  ethereum: sendUseTestnet
    ? {
        id: "ethereum",
        namespace: "eip155",
        chainId: EIP155_CHAIN_IDS.ETHEREUM_SEPOLIA,
        caip2: `eip155:${EIP155_CHAIN_IDS.ETHEREUM_SEPOLIA}`,
        backendName: BACKEND_CHAIN_NAMES.ETHEREUM_SEPOLIA,
        decimals: NATIVE_DECIMALS.EVM,
        currencySymbol: "ETH",
        label: "Ethereum Sepolia",
        shortLabel: "Sepolia",
      }
    : {
        id: "ethereum",
        namespace: "eip155",
        chainId: EIP155_CHAIN_IDS.ETHEREUM_MAINNET,
        caip2: `eip155:${EIP155_CHAIN_IDS.ETHEREUM_MAINNET}`,
        backendName: BACKEND_CHAIN_NAMES.ETHEREUM_MAINNET,
        decimals: NATIVE_DECIMALS.EVM,
        currencySymbol: "ETH",
        label: "Ethereum",
        shortLabel: "Ethereum",
      },
  arbitrum: {
    id: "arbitrum",
    namespace: "eip155",
    chainId: EIP155_CHAIN_IDS.ARBITRUM_SEPOLIA,
    caip2: `eip155:${EIP155_CHAIN_IDS.ARBITRUM_SEPOLIA}`,
    backendName: BACKEND_CHAIN_NAMES.ARBITRUM,
    decimals: NATIVE_DECIMALS.EVM,
    currencySymbol: "ETH",
    label: "Arbitrum Sepolia",
    shortLabel: "Arbitrum",
  },
  monad: {
    id: "monad",
    namespace: "eip155",
    chainId: EIP155_CHAIN_IDS.MONAD_TESTNET,
    caip2: `eip155:${EIP155_CHAIN_IDS.MONAD_TESTNET}`,
    backendName: BACKEND_CHAIN_NAMES.MONAD_TESTNET,
    decimals: NATIVE_DECIMALS.EVM,
    currencySymbol: "MON",
    label: "Monad Testnet",
    shortLabel: "Monad",
  },
  sui: {
    id: "sui",
    namespace: "sui",
    chainId: null,
    caip2: sendUseTestnet ? "sui:testnet" : "sui:mainnet",
    backendName: BACKEND_CHAIN_NAMES.SUI,
    decimals: NATIVE_DECIMALS.SUI,
    currencySymbol: "SUI",
    label: "Sui",
    shortLabel: "Sui",
  },
};

/**
 * EIP-155 id → frontend chain, covering BOTH mainnet and testnet ids so
 * scan results resolve regardless of which environment published them.
 */
const EIP155_TO_TX_CHAIN: Record<number, EvmTxChain> = {
  [EIP155_CHAIN_IDS.ETHEREUM_MAINNET]: "ethereum",
  [EIP155_CHAIN_IDS.ETHEREUM_SEPOLIA]: "ethereum",
  [EIP155_CHAIN_IDS.ARBITRUM_ONE]: "arbitrum",
  [EIP155_CHAIN_IDS.ARBITRUM_SEPOLIA]: "arbitrum",
  [EIP155_CHAIN_IDS.MONAD_MAINNET]: "monad",
  [EIP155_CHAIN_IDS.MONAD_TESTNET]: "monad",
};

export function getChainStandard(chain: TxChain): ChainStandard {
  return CHAIN_STANDARDS[chain];
}

/** CAIP-2 identifier for a chain (e.g. "eip155:10143"). */
export function getCaip2(chain: TxChain): string {
  return CHAIN_STANDARDS[chain].caip2;
}

/** SPECTER backend chain name (server `CHAIN_RPC_<NAME>` key). */
export function getBackendChainName(chain: TxChain): string {
  return CHAIN_STANDARDS[chain].backendName;
}

/** EIP-155 chain ID for the publish request's `source_chain_id` (undefined for Sui). */
export function getSourceChainId(chain: TxChain): number | undefined {
  return CHAIN_STANDARDS[chain].chainId ?? undefined;
}

/** Native currency decimals for base-unit ↔ display conversion. */
export function getChainDecimals(chain: TxChain): number {
  return CHAIN_STANDARDS[chain].decimals;
}

/** Reverse of {@link getSourceChainId}: EIP-155 id → frontend chain. */
export function getTxChainFromSourceChainId(
  id: number | null | undefined,
): EvmTxChain | null {
  if (id == null) return null;
  return EIP155_TO_TX_CHAIN[id] ?? null;
}

/**
 * Maps a backend/registry chain name ("monad-testnet", "sepolia", "sui", …)
 * back to the frontend chain. Exact backend names resolve first, then a
 * fuzzy match covers legacy rows. Returns null when unknown — callers must
 * surface "unknown" rather than assuming a default chain.
 */
export function getTxChainFromBackendName(
  name: string | null | undefined,
): TxChain | null {
  const normalized = (name ?? "").trim().toLowerCase();
  if (!normalized) return null;

  for (const std of Object.values(CHAIN_STANDARDS)) {
    if (std.backendName === normalized) return std.id;
  }

  // Legacy/fuzzy fallback for rows published before names were standardized.
  if (normalized.includes("sui")) return "sui";
  if (normalized.includes("monad")) return "monad";
  if (normalized.includes("arb")) return "arbitrum";
  if (normalized.includes("sepolia") || normalized.includes("eth")) return "ethereum";
  return null;
}
