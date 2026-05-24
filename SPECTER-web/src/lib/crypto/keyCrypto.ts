/**
 * AES-256-GCM encryption/decryption for SPECTER keys using Web Crypto API.
 *
 * Password path: PBKDF2 (SHA-256, 210 000 iterations) → AES-256-GCM.
 * Passkey path: WebAuthn PRF output → HKDF-SHA256 → AES-256-GCM (see passkeyVault.ts).
 *
 * Ciphertext envelope: { v, kdf?, salt, iv, data } — all Base64-encoded.
 */

const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const ENVELOPE_VERSION = 1;
const ENVELOPE_VERSION_PRF = 2;

/** HKDF info labels — changing these invalidates existing passkey vaults. */
const PRF_HKDF_SALT = new TextEncoder().encode("specter-vault-prf-hkdf-salt-v1");
const PRF_HKDF_INFO = new TextEncoder().encode("specter-vault-aes-256-gcm-v1");

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export type EnvelopeKdf = "pbkdf2" | "prf-hkdf";

export interface EncryptedEnvelope {
  v: number;
  /** Omitted on legacy entries — treated as pbkdf2. */
  kdf?: EnvelopeKdf;
  salt: string;
  iv: string;
  data: string;
}

/** Derive AES-256-GCM wrap key from WebAuthn PRF output (never store PRF output). */
export async function deriveAesKeyFromPrfMaterial(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  if (prfOutput.byteLength < 32) {
    throw new Error("PRF output too short for key derivation");
  }
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    prfOutput,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: PRF_HKDF_SALT,
      info: PRF_HKDF_INFO,
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptWithAesKey(
  plaintext: string,
  aesKey: CryptoKey,
): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(plaintext),
  );
  return {
    v: ENVELOPE_VERSION_PRF,
    kdf: "prf-hkdf",
    salt: "",
    iv: toBase64(iv.buffer),
    data: toBase64(ciphertext),
  };
}

export async function decryptWithAesKey(
  envelope: EncryptedEnvelope,
  aesKey: CryptoKey,
): Promise<string> {
  if (envelope.kdf !== "prf-hkdf" && envelope.v !== ENVELOPE_VERSION_PRF) {
    throw new Error("Envelope is not passkey-encrypted");
  }
  const iv = new Uint8Array(fromBase64(envelope.iv));
  const ciphertext = fromBase64(envelope.data);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

export async function encryptWithPassword(
  plaintext: string,
  password: string,
): Promise<EncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    v: ENVELOPE_VERSION,
    salt: toBase64(salt.buffer),
    iv: toBase64(iv.buffer),
    data: toBase64(ciphertext),
  };
}

export async function decryptWithPassword(
  envelope: EncryptedEnvelope,
  password: string,
): Promise<string> {
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new Error("Unsupported envelope version");
  }
  const salt = new Uint8Array(fromBase64(envelope.salt));
  const iv = new Uint8Array(fromBase64(envelope.iv));
  const ciphertext = fromBase64(envelope.data);
  const key = await deriveKey(password, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}
