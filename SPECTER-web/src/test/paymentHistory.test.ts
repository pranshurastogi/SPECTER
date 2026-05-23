import { describe, it, expect, beforeEach } from "vitest";
import {
  getPaymentHistory,
  addPaymentEntry,
  updatePaymentEntryByTxHash,
  clearPaymentHistory,
  type PaymentEntry,
} from "@/lib/paymentHistory";

const baseEntry: Omit<PaymentEntry, "timestamp"> = {
  recipient: "vitalik.eth",
  chain: "ethereum",
  amount: "0.1",
  txHash: "0xabc123",
  announcementId: 42,
};

beforeEach(() => {
  sessionStorage.clear();
});

describe("getPaymentHistory", () => {
  it("returns empty array when storage is empty", () => {
    expect(getPaymentHistory()).toEqual([]);
  });

  it("returns empty array when stored value is malformed JSON", () => {
    sessionStorage.setItem("specter_payment_history", "not-json{");
    expect(getPaymentHistory()).toEqual([]);
  });

  it("returns empty array when stored value is non-array JSON", () => {
    sessionStorage.setItem("specter_payment_history", JSON.stringify({ x: 1 }));
    expect(getPaymentHistory()).toEqual([]);
  });

  it("backfills missing status to 'published' (legacy entries)", () => {
    sessionStorage.setItem(
      "specter_payment_history",
      JSON.stringify([
        {
          recipient: "old.eth",
          chain: "ethereum",
          amount: "1",
          txHash: "0xold",
          announcementId: 1,
          timestamp: 1,
        },
      ]),
    );
    const [entry] = getPaymentHistory();
    expect(entry.status).toBe("published");
  });
});

describe("addPaymentEntry", () => {
  it("adds an entry with a timestamp", () => {
    addPaymentEntry(baseEntry);
    const history = getPaymentHistory();
    expect(history).toHaveLength(1);
    expect(history[0].recipient).toBe("vitalik.eth");
    expect(history[0].timestamp).toBeGreaterThan(0);
  });

  it("defaults status to 'published'", () => {
    addPaymentEntry(baseEntry);
    expect(getPaymentHistory()[0].status).toBe("published");
  });

  it("respects an explicit 'sent_unpublished' status", () => {
    addPaymentEntry({ ...baseEntry, status: "sent_unpublished" });
    expect(getPaymentHistory()[0].status).toBe("sent_unpublished");
  });

  it("prepends new entries (most recent first)", () => {
    addPaymentEntry({ ...baseEntry, txHash: "0xfirst" });
    addPaymentEntry({ ...baseEntry, txHash: "0xsecond" });
    const history = getPaymentHistory();
    expect(history[0].txHash).toBe("0xsecond");
    expect(history[1].txHash).toBe("0xfirst");
  });

  it("caps history at 10 entries", () => {
    for (let i = 0; i < 15; i++) {
      addPaymentEntry({ ...baseEntry, txHash: `0x${i}` });
    }
    expect(getPaymentHistory()).toHaveLength(10);
  });

  it("merges in-place when re-adding the same txHash (no duplicates)", () => {
    addPaymentEntry({ ...baseEntry, status: "sent_unpublished", announcementId: null });
    addPaymentEntry({ ...baseEntry, status: "published", announcementId: 99 });
    const all = getPaymentHistory();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("published");
    expect(all[0].announcementId).toBe(99);
  });

  it("preserves the original timestamp on in-place merge", () => {
    addPaymentEntry({ ...baseEntry, status: "sent_unpublished" });
    const tsBefore = getPaymentHistory()[0].timestamp;
    addPaymentEntry({ ...baseEntry, status: "published" });
    const tsAfter = getPaymentHistory()[0].timestamp;
    expect(tsAfter).toBe(tsBefore);
  });

  it("persists optional payment_id and stealth_address", () => {
    addPaymentEntry({
      ...baseEntry,
      payment_id: "pid-1",
      stealth_address: "0xstealth",
    });
    const e = getPaymentHistory()[0];
    expect(e.payment_id).toBe("pid-1");
    expect(e.stealth_address).toBe("0xstealth");
  });
});

describe("updatePaymentEntryByTxHash", () => {
  it("flips status sent_unpublished → published", () => {
    addPaymentEntry({ ...baseEntry, status: "sent_unpublished", announcementId: null });
    const updated = updatePaymentEntryByTxHash(baseEntry.txHash, {
      status: "published",
      announcementId: 7,
    });
    expect(updated?.status).toBe("published");
    expect(updated?.announcementId).toBe(7);
    expect(getPaymentHistory()[0].status).toBe("published");
  });

  it("returns null for missing tx hash", () => {
    expect(updatePaymentEntryByTxHash("0xnope", { status: "published" })).toBeNull();
  });

  it("returns null for empty tx hash", () => {
    expect(updatePaymentEntryByTxHash("", { status: "published" })).toBeNull();
  });
});

describe("clearPaymentHistory", () => {
  it("removes all entries", () => {
    addPaymentEntry(baseEntry);
    clearPaymentHistory();
    expect(getPaymentHistory()).toEqual([]);
  });
});
