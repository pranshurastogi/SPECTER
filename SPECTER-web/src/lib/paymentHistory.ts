/**
 * Session-based payment history.
 * Uses sessionStorage so entries are cleared when the browser tab closes.
 */

const STORAGE_KEY = "specter_payment_history";
const MAX_ENTRIES = 10;

export interface PaymentEntry {
  recipient: string;
  chain: "ethereum" | "sui";
  amount: string;
  txHash: string;
  announcementId: number | null;
  timestamp: number;
}

export function getPaymentHistory(): PaymentEntry[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addPaymentEntry(entry: Omit<PaymentEntry, "timestamp">): void {
  try {
    const existing = getPaymentHistory();
    const updated = [{ ...entry, timestamp: Date.now() }, ...existing].slice(
      0,
      MAX_ENTRIES,
    );
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // sessionStorage unavailable — silently skip
  }
}

export function clearPaymentHistory(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}
