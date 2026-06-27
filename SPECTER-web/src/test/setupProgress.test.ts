import { describe, it, expect, beforeEach } from "vitest";
import {
  getSetupProgress,
  saveSetupProgress,
  clearSetupProgress,
  isSetupInProgress,
  getRegisteredName,
} from "@/lib/setupProgress";

beforeEach(() => {
  localStorage.clear();
});

describe("getSetupProgress", () => {
  it("returns null when no progress is stored", () => {
    expect(getSetupProgress()).toBeNull();
  });
});

describe("saveSetupProgress", () => {
  it("creates a new progress record with defaults for missing fields", () => {
    saveSetupProgress({ keysGenerated: true });
    const p = getSetupProgress();
    expect(p).not.toBeNull();
    expect(p!.keysGenerated).toBe(true);
    expect(p!.ensAttached).toBe(false);
    expect(p!.suinsAttached).toBe(false);
    expect(p!.startedAt).toBeGreaterThan(0);
  });

  it("merges partial updates into existing progress", () => {
    saveSetupProgress({ keysGenerated: true });
    saveSetupProgress({ ensAttached: true });
    const p = getSetupProgress();
    expect(p!.keysGenerated).toBe(true);
    expect(p!.ensAttached).toBe(true);
  });

  it("preserves startedAt across multiple saves", () => {
    saveSetupProgress({ keysGenerated: true });
    const first = getSetupProgress()!.startedAt;
    saveSetupProgress({ ensAttached: true });
    expect(getSetupProgress()!.startedAt).toBe(first);
  });
});

describe("clearSetupProgress", () => {
  it("removes stored progress", () => {
    saveSetupProgress({ keysGenerated: true });
    clearSetupProgress();
    expect(getSetupProgress()).toBeNull();
  });
});

describe("isSetupInProgress", () => {
  it("returns false when nothing is stored", () => {
    expect(isSetupInProgress()).toBe(false);
  });

  it("returns false when keys have not been generated", () => {
    saveSetupProgress({ keysGenerated: false });
    expect(isSetupInProgress()).toBe(false);
  });

  it("returns true once keys are generated", () => {
    saveSetupProgress({ keysGenerated: true });
    expect(isSetupInProgress()).toBe(true);
  });
});

describe("getRegisteredName", () => {
  beforeEach(() => localStorage.clear());
  it("returns null when nothing stored", () => {
    expect(getRegisteredName()).toBeNull();
  });
  it("returns the ENS name when present", () => {
    saveSetupProgress({ ensAttached: true, ensName: "alice.eth" });
    expect(getRegisteredName()).toBe("alice.eth");
  });
  it("falls back to the SuiNS name", () => {
    saveSetupProgress({ suinsAttached: true, suinsName: "bob.sui" });
    expect(getRegisteredName()).toBe("bob.sui");
  });
});
