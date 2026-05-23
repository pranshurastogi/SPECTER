/**
 * Session-scoped payment history.
 *
 * Tracks both fully-published payments and "sent but not yet published"
 * payments so the user always sees a true picture of what they've done.
 * Entries are keyed by `txHash` so retries / status flips are idempotent.
 *
 * Storage: `sessionStorage` (intentionally — this is a transient device
 * log, not a persistent ledger). Persistent recovery lives in
 * `pendingPayment.ts` and uses `localStorage`.
 *
 * Backwards compatibility: pre-existing entries without `status` are
 * normalised to `published` on read so older sessions render correctly.
 */

const STORAGE_KEY = "specter_payment_history";
const MAX_ENTRIES = 10;

export type PaymentHistoryStatus = "sent_unpublished" | "published";

export interface PaymentEntry {
  recipient: string;
  chain: "ethereum" | "sui";
  amount: string;
  txHash: string;
  announcementId: number | null;
  timestamp: number;
  /**
   * Lifecycle status.
   * - `sent_unpublished` — on-chain tx confirmed, registry publish pending.
   * - `published` — registry has the announcement (recipient can discover).
   * Defaults to `published` for legacy entries written before this field existed.
   */
  status?: PaymentHistoryStatus;
  /** Server payment_id when known (lets us retry publish without re-sending). */
  payment_id?: string;
  /** Stealth address funds were sent to (display + verification). */
  stealth_address?: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function logWarn(msg: string, err?: unknown) {
  console.warn(`[paymentHistory] ${msg}`, err ?? "");
}

function normalise(entry: PaymentEntry): PaymentEntry {
  return {
    ...entry,
    status: entry.status ?? "published",
  };
}

export function getPaymentHistory(): PaymentEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((e) => normalise(e as PaymentEntry));
  } catch (err) {
    logWarn("Failed to parse history; treating as empty.", err);
    return [];
  }
}

function writeHistory(entries: PaymentEntry[]): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch (err) {
    logWarn("Failed to persist history.", err);
  }
}

/**
 * Add or update an entry. If an entry with the same `txHash` already
 * exists it is updated in place (preserves chronological position only
 * when status moves *forward* — otherwise it floats to the top).
 */
export function addPaymentEntry(entry: Omit<PaymentEntry, "timestamp">): PaymentEntry {
  const now = Date.now();
  const newEntry: PaymentEntry = normalise({ ...entry, timestamp: now });
  const existing = getPaymentHistory();
  const idx = existing.findIndex((e) => e.txHash && e.txHash === entry.txHash);

  let updated: PaymentEntry[];
  if (idx >= 0) {
    const prior = existing[idx];
    const merged: PaymentEntry = {
      ...prior,
      ...newEntry,
      // Preserve the original timestamp so status updates don't shuffle the row.
      timestamp: prior.timestamp,
    };
    updated = [...existing];
    updated[idx] = merged;
  } else {
    updated = [newEntry, ...existing];
  }

  writeHistory(updated);
  return newEntry;
}

/**
 * Patch an existing entry by `txHash`. No-op if the entry is missing.
 * Use this to flip `sent_unpublished` → `published` after a retry.
 */
export function updatePaymentEntryByTxHash(
  txHash: string,
  patch: Partial<Omit<PaymentEntry, "txHash" | "timestamp">>,
): PaymentEntry | null {
  if (!txHash) return null;
  const all = getPaymentHistory();
  const idx = all.findIndex((e) => e.txHash === txHash);
  if (idx < 0) return null;
  const merged: PaymentEntry = normalise({ ...all[idx], ...patch });
  all[idx] = merged;
  writeHistory(all);
  return merged;
}

export function clearPaymentHistory(): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    logWarn("Failed to clear history.", err);
  }
}
