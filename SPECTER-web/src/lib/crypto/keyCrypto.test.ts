import { describe, it, expect } from "vitest";
import {
  encryptWithPassword,
  decryptWithPassword,
  deriveAesKeyFromPrfMaterial,
  encryptWithAesKey,
  decryptWithAesKey,
} from "./keyCrypto";

describe("keyCrypto password envelope", () => {
  it("round-trips plaintext with password", async () => {
    const plain = JSON.stringify({ spending_sk: "abc", meta_address: "0x" });
    const envelope = await encryptWithPassword(plain, "test-password-123");
    const out = await decryptWithPassword(envelope, "test-password-123");
    expect(out).toBe(plain);
  });

  it("rejects wrong password", async () => {
    const envelope = await encryptWithPassword("secret", "correct");
    await expect(decryptWithPassword(envelope, "wrong")).rejects.toThrow();
  });
});

describe("keyCrypto passkey PRF envelope", () => {
  it("round-trips with PRF-derived AES key", async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const aesKey = await deriveAesKeyFromPrfMaterial(prfOutput);
    const plain = JSON.stringify({ viewing_sk: "deadbeef" });
    const envelope = await encryptWithAesKey(plain, aesKey);
    expect(envelope.kdf).toBe("prf-hkdf");
    const aesKey2 = await deriveAesKeyFromPrfMaterial(prfOutput);
    const out = await decryptWithAesKey(envelope, aesKey2);
    expect(out).toBe(plain);
  });

  it("rejects PRF output shorter than 32 bytes", async () => {
    const short = new Uint8Array(16).buffer;
    await expect(deriveAesKeyFromPrfMaterial(short)).rejects.toThrow(/too short/);
  });
});
