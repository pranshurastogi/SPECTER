/**
 * SPECTER Envio event handler — SPECTERAnnouncer.Announcement
 *
 * For each on-chain Announcement event:
 *   1. Decode the 77-byte SPECTER metadata (viewTag, txHash, amount, sourceChainId)
 *   2. Validate ephemeralPubKey length (must be 1088 bytes for ML-KEM-1024)
 *   3. Write to Envio's internal Postgres DB (queryable via GraphQL)
 *   4. Dual-write to Turso (for the SPECTER API scanning path)
 *
 * Error handling strategy:
 *   - Metadata decode failure → log, use zero defaults, continue indexing
 *   - Turso write failure     → log, mark tursoSynced=false, continue indexing
 *   - Never throw from handler → Envio must not stop indexing due to one bad event
 */

import { SPECTERAnnouncer } from "generated";
import { decodeMetadataSafe, EPHEMERAL_KEY_LENGTH } from "./metadata";
import { writeTursoAnnouncement } from "./turso";

const MONAD_TESTNET_CHAIN_NAME = "monad-testnet";

SPECTERAnnouncer.Announcement.handler(async ({ event, context }) => {
  const { schemeId, stealthAddress, caller, ephemeralPubKey, metadata } =
    event.params;

  const txHash = event.transaction.hash;
  const logIndex = event.logIndex;
  const blockNumber = event.block.number;
  const blockTimestamp = event.block.timestamp;

  // Unique entity ID across all Monad blocks
  const entityId = `${txHash}-${logIndex}`;

  // ── 1. Decode 77-byte metadata ─────────────────────────────────────────
  const decoded = decodeMetadataSafe(metadata, (msg) =>
    context.log.error(`[${entityId}] ${msg}`)
  );

  // ── 2. Validate ephemeralPubKey length ─────────────────────────────────
  // Strip leading "0x" if present; each byte = 2 hex chars
  const ephemeralKeyHex = ephemeralPubKey.startsWith("0x")
    ? ephemeralPubKey.slice(2)
    : ephemeralPubKey;

  const ephemeralKeyBytes = ephemeralKeyHex.length / 2;
  if (ephemeralKeyBytes !== EPHEMERAL_KEY_LENGTH) {
    // Log and continue — we still index the event so it's discoverable
    context.log.warn(
      `[${entityId}] Invalid ephemeralPubKey: ${ephemeralKeyBytes} bytes, expected ${EPHEMERAL_KEY_LENGTH}. ` +
        `Event will be indexed but recipients may fail to decrypt.`
    );
  }

  const stealthAddressLower = stealthAddress.toLowerCase();
  const callerLower = caller.toLowerCase();

  // ── 3. Write to Envio entity ───────────────────────────────────────────
  //    First write (tursoSynced=false); updated below if Turso succeeds.
  //    We write immediately so the entity exists even if Turso is down.
  context.AnnouncementEvent.set({
    id: entityId,
    schemeId,
    stealthAddress: stealthAddressLower,
    caller: callerLower,
    ephemeralPubKey: ephemeralKeyHex,
    viewTag: decoded.viewTag,
    txHash: decoded.txHash,
    amount: decoded.amount,
    sourceChainId: decoded.sourceChainId,
    blockNumber: BigInt(blockNumber),
    blockTimestamp: BigInt(blockTimestamp),
    transactionHash: txHash,
    logIndex,
    metadataRaw: metadata,
    tursoSynced: false,
  });

  // ── 4. Dual-write to Turso ─────────────────────────────────────────────
  const tursoSynced = await writeTursoAnnouncement({
    viewTag: decoded.viewTag,
    timestamp: blockTimestamp,
    ephemeralKey: ephemeralKeyHex,
    sourceChainId:
      decoded.sourceChainId !== null ? Number(decoded.sourceChainId) : null,
    blockNumber,
    txHash: decoded.txHash,
    amount: decoded.amount,
    chain: MONAD_TESTNET_CHAIN_NAME,
    stealthAddress: stealthAddressLower,
    blockTxIndex: logIndex,
    transactionHash: txHash,
  });

  if (!tursoSynced) {
    context.log.warn(
      `[${entityId}] Turso write failed — event indexed in Envio but SPECTER API ` +
        `scanning may not see this announcement until the next sync.`
    );
  }

  // ── 5. Update entity with final tursoSynced status ─────────────────────
  // Overwrite with correct tursoSynced value (Envio uses last set() in handler)
  context.AnnouncementEvent.set({
    id: entityId,
    schemeId,
    stealthAddress: stealthAddressLower,
    caller: callerLower,
    ephemeralPubKey: ephemeralKeyHex,
    viewTag: decoded.viewTag,
    txHash: decoded.txHash,
    amount: decoded.amount,
    sourceChainId: decoded.sourceChainId,
    blockNumber: BigInt(blockNumber),
    blockTimestamp: BigInt(blockTimestamp),
    transactionHash: txHash,
    logIndex,
    metadataRaw: metadata,
    tursoSynced,
  });
});
