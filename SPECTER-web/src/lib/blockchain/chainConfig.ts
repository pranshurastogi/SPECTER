/**
 * Chain configuration.
 *
 * `VITE_USE_TESTNET` — ENS, viem reads, setup (Generate Keys).
 * `VITE_SEND_USE_TESTNET` — send-payment chain picker (Sepolia, Arb Sepolia, Monad, Sui testnet).
 *   Set `true` while testing sends against mainnet ENS; set `false` when going full mainnet.
 */

import { mainnet, sepolia } from 'viem/chains';

export const useTestnet =
  import.meta.env.VITE_USE_TESTNET === 'true' ||
  import.meta.env.VITE_USE_TESTNET === '1';

/** Testnet send chains when true; follows `useTestnet` unless overridden. */
export const sendUseTestnet =
  import.meta.env.VITE_SEND_USE_TESTNET === 'false' ||
  import.meta.env.VITE_SEND_USE_TESTNET === '0'
    ? false
    : useTestnet ||
      import.meta.env.VITE_SEND_USE_TESTNET === 'true' ||
      import.meta.env.VITE_SEND_USE_TESTNET === '1';

export const chainId = useTestnet ? sepolia.id : mainnet.id;
export const chain = useTestnet ? sepolia : mainnet;
