/**
 * ENS is always on Ethereum mainnet — real .eth names are not on Sepolia.
 * Used for reverse lookup, text-record writes, and ENS app links.
 */

import { createPublicClient, fallback, http, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { ETH_MAINNET_FALLBACKS, isBrokenRpcUrl, usableRpcUrls } from './rpcFallbacks';

export const ENS_CHAIN = mainnet;
export const ENS_CHAIN_ID = mainnet.id;
export const ENS_APP_URL = 'https://app.ens.domains';

/**
 * Endpoints for ENS reads, primary first.
 *
 * A configured RPC that is rate-limited or has a revoked key would otherwise
 * make every name look like it has no SPECTER record, so the public nodes are
 * always appended behind it rather than used only when nothing is configured.
 */
function ensRpcUrls(): string[] {
  const configured =
    import.meta.env.VITE_ENS_RPC_URL || import.meta.env.VITE_ETH_MAINNET_RPC_URL;
  const primary = isBrokenRpcUrl(configured) ? undefined : configured;
  return usableRpcUrls(primary, ...ETH_MAINNET_FALLBACKS);
}

export const ensPublicClient: PublicClient = createPublicClient({
  chain: mainnet,
  transport: fallback(ensRpcUrls().map((url) => http(url))),
});

export function ensAppProfileUrl(name: string): string {
  return `${ENS_APP_URL}/${encodeURIComponent(name)}`;
}
