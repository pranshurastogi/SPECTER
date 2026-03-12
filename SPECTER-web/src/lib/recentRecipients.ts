const STORAGE_KEY = "specter_recent_recipients";
const MAX_ENTRIES = 5;

export interface RecentRecipient {
  name: string;
  resolvedAt: number;
}

export function getRecentRecipients(): RecentRecipient[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addRecentRecipient(name: string): void {
  try {
    const existing = getRecentRecipients().filter((r) => r.name !== name);
    const updated = [{ name, resolvedAt: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // silently skip
  }
}

export function clearRecentRecipients(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
