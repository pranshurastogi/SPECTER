import { describe, it, expect } from "vitest";
import { formatAddress, formatCryptoAmount } from "@/lib/utils";

describe("formatAddress", () => {
  it("returns empty string for undefined", () => {
    expect(formatAddress(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(formatAddress("")).toBe("");
  });

  it("truncates a full Ethereum address", () => {
    expect(formatAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe(
      "0x1234...5678",
    );
  });

  it("preserves short addresses without truncation issues", () => {
    const short = "0xABCDEF";
    const result = formatAddress(short);
    expect(result).toContain("0xABCD");
  });
});

describe("formatCryptoAmount", () => {
  it("returns '0' for NaN string input", () => {
    expect(formatCryptoAmount("not-a-number")).toBe("0");
  });

  it("returns '0' for zero", () => {
    expect(formatCryptoAmount(0)).toBe("0");
    expect(formatCryptoAmount("0")).toBe("0");
  });

  it("returns '0' for dust values that round to zero", () => {
    expect(formatCryptoAmount("0.000000001")).toBe("0");
  });

  it("formats a normal integer amount", () => {
    expect(formatCryptoAmount(1)).toBe("1");
    expect(formatCryptoAmount("42")).toBe("42");
  });

  it("strips trailing zeros from decimals", () => {
    expect(formatCryptoAmount("1.50000000")).toBe("1.5");
  });

  it("preserves up to 8 decimal places", () => {
    expect(formatCryptoAmount("0.00000001")).toBe("1e-8");
  });

  it("handles string representation of a decimal", () => {
    expect(formatCryptoAmount("0.5")).toBe("0.5");
  });
});
