/**
 * SPECTER Event Poller
 *
 * Polls Monad for SPECTERAnnouncer `Announcement` events via eth_getLogs,
 * recovers the full ML-KEM ciphertext from the announce() calldata, verifies it
 * against the event's keccak256 hash, and writes each verified event to Turso.
 * Persists a block checkpoint so restarts never re-process old blocks.
 */

import {
  createPublicClient,
  http,
  parseAbiItem,
  decodeEventLog,
  decodeFunctionData,
  keccak256,
  type Hex,
  type Address,
} from "viem";
import { createClient, type Client as TursoClient } from "@libsql/client";
import * as fs from "fs";
import * as path from "path";

// ── Config ─────────────────────────────────────────────────────────────────────

function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadDotEnv();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val || val.trim() === "") {
    throw new Error(
      `[event-poller] Missing required environment variable: ${key}\n` +
      `  → Add it to .env or set it in your Railway service variables.`
    );
  }
  return val.trim();
}

function optionalEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed <= 0) {
    console.warn(`[event-poller] ${key}="${raw}" is not a valid positive integer — using default ${fallback}`);
    return fallback;
  }
  return parsed;
}

const MONAD_RPC_URL        = requireEnv("MONAD_RPC_URL");
const ANNOUNCER_ADDRESS    = requireEnv("SPECTER_ANNOUNCER_ADDRESS") as Address;
const TURSO_URL            = requireEnv("TURSO_DATABASE_URL");
const TURSO_AUTH_TOKEN     = requireEnv("TURSO_AUTH_TOKEN");
const DEPLOY_BLOCK_RAW     = requireEnv("SPECTER_ANNOUNCER_DEPLOY_BLOCK");

// Validate contract address format
if (!/^0x[0-9a-fA-F]{40}$/.test(ANNOUNCER_ADDRESS)) {
  throw new Error(`[event-poller] SPECTER_ANNOUNCER_ADDRESS is not a valid EVM address: ${ANNOUNCER_ADDRESS}`);
}

// Validate deploy block
const DEPLOY_BLOCK_NUM = parseInt(DEPLOY_BLOCK_RAW, 10);
if (isNaN(DEPLOY_BLOCK_NUM) || DEPLOY_BLOCK_NUM < 0) {
  throw new Error(`[event-poller] SPECTER_ANNOUNCER_DEPLOY_BLOCK must be a non-negative integer, got: ${DEPLOY_BLOCK_RAW}`);
}
const DEPLOY_BLOCK = BigInt(DEPLOY_BLOCK_NUM);

const POLL_INTERVAL_MS   = optionalEnvInt("POLL_INTERVAL_MS", 10_000);
const CONFIRMATION_DEPTH = BigInt(optionalEnvInt("CONFIRMATION_DEPTH", 2));
const MAX_BLOCKS_PER_POLL = BigInt(optionalEnvInt("MAX_BLOCKS_PER_POLL", 500));
const MAX_BACKOFF_MS     = 60_000;
const DB_CONNECT_TIMEOUT_MS = 10_000;

// ── ABI ────────────────────────────────────────────────────────────────────────

const ANNOUNCEMENT_EVENT = parseAbiItem(
  "event Announcement(uint256 schemeId, address indexed stealthAddress, address indexed caller, bytes32 ephemeralKeyHash, bytes metadata)"
);

// ── announce() calldata decode ───────────────────────────────────────────────────
// The Announcement event carries only keccak256(ciphertext); the full 1088-byte
// ML-KEM ciphertext lives in the announce() calldata. Support both the 3-arg and
// the schemeId-prefixed 4-arg announce() signatures.

const ANNOUNCE_ABI = [
  {
    type: "function", name: "announce", stateMutability: "nonpayable",
    inputs: [
      { name: "stealthAddress", type: "address" },
      { name: "ephemeralPubKey", type: "bytes" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "announce", stateMutability: "nonpayable",
    inputs: [
      { name: "schemeId", type: "uint256" },
      { name: "stealthAddress", type: "address" },
      { name: "ephemeralPubKey", type: "bytes" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/** Recover the ML-KEM ciphertext (Hex, 0x-prefixed) from announce() calldata. */
function decodeEphemeralKey(input: Hex): Hex {
  const decoded = decodeFunctionData({ abi: ANNOUNCE_ABI, data: input });
  const args = decoded.args as readonly unknown[];
  return (args.length === 3 ? args[1] : args[2]) as Hex; // ephemeralPubKey position
}

/** Extract the plaintext view_tag (byte 0) from the metadata blob. */
function extractViewTag(metadata: Hex): number {
  const hex = metadata.startsWith("0x") ? metadata.slice(2) : metadata;
  if (hex.length < 2) throw new Error("metadata too short: missing view_tag");
  return parseInt(hex.slice(0, 2), 16);
}

// ── RPC client ─────────────────────────────────────────────────────────────────

const viemClient = createPublicClient({
  transport: http(MONAD_RPC_URL, {
    timeout: 30_000,
    retryCount: 3,
    retryDelay: 2_000,
  }),
});

// ── Turso client ───────────────────────────────────────────────────────────────

let turso: TursoClient;

async function initTurso(): Promise<void> {
  turso = createClient({ url: TURSO_URL, authToken: TURSO_AUTH_TOKEN });

  // Verify connectivity with a timeout
  const connectPromise = turso.execute({ sql: "SELECT 1", args: [] });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Turso connection timed out")), DB_CONNECT_TIMEOUT_MS)
  );
  await Promise.race([connectPromise, timeoutPromise]);
  console.log("[event-poller] Turso connection verified");
}

// ── Checkpoint helpers ─────────────────────────────────────────────────────────

async function getCheckpoint(): Promise<bigint> {
  try {
    const rs = await turso.execute({
      sql: "SELECT value FROM registry_metadata WHERE key = 'poller_last_block' LIMIT 1",
      args: [],
    });
    if (rs.rows.length === 0) return DEPLOY_BLOCK > 0n ? DEPLOY_BLOCK - 1n : 0n;
    const raw = rs.rows[0]!["value"] as string | null;
    if (!raw) return DEPLOY_BLOCK > 0n ? DEPLOY_BLOCK - 1n : 0n;
    const parsed = BigInt(raw);
    // Sanity check: never go before deploy block
    return parsed < DEPLOY_BLOCK - 1n ? DEPLOY_BLOCK - 1n : parsed;
  } catch (e) {
    console.error("[event-poller] Failed to read checkpoint — starting from deploy block:", e);
    return DEPLOY_BLOCK > 0n ? DEPLOY_BLOCK - 1n : 0n;
  }
}

async function saveCheckpoint(block: bigint): Promise<void> {
  await turso.execute({
    sql: `INSERT INTO registry_metadata (key, value) VALUES ('poller_last_block', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [block.toString()],
  });
}

// ── Announcement writer ────────────────────────────────────────────────────────

interface AnnouncementRow {
  ephemeralKey: string;       // full ciphertext hex, no 0x prefix
  ephemeralKeyHash: string;   // hex, no 0x prefix
  metadataBlob: string;       // hex, no 0x prefix
  viewTag: number;
  stealthAddress: string;
  txHash: string;
  blockNumber: bigint;
  chain: string;
}

async function insertAnnouncement(row: AnnouncementRow): Promise<void> {
  // Validate ephemeral key length (must be 1088 bytes = 2176 hex chars).
  // This is the full ML-KEM ciphertext recovered from announce() calldata.
  if (row.ephemeralKey.length !== 2176) {
    throw new Error(
      `ephemeral ciphertext must be 1088 bytes (${2176} hex chars), got ${row.ephemeralKey.length / 2} bytes`
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  // ephemeral_key, ephemeral_key_hash, metadata_blob are BLOB columns — store as
  // Buffers (matching the Envio indexer's canonical write).
  await turso.execute({
    sql: `INSERT OR IGNORE INTO announcements
            (ephemeral_key, ephemeral_key_hash, metadata_blob, view_tag, timestamp,
             tx_hash, block_number, chain, stealth_address, on_chain, record_source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'indexer')`,
    args: [
      Buffer.from(row.ephemeralKey, "hex"),
      Buffer.from(row.ephemeralKeyHash, "hex"),
      Buffer.from(row.metadataBlob, "hex"),
      row.viewTag,
      nowSec,
      row.txHash,
      row.blockNumber.toString(),
      row.chain,
      row.stealthAddress,
    ],
  });
}

// ── Event log processor ────────────────────────────────────────────────────────

interface ProcessedLog {
  txHash: string;
  blockNumber: bigint;
  stealthAddress: Address;
  ephemeralKey: string;       // full 1088-byte ciphertext hex, no 0x
  ephemeralKeyHash: string;   // 32-byte hash hex, no 0x
  metadataBlob: string;       // raw encrypted metadata hex, no 0x
  viewTag: number;
}

async function processLog(log: {
  data: Hex;
  topics: readonly [Hex, ...Hex[]];
  transactionHash: Hex | null;
  blockNumber: bigint | null;
  logIndex: number | null;
}): Promise<ProcessedLog | null> {
  if (!log.transactionHash) throw new Error("Log is missing transactionHash (pending log?)");
  if (log.blockNumber === null) throw new Error("Log is missing blockNumber");

  const decoded = decodeEventLog({
    abi: [ANNOUNCEMENT_EVENT],
    data: log.data,
    // viem getLogs returns readonly topics; decodeEventLog needs mutable — spread to copy
    topics: [...log.topics] as [Hex, ...Hex[]],
    strict: true,
  });

  const args = decoded.args as {
    schemeId: bigint;
    stealthAddress: Address;
    caller: Address;
    ephemeralKeyHash: Hex;
    metadata: Hex;
  };

  if (!args.stealthAddress || !/^0x[0-9a-fA-F]{40}$/.test(args.stealthAddress)) {
    throw new Error(`Invalid stealthAddress in log: ${args.stealthAddress}`);
  }

  const viewTag = extractViewTag(args.metadata);

  // Recover the ciphertext from calldata and verify keccak256 against the event hash.
  const tx = await viemClient.getTransaction({ hash: log.transactionHash });
  let ek: Hex;
  try {
    ek = decodeEphemeralKey(tx.input);
  } catch (e) {
    console.warn(`[event-poller] tx ${log.transactionHash}: announce calldata decode failed (${e}); skipping`);
    return null;
  }
  if (keccak256(ek).toLowerCase() !== args.ephemeralKeyHash.toLowerCase()) {
    console.warn(`[event-poller] tx ${log.transactionHash}: ciphertext keccak256 != ephemeralKeyHash; skipping`);
    return null;
  }

  return {
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    stealthAddress: args.stealthAddress,
    ephemeralKey: ek.slice(2),
    ephemeralKeyHash: args.ephemeralKeyHash.slice(2),
    metadataBlob: args.metadata.startsWith("0x") ? args.metadata.slice(2) : args.metadata,
    viewTag,
  };
}

// ── Polling loop ───────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  // Get chain head
  let head: bigint;
  try {
    head = await viemClient.getBlockNumber();
  } catch (e) {
    throw new Error(`eth_blockNumber failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (head < CONFIRMATION_DEPTH) return; // Chain not yet deep enough
  const safeHead = head - CONFIRMATION_DEPTH;

  const fromBlock = (await getCheckpoint()) + 1n;
  if (fromBlock > safeHead) return; // Nothing new to process

  // Clamp range to avoid oversized getLogs requests
  const toBlock = fromBlock + MAX_BLOCKS_PER_POLL - 1n < safeHead
    ? fromBlock + MAX_BLOCKS_PER_POLL - 1n
    : safeHead;

  let logs: Awaited<ReturnType<typeof viemClient.getLogs>>;
  try {
    logs = await viemClient.getLogs({
      address: ANNOUNCER_ADDRESS,
      event: ANNOUNCEMENT_EVENT,
      fromBlock,
      toBlock,
    });
  } catch (e) {
    throw new Error(
      `eth_getLogs(${fromBlock}–${toBlock}) failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  let written = 0;
  let skipped = 0;

  for (const log of logs) {
    let processed: ProcessedLog | null;
    try {
      processed = await processLog(log as Parameters<typeof processLog>[0]);
    } catch (e) {
      console.warn(
        `[event-poller] Skipping malformed log (tx=${log.transactionHash ?? "unknown"} block=${log.blockNumber ?? "unknown"}): ${e instanceof Error ? e.message : String(e)}`
      );
      skipped++;
      continue;
    }

    // Null = ciphertext could not be recovered/verified from calldata → never store unverified.
    if (!processed) {
      skipped++;
      continue;
    }

    try {
      await insertAnnouncement({
        ephemeralKey: processed.ephemeralKey,
        ephemeralKeyHash: processed.ephemeralKeyHash,
        metadataBlob: processed.metadataBlob,
        viewTag: processed.viewTag,
        stealthAddress: processed.stealthAddress,
        txHash: processed.txHash,
        blockNumber: processed.blockNumber,
        chain: "monad-testnet",
      });
      written++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // UNIQUE constraint = already indexed by API side → not an error
      if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("already exists")) {
        skipped++;
      } else {
        console.error(
          `[event-poller] DB write failed for tx=${processed.txHash}: ${msg}`
        );
        skipped++;
      }
    }
  }

  // Always advance checkpoint, even if some logs were skipped.
  // Re-processing malformed logs won't produce different results.
  try {
    await saveCheckpoint(toBlock);
  } catch (e) {
    // Non-fatal: worst case we re-process this range next restart
    console.error(`[event-poller] Failed to save checkpoint at block ${toBlock}:`, e);
  }

  if (logs.length > 0 || written > 0) {
    console.log(
      `[event-poller] blocks ${fromBlock}–${toBlock} (head=${head}): ` +
      `${logs.length} events → ${written} written, ${skipped} skipped/deduped`
    );
  }
}

// ── Main loop with exponential back-off ────────────────────────────────────────

async function run(): Promise<never> {
  console.log(
    `[event-poller] Starting\n` +
    `  contract : ${ANNOUNCER_ADDRESS}\n` +
    `  rpc      : ${MONAD_RPC_URL}\n` +
    `  turso    : ${TURSO_URL.replace(/\/\/.*@/, "//<credentials>@")}\n` +
    `  deploy   : block ${DEPLOY_BLOCK}\n` +
    `  interval : ${POLL_INTERVAL_MS}ms, depth=${CONFIRMATION_DEPTH}, max=${MAX_BLOCKS_PER_POLL} blocks/poll`
  );

  // Establish DB connection (fail fast if creds are wrong)
  await initTurso();

  let consecutiveErrors = 0;
  let backoffMs = 0;

  while (true) {
    if (backoffMs > 0) {
      await sleep(backoffMs);
    }

    try {
      await poll();
      consecutiveErrors = 0;
      backoffMs = 0;
    } catch (e) {
      consecutiveErrors++;
      const msg = e instanceof Error ? e.message : String(e);
      const nextBackoff = Math.min(
        backoffMs === 0 ? POLL_INTERVAL_MS * 2 : backoffMs * 2,
        MAX_BACKOFF_MS
      );
      console.error(
        `[event-poller] Poll error #${consecutiveErrors} (retry in ${nextBackoff / 1000}s): ${msg}`
      );
      backoffMs = nextBackoff;

      // Re-verify DB connectivity after several consecutive failures
      if (consecutiveErrors % 5 === 0) {
        try {
          await initTurso();
          console.log("[event-poller] Turso reconnected");
        } catch (dbErr) {
          console.error("[event-poller] Turso reconnect failed:", dbErr);
        }
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`[event-poller] ${signal} received — shutting down gracefully`);
  try { turso?.close(); } catch (_) {}
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("[event-poller] Uncaught exception — process will exit:", err);
  try { turso?.close(); } catch (_) {}
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[event-poller] Unhandled promise rejection:", reason);
  // Do not exit — let the retry loop recover
});

// ── Entry point ────────────────────────────────────────────────────────────────

run().catch((err) => {
  console.error("[event-poller] Fatal startup error:", err);
  process.exit(1);
});
