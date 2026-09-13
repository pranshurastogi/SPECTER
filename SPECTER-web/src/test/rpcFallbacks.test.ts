import { describe, expect, it } from "vitest";
import {
  ETH_MAINNET_FALLBACKS,
  isBrokenRpcUrl,
  rpcChain,
  usableRpcUrls,
} from "@/lib/blockchain/rpcFallbacks";

describe("isBrokenRpcUrl", () => {
  it("flags hosts that answer eth_chainId but fail real traffic", () => {
    // cloudflare-eth.com returns "Internal error" for eth_call against the
    // ENS registry; rpc.sepolia.org now serves a 404 HTML page.
    expect(isBrokenRpcUrl("https://cloudflare-eth.com")).toBe(true);
    expect(isBrokenRpcUrl("https://rpc.sepolia.org")).toBe(true);
    expect(isBrokenRpcUrl("https://eth-sepolia.public.blastapi.io")).toBe(true);
  });

  it("treats a missing url as unusable", () => {
    expect(isBrokenRpcUrl(undefined)).toBe(true);
    expect(isBrokenRpcUrl("")).toBe(true);
  });

  it("accepts a healthy endpoint", () => {
    expect(isBrokenRpcUrl("https://mainnet.infura.io/v3/key")).toBe(false);
  });
});

describe("usableRpcUrls", () => {
  it("keeps the configured primary ahead of the public fallbacks", () => {
    const urls = usableRpcUrls("https://mainnet.infura.io/v3/key", ...ETH_MAINNET_FALLBACKS);
    expect(urls[0]).toBe("https://mainnet.infura.io/v3/key");
    expect(urls.length).toBe(1 + ETH_MAINNET_FALLBACKS.length);
  });

  it("drops blanks, duplicates, and broken hosts", () => {
    expect(
      usableRpcUrls(
        undefined,
        "https://a.example",
        "https://a.example",
        "https://cloudflare-eth.com",
        "",
        "https://b.example",
      ),
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  it("still yields the public fallbacks when nothing is configured", () => {
    // A missing env var must not leave the app with zero endpoints.
    expect(usableRpcUrls(undefined, ...ETH_MAINNET_FALLBACKS)).toEqual(
      ETH_MAINNET_FALLBACKS,
    );
  });

  it("never returns a known-broken host as the only option", () => {
    const urls = usableRpcUrls("https://cloudflare-eth.com", ...ETH_MAINNET_FALLBACKS);
    expect(urls).not.toContain("https://cloudflare-eth.com");
    expect(urls.length).toBeGreaterThan(0);
  });
});

describe("rpcChain (primary -> secondary -> public)", () => {
  const ALCHEMY = "https://eth-mainnet.g.alchemy.com/v2/alch_key";
  const INFURA = "https://mainnet.infura.io/v3/infura_key";

  it("orders the tiers primary, secondary, then public", () => {
    expect(rpcChain(ALCHEMY, INFURA, ETH_MAINNET_FALLBACKS)).toEqual([
      ALCHEMY,
      INFURA,
      ...ETH_MAINNET_FALLBACKS,
    ]);
  });

  it("keeps the public tier when no secondary is configured", () => {
    // Configuring one paid provider must not remove the key-free safety net.
    expect(rpcChain(ALCHEMY, undefined, ETH_MAINNET_FALLBACKS)).toEqual([
      ALCHEMY,
      ...ETH_MAINNET_FALLBACKS,
    ]);
  });

  it("falls back to public only when nothing is configured", () => {
    expect(rpcChain(undefined, undefined, ETH_MAINNET_FALLBACKS)).toEqual(
      ETH_MAINNET_FALLBACKS,
    );
  });

  it("drops a broken primary but keeps the tiers behind it", () => {
    const urls = rpcChain("https://cloudflare-eth.com", INFURA, ETH_MAINNET_FALLBACKS);
    expect(urls[0]).toBe(INFURA);
    expect(urls).not.toContain("https://cloudflare-eth.com");
  });

  it("never yields an empty list", () => {
    expect(rpcChain(undefined, undefined, ETH_MAINNET_FALLBACKS).length).toBeGreaterThan(0);
  });
});
