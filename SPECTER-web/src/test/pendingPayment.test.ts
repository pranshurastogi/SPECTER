import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  savePending,
  markSent,
  markPublishFailed,
  markPublished,
  clearPending,
  clearAllPending,
  getPending,
  getAllPending,
  getActivePending,
  getPendingByTxHash,
  buildRecoveryJson,
  hasIncompletePending,
  purgeExpired,
  __internal,
  type PendingPaymentRecord,
} from "@/lib/pendingPayment";
import type { AnnouncementDto } from "@/lib/api";

function freshAnnouncement(overrides: Partial<AnnouncementDto> = {}): AnnouncementDto {
  return {
    id: 1,
    ephemeral_key: "0xdeadbeef",
    view_tag: 7,
    timestamp: 1_700_000_000,
    ...overrides,
  };
}

function baseInput(payment_id = "p-1") {
  return {
    payment_id,
    recipient: "bob.eth",
    meta_address: "0xabc",
    stealth_address: "0x" + "1".repeat(40),
    stealth_sui_address: "0x" + "2".repeat(64),
    announcement: freshAnnouncement(),
    chain: "ethereum" as const,
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("savePending", () => {
  it("stores a brand new record with sane defaults", () => {
    const rec = savePending(baseInput());
    expect(rec.status).toBe("awaiting_send");
    expect(rec.publish_attempts).toBe(0);
    expect(rec.schema_version).toBe(1);
    expect(rec.created_at).toBeGreaterThan(0);
    expect(rec.updated_at).toBe(rec.created_at);
  });

  it("is idempotent on same payment_id (merges, does not duplicate)", () => {
    const first = savePending(baseInput());
    const second = savePending({ ...baseInput(), chain: "sui" });
    expect(second.payment_id).toBe(first.payment_id);
    expect(second.chain).toBe("sui");
    expect(getAllPending()).toHaveLength(1);
  });

  it("does not regress server-built fields when called with empty strings", () => {
    savePending(baseInput());
    const merged = savePending({
      ...baseInput(),
      stealth_address: "",
      stealth_sui_address: "",
    });
    expect(merged.stealth_address).toBe(baseInput().stealth_address);
    expect(merged.stealth_sui_address).toBe(baseInput().stealth_sui_address);
  });

  it("stores multiple distinct payment_ids", () => {
    savePending(baseInput("a"));
    savePending(baseInput("b"));
    savePending(baseInput("c"));
    expect(getAllPending().map((r) => r.payment_id).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("getPending / getAllPending / getActivePending", () => {
  it("returns null when missing", () => {
    expect(getPending("nope")).toBeNull();
  });

  it("returns newest-first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    savePending(baseInput("a"));
    vi.setSystemTime(new Date("2026-01-01T00:00:01Z"));
    savePending(baseInput("b"));
    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
    savePending(baseInput("c"));
    const all = getAllPending();
    expect(all.map((r) => r.payment_id)).toEqual(["c", "b", "a"]);
  });

  it("getActivePending excludes published records", () => {
    savePending(baseInput("p-active"));
    savePending(baseInput("p-done"));
    markPublished("p-done");
    const active = getActivePending();
    expect(active.map((r) => r.payment_id)).toEqual(["p-active"]);
  });
});

describe("markSent", () => {
  it("advances status to sent_unpublished and stores tx_hash + chain", () => {
    savePending(baseInput());
    const rec = markSent("p-1", { tx_hash: "0xtx", chain: "sui", amount: "0.5" });
    expect(rec).not.toBeNull();
    expect(rec?.status).toBe("sent_unpublished");
    expect(rec?.tx_hash).toBe("0xtx");
    expect(rec?.chain).toBe("sui");
    expect(rec?.amount).toBe("0.5");
  });

  it("returns null when the payment_id is unknown", () => {
    expect(markSent("ghost", { tx_hash: "0x", chain: "ethereum" })).toBeNull();
  });
});

describe("markPublishFailed", () => {
  it("increments publish_attempts and stores truncated error", () => {
    savePending(baseInput());
    markSent("p-1", { tx_hash: "0xtx", chain: "ethereum" });
    const long = "x".repeat(500);
    const rec = markPublishFailed("p-1", long);
    expect(rec?.publish_attempts).toBe(1);
    expect(rec?.last_publish_error?.length).toBe(240);

    const rec2 = markPublishFailed("p-1", "second");
    expect(rec2?.publish_attempts).toBe(2);
    expect(rec2?.last_publish_error).toBe("second");
  });

  it("returns null for missing record", () => {
    expect(markPublishFailed("ghost", "err")).toBeNull();
  });
});

describe("markPublished", () => {
  it("flips status to published and clears last_publish_error", () => {
    savePending(baseInput());
    markPublishFailed("p-1", "boom");
    const rec = markPublished("p-1");
    expect(rec?.status).toBe("published");
    expect(rec?.last_publish_error).toBeUndefined();
  });
});

describe("clearPending / clearAllPending", () => {
  it("clearPending removes one record", () => {
    savePending(baseInput("a"));
    savePending(baseInput("b"));
    clearPending("a");
    expect(getAllPending().map((r) => r.payment_id)).toEqual(["b"]);
  });

  it("clearPending is a no-op for missing id", () => {
    savePending(baseInput("a"));
    clearPending("nope");
    expect(getAllPending()).toHaveLength(1);
  });

  it("clearAllPending wipes the vault", () => {
    savePending(baseInput("a"));
    savePending(baseInput("b"));
    clearAllPending();
    expect(getAllPending()).toEqual([]);
  });
});

describe("hasIncompletePending", () => {
  it("returns false when empty", () => {
    expect(hasIncompletePending()).toBe(false);
  });

  it("returns true while a record is awaiting_send", () => {
    savePending(baseInput());
    expect(hasIncompletePending()).toBe(true);
  });

  it("returns false after the last record is published (within 30m)", () => {
    savePending(baseInput("p-only"));
    markPublished("p-only");
    expect(hasIncompletePending()).toBe(false);
  });
});

describe("getPendingByTxHash", () => {
  it("finds a record by tx hash (case-insensitive)", () => {
    savePending(baseInput("p-1"));
    markSent("p-1", { tx_hash: "0xAbCd1234", chain: "ethereum" });
    expect(getPendingByTxHash("0xabcd1234")?.payment_id).toBe("p-1");
    expect(getPendingByTxHash("0xABCD1234")?.payment_id).toBe("p-1");
  });

  it("returns null for unknown hash", () => {
    savePending(baseInput("p-1"));
    expect(getPendingByTxHash("0xnope")).toBeNull();
  });

  it("returns null when tx hash empty", () => {
    expect(getPendingByTxHash("")).toBeNull();
  });
});

describe("buildRecoveryJson", () => {
  it("includes the _specter envelope + all critical fields", () => {
    const rec = savePending(baseInput());
    const json = buildRecoveryJson(rec);
    expect(json._specter.kind).toBe("specter.payment.recovery");
    expect(json._specter.version).toBe(1);
    expect(json.payment_id).toBe(rec.payment_id);
    expect(json.announcement).toEqual(rec.announcement);
    expect(json.meta_address).toBe(rec.meta_address);
    expect(json.stealth_address).toBe(rec.stealth_address);
  });
});

describe("TTL + pruning", () => {
  it("drops records older than TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    savePending(baseInput("old"));
    vi.setSystemTime(new Date("2026-01-09T00:00:00Z")); // > 7 days
    savePending(baseInput("fresh"));
    purgeExpired();
    expect(getAllPending().map((r) => r.payment_id)).toEqual(["fresh"]);
  });

  it("drops published records after 30 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    savePending(baseInput("done"));
    markPublished("done");
    vi.setSystemTime(new Date("2026-01-01T00:31:00Z"));
    purgeExpired();
    expect(getAllPending()).toEqual([]);
  });

  it("enforces MAX_ENTRIES cap, dropping oldest by updated_at", () => {
    vi.useFakeTimers();
    for (let i = 0; i < __internal.MAX_ENTRIES + 5; i++) {
      vi.setSystemTime(new Date(2026, 0, 1, 0, 0, i));
      savePending(baseInput(`p-${i}`));
    }
    const all = getAllPending();
    expect(all.length).toBe(__internal.MAX_ENTRIES);
    // newest survives, oldest dropped
    expect(all[0].payment_id).toBe(`p-${__internal.MAX_ENTRIES + 4}`);
    expect(all.find((r) => r.payment_id === "p-0")).toBeUndefined();
  });
});

describe("robustness: malformed storage", () => {
  it("treats junk JSON as empty without throwing", () => {
    localStorage.setItem(__internal.STORAGE_KEY, "{ not json");
    expect(() => getAllPending()).not.toThrow();
    expect(getAllPending()).toEqual([]);
  });

  it("rejects wrong schema_version and resets", () => {
    localStorage.setItem(
      __internal.STORAGE_KEY,
      JSON.stringify({ version: 99, records: {} }),
    );
    expect(getAllPending()).toEqual([]);
  });

  it("rejects non-object records and resets", () => {
    localStorage.setItem(
      __internal.STORAGE_KEY,
      JSON.stringify({ version: 1, records: null }),
    );
    expect(getAllPending()).toEqual([]);
  });

  it("survives a localStorage quota error during write", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      // savePending must not throw even though writes fail.
      const rec = savePending(baseInput());
      expect(rec.payment_id).toBe("p-1");
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("end-to-end happy path", () => {
  it("walks awaiting_send → sent_unpublished → published with no data loss", () => {
    const rec0 = savePending(baseInput());
    expect(rec0.status).toBe("awaiting_send");

    const rec1 = markSent("p-1", {
      tx_hash: "0xtx",
      chain: "ethereum",
      amount: "0.42",
    });
    expect(rec1?.status).toBe("sent_unpublished");
    expect(rec1?.tx_hash).toBe("0xtx");

    const rec2 = markPublished("p-1");
    expect(rec2?.status).toBe("published");
    expect(rec2?.tx_hash).toBe("0xtx");
    expect(rec2?.amount).toBe("0.42");
    expect(rec2?.announcement).toEqual(rec0.announcement);
  });
});

describe("contract: nothing secret is persisted", () => {
  it("the persisted record exposes only public fields", () => {
    const rec = savePending(baseInput());
    const stored = JSON.parse(localStorage.getItem(__internal.STORAGE_KEY)!);
    const inner = stored.records[rec.payment_id] as PendingPaymentRecord;
    const keys = Object.keys(inner).sort();
    // None of viewing_sk / spending_sk / mnemonic / private_key
    for (const k of keys) {
      expect(k).not.toMatch(/sk|secret|mnemonic|private/i);
    }
  });
});
