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
      `[${entityId}] Turso write failed — event indexed in Envio only. ` +
        `Use the unsynced_turso.graphql query to find and retry failed writes.`
    );
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
