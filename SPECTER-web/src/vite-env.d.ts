/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_ETH_RPC_URL?: string;
  /** Ethereum mainnet RPC for ENS (optional; defaults to publicnode) */
  readonly VITE_ENS_RPC_URL?: string;
  /** `staging` shows staging-only UI; `main` or omitted = production behavior */
  readonly VITE_APP_DEPLOYMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
