/**
 * Tests for calldata.ts — decodeEphemeralKey + verifyEphemeralKeyHash.
 *
 * Pure unit tests: announce() calldata is built locally with viem's
 * encodeFunctionData, so no network access is required.
 */

import { describe, it, expect } from "vitest";
import { encodeFunctionData, keccak256, type Hex } from "viem";
import { decodeEphemeralKey, verifyEphemeralKeyHash } from "../calldata";

// 1088-byte ML-KEM ciphertext (deterministic, non-trivial bytes)
const CIPHERTEXT: Hex = ("0x" + "ab".repeat(1088)) as Hex;
const METADATA: Hex = "0x7f00000000" as Hex;
const STEALTH = "0x1111111111111111111111111111111111111111" as const;

// ABIs for encoding (mirror the two announce overloads under test)
const ABI_3 = [
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
] as const;

const ABI_4 = [
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

describe("decodeEphemeralKey — 3-arg announce", () => {
  it("round-trips the ciphertext", () => {
    const input = encodeFunctionData({
      abi: ABI_3,
      functionName: "announce",
      args: [STEALTH, CIPHERTEXT, METADATA],
    });
    expect(decodeEphemeralKey(input).toLowerCase()).toBe(CIPHERTEXT.toLowerCase());
  });
});

describe("decodeEphemeralKey — 4-arg announce", () => {
  it("round-trips the ciphertext", () => {
    const input = encodeFunctionData({
      abi: ABI_4,
      functionName: "announce",
      args: [1000n, STEALTH, CIPHERTEXT, METADATA],
    });
    expect(decodeEphemeralKey(input).toLowerCase()).toBe(CIPHERTEXT.toLowerCase());
  });
});

describe("verifyEphemeralKeyHash", () => {
  it("returns true for keccak256(ciphertext)", () => {
    const ek = decodeEphemeralKey(
      encodeFunctionData({
        abi: ABI_3,
        functionName: "announce",
        args: [STEALTH, CIPHERTEXT, METADATA],
      })
    );
    expect(verifyEphemeralKeyHash(ek, keccak256(ek))).toBe(true);
  });

  it("returns false for a wrong hash", () => {
    const wrong = ("0x" + "00".repeat(32)) as Hex;
    expect(verifyEphemeralKeyHash(CIPHERTEXT, wrong)).toBe(false);
  });

  it("is case-insensitive on the expected hash", () => {
    const hash = keccak256(CIPHERTEXT);
    expect(verifyEphemeralKeyHash(CIPHERTEXT, hash.toUpperCase() as Hex)).toBe(true);
  });
});
