/**
 * Shared viem public client for on-chain reads (Yellow, send chains, etc.).
 * Uses Sepolia when VITE_USE_TESTNET=true, otherwise mainnet.
 * ENS always uses {@link ensPublicClient} from ensConfig.ts (mainnet only).
 */

import { createPublicClient, fallback, http } from 'viem';
import { chain } from './chainConfig';
import {
  ETH_MAINNET_FALLBACKS,
  ETH_SEPOLIA_FALLBACKS,
  rpcChain,
} from './rpcFallbacks';

const defaults = chain.id === 1 ? ETH_MAINNET_FALLBACKS : ETH_SEPOLIA_FALLBACKS;
const urls = rpcChain(
  import.meta.env.VITE_ETH_RPC_URL,
  import.meta.env.VITE_ETH_RPC_URL_FALLBACK,
  defaults,
);

export const publicClient = createPublicClient({
  chain,
  transport: fallback(urls.map((url) => http(url))),
});
