/**
 * SPECTER Envio event handler — SPECTERAnnouncer.Announcement
 *
 * For each on-chain Announcement event:
 *   1. Read ephemeralKeyHash (bytes32) + metadata (bytes); viewTag = metadata[0]
 *   2. Resolve the FULL ML-KEM ciphertext from the announce() calldata (tx input)
 *   3. Verify keccak256(ciphertext) === ephemeralKeyHash (skip row on mismatch)
 *   4. Write to Envio's Postgres DB (queryable via GraphQL)
 *   5. Dual-write to Turso (for the SPECTER API scanning path):
 *      full ciphertext + ephemeralKeyHash + raw encrypted metadata blob.
 *
 * The metadata is now an opaque AEAD-encrypted blob — txHash/amount/sourceChainId
 * are encrypted and unreadable here, so we no longer store them in plaintext.
 *
 * Error strategy: never throw from the handler. Log, degrade gracefully, continue.
 *
 * Recovery: events that fail Turso write (tursoSynced=false) are picked up and
 * retried by the background worker started at the bottom of this module.
 */

import { SPECTERAnnouncer } from "generated";
import { extractViewTag } from "./metadata";
import { decodeEphemeralKey, verifyEphemeralKeyHash } from "./calldata";
import { writeTursoAnnouncement } from "./turso";
import { startRetryWorker } from "./retrySync";

const MONAD_TESTNET_CHAIN_NAME = "monad-testnet";

SPECTERAnnouncer.Announcement.handler(async ({ event, context }) => {
  const { schemeId, stealthAddress, caller, ephemeralKeyHash, metadata } =
    event.params;

  const txHash = event.transaction.hash;
  const logIndex = event.logIndex;
  const blockNumber = event.block.number;
  const blockTimestamp = event.block.timestamp;

  const entityId = `${txHash}-${logIndex}`;

  // ── 1. View tag (byte 0 of the metadata blob) ──────────────────────────
  let viewTag: number;
  try {
    viewTag = extractViewTag(metadata);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    context.log.error(`[${entityId}] view_tag extraction failed: ${msg}. Skipping.`);
    return;
  }

  // ── 2+3. Resolve ciphertext from calldata + verify keccak256 hash ───────
  const input = event.transaction.input as `0x${string}`;
  const expectedHash = ephemeralKeyHash as `0x${string}`;

  let ephemeralPubKey: string; // hex, no 0x — the FULL 1088-byte ciphertext
  try {
    const ek = decodeEphemeralKey(input);
    if (!verifyEphemeralKeyHash(ek, expectedHash)) {
      context.log.error(
        `[${entityId}] ephemeralKeyHash mismatch: keccak256(calldata ciphertext) ` +
          `does not equal the event hash ${expectedHash}. Skipping (unverified data not stored).`
      );
      return;
    }
    ephemeralPubKey = ek.slice(2); // strip 0x for storage convention
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    context.log.error(
      `[${entityId}] failed to decode ephemeral key from announce() calldata: ${msg}. Skipping.`
    );
    return;
  }

  // hex (no 0x) forms for storage
  const ephemeralKeyHashHex = expectedHash.startsWith("0x")
    ? expectedHash.slice(2)
    : expectedHash;
  const metadataBlobHex = metadata.startsWith("0x") ? metadata.slice(2) : metadata;

  const stealthAddressLower = stealthAddress.toLowerCase();
  const callerLower = caller.toLowerCase();

  // ── 4. Write to Turso first so we know the sync status ─────────────────
  const result = await writeTursoAnnouncement({
    viewTag,
    timestamp: blockTimestamp,
    ephemeralKey: ephemeralPubKey,           // full resolved ciphertext (hex, no 0x)
    ephemeralKeyHash: ephemeralKeyHashHex,   // 32-byte event hash (hex, no 0x)
    metadataBlob: metadataBlobHex,           // raw encrypted metadata (hex, no 0x)
    blockNumber,
    txHash: txHash,                          // Monad announce tx hash (dedup key)
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

  // ── 5. Write to Envio entity (Postgres) ────────────────────────────────
  context.AnnouncementEvent.set({
    id: entityId,
    schemeId,
    stealthAddress: stealthAddressLower,
    caller: callerLower,
    ephemeralPubKey,
    ephemeralKeyHash: ephemeralKeyHashHex,
    viewTag,
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
