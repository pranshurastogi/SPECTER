/**
 * SPECTER Event Poller
 *
 * Polls the Monad chain for SPECTERAnnouncer `Announcement` events using
 * eth_getLogs, decodes the 77-byte metadata, and writes each discovered
 * announcement to Turso.  Stores a checkpoint in `registry_metadata` so
 * restarts never re-process old blocks.
 *
 * Architecture:
 *   - Single Node.js process (no Docker, no Hasura, no Postgres)
 *   - Viem for typed ABI decoding + RPC calls
 *   - @libsql/client for Turso writes
 *   - POLL_INTERVAL_MS (default 10 000 ms) polling loop
 *   - CONFIRMATION_DEPTH (default 2) blocks behind head before writing
 *   - Exponential back-off on RPC/DB errors (up to MAX_BACKOFF_MS)
 */

import { createPublicClient, http, parseAbiItem, decodeEventLog, type Hex, type Address } from "viem";
import { createClient, type Client as TursoClient } from "@libsql/client";

// ── Config ─────────────────────────────────────────────────────────────────────

const MONAD_RPC_URL = requireEnv("MONAD_RPC_URL");
const ANNOUNCER_ADDRESS = requireEnv("SPECTER_ANNOUNCER_ADDRESS") as Address;
const TURSO_URL = requireEnv("TURSO_DATABASE_URL");
const TURSO_AUTH_TOKEN = requireEnv("TURSO_AUTH_TOKEN");
const DEPLOY_BLOCK = BigInt(requireEnv("SPECTER_ANNOUNCER_DEPLOY_BLOCK"));

const POLL_INTERVAL_MS = parseInt(process.env["POLL_INTERVAL_MS"] ?? "10000", 10);
const CONFIRMATION_DEPTH = BigInt(process.env["CONFIRMATION_DEPTH"] ?? "2");
const MAX_BLOCKS_PER_POLL = BigInt(process.env["MAX_BLOCKS_PER_POLL"] ?? "500");
const MAX_BACKOFF_MS = 60_000;

// ── ABI ────────────────────────────────────────────────────────────────────────

const ANNOUNCEMENT_EVENT = parseAbiItem(
  "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)"
);

// ── Metadata layout (77 bytes) ─────────────────────────────────────────────────
// [0]        view_tag  (u8)
// [1..33]    payment_tx_hash (big-endian, 32 bytes)
// [33..65]   amount (big-endian uint256, 32 bytes)
// [65..73]   source_chain_id (big-endian u64, 8 bytes)
// [73..77]   reserved

interface DecodedMetadata {
  viewTag: number;
  paymentTxHash: string | null;
  amount: string | null;
  sourceChainId: bigint | null;
}

function decodeMetadata(meta: Hex): DecodedMetadata {
  const buf = hexToBytes(meta);
  if (buf.length < 77) {
    return { viewTag: buf[0] ?? 0, paymentTxHash: null, amount: null, sourceChainId: null };
  }

  const viewTag = buf[0]!;

  const txBytes = buf.slice(1, 33);
  const paymentTxHash = txBytes.every((b) => b === 0)
    ? null
    : "0x" + Buffer.from(txBytes).toString("hex");

  const amountBytes = buf.slice(33, 65);
  const amountBig = bytesToBigInt(amountBytes);
  const amount = amountBig === 0n ? null : amountBig.toString();

  const chainBytes = buf.slice(65, 73);
  const sourceChainId = bytesToBigInt(chainBytes);

  return {
    viewTag,
    paymentTxHash,
    amount,
    sourceChainId: sourceChainId === 0n ? null : sourceChainId,
  };
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

const turso: TursoClient = createClient({
  url: TURSO_URL,
  authToken: TURSO_AUTH_TOKEN,
});

// ── Checkpoint helpers ─────────────────────────────────────────────────────────

async function getCheckpoint(): Promise<bigint> {
  const rs = await turso.execute({
    sql: "SELECT value FROM registry_metadata WHERE key = 'poller_last_block' LIMIT 1",
    args: [],
  });
  if (rs.rows.length === 0) return DEPLOY_BLOCK - 1n;
  const raw = rs.rows[0]!["value"] as string | null;
  if (!raw) return DEPLOY_BLOCK - 1n;
  return BigInt(raw);
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
  ephemeralKey: string;
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

// ── Polling loop ───────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  const head = await viemClient.getBlockNumber();
  const safeHead = head - CONFIRMATION_DEPTH;
  const fromBlock = (await getCheckpoint()) + 1n;

  if (fromBlock > safeHead) {
    return; // Nothing to process yet
  }

  const toBlock = fromBlock + MAX_BLOCKS_PER_POLL - 1n < safeHead
    ? fromBlock + MAX_BLOCKS_PER_POLL - 1n
    : safeHead;

  const logs = await viemClient.getLogs({
    address: ANNOUNCER_ADDRESS,
    event: ANNOUNCEMENT_EVENT,
    fromBlock,
    toBlock,
  });

  let written = 0;
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: [ANNOUNCEMENT_EVENT],
        data: log.data,
        topics: log.topics,
      });

      const args = decoded.args as {
        schemeId: bigint;
        stealthAddress: Address;
        caller: Address;
        ephemeralPubKey: Hex;
        metadata: Hex;
      };

      const meta = decodeMetadata(args.metadata);
      const txHash = log.transactionHash ?? "0x";
      const blockNumber = log.blockNumber ?? toBlock;

      const ek = args.ephemeralPubKey.startsWith("0x")
        ? args.ephemeralPubKey.slice(2)
        : args.ephemeralPubKey;

      await insertAnnouncement({
        ephemeralKey: ek,
        viewTag: meta.viewTag,
        stealthAddress: args.stealthAddress,
        txHash,
        blockNumber,
        paymentTxHash: meta.paymentTxHash,
        amount: meta.amount,
        chain: "monad-testnet",
        sourceChainId: meta.sourceChainId,
      });
      written++;
    } catch (err) {
      console.error(`[event-poller] Failed to write log ${log.transactionHash}:`, err);
    }
  }

  await saveCheckpoint(toBlock);

  if (logs.length > 0) {
    console.log(
      `[event-poller] blocks ${fromBlock}–${toBlock}: ${logs.length} events, ${written} written`
    );
  }
}

// ── Main loop with exponential back-off ────────────────────────────────────────

async function run(): Promise<never> {
  console.log(
    `[event-poller] Starting — contract=${ANNOUNCER_ADDRESS} deployBlock=${DEPLOY_BLOCK} interval=${POLL_INTERVAL_MS}ms`
  );

  let backoff = 0;

  while (true) {
    if (backoff > 0) {
      await sleep(backoff);
    }

    try {
      await poll();
      backoff = 0; // Reset on success
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[event-poller] Poll error (retrying in ${(backoff || POLL_INTERVAL_MS) / 1000}s):`, msg);
      backoff = Math.min(
        backoff === 0 ? POLL_INTERVAL_MS * 2 : backoff * 2,
        MAX_BACKOFF_MS
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function hexToBytes(hex: Hex): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  const buf = new Uint8Array(Math.ceil(s.length / 2));
  for (let i = 0; i < buf.length; i++) {
    buf[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return buf;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  return n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Entry point ────────────────────────────────────────────────────────────────

process.on("SIGTERM", () => {
  console.log("[event-poller] SIGTERM received, shutting down");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[event-poller] SIGINT received, shutting down");
  process.exit(0);
});

run().catch((err) => {
  console.error("[event-poller] Fatal error:", err);
  process.exit(1);
});
