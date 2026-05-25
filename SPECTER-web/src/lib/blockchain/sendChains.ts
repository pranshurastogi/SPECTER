import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";
import { arbitrumSepolia, mainnet, sepolia } from "viem/chains";
import { useTestnet } from "./chainConfig";

export type EvmTxChain = "ethereum" | "arbitrum" | "monad";
export type TxChain = EvmTxChain | "sui";

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
  id: 10143,
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

const EVM_CONFIG: Record<EvmTxChain, {
  chain: Chain;
  rpcUrl: string;
  label: string;
  shortLabel: string;
  currencySymbol: string;
  colorClass: string;
}> = {
  ethereum: {
    chain: useTestnet ? sepolia : mainnet,
    rpcUrl:
      import.meta.env.VITE_ETH_RPC_URL ||
      (useTestnet ? "https://ethereum-sepolia-rpc.publicnode.com" : "https://cloudflare-eth.com"),
    label: useTestnet ? "Ethereum Sepolia" : "Ethereum",
    shortLabel: useTestnet ? "Sepolia" : "Ethereum",
    currencySymbol: "ETH",
    colorClass: "text-primary",
    logoPath: undefined,
  },
  arbitrum: {
    chain: arbitrumSepolia,
    rpcUrl:
      import.meta.env.VITE_ARB_SEPOLIA_RPC_URL ||
      "https://sepolia-rollup.arbitrum.io/rpc",
    label: "Arbitrum Sepolia",
    shortLabel: "Arbitrum",
    currencySymbol: "ETH",
    colorClass: "text-[#96BEDC]",
    logoPath: "/assets/logo/arbitrum-logo.png",
  },
  monad: {
    chain: monadTestnet,
    rpcUrl:
      import.meta.env.VITE_MONAD_TESTNET_RPC_URL ||
      "https://testnet-rpc.monad.xyz",
    label: "Monad Testnet",
    shortLabel: "Monad",
    currencySymbol: "MON",
    colorClass: "text-[#9E7BFF]",
    logoPath: "/assets/logo/monad-logo.png",
  },
};

const SUI_CONFIG: SendChainConfig = {
  id: "sui",
  label: "Sui",
  shortLabel: "Sui",
  currencySymbol: "SUI",
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
  if (useTestnet) {
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
  return {
    id: chain,
    label: evm.label,
    shortLabel: evm.shortLabel,
    currencySymbol: evm.currencySymbol,
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
    const base = useTestnet ? "https://suiscan.xyz/testnet/tx/" : "https://suiscan.xyz/mainnet/tx/";
    return `${base}${txHash}`;
  }
  const explorer = EVM_CONFIG[chain].chain.blockExplorers?.default?.url ?? "";
  return explorer ? `${explorer}/tx/${txHash}` : "";
}

const evmClients = new Map<EvmTxChain, PublicClient>();

export function getPublicClientForEvm(chain: EvmTxChain): PublicClient {
  const existing = evmClients.get(chain);
  if (existing) return existing;
  const client = createPublicClient({
    chain: getViemChainForEvm(chain),
    transport: http(getRpcUrlForEvm(chain)),
  });
  evmClients.set(chain, client);
  return client;
}
