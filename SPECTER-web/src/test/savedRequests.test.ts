import { describe, it, expect, beforeEach } from "vitest";
import {
  getSavedRequests,
  addSavedRequest,
  removeSavedRequest,
  updateSavedRequestStatus,
  clearSavedRequests,
} from "@/lib/savedRequests";

beforeEach(() => localStorage.clear());

describe("savedRequests", () => {
  it("starts empty", () => {
    expect(getSavedRequests()).toEqual([]);
  });
  it("adds a request with id, createdAt and open status, newest first", () => {
    const a = addSavedRequest({ recipient: "alice.eth", amount: "50", chain: "sui" });
    const b = addSavedRequest({ recipient: "alice.eth", amount: "10" });
    expect(a.id).toBeTruthy();
    expect(a.status).toBe("open");
    expect(typeof a.createdAt).toBe("number");
    const all = getSavedRequests();
    expect(all.map((r) => r.id)).toEqual([b.id, a.id]);
  });
  it("removes by id", () => {
    const a = addSavedRequest({ recipient: "alice.eth" });
    removeSavedRequest(a.id);
    expect(getSavedRequests()).toEqual([]);
  });
  it("updates status", () => {
    const a = addSavedRequest({ recipient: "alice.eth" });
    updateSavedRequestStatus(a.id, "paid");
    expect(getSavedRequests()[0].status).toBe("paid");
  });
  it("clears all", () => {
    addSavedRequest({ recipient: "alice.eth" });
    clearSavedRequests();
    expect(getSavedRequests()).toEqual([]);
  });
});
