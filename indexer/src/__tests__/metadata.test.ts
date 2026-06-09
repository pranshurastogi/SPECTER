/**
 * Tests for the 77-byte SPECTER metadata decoder (metadata.ts).
 *
 * Layout under test:
 *   [0]       view_tag        uint8   (always present)
 *   [1..33]   tx_hash         bytes32 (all-zero = absent → null)
 *   [33..65]  amount          uint256 (all-zero = absent → null)
 *   [65..73]  source_chain_id uint64  (big-endian, 0 = absent → null)
 *   [73..77]  reserved        bytes4  (always zero)
 */

import { describe, it, expect } from "vitest";
import {
  decodeMetadata,
  decodeMetadataSafe,
  MetadataDecodeError,
  METADATA_LENGTH,
  EPHEMERAL_KEY_LENGTH,
} from "../metadata";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a 77-byte buffer from parts. All fields optional, default to zero. */
function buildMetadata({
  viewTag = 0,
  txHash = new Uint8Array(32),
  amount = new Uint8Array(32),
  sourceChainId = 0n,
  reserved = new Uint8Array(4),
}: {
  viewTag?: number;
  txHash?: Uint8Array;
  amount?: Uint8Array;
  sourceChainId?: bigint;
  reserved?: Uint8Array;
} = {}): string {
  const buf = new Uint8Array(77);
  buf[0] = viewTag;
  buf.set(txHash, 1);
  buf.set(amount, 33);

  // source_chain_id: big-endian uint64
  const chainBuf = new Uint8Array(8);
  let chainId = sourceChainId;
  for (let i = 7; i >= 0; i--) {
    chainBuf[i] = Number(chainId & 0xffn);
    chainId >>= 8n;
  }
  buf.set(chainBuf, 65);
  buf.set(reserved, 73);

  return "0x" + Buffer.from(buf).toString("hex");
}

const ZERO_32 = new Uint8Array(32);
const ALL_FF_32 = new Uint8Array(32).fill(0xff);
const NONCE_TX = new Uint8Array(32).fill(0x11);
const NONCE_AMOUNT = new Uint8Array(32).fill(0x22);

// ── Constants ─────────────────────────────────────────────────────────────────

describe("METADATA_LENGTH and EPHEMERAL_KEY_LENGTH constants", () => {
  it("METADATA_LENGTH is 77", () => {
    expect(METADATA_LENGTH).toBe(77);
  });

  it("EPHEMERAL_KEY_LENGTH is 1088", () => {
    expect(EPHEMERAL_KEY_LENGTH).toBe(1088);
  });
});

// ── decodeMetadata ────────────────────────────────────────────────────────────

describe("decodeMetadata — valid inputs", () => {
  it("decodes view_tag from byte 0", () => {
    const hex = buildMetadata({ viewTag: 0x42 });
    const result = decodeMetadata(hex);
    expect(result.viewTag).toBe(0x42);
  });

  it("view_tag 0 (min) is decoded correctly", () => {
    const hex = buildMetadata({ viewTag: 0 });
    expect(decodeMetadata(hex).viewTag).toBe(0);
  });

  it("view_tag 255 (max) is decoded correctly", () => {
    const hex = buildMetadata({ viewTag: 255 });
    expect(decodeMetadata(hex).viewTag).toBe(255);
  });

  it("all-zero tx_hash returns null", () => {
    const hex = buildMetadata({ txHash: ZERO_32 });
    expect(decodeMetadata(hex).txHash).toBeNull();
  });

  it("non-zero tx_hash returns 0x-prefixed hex", () => {
    const hex = buildMetadata({ txHash: NONCE_TX });
    const result = decodeMetadata(hex);
    expect(result.txHash).not.toBeNull();
    expect(result.txHash!.startsWith("0x")).toBe(true);
    expect(result.txHash).toHaveLength(2 + 64); // "0x" + 32 bytes = 66 chars
  });

  it("tx_hash with single non-zero byte is treated as present", () => {
    const singleByte = new Uint8Array(32);
    singleByte[31] = 0x01;
    const hex = buildMetadata({ txHash: singleByte });
    expect(decodeMetadata(hex).txHash).not.toBeNull();
  });

  it("all-zero amount returns null", () => {
    const hex = buildMetadata({ amount: ZERO_32 });
    expect(decodeMetadata(hex).amount).toBeNull();
  });

  it("non-zero amount returns 0x-prefixed hex", () => {
    const hex = buildMetadata({ amount: NONCE_AMOUNT });
    const result = decodeMetadata(hex);
    expect(result.amount).not.toBeNull();
    expect(result.amount!.startsWith("0x")).toBe(true);
    expect(result.amount).toHaveLength(2 + 64);
  });

  it("max amount (all 0xFF) is decoded as present", () => {
    const hex = buildMetadata({ amount: ALL_FF_32 });
    expect(decodeMetadata(hex).amount).not.toBeNull();
  });

  it("sourceChainId 0 returns null", () => {
    const hex = buildMetadata({ sourceChainId: 0n });
    expect(decodeMetadata(hex).sourceChainId).toBeNull();
  });

  it("sourceChainId 1 (Ethereum mainnet) is decoded correctly", () => {
    const hex = buildMetadata({ sourceChainId: 1n });
    expect(decodeMetadata(hex).sourceChainId).toBe(1n);
  });

  it("sourceChainId 10143 (Monad testnet) roundtrips correctly", () => {
    const hex = buildMetadata({ sourceChainId: 10143n });
    expect(decodeMetadata(hex).sourceChainId).toBe(10143n);
  });

  it("sourceChainId 42161 (Arbitrum One) roundtrips correctly", () => {
    const hex = buildMetadata({ sourceChainId: 42161n });
    expect(decodeMetadata(hex).sourceChainId).toBe(42161n);
  });

  it("sourceChainId 137 (Polygon) roundtrips correctly", () => {
    const hex = buildMetadata({ sourceChainId: 137n });
    expect(decodeMetadata(hex).sourceChainId).toBe(137n);
  });

  it("sourceChainId 8453 (Base) roundtrips correctly", () => {
    const hex = buildMetadata({ sourceChainId: 8453n });
    expect(decodeMetadata(hex).sourceChainId).toBe(8453n);
  });

  it("max uint64 source chain ID roundtrips without loss", () => {
    const maxU64 = 0xffff_ffff_ffff_ffffn;
    const hex = buildMetadata({ sourceChainId: maxU64 });
    expect(decodeMetadata(hex).sourceChainId).toBe(maxU64);
  });

  it("reserved bytes are always '0x00000000'", () => {
    const hex = buildMetadata({ viewTag: 0xab });
    expect(decodeMetadata(hex).reserved).toBe("0x00000000");
  });

  it("ignores non-reserved bytes [73..77] even if caller provides garbage", () => {
    // Build a 77-byte buffer with garbage at [73..77]
    // decodeMetadata always reads exactly 77 bytes and reports [73..77] as reserved
    const hex = buildMetadata({ viewTag: 7, reserved: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) });
    // Reserved field is read as-is; we don't validate it, just report
    const result = decodeMetadata(hex);
    expect(result.viewTag).toBe(7);
    // The reserved bytes are set to the garbage we passed
    expect(result.reserved).toBe("0xdeadbeef");
  });

  it("accepts metadata without 0x prefix", () => {
    const full = buildMetadata({ viewTag: 0x55 }); // has 0x
    const stripped = full.slice(2); // no 0x
    const withPrefix = decodeMetadata(full);
    const withoutPrefix = decodeMetadata(stripped);
    expect(withPrefix.viewTag).toBe(withoutPrefix.viewTag);
    expect(withPrefix.txHash).toBe(withoutPrefix.txHash);
    expect(withPrefix.sourceChainId).toBe(withoutPrefix.sourceChainId);
  });

  it("accepts input longer than 77 bytes (extra bytes ignored)", () => {
    const hex = buildMetadata({ viewTag: 0x99 }) + "deadbeef"; // extra 2 bytes
    const result = decodeMetadata(hex);
    expect(result.viewTag).toBe(0x99);
  });

  it("decodes a fully-populated metadata correctly", () => {
    const hex = buildMetadata({
      viewTag: 0xcc,
      txHash: NONCE_TX,
      amount: NONCE_AMOUNT,
      sourceChainId: 42161n,
    });
    const result = decodeMetadata(hex);
    expect(result.viewTag).toBe(0xcc);
    expect(result.txHash).not.toBeNull();
    expect(result.amount).not.toBeNull();
    expect(result.sourceChainId).toBe(42161n);
    expect(result.reserved).toBe("0x00000000");
  });
});

describe("decodeMetadata — invalid inputs", () => {
  it("throws MetadataDecodeError for empty string", () => {
    expect(() => decodeMetadata("")).toThrow(MetadataDecodeError);
  });

  it("throws MetadataDecodeError for '0x' only", () => {
    expect(() => decodeMetadata("0x")).toThrow(MetadataDecodeError);
  });

  it("throws MetadataDecodeError for 76-byte metadata (one short)", () => {
    const truncated = buildMetadata({ viewTag: 0x01 }).slice(0, -2); // remove last byte
    expect(() => decodeMetadata(truncated)).toThrow(MetadataDecodeError);
  });

  it("error message mentions expected length", () => {
    try {
      decodeMetadata("0xdeadbeef");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MetadataDecodeError);
      expect((e as Error).message).toMatch(/77/);
    }
  });

  it("MetadataDecodeError is an instance of Error", () => {
    try {
      decodeMetadata("0x00");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(MetadataDecodeError);
    }
  });

  it("MetadataDecodeError has the right name property", () => {
    try {
      decodeMetadata("short");
    } catch (e) {
      expect((e as Error).name).toBe("MetadataDecodeError");
    }
  });
});

// ── decodeMetadataSafe ────────────────────────────────────────────────────────

describe("decodeMetadataSafe — graceful degradation", () => {
  it("returns zero defaults on empty string without throwing", () => {
    const result = decodeMetadataSafe("");
    expect(result.viewTag).toBe(0);
    expect(result.txHash).toBeNull();
    expect(result.amount).toBeNull();
    expect(result.sourceChainId).toBeNull();
    expect(result.reserved).toBe("0x00000000");
  });

  it("returns zero defaults on too-short metadata without throwing", () => {
    const result = decodeMetadataSafe("0xdeadbeef");
    expect(result.viewTag).toBe(0);
    expect(result.txHash).toBeNull();
    expect(result.sourceChainId).toBeNull();
  });

  it("calls the logError callback on decode failure", () => {
    let captured = "";
    decodeMetadataSafe("0x00", (msg) => { captured = msg; });
    expect(captured).toMatch(/metadata/i);
  });

  it("does NOT call logError for a valid 77-byte payload", () => {
    let called = false;
    const hex = buildMetadata({ viewTag: 0x77 });
    decodeMetadataSafe(hex, () => { called = true; });
    expect(called).toBe(false);
  });

  it("returns correct values for a valid 77-byte payload", () => {
    const hex = buildMetadata({ viewTag: 0xab, sourceChainId: 137n });
    const result = decodeMetadataSafe(hex);
    expect(result.viewTag).toBe(0xab);
    expect(result.sourceChainId).toBe(137n);
  });

  it("does not throw when logError is undefined and input is invalid", () => {
    expect(() => decodeMetadataSafe("bad")).not.toThrow();
  });

  it("safe version returns same result as strict version for valid input", () => {
    const hex = buildMetadata({
      viewTag: 0x55,
      txHash: NONCE_TX,
      amount: NONCE_AMOUNT,
      sourceChainId: 10143n,
    });
    const strict = decodeMetadata(hex);
    const safe = decodeMetadataSafe(hex);
    expect(safe.viewTag).toBe(strict.viewTag);
    expect(safe.txHash).toBe(strict.txHash);
    expect(safe.amount).toBe(strict.amount);
    expect(safe.sourceChainId).toBe(strict.sourceChainId);
  });
});

// ── Boundary and stress tests ─────────────────────────────────────────────────

describe("decodeMetadata — boundary and cross-field tests", () => {
  it("exactly 77 bytes (boundary) decodes without error", () => {
    const hex = buildMetadata({ viewTag: 0x01 });
    expect(hex.length).toBe(2 + 77 * 2); // "0x" + 154 hex chars
    expect(() => decodeMetadata(hex)).not.toThrow();
  });

  it("all-zero 77 bytes yields zero defaults", () => {
    const hex = "0x" + "00".repeat(77);
    const result = decodeMetadata(hex);
    expect(result.viewTag).toBe(0);
    expect(result.txHash).toBeNull();
    expect(result.amount).toBeNull();
    expect(result.sourceChainId).toBeNull();
  });

  it("all-ones 77 bytes (0xFF) yields non-null fields and view_tag=255", () => {
    const hex = "0x" + "ff".repeat(77);
    const result = decodeMetadata(hex);
    expect(result.viewTag).toBe(255);
    expect(result.txHash).not.toBeNull();
    expect(result.amount).not.toBeNull();
    // source_chain_id bytes all FF = max uint64
    expect(result.sourceChainId).toBe(0xffff_ffff_ffff_ffffn);
  });

  it("ten different view tags all decode correctly", () => {
    const tags = [0, 1, 42, 127, 128, 200, 240, 253, 254, 255];
    for (const tag of tags) {
      const hex = buildMetadata({ viewTag: tag });
      expect(decodeMetadata(hex).viewTag).toBe(tag);
    }
  });

  it("tx_hash and amount decode to distinct hex strings", () => {
    const txH = new Uint8Array(32).fill(0xaa);
    const amt = new Uint8Array(32).fill(0xbb);
    const hex = buildMetadata({ txHash: txH, amount: amt });
    const result = decodeMetadata(hex);
    expect(result.txHash).not.toBe(result.amount);
    expect(result.txHash).toMatch(/aa/);
    expect(result.amount).toMatch(/bb/);
  });
});
