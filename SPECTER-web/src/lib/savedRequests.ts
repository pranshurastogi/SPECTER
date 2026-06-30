import type { TxChain } from "@/lib/blockchain/sendChains";

const STORAGE_KEY = "specter_saved_requests";
const MAX = 50;

export interface SavedRequest {
  id: string;
  recipient: string;
  amount?: string;
  chain?: TxChain;
  label?: string;
  memo?: string;
  createdAt: number;
  status: "open" | "paid";
}

function read(): SavedRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedRequest[]) : [];
  } catch {
    return [];
  }
}

function write(list: SavedRequest[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // localStorage unavailable — silently skip
  }
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getSavedRequests(): SavedRequest[] {
  return read();
}

export function addSavedRequest(
  input: Omit<SavedRequest, "id" | "createdAt" | "status">
): SavedRequest {
  const entry: SavedRequest = { ...input, id: newId(), createdAt: Date.now(), status: "open" };
  write([entry, ...read()]);
  return entry;
}

export function removeSavedRequest(id: string): void {
  write(read().filter((r) => r.id !== id));
}

export function updateSavedRequestStatus(id: string, status: SavedRequest["status"]): void {
  write(read().map((r) => (r.id === id ? { ...r, status } : r)));
}

export function clearSavedRequests(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
