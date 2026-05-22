import { describe, it, expect, beforeEach } from "vitest";
import {
  getPaymentHistory,
  addPaymentEntry,
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
});

describe("addPaymentEntry", () => {
  it("adds an entry with a timestamp", () => {
    addPaymentEntry(baseEntry);
    const history = getPaymentHistory();
    expect(history).toHaveLength(1);
    expect(history[0].recipient).toBe("vitalik.eth");
    expect(history[0].timestamp).toBeGreaterThan(0);
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
});

describe("clearPaymentHistory", () => {
  it("removes all entries", () => {
    addPaymentEntry(baseEntry);
    clearPaymentHistory();
    expect(getPaymentHistory()).toEqual([]);
  });
});
