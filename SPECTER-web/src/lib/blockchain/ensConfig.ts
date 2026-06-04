/**
 * ENS is always on Ethereum mainnet — real .eth names are not on Sepolia.
 * Used for reverse lookup, text-record writes, and ENS app links.
 */

import { createPublicClient, http, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';

export const ENS_CHAIN = mainnet;
export const ENS_CHAIN_ID = mainnet.id;
export const ENS_APP_URL = 'https://app.ens.domains';

const DEFAULT_ENS_RPC = 'https://ethereum.publicnode.com';
const ENS_INCOMPATIBLE_RPC_HOSTS = ['cloudflare-eth.com'];

function ensRpcUrl(): string {
  const configured =
    import.meta.env.VITE_ENS_RPC_URL || import.meta.env.VITE_ETH_MAINNET_RPC_URL;
  if (configured && !ENS_INCOMPATIBLE_RPC_HOSTS.some((host) => configured.includes(host))) {
    return configured;
  }
  return DEFAULT_ENS_RPC;
}

export const ensPublicClient: PublicClient = createPublicClient({
  chain: mainnet,
  transport: http(ensRpcUrl()),
});

export function ensAppProfileUrl(name: string): string {
  return `${ENS_APP_URL}/${encodeURIComponent(name)}`;
}
