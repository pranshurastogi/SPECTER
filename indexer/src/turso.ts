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
 * - Returns TursoWriteResult so callers can distinguish transient vs permanent failures
 */

import { createClient } from "@libsql/client";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TursoAnnouncement {
  /** View tag byte (0–255). */
  viewTag: number;
  /** Unix timestamp of the Monad block. */
  timestamp: number;
  /** Full ML-KEM ephemeral ciphertext (hex, no 0x prefix). Must be 1088 bytes. */
  ephemeralKey: string;
  /** keccak256 of the ciphertext (hex, no 0x prefix — 32 bytes), from the event. */
  ephemeralKeyHash: string;
  /** Raw encrypted metadata blob (hex, no 0x prefix). Only byte 0 is plaintext. */
  metadataBlob: string;
  /** Monad block number. */
  blockNumber: number;
  /**
   * Monad announce tx hash — the tx that called SPECTERAnnouncer.announce().
   * Used as the dedup key in Turso (always unique, never null for on-chain events).
   * This is event.transaction.hash in the Envio handler.
   */
  txHash: string;
  /** Human-readable chain name, e.g. "monad-testnet". */
  chain: string;
  /** Recipient stealth address (lowercase). */
  stealthAddress: string;
  /** Log index within the Monad block (used as block_tx_index). */
  blockTxIndex: number;
}

/**
 * Result of a Turso write attempt.
 *
 * ok=true  — write succeeded (or was a harmless duplicate).
 * ok=false, permanent=true  — non-retryable error (auth, schema mismatch).
 *   The caller should NOT retry without operator intervention.
 * ok=false, permanent=false — transient error; all retries exhausted.
 *   The caller may retry later.
 */
export type TursoWriteResult =
  | { ok: true }
  | { ok: false; permanent: boolean; error: string };

// ── Client factory ─────────────────────────────────────────────────────────

let _client: ReturnType<typeof createClient> | null = null;
let _clientWarned = false;

function getClient(): ReturnType<typeof createClient> | null {
  if (_client) return _client;

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) {
    if (!_clientWarned) {
      _clientWarned = true;
      console.warn(
        "[specter-envio/turso] TURSO_DATABASE_URL or TURSO_AUTH_TOKEN not set — " +
          "skipping Turso sync. Set these env vars to enable dual-write."
      );
    }
    return null;
  }

  _client = createClient({ url, authToken: token });
  return _client;
}

/**
 * Verifies Turso connectivity by issuing a lightweight SELECT 1.
 * Returns true if the connection is healthy, false otherwise.
 * Used by the retry worker to probe before opening a full batch.
 */
export async function probeTursoConnection(): Promise<boolean> {
  const client = getClient();
  if (!client) return false;
  try {
    await client.execute("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Writes a single announcement to Turso with retry.
 *
 * Uses INSERT OR IGNORE so duplicate tx_hashes (e.g., from Envio replays)
 * are silently skipped. The on_chain column is always set to 1 here because
 * this function is only called from the chain indexer path.
 *
 * @returns TursoWriteResult — ok=true on success, ok=false with permanent flag
 *          so callers can distinguish auth/schema failures from transient errors.
 */
export async function writeTursoAnnouncement(
  ann: TursoAnnouncement,
  maxRetries = 3
): Promise<TursoWriteResult> {
  const client = getClient();
  if (!client) {
    return { ok: false, permanent: false, error: "Turso not configured" };
  }

  const sql = `
    INSERT OR IGNORE INTO announcements
      (view_tag, timestamp, ephemeral_key, ephemeral_key_hash, metadata_blob, on_chain,
       block_number, tx_hash, chain, stealth_address, block_tx_index)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  `;

  // ephemeral_key, ephemeral_key_hash, metadata_blob are stored as BLOB —
  // convert hex strings to Buffers.
  const ephemeralKeyBuffer = Buffer.from(ann.ephemeralKey, "hex");
  const ephemeralKeyHashBuffer = Buffer.from(ann.ephemeralKeyHash, "hex");
  const metadataBlobBuffer = Buffer.from(ann.metadataBlob, "hex");

  const args = [
    ann.viewTag,
    ann.timestamp,
    ephemeralKeyBuffer,
    ephemeralKeyHashBuffer,
    metadataBlobBuffer,
    ann.blockNumber,
    ann.txHash,                  // Monad announce tx hash — dedup key, always present
    ann.chain,
    ann.stealthAddress,
    ann.blockTxIndex,
  ];

  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await client.execute({ sql, args });
      return { ok: true };
    } catch (err) {
      lastError = err;

      const msg = err instanceof Error ? err.message : String(err);

      // UNIQUE constraint on tx_hash is handled by INSERT OR IGNORE at the SQL
      // level. If the driver still surfaces it, treat as success.
      if (msg.includes("UNIQUE constraint") || msg.includes("duplicate")) {
        return { ok: true };
      }

      // Non-retryable errors: auth failure, schema mismatch, syntax error.
      // These require operator intervention — stop retrying immediately.
      if (isNonRetryable(msg)) {
        console.error(
          `[specter-envio/turso] Non-retryable error for tx ${ann.txHash} ` +
            `(block ${ann.blockNumber}, logIndex ${ann.blockTxIndex}): ${msg}`
        );
        return { ok: false, permanent: true, error: msg };
      }

      if (attempt < maxRetries - 1) {
        // Exponential backoff: 100ms, 200ms, 400ms
        await sleep(100 * Math.pow(2, attempt));
      }
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  console.error(
    `[specter-envio/turso] All ${maxRetries} retries failed for tx ${ann.txHash} ` +
      `(block ${ann.blockNumber}, logIndex ${ann.blockTxIndex}): ${errMsg}`
  );
  return { ok: false, permanent: false, error: errMsg };
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
