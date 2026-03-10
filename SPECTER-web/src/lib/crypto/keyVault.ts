/**
 * Encrypted key vault backed by localStorage.
 *
 * Stores multiple named key sets as individually encrypted blobs.
 * Each entry: { label, createdAt, envelope }.
 * The master list is stored at STORAGE_KEY; each entry's `envelope`
 * is an AES-GCM ciphertext that can only be decrypted with the
 * password the user chose when saving.
 */

import {
  encryptWithPassword,
  decryptWithPassword,
  type EncryptedEnvelope,
} from "./keyCrypto";

const STORAGE_KEY = "specter_key_vault";

export interface VaultEntry {
  id: string;
  label: string;
  createdAt: number;
  envelope: EncryptedEnvelope;
}

export interface DecryptedKeys {
  spending_pk: string;
  spending_sk: string;
  viewing_pk: string;
  viewing_sk: string;
  meta_address: string;
  view_tag: number;
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
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeVault(entries: VaultEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/** List all stored entries (without decrypting). */
export function listVaultEntries(): VaultEntry[] {
  return readVault();
}

/** Check if the vault has any entries. */
export function hasStoredKeys(): boolean {
  return readVault().length > 0;
}

/** Save keys under a label, encrypted with the given password. Returns the new entry id. */
export async function saveToVault(
  keys: DecryptedKeys,
  label: string,
  password: string,
): Promise<string> {
  const plaintext = JSON.stringify(keys);
  const envelope = await encryptWithPassword(plaintext, password);
  const entry: VaultEntry = {
    id: generateId(),
    label: label.trim() || "My Keys",
    createdAt: Date.now(),
    envelope,
  };
  const vault = readVault();
  vault.push(entry);
  writeVault(vault);
  return entry.id;
}

/** Decrypt a specific vault entry by id. Throws on wrong password. */
export async function unlockEntry(
  id: string,
  password: string,
): Promise<DecryptedKeys> {
  const vault = readVault();
  const entry = vault.find((e) => e.id === id);
  if (!entry) throw new Error("Key entry not found");
  const plaintext = await decryptWithPassword(entry.envelope, password);
  return JSON.parse(plaintext) as DecryptedKeys;
}

/** Remove a single vault entry by id. */
export function removeEntry(id: string): void {
  const vault = readVault().filter((e) => e.id !== id);
  writeVault(vault);
}

/** Clear all stored keys. */
export function clearVault(): void {
  localStorage.removeItem(STORAGE_KEY);
}
