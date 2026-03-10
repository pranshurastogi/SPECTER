/**
 * Chain configuration. Flip VITE_USE_TESTNET to switch between Sepolia and mainnet.
 * - true: Sepolia (for testing)
 * - false/unset: Ethereum mainnet (production)
 */

import { mainnet, sepolia } from 'viem/chains';

export const useTestnet =
  import.meta.env.VITE_USE_TESTNET === 'true' ||
  import.meta.env.VITE_USE_TESTNET === '1';

export const chainId = useTestnet ? sepolia.id : mainnet.id;
export const chain = useTestnet ? sepolia : mainnet;
