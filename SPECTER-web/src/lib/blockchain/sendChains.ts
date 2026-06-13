import { createPublicClient, defineChain, fallback, http, type Chain, type PublicClient } from "viem";
import { arbitrumSepolia, mainnet, sepolia } from "viem/chains";
import { sendUseTestnet, useSuiTestnet } from "./chainConfig";
import {
  CHAIN_STANDARDS,
  EIP155_CHAIN_IDS,
  getBackendChainName,
  getCaip2,
  getChainDecimals,
  getChainStandard,
  getSourceChainId,
  getTxChainFromBackendName,
  getTxChainFromSourceChainId,
  type EvmTxChain,
  type TxChain,
} from "./chainRegistry";

// Chain identity (names, EIP-155 ids, CAIP-2, decimals) lives in
// chainRegistry.ts — re-exported here so existing imports keep working.
export {
  CHAIN_STANDARDS,
  EIP155_CHAIN_IDS,
  getBackendChainName,
  getCaip2,
  getChainDecimals,
  getChainStandard,
  getSourceChainId,
  getTxChainFromBackendName,
  getTxChainFromSourceChainId,
};
export type { EvmTxChain, TxChain };

export interface SendChainConfig {
  id: TxChain;
  label: string;
  shortLabel: string;
  currencySymbol: string;
  isEvm: boolean;
  colorClass: string;
  txHashPlaceholder: string;
  logoPath?: string;
}

const monadTestnet = defineChain({
  id: EIP155_CHAIN_IDS.MONAD_TESTNET,
  name: "Monad Testnet",
  network: "monad-testnet",
  nativeCurrency: {
    name: "Monad",
    symbol: "MON",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz"] },
    public: { http: [import.meta.env.VITE_MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://testnet.monadvision.com",
    },
  },
  testnet: true,
});

// Per-chain runtime config (viem chain + RPC + presentation). Identity
// fields (label, symbol, ids) come from the chain registry.
const EVM_CONFIG: Record<EvmTxChain, {
  chain: Chain;
  rpcUrl: string;
  colorClass: string;
  logoPath?: string;
}> = {
  ethereum: {
    chain: sendUseTestnet ? sepolia : mainnet,
    rpcUrl: sendUseTestnet
      ? import.meta.env.VITE_ETH_SEPOLIA_RPC_URL ||
        import.meta.env.VITE_YELLOW_SANDBOX_RPC_SEPOLIA ||
        "https://ethereum-sepolia-rpc.publicnode.com"
      : import.meta.env.VITE_ETH_RPC_URL || "https://cloudflare-eth.com",
    colorClass: "text-primary",
    logoPath: undefined,
  },
  arbitrum: {
    chain: arbitrumSepolia,
    rpcUrl:
      import.meta.env.VITE_ARB_SEPOLIA_RPC_URL ||
      "https://sepolia-rollup.arbitrum.io/rpc",
    colorClass: "text-[#96BEDC]",
    logoPath: "/assets/logo/arbitrum-logo.png",
  },
  monad: {
    chain: monadTestnet,
    rpcUrl:
      import.meta.env.VITE_MONAD_TESTNET_RPC_URL ||
      "https://testnet-rpc.monad.xyz",
    colorClass: "text-[#9E7BFF]",
    logoPath: "/assets/logo/monad-logo.png",
  },
};

const SUI_CONFIG: SendChainConfig = {
  id: "sui",
  label: useSuiTestnet ? "Sui Testnet" : "Sui Mainnet",
  shortLabel: useSuiTestnet ? "Sui Testnet" : "Sui",
  currencySymbol: CHAIN_STANDARDS.sui.currencySymbol,
  isEvm: false,
  colorClass: "text-[#4DA2FF]",
  txHashPlaceholder: "e.g. DFBxP4qNbDPYyXdwwDxUu3MSVXV13g51PwHkWv34VMCv",
  logoPath: "/assets/logo/sui-logo.png",
};

export function isEvmChain(chain: TxChain): chain is EvmTxChain {
  return chain !== "sui";
}

export function getAvailableSendChains(includeSui: boolean): TxChain[] {
  const base: TxChain[] = ["ethereum"];
  if (sendUseTestnet) {
    base.push("arbitrum", "monad");
  }
  if (includeSui) {
    base.push("sui");
  }
  return base;
}

export function getSendChainConfig(chain: TxChain): SendChainConfig {
  if (chain === "sui") {
    return SUI_CONFIG;
  }
  const evm = EVM_CONFIG[chain];
  const std = getChainStandard(chain);
  return {
    id: chain,
    label: std.label,
    shortLabel: std.shortLabel,
    currencySymbol: std.currencySymbol,
    isEvm: true,
    colorClass: evm.colorClass,
    txHashPlaceholder: "0x...",
    logoPath: evm.logoPath,
  };
}

export function getViemChainForEvm(chain: EvmTxChain): Chain {
  return EVM_CONFIG[chain].chain;
}

export function getRpcUrlForEvm(chain: EvmTxChain): string {
  return EVM_CONFIG[chain].rpcUrl;
}

export function getExplorerTxUrl(chain: TxChain, txHash: string): string {
  if (!txHash) return "";
  if (chain === "sui") {
    const base = useSuiTestnet ? "https://suiscan.xyz/testnet/tx/" : "https://suiscan.xyz/mainnet/tx/";
    return `${base}${txHash}`;
  }
  const explorer = EVM_CONFIG[chain].chain.blockExplorers?.default?.url ?? "";
  return explorer ? `${explorer}/tx/${txHash}` : "";
}

// Dev-time guard: the viem chain objects must agree with the registry's
// EIP-155 ids, otherwise publish requests would carry the wrong chain id.
if (import.meta.env.DEV) {
  for (const c of ["ethereum", "arbitrum", "monad"] as const) {
    if (EVM_CONFIG[c].chain.id !== CHAIN_STANDARDS[c].chainId) {
      console.warn(
        `[sendChains] viem chain id (${EVM_CONFIG[c].chain.id}) disagrees with chainRegistry (${CHAIN_STANDARDS[c].chainId}) for "${c}"`,
      );
    }
  }
}

// Public fallback RPCs (no API key required). Used when the primary RPC
// (e.g. Alchemy, Infura) is down, rate-limited, or returns 401.
const EVM_FALLBACK_RPCS: Partial<Record<EvmTxChain, string[]>> = {
  ethereum: sendUseTestnet
    ? [
        "https://ethereum-sepolia-rpc.publicnode.com",
        "https://rpc.sepolia.org",
        "https://rpc2.sepolia.org",
      ]
    : [
        "https://ethereum.publicnode.com",
        "https://cloudflare-eth.com",
      ],
  arbitrum: [
    "https://sepolia-rollup.arbitrum.io/rpc",
    "https://arbitrum-sepolia-rpc.publicnode.com",
  ],
};

const evmClients = new Map<EvmTxChain, PublicClient>();

export function getPublicClientForEvm(chain: EvmTxChain): PublicClient {
  const existing = evmClients.get(chain);
  if (existing) return existing;

  const primaryUrl = getRpcUrlForEvm(chain);
  const fallbacks = EVM_FALLBACK_RPCS[chain] ?? [];
  // Exclude fallbacks that duplicate the primary to avoid redundant retries.
  const uniqueFallbacks = fallbacks.filter((u) => u !== primaryUrl);

  const transport =
    uniqueFallbacks.length > 0
      ? fallback([http(primaryUrl), ...uniqueFallbacks.map((u) => http(u))])
      : http(primaryUrl);

  const client = createPublicClient({
    chain: getViemChainForEvm(chain),
    transport,
  });
  evmClients.set(chain, client);
  return client;
}
