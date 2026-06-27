import { describe, it, expect } from "vitest";
import {
  isValidRecipientName,
  buildPayPath,
  buildPayUrl,
  parsePayParams,
  PAY_ORIGIN,
} from "@/lib/payLink";

describe("isValidRecipientName", () => {
  it("accepts .eth and .sui names", () => {
    expect(isValidRecipientName("alice.eth")).toBe(true);
    expect(isValidRecipientName("bob.sui")).toBe(true);
    expect(isValidRecipientName("ALICE.ETH")).toBe(true);
  });
  it("rejects empty, plain words, and non-name junk", () => {
    expect(isValidRecipientName("")).toBe(false);
    expect(isValidRecipientName("alice")).toBe(false);
    expect(isValidRecipientName("../etc")).toBe(false);
  });
});

describe("buildPayPath / buildPayUrl", () => {
  it("builds a bare path with no params", () => {
    expect(buildPayPath("alice.eth")).toBe("/pay/alice.eth");
  });
  it("appends and url-encodes params in stable order", () => {
    const path = buildPayPath("alice.eth", { amount: "50", chain: "sui", label: "Invoice #204" });
    expect(path).toBe("/pay/alice.eth?amount=50&chain=sui&label=Invoice+%23204");
  });
  it("omits empty params", () => {
    expect(buildPayPath("bob.sui", { amount: "", label: undefined })).toBe("/pay/bob.sui");
  });
  it("buildPayUrl prefixes the origin", () => {
    expect(buildPayUrl("alice.eth", { amount: "5" })).toBe(`${PAY_ORIGIN}/pay/alice.eth?amount=5`);
    expect(buildPayUrl("alice.eth", {}, "https://x.test")).toBe("https://x.test/pay/alice.eth");
  });
});

describe("parsePayParams", () => {
  it("parses and validates known params", () => {
    const p = parsePayParams("amount=50&chain=sui&label=Hi&memo=thanks&ref=twitter");
    expect(p).toEqual({ amount: "50", chain: "sui", label: "Hi", memo: "thanks", ref: "twitter" });
  });
  it("drops invalid chain and non-numeric amount", () => {
    const p = parsePayParams("amount=abc&chain=solana");
    expect(p.amount).toBeUndefined();
    expect(p.chain).toBeUndefined();
  });
  it("accepts decimal amounts and trims/caps label+memo", () => {
    const p = parsePayParams(`amount=1.25&label=${"x".repeat(200)}&memo=${"y".repeat(200)}`);
    expect(p.amount).toBe("1.25");
    expect(p.label!.length).toBe(80);
    expect(p.memo!.length).toBe(140);
  });
  it("accepts a URLSearchParams instance", () => {
    expect(parsePayParams(new URLSearchParams("chain=monad")).chain).toBe("monad");
  });
});
