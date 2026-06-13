/**
 * announce() calldata decoder for index-time ephemeral-key resolution.
 *
 * The new SPECTERAnnouncer Announcement event carries only the keccak256 hash
 * of the ML-KEM ciphertext (ephemeralKeyHash), not the full 1088-byte ciphertext.
 * The full ciphertext lives in the announce() calldata of the same transaction.
 *
 * This module recovers that ciphertext from the tx `input` bytes and verifies
 * keccak256(ciphertext) === ephemeralKeyHash so we never store unverified data.
 */

import { decodeFunctionData, keccak256, type Hex } from "viem";

// Minimal ABI for both announce overloads (3-arg and 4-arg).
const ANNOUNCE_ABI = [
  {
    type: "function",
    name: "announce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "stealthAddress", type: "address" },
      { name: "ephemeralPubKey", type: "bytes" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "announce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schemeId", type: "uint256" },
      { name: "stealthAddress", type: "address" },
      { name: "ephemeralPubKey", type: "bytes" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/** Recover the ML-KEM ciphertext (Hex, with 0x) from announce() calldata. */
export function decodeEphemeralKey(input: Hex): Hex {
  const decoded = decodeFunctionData({ abi: ANNOUNCE_ABI, data: input });
  // ephemeralPubKey is the `bytes` arg: index 1 (3-arg) or 2 (4-arg).
  const args = decoded.args as readonly unknown[];
  const ek = (args.length === 3 ? args[1] : args[2]) as Hex;
  return ek;
}

/** True iff keccak256(ciphertext) === expected event hash (both 0x-prefixed). */
export function verifyEphemeralKeyHash(ciphertext: Hex, expectedHash: Hex): boolean {
  return keccak256(ciphertext).toLowerCase() === expectedHash.toLowerCase();
}
