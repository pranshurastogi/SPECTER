/**
 * Tests for the metadata view-tag reader (metadata.ts).
 *
 * The on-chain metadata is now an opaque AEAD-encrypted blob; only byte 0
 * (view_tag) is plaintext. The indexer can no longer decode the rest.
 */

import { describe, it, expect } from "vitest";
import { extractViewTag, EPHEMERAL_KEY_LENGTH } from "../metadata";

describe("EPHEMERAL_KEY_LENGTH constant", () => {
  it("EPHEMERAL_KEY_LENGTH is 1088", () => {
    expect(EPHEMERAL_KEY_LENGTH).toBe(1088);
  });
});

describe("extractViewTag", () => {
  it("reads byte 0", () => {
    expect(extractViewTag("0x7f1122")).toBe(0x7f);
  });

  it("reads byte 0 without 0x prefix", () => {
    expect(extractViewTag("7f1122")).toBe(0x7f);
  });

  it("view_tag 0 (min)", () => {
    expect(extractViewTag("0x00abcdef")).toBe(0);
  });

  it("view_tag 255 (max)", () => {
    expect(extractViewTag("0xffabcdef")).toBe(255);
  });

  it("throws on empty", () => {
    expect(() => extractViewTag("0x")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => extractViewTag("")).toThrow();
  });
});
