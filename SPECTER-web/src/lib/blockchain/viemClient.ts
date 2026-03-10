/**
 * Shared viem public client for ENS resolution and on-chain reads.
 * Uses Sepolia when VITE_USE_TESTNET=true, otherwise mainnet.
 */

import { createPublicClient, http } from 'viem';
import { chain } from './chainConfig';

const rpcUrl =
  import.meta.env.VITE_ETH_RPC_URL ||
  (chain.id === 1 ? 'https://cloudflare-eth.com' : 'https://ethereum-sepolia-rpc.publicnode.com');

export const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});
