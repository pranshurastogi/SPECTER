/**
 * SPECTER 77-byte announcement metadata decoder.
 *
 * Wire layout (matches SPECTERAnnouncer on-chain metadata bytes):
 *
 *   [0]       view_tag        uint8    1 byte   — always present
 *   [1..33]   tx_hash         bytes32  32 bytes — all-zeros = absent
 *   [33..65]  amount          uint256  32 bytes — all-zeros = absent
 *   [65..73]  source_chain_id uint64   8 bytes  — big-endian u64, 0 = absent
 *   [73..77]  reserved        bytes4   4 bytes  — always zero
 *
 * schemeId 1000 = ML-KEM-1024 (SPECTER post-quantum scheme).
 * ephemeralPubKey is always 1088 bytes (ML-KEM-1024 ciphertext).
 */

export const METADATA_LENGTH = 77;
export const EPHEMERAL_KEY_LENGTH = 1088;

export interface DecodedMetadata {
  /** View tag byte (0–255). First byte of SHAKE-256(shared_secret). */
  viewTag: number;
  /** Source chain tx hash as "0x..." hex string, or null if all-zero. */
  txHash: string | null;
  /** Raw big-endian amount as "0x..." hex string, or null if all-zero. */
  amount: string | null;
  /** EIP-155 source chain ID (bigint), or null if zero. */
  sourceChainId: bigint | null;
  /** Reserved bytes [73..77] — always "0x00000000". */
  reserved: string;
}

/**
 * Decodes the 77-byte SPECTER metadata payload from a hex string.
 *
 * @param metadataHex - Hex string from the contract event (with or without 0x prefix).
 * @throws {MetadataDecodeError} if the input is shorter than 77 bytes.
 */
export function decodeMetadata(metadataHex: string): DecodedMetadata {
  const hex = metadataHex.startsWith("0x") ? metadataHex.slice(2) : metadataHex;

  // Each byte = 2 hex chars; must be at least 77 bytes
  if (hex.length < METADATA_LENGTH * 2) {
    throw new MetadataDecodeError(
      `Metadata too short: ${hex.length / 2} bytes, expected ${METADATA_LENGTH}`
    );
  }

  const bytes = hexToBytes(hex.slice(0, METADATA_LENGTH * 2));

  // [0] view_tag
  const viewTag = bytes[0]!;

  // [1..33] tx_hash — 32 bytes; treat all-zero as absent
  const txHashBytes = bytes.slice(1, 33);
  const txHash = isAllZero(txHashBytes) ? null : "0x" + bytesToHex(txHashBytes);

  // [33..65] amount — 32 bytes; treat all-zero as absent
  const amountBytes = bytes.slice(33, 65);
  const amount = isAllZero(amountBytes) ? null : "0x" + bytesToHex(amountBytes);

  // [65..73] source_chain_id — 8 bytes big-endian u64; treat 0 as absent
  const chainIdBytes = bytes.slice(65, 73);
  const chainIdBigInt = readBigUint64BE(chainIdBytes);
  const sourceChainId = chainIdBigInt === 0n ? null : chainIdBigInt;

  // [73..77] reserved — always zero
  const reservedBytes = bytes.slice(73, 77);
  const reserved = "0x" + bytesToHex(reservedBytes);

  return { viewTag, txHash, amount, sourceChainId, reserved };
}

/**
 * Safe version of decodeMetadata that never throws.
 * Returns a zero-filled result and logs the error on decode failure.
 */
export function decodeMetadataSafe(
  metadataHex: string,
  logError?: (msg: string) => void
): DecodedMetadata {
  try {
    return decodeMetadata(metadataHex);
  } catch (err) {
    const msg = `Failed to decode SPECTER metadata: ${err instanceof Error ? err.message : String(err)}`;
    if (logError) {
      logError(msg);
    } else {
      console.error(msg);
    }
    return {
      viewTag: 0,
      txHash: null,
      amount: null,
      sourceChainId: null,
      reserved: "0x00000000",
    };
  }
}

// ── Error type ─────────────────────────────────────────────────────────────

export class MetadataDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetadataDecodeError";
  }
}

// ── Private helpers ────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isAllZero(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0);
}

/** Read 8 bytes as big-endian unsigned 64-bit integer. */
function readBigUint64BE(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value = (value << 8n) | BigInt(bytes[i]!);
  }
  return value;
}
