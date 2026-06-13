/**
 * Chain configuration.
 *
 * `VITE_USE_TESTNET` — ENS, viem reads, setup (Generate Keys).
 * `VITE_SEND_USE_TESTNET` — send-payment chain picker (Sepolia, Arb Sepolia, Monad, Sui testnet).
 *   Set `true` while testing sends against mainnet ENS; set `false` when going full mainnet.
 * `VITE_USE_SUI_TESTNET` — SuiNS resolution network, independent of EVM testnet flag.
 *   Defaults to `VITE_USE_TESTNET` when not set.
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

/** Controls which SuiNS network the Sui wallet and resolver use. Independent of EVM testnet. */
export const useSuiTestnet =
  import.meta.env.VITE_USE_SUI_TESTNET === 'false' ||
  import.meta.env.VITE_USE_SUI_TESTNET === '0'
    ? false
    : import.meta.env.VITE_USE_SUI_TESTNET === 'true' ||
      import.meta.env.VITE_USE_SUI_TESTNET === '1'
      ? true
      : useTestnet; // fall back to VITE_USE_TESTNET when not explicitly set

export const chainId = useTestnet ? sepolia.id : mainnet.id;
export const chain = useTestnet ? sepolia : mainnet;
