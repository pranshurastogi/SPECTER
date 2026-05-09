import { describe, it, expect, beforeEach } from "vitest";
import {
  getRecentRecipients,
  addRecentRecipient,
  clearRecentRecipients,
} from "@/lib/recentRecipients";

beforeEach(() => {
  localStorage.clear();
});

describe("getRecentRecipients", () => {
  it("returns empty array when storage is empty", () => {
    expect(getRecentRecipients()).toEqual([]);
  });

  it("returns empty array when stored value is non-array JSON", () => {
    localStorage.setItem("specter_recent_recipients", JSON.stringify("oops"));
    expect(getRecentRecipients()).toEqual([]);
  });
});

describe("addRecentRecipient", () => {
  it("adds a new recipient with a resolvedAt timestamp", () => {
    addRecentRecipient("vitalik.eth");
    const result = getRecentRecipients();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("vitalik.eth");
    expect(result[0].resolvedAt).toBeGreaterThan(0);
  });

  it("deduplicates: re-adding moves entry to front", () => {
    addRecentRecipient("alice.eth");
    addRecentRecipient("bob.eth");
    addRecentRecipient("alice.eth");
    const result = getRecentRecipients();
    expect(result[0].name).toBe("alice.eth");
    expect(result.filter((r) => r.name === "alice.eth")).toHaveLength(1);
  });

  it("caps list at 5 entries", () => {
    for (let i = 0; i < 8; i++) {
      addRecentRecipient(`user${i}.eth`);
    }
    expect(getRecentRecipients()).toHaveLength(5);
  });
});

describe("clearRecentRecipients", () => {
  it("removes all entries", () => {
    addRecentRecipient("vitalik.eth");
    clearRecentRecipients();
    expect(getRecentRecipients()).toEqual([]);
  });
});
