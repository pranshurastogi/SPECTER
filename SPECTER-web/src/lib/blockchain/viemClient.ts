/**
 * Shared viem public client for on-chain reads (Yellow, send chains, etc.).
 * Uses Sepolia when VITE_USE_TESTNET=true, otherwise mainnet.
 * ENS always uses {@link ensPublicClient} from ensConfig.ts (mainnet only).
 */

import { createPublicClient, http } from 'viem';
import { chain } from './chainConfig';

const rpcUrl =
  import.meta.env.VITE_ETH_RPC_URL ||
  (chain.id === 1 ? 'https://ethereum.publicnode.com' : 'https://ethereum-sepolia-rpc.publicnode.com');

export const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});
