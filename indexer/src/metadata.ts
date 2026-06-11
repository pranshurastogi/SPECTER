/**
 * SPECTER announcement metadata view-tag reader.
 *
 * The on-chain metadata is now an AEAD-encrypted blob; only byte 0 (view_tag)
 * is plaintext. Everything else is opaque ciphertext only the recipient can read.
 * The indexer can no longer decode txHash/amount/sourceChainId from metadata.
 *
 * schemeId 1000 = ML-KEM-768 (SPECTER post-quantum scheme).
 * ephemeralPubKey (the resolved ciphertext) is always 1088 bytes (ML-KEM-768).
 */

export const EPHEMERAL_KEY_LENGTH = 1088;

/**
 * Extracts the plaintext view-tag byte (byte 0) from the metadata hex.
 *
 * @param metadataHex - Hex string from the contract event (with or without 0x prefix).
 * @throws if the input is shorter than one byte.
 */
export function extractViewTag(metadataHex: string): number {
  const hex = metadataHex.startsWith("0x") ? metadataHex.slice(2) : metadataHex;
  if (hex.length < 2) throw new Error("metadata too short: missing view_tag");
  return parseInt(hex.slice(0, 2), 16);
}
