/**
 * Turso (libSQL) write client for the SPECTER registry.
 *
 * Envio event handlers call writeTursoAnnouncement() to keep the SPECTER
 * Turso registry in sync with on-chain Announcement events. This is the
 * "on-chain → Turso" leg of the dual-write architecture.
 *
 * Key design decisions:
 * - INSERT OR IGNORE: idempotent; re-indexing the same event is safe
 * - on_chain = 1: always set for this path (distinguishes from API submissions)
 * - Exponential backoff retry: Turso HTTP errors are transient; we retry 3×
 * - Graceful degradation: if TURSO_DATABASE_URL is not set, skip silently
 * - Never throw after max retries: log the error, let Envio continue indexing
 */

import { createClient } from "@libsql/client";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TursoAnnouncement {
  /** View tag byte (0–255). */
  viewTag: number;
  /** Unix timestamp of the Monad block. */
  timestamp: number;
  /** ML-KEM ephemeral ciphertext (hex, no 0x prefix). Must be 1088 bytes. */
  ephemeralKey: string;
  /** Source chain ID (EIP-155), or null if not embedded in metadata. */
  sourceChainId: number | null;
  /** Monad block number. */
  blockNumber: number;
  /** Source-chain tx hash (from metadata), or null. */
  txHash: string | null;
  /** Raw amount hex string, or null. */
  amount: string | null;
  /** Human-readable chain name, e.g. "monad-testnet". */
  chain: string;
  /** Recipient stealth address (checksummed). */
  stealthAddress: string;
  /** Log index within the Monad block (used as block_tx_index for dedup). */
  blockTxIndex: number;
  /** Monad transaction hash (the announcement tx, not the source-chain tx). */
  transactionHash: string;
}

// ── Client factory ─────────────────────────────────────────────────────────

let _client: ReturnType<typeof createClient> | null = null;

function getClient(): ReturnType<typeof createClient> | null {
  if (_client) return _client;

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) {
    // Log once; subsequent calls will skip silently
    console.warn(
      "[specter-envio/turso] TURSO_DATABASE_URL or TURSO_AUTH_TOKEN not set — " +
        "skipping Turso sync. Set these env vars to enable dual-write."
    );
    return null;
  }

  _client = createClient({ url, authToken: token });
  return _client;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Writes a single announcement to Turso with retry.
 *
 * Uses INSERT OR IGNORE so duplicate tx_hashes (e.g., from Envio replays)
 * are silently skipped. The on_chain column is always set to 1 here because
 * this function is only called from the chain indexer path.
 *
 * @returns true if the write succeeded, false if Turso is unconfigured or all retries failed.
 */
export async function writeTursoAnnouncement(
  ann: TursoAnnouncement,
  maxRetries = 3
): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  const sql = `
    INSERT OR IGNORE INTO announcements
      (view_tag, timestamp, ephemeral_key, source_chain_id, on_chain,
       block_number, tx_hash, amount, chain, stealth_address, block_tx_index)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
  `;

  // ephemeral_key is stored as BLOB — convert hex string to Buffer
  const ephemeralKeyBuffer = Buffer.from(ann.ephemeralKey, "hex");

  const args = [
    ann.viewTag,
    ann.timestamp,
    ephemeralKeyBuffer,
    ann.sourceChainId ?? null,
    ann.blockNumber,
    ann.txHash ?? null,
    ann.amount ?? null,
    ann.chain,
    ann.stealthAddress,
    ann.blockTxIndex,
  ];

  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await client.execute({ sql, args });
      return true;
    } catch (err) {
      lastError = err;

      const msg = err instanceof Error ? err.message : String(err);

      // UNIQUE constraint on tx_hash already handled by INSERT OR IGNORE,
      // but in case the driver surfaces it differently, treat it as success
      if (msg.includes("UNIQUE constraint") || msg.includes("duplicate")) {
        return true;
      }

      // Don't retry non-transient errors (schema mismatch, auth failure, etc.)
      if (isNonRetryable(msg)) {
        console.error(
          `[specter-envio/turso] Non-retryable error for tx ${ann.transactionHash}: ${msg}`
        );
        return false;
      }

      if (attempt < maxRetries - 1) {
        // Exponential backoff: 100ms, 200ms, 400ms
        await sleep(100 * Math.pow(2, attempt));
      }
    }
  }

  console.error(
    `[specter-envio/turso] All ${maxRetries} retries failed for tx ${ann.transactionHash} ` +
      `(block ${ann.blockNumber}, logIndex ${ann.blockTxIndex}): ${lastError}`
  );
  return false;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true for errors that should NOT be retried (e.g., auth failure,
 * schema mismatch). Transient network/timeout errors should be retried.
 */
function isNonRetryable(errorMessage: string): boolean {
  const nonRetryablePatterns = [
    "UNAUTHORIZED",
    "forbidden",
    "no such table",
    "no such column",
    "syntax error",
  ];
  const lower = errorMessage.toLowerCase();
  return nonRetryablePatterns.some((p) => lower.includes(p.toLowerCase()));
}
