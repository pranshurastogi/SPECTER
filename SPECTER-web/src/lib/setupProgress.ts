const STORAGE_KEY = "specter_setup_progress";

export interface SetupProgress {
  keysGenerated: boolean;
  ensAttached: boolean;
  suinsAttached: boolean;
  ensName?: string;
  suinsName?: string;
  startedAt: number;
}

function read(): SetupProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SetupProgress;
  } catch {
    return null;
  }
}

export function getSetupProgress(): SetupProgress | null {
  return read();
}

export function saveSetupProgress(update: Partial<SetupProgress>): void {
  try {
    const existing = read() ?? {
      keysGenerated: false,
      ensAttached: false,
      suinsAttached: false,
      startedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, ...update }));
  } catch {
    // localStorage unavailable — silently skip
  }
}

export function clearSetupProgress(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable — silently skip
  }
}

export function isSetupInProgress(): boolean {
  const p = read();
  return p !== null && p.keysGenerated;
}

/** The user's registered name for building their pay link. ENS takes precedence. */
export function getRegisteredName(): string | null {
  const p = read();
  return p?.ensName ?? p?.suinsName ?? null;
}
