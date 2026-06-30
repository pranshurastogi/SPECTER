/**
 * Local history of the *receiver's own* registered names entered in the
 * pay-link card. Kept separate from `recentRecipients` (people you pay) so the
 * two suggestion lists never bleed into each other. Mirrors the same
 * localStorage shape used across the Send section.
 */
const STORAGE_KEY = "specter_my_pay_names";
const MAX_ENTRIES = 5;

export interface MyPayName {
  name: string;
  usedAt: number;
}

export function getMyPayNames(): MyPayName[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addMyPayName(name: string): void {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return;
  try {
    const existing = getMyPayNames().filter((r) => r.name !== normalized);
    const updated = [{ name: normalized, usedAt: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // storage unavailable — silently skip
  }
}

export function clearMyPayNames(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable — silently skip
  }
}
