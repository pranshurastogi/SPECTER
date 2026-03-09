/**
 * AES-256-GCM encryption/decryption for SPECTER keys using Web Crypto API.
 * Password → PBKDF2 (SHA-256, 210 000 iterations) → 256-bit AES-GCM key.
 * Ciphertext envelope: { v, salt, iv, data } — all Base64-encoded.
 */

const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const ENVELOPE_VERSION = 1;

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

export interface EncryptedEnvelope {
  v: number;
  salt: string;
  iv: string;
  data: string;
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
