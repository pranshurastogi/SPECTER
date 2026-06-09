/**
 * SPECTER Event Poller
 *
 * Polls Monad for SPECTERAnnouncer `Announcement` events via eth_getLogs,
 * decodes the 77-byte metadata, and writes each event to Turso.
 * Persists a block checkpoint so restarts never re-process old blocks.
 */

import {
  createPublicClient,
  http,
  parseAbiItem,
  decodeEventLog,
  isHex,
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
  "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)"
);

// ── Metadata layout (77 bytes) ─────────────────────────────────────────────────
// [0]       view_tag         (u8)
// [1..33]   payment_tx_hash  (32 bytes, big-endian, zero = absent)
// [33..65]  amount           (uint256 big-endian, zero = absent)
// [65..73]  source_chain_id  (u64 big-endian, zero = absent)
// [73..77]  reserved

interface DecodedMetadata {
  viewTag: number;
  paymentTxHash: string | null;
  amount: string | null;
  sourceChainId: bigint | null;
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) {
    throw new Error(`Invalid hex string length (${s.length}) — must be even`);
  }
  const buf = new Uint8Array(s.length / 2);
  for (let i = 0; i < buf.length; i++) {
    const byte = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    if (isNaN(byte)) throw new Error(`Invalid hex byte at position ${i * 2}: "${s.slice(i * 2, i * 2 + 2)}"`);
    buf[i] = byte;
  }
  return buf;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

function decodeMetadata(meta: Hex): DecodedMetadata {
  let buf: Uint8Array;
  try {
    buf = hexToBytes(meta);
  } catch (e) {
    console.warn(`[event-poller] Failed to hex-decode metadata: ${e}`);
    return { viewTag: 0, paymentTxHash: null, amount: null, sourceChainId: null };
  }

  if (buf.length === 0) {
    return { viewTag: 0, paymentTxHash: null, amount: null, sourceChainId: null };
  }

  const viewTag = buf[0]!;

  // Metadata may be shorter than 77 bytes if fields were omitted by caller
  let paymentTxHash: string | null = null;
  if (buf.length >= 33) {
    const txBytes = buf.slice(1, 33);
    if (!txBytes.every((b) => b === 0)) {
      paymentTxHash = "0x" + Buffer.from(txBytes).toString("hex");
    }
  }

  let amount: string | null = null;
  if (buf.length >= 65) {
    const amountBig = bytesToBigInt(buf.slice(33, 65));
    if (amountBig !== 0n) amount = amountBig.toString();
  }

  let sourceChainId: bigint | null = null;
  if (buf.length >= 73) {
    const chainBig = bytesToBigInt(buf.slice(65, 73));
    if (chainBig !== 0n) sourceChainId = chainBig;
  }

  return { viewTag, paymentTxHash, amount, sourceChainId };
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
  ephemeralKey: string;  // hex, no 0x prefix
  viewTag: number;
  stealthAddress: string;
  txHash: string;
  blockNumber: bigint;
  paymentTxHash: string | null;
  amount: string | null;
  chain: string;
  sourceChainId: bigint | null;
}

async function insertAnnouncement(row: AnnouncementRow): Promise<void> {
  // Validate ephemeral key length (must be 1088 bytes = 2176 hex chars)
  if (row.ephemeralKey.length !== 2176) {
    throw new Error(
      `ephemeralPubKey must be 1088 bytes (${2176} hex chars), got ${row.ephemeralKey.length / 2} bytes`
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  await turso.execute({
    sql: `INSERT OR IGNORE INTO announcements
            (ephemeral_key, view_tag, timestamp, tx_hash, block_number,
             payment_tx_hash, amount, chain, source_chain_id, stealth_address, record_source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'indexer')`,
    args: [
      row.ephemeralKey,
      row.viewTag,
      nowSec,
      row.txHash,
      row.blockNumber.toString(),
      row.paymentTxHash,
      row.amount,
      row.chain,
      row.sourceChainId !== null ? row.sourceChainId.toString() : null,
      row.stealthAddress,
    ],
  });
}

// ── Event log processor ────────────────────────────────────────────────────────

interface ProcessedLog {
  txHash: string;
  blockNumber: bigint;
  stealthAddress: Address;
  ephemeralKey: string;
  metadata: DecodedMetadata;
}

function processLog(log: {
  data: Hex;
  topics: readonly [Hex, ...Hex[]];
  transactionHash: Hex | null;
  blockNumber: bigint | null;
  logIndex: number | null;
}): ProcessedLog {
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
    ephemeralPubKey: Hex;
    metadata: Hex;
  };

  if (!args.stealthAddress || !/^0x[0-9a-fA-F]{40}$/.test(args.stealthAddress)) {
    throw new Error(`Invalid stealthAddress in log: ${args.stealthAddress}`);
  }

  if (!isHex(args.ephemeralPubKey) || args.ephemeralPubKey.length < 4) {
    throw new Error("ephemeralPubKey is not valid hex");
  }

  // Strip 0x prefix for DB storage
  const ephemeralKey = args.ephemeralPubKey.slice(2);

  const metadata = decodeMetadata(args.metadata);

  return {
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    stealthAddress: args.stealthAddress,
    ephemeralKey,
    metadata,
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
    let processed: ProcessedLog;
    try {
      processed = processLog(log as Parameters<typeof processLog>[0]);
    } catch (e) {
      console.warn(
        `[event-poller] Skipping malformed log (tx=${log.transactionHash ?? "unknown"} block=${log.blockNumber ?? "unknown"}): ${e instanceof Error ? e.message : String(e)}`
      );
      skipped++;
      continue;
    }

    try {
      await insertAnnouncement({
        ephemeralKey: processed.ephemeralKey,
        viewTag: processed.metadata.viewTag,
        stealthAddress: processed.stealthAddress,
        txHash: processed.txHash,
        blockNumber: processed.blockNumber,
        paymentTxHash: processed.metadata.paymentTxHash,
        amount: processed.metadata.amount,
        chain: "monad-testnet",
        sourceChainId: processed.metadata.sourceChainId,
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
