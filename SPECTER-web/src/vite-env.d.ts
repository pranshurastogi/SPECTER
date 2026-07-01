/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  /** API key sent as X-API-Key on mutating requests (required when backend sets API_KEY). */
  readonly VITE_API_KEY?: string;
  readonly VITE_ETH_RPC_URL?: string;
  /** Sepolia RPC for send flow when VITE_SEND_USE_TESTNET=true */
  readonly VITE_ETH_SEPOLIA_RPC_URL?: string;
  /** `true` = testnet send chains while VITE_USE_TESTNET may stay false for mainnet ENS */
  readonly VITE_SEND_USE_TESTNET?: string;
  /** Ethereum mainnet RPC for ENS (optional; defaults to publicnode) */
  readonly VITE_ENS_RPC_URL?: string;
  /** `staging` shows staging-only UI; `main` or omitted = production behavior */
  readonly VITE_APP_DEPLOYMENT?: string;
  /** Monad testnet RPC (send flow + trustless recovery direct-RPC sweep). */
  readonly VITE_MONAD_TESTNET_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
