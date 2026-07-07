/**
 * Trustless-recovery configuration.
 *
 * Everything the `/i-dont-trust-specter` page needs to read SPECTER
 * announcements straight from the chain — with ZERO calls to SPECTER's
 * backend or indexer. The only network endpoint is the Monad RPC, which the
 * user can override on the page.
 *
 * The announcer address + deploy block are protocol facts baked into the
 * deployed contract; they are intentionally NOT pulled from any SPECTER
 * service so the page keeps working even if SPECTER is gone.
 */

import { EIP155_CHAIN_IDS } from "@/lib/blockchain/chainRegistry";

/** The chain SPECTER announcements live on (Monad testnet). */
export const RECOVERY_CHAIN_ID = EIP155_CHAIN_IDS.MONAD_TESTNET;

/** Deployed SPECTERAnnouncer contract. */
export const ANNOUNCER_ADDRESS =
  "0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC" as const;

/** Block the announcer was deployed at — scanning starts here. */
export const ANNOUNCER_DEPLOY_BLOCK = 37571591n;

/**
 * Public, key-less Monad testnet RPC. Used as the default; the user may
 * paste their own endpoint (e.g. a private node) on the page. Anyone can run
 * recovery against any RPC that serves the announcer's logs.
 *
 * Deliberately NOT a keyed provider (e.g. Alchemy) — this page's whole point
 * is working when SPECTER's own infra (including its keyed RPC providers) is
 * unavailable, so the default must be a no-signup public node.
 */
export const DEFAULT_MONAD_RPC_URL =
  (import.meta.env.VITE_MONAD_TESTNET_RPC_URL as string | undefined) ||
  "https://rpc-testnet.monadinfra.com";

/**
 * Initial block window for chunked `getLogs`. Public RPCs cap the range per
 * request: Monad's public endpoints have historically hard-capped
 * `eth_getLogs` around **100 blocks**, so 100 is the zero-friction default. The
 * sweep adapts DOWN automatically if an RPC enforces an even smaller cap (it
 * parses the limit from the error, or halves), so 100 stays correct everywhere
 * — a more permissive RPC simply does more (still-correct) requests. The fast
 * path is the registry; this is the fully-trustless fallback.
 */
export const LOG_SCAN_CHUNK = 100n;

/** Never shrink the adaptive `getLogs` window below this many blocks. */
export const MIN_LOG_SCAN_CHUNK = 25n;

/**
 * Stay safely under Monad's public-RPC rate cap (`requests limited to 25/sec`).
 * Every RPC call (getLogs + the per-announcement getTransaction) passes through
 * a token-spaced gate at this rate, and the sweep backs off on 429 / rate-limit
 * errors.
 */
export const RPC_MAX_REQUESTS_PER_SEC = 18;

/** Overlapping in-flight RPC requests, to hide network latency under the gate. */
export const RPC_SCAN_CONCURRENCY = 6;

/**
 * SPECTER's deployed backend, whose read-only registry (`GET
 * /api/v1/registry/announcements`) is the FAST default source. The registry
 * serves the full 1088-byte ML-KEM ciphertext plus the payment's amount/chain,
 * so the page never has to sweep millions of blocks itself. Reads are public
 * (no API key) and the user's keys never leave the browser — decapsulation and
 * key derivation still happen client-side via WASM. Defaults to the same
 * `localhost:3001` as the rest of the app (`src/lib/api.ts`); staging/prod set
 * `VITE_API_BASE_URL`. If it is unset/unreachable, recovery falls back to the
 * fully-trustless direct-RPC sweep.
 */
export const SPECTER_API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  "http://localhost:3001";
