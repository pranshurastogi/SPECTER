/**
 * Shared viem public client for ENS resolution and on-chain reads.
 * Uses Ethereum mainnet since ENS lives on L1.
 */

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const mainnetRpc =
  import.meta.env.VITE_RPC_ETH_MAINNET || 'https://cloudflare-eth.com';

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(mainnetRpc),
});
