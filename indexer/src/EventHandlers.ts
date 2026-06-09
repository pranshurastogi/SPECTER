/**
 * SPECTER Envio event handler — SPECTERAnnouncer.Announcement
 *
 * For each on-chain Announcement event:
 *   1. Decode the 77-byte SPECTER metadata (viewTag, txHash, amount, sourceChainId)
 *   2. Validate ephemeralPubKey length (must be 1088 bytes for ML-KEM-1024)
 *   3. Write to Envio's Postgres DB (queryable via GraphQL)
 *   4. Dual-write to Turso (for the SPECTER API scanning path)
 *
 * Error strategy: never throw from the handler. Log, degrade gracefully, continue.
 *
 * Recovery: events that fail Turso write (tursoSynced=false) are picked up and
 * retried by the background worker started at the bottom of this module.
 */

import { SPECTERAnnouncer } from "generated";
import { decodeMetadataSafe, EPHEMERAL_KEY_LENGTH } from "./metadata";
import { writeTursoAnnouncement } from "./turso";
import { startRetryWorker } from "./retrySync";

const MONAD_TESTNET_CHAIN_NAME = "monad-testnet";

SPECTERAnnouncer.Announcement.handler(async ({ event, context }) => {
  const { schemeId, stealthAddress, caller, ephemeralPubKey, metadata } =
    event.params;

  const txHash = event.transaction.hash;
  const logIndex = event.logIndex;
  const blockNumber = event.block.number;
  const blockTimestamp = event.block.timestamp;

  const entityId = `${txHash}-${logIndex}`;

  // ── 1. Decode 77-byte metadata ─────────────────────────────────────────
  const decoded = decodeMetadataSafe(metadata, (msg) =>
    context.log.error(`[${entityId}] metadata decode failed: ${msg}`)
  );

  // ── 2. Validate ephemeralPubKey length (hex string: 1088 bytes = 2176 chars + optional 0x)
  const ephemeralKeyHex = ephemeralPubKey.startsWith("0x")
    ? ephemeralPubKey.slice(2)
    : ephemeralPubKey;

  const ephemeralKeyBytes = ephemeralKeyHex.length / 2;
  if (ephemeralKeyBytes !== EPHEMERAL_KEY_LENGTH) {
    context.log.warn(
      `[${entityId}] Invalid ephemeralPubKey: ${ephemeralKeyBytes} bytes (expected ${EPHEMERAL_KEY_LENGTH}). Indexing anyway.`
    );
  }

  const stealthAddressLower = stealthAddress.toLowerCase();
  const callerLower = caller.toLowerCase();

  // ── 3. Write to Turso first so we know the sync status ─────────────────
  const result = await writeTursoAnnouncement({
    viewTag: decoded.viewTag,
    timestamp: blockTimestamp,
    ephemeralKey: ephemeralKeyHex,
    sourceChainId:
      decoded.sourceChainId !== null ? Number(decoded.sourceChainId) : null,
    blockNumber,
    txHash: txHash,                    // Monad announce tx hash (dedup key)
    paymentTxHash: decoded.txHash,     // source-chain payment tx from metadata [1..33]
    amount: decoded.amount,
    chain: MONAD_TESTNET_CHAIN_NAME,
    stealthAddress: stealthAddressLower,
    blockTxIndex: logIndex,
  });

  const tursoSynced = result.ok;

  if (!tursoSynced) {
    if (!result.ok && result.permanent) {
      // Auth failure, schema mismatch — operator action required.
      context.log.error(
        `[${entityId}] Turso write failed with a PERMANENT error (auth/schema). ` +
          `No automatic recovery possible — check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. ` +
          `Error: ${result.error}`
      );
    } else {
      // Transient failure — the retry worker will pick this up.
      context.log.warn(
        `[${entityId}] Turso write failed (transient). Event indexed in Envio only. ` +
          `The retrySync worker will retry automatically. ` +
          `Run the unsynced_turso.graphql query to inspect the backlog.`
      );
    }
  }

  // ── 4. Write to Envio entity (Postgres) ────────────────────────────────
  context.AnnouncementEvent.set({
    id: entityId,
    schemeId,
    stealthAddress: stealthAddressLower,
    caller: callerLower,
    ephemeralPubKey: ephemeralKeyHex,
    viewTag: decoded.viewTag,
    txHash: decoded.txHash ?? undefined,
    amount: decoded.amount ?? undefined,
    sourceChainId: decoded.sourceChainId ?? undefined,
    blockNumber: BigInt(blockNumber),
    blockTimestamp: BigInt(blockTimestamp),
    transactionHash: txHash,
    logIndex,
    metadataRaw: metadata,
    tursoSynced,
  });
});

// ── Background retry worker ─────────────────────────────────────────────────
//
// Starts once when the Envio worker process loads this module.
// Queries Envio GraphQL periodically for tursoSynced=false events and
// re-pushes them to Turso (idempotent: INSERT OR IGNORE on tx_hash).
startRetryWorker();
