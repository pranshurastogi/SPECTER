/**
 * Encrypted key vault backed by localStorage.
 *
 * Supports two unlock methods per entry:
 * - password: PBKDF2 + AES-GCM (user-chosen password)
 * - passkey: WebAuthn PRF + HKDF + AES-GCM (platform authenticator)
 *
 * Secret key material is never stored in plaintext.
 */

import {
  encryptWithPassword,
  decryptWithPassword,
  encryptWithAesKey,
  decryptWithAesKey,
  type EncryptedEnvelope,
} from "./keyCrypto";
import {
  registerVaultPasskey,
  deriveVaultAesKeyFromPasskey,
  type PasskeyVaultMeta,
  PasskeyVaultError,
} from "./passkeyVault";

const STORAGE_KEY = "specter_key_vault";

export type VaultUnlockMethod = "password" | "passkey";

export interface VaultEntry {
  id: string;
  label: string;
  createdAt: number;
  /** Legacy entries omit this — treated as "password". */
  unlockMethod?: VaultUnlockMethod;
  envelope: EncryptedEnvelope;
  /** Present when unlockMethod === "passkey". */
  passkey?: PasskeyVaultMeta;
}

export interface DecryptedKeys {
  spending_pk: string;
  spending_sk: string;
  viewing_pk: string;
  viewing_sk: string;
  meta_address: string;
  /**
   * @deprecated SPECTER view tags are per-payment, not per-wallet.
   */
  view_tag?: number;
}

export class VaultError extends Error {
  constructor(
    message: string,
    readonly code: "ENTRY_NOT_FOUND" | "PASSWORD_REQUIRED" | "INVALID_ENTRY" = "INVALID_ENTRY",
  ) {
    super(message);
    this.name = "VaultError";
  }
}

function generateId(): string {
  return crypto.getRandomValues(new Uint8Array(8)).reduce(
    (s, b) => s + b.toString(16).padStart(2, "0"),
    "",
  );
}

function readVault(): VaultEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidVaultEntry);
  } catch {
    return [];
  }
}

function isValidVaultEntry(entry: unknown): entry is VaultEntry {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as VaultEntry;
  if (typeof e.id !== "string" || typeof e.label !== "string") return false;
  if (typeof e.createdAt !== "number" || !e.envelope) return false;
  const method = getEntryUnlockMethod(e);
  if (method === "passkey") {
    const p = e.passkey;
    if (
      !p ||
      typeof p.credentialId !== "string" ||
      typeof p.prfSalt !== "string" ||
      typeof p.rpId !== "string" ||
      typeof p.userId !== "string"
    ) {
      return false;
    }
  }
  return true;
}

function writeVault(entries: VaultEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function sanitizeKeysForStorage(keys: DecryptedKeys): string {
  const { view_tag: _legacyTag, ...sanitized } = keys;
  void _legacyTag;
  return JSON.stringify(sanitized);
}

function parseDecryptedKeys(plaintext: string): DecryptedKeys {
  return JSON.parse(plaintext) as DecryptedKeys;
}

export function getEntryUnlockMethod(entry: VaultEntry): VaultUnlockMethod {
  return entry.unlockMethod ?? "password";
}

export function isPasskeyVaultEntry(entry: VaultEntry): boolean {
  return getEntryUnlockMethod(entry) === "passkey";
}

/** List all stored entries (without decrypting). */
export function listVaultEntries(): VaultEntry[] {
  return readVault();
}

export function hasStoredKeys(): boolean {
  return readVault().length > 0;
}

/** Save keys under a label, encrypted with the given password. */
export async function saveToVault(
  keys: DecryptedKeys,
  label: string,
  password: string,
): Promise<string> {
  const plaintext = sanitizeKeysForStorage(keys);
  const envelope = await encryptWithPassword(plaintext, password);
  const entry: VaultEntry = {
    id: generateId(),
    label: label.trim() || "My Keys",
    createdAt: Date.now(),
    unlockMethod: "password",
    envelope,
  };
  const vault = readVault();
  vault.push(entry);
  writeVault(vault);
  return entry.id;
}

/**
 * Register a passkey and save keys encrypted with PRF-derived AES key.
 */
export async function saveToVaultWithPasskey(
  keys: DecryptedKeys,
  label: string,
): Promise<string> {
  const entryId = generateId();
  const plaintext = sanitizeKeysForStorage(keys);

  let aesKey: CryptoKey;
  let passkey: PasskeyVaultMeta;
  try {
    const registration = await registerVaultPasskey(label, entryId);
    aesKey = registration.aesKey;
    passkey = registration.meta;
  } catch (err) {
    if (err instanceof PasskeyVaultError) throw err;
    throw new PasskeyVaultError(
      "REGISTRATION_FAILED",
      err instanceof Error ? err.message : "Passkey registration failed.",
      err,
    );
  }

  try {
    const envelope = await encryptWithAesKey(plaintext, aesKey);
    const entry: VaultEntry = {
      id: entryId,
      label: label.trim() || "My Keys",
      createdAt: Date.now(),
      unlockMethod: "passkey",
      envelope,
      passkey,
    };
    const vault = readVault();
    vault.push(entry);
    writeVault(vault);
    return entry.id;
  } finally {
    // Best-effort: drop reference to derived key (JS cannot zero CryptoKey material).
    void aesKey;
  }
}

/** Decrypt a password-protected vault entry. Throws on wrong password. */
export async function unlockEntry(
  id: string,
  password: string,
): Promise<DecryptedKeys> {
  const entry = readVault().find((e) => e.id === id);
  if (!entry) throw new VaultError("Key entry not found", "ENTRY_NOT_FOUND");
  if (getEntryUnlockMethod(entry) === "passkey") {
    throw new VaultError(
      "This entry requires a passkey to unlock, not a password.",
      "PASSWORD_REQUIRED",
    );
  }
  const plaintext = await decryptWithPassword(entry.envelope, password);
  return parseDecryptedKeys(plaintext);
}

/** Decrypt a passkey-protected vault entry (triggers WebAuthn). */
export async function unlockPasskeyEntry(id: string): Promise<DecryptedKeys> {
  const entry = readVault().find((e) => e.id === id);
  if (!entry) throw new VaultError("Key entry not found", "ENTRY_NOT_FOUND");
  if (getEntryUnlockMethod(entry) !== "passkey" || !entry.passkey) {
    throw new VaultError("This entry is not passkey-protected.", "INVALID_ENTRY");
  }

  const aesKey = await deriveVaultAesKeyFromPasskey(entry.passkey);
  try {
    const plaintext = await decryptWithAesKey(entry.envelope, aesKey);
    return parseDecryptedKeys(plaintext);
  } catch {
    throw new VaultError(
      "Vault data could not be decrypted. The passkey may not match this entry.",
      "INVALID_ENTRY",
    );
  }
}

/**
 * Unlock any vault entry using the correct method for that entry.
 * Password is required only for password entries.
 */
export async function unlockVaultEntry(
  id: string,
  password?: string,
): Promise<DecryptedKeys> {
  const entry = readVault().find((e) => e.id === id);
  if (!entry) throw new VaultError("Key entry not found", "ENTRY_NOT_FOUND");

  if (getEntryUnlockMethod(entry) === "passkey") {
    return unlockPasskeyEntry(id);
  }
  if (!password?.length) {
    throw new VaultError("Password is required for this vault entry.", "PASSWORD_REQUIRED");
  }
  return unlockEntry(id, password);
}

export function removeEntry(id: string): void {
  const vault = readVault().filter((e) => e.id !== id);
  writeVault(vault);
}

export function clearVault(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export { PasskeyVaultError } from "./passkeyVault";
export { isPasskeyVaultSupported, formatVaultUnlockError } from "./passkeyVault";
