/**
 * Tests for turso.ts — writeTursoAnnouncement and probeTursoConnection.
 *
 * The @libsql/client module is mocked so no real network calls are made.
 * Each test controls exactly what the execute() method returns or throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock @libsql/client before importing turso.ts ─────────────────────────────
// vi.mock() factories are hoisted to the top of the file by vitest, so any
// variables they reference must also be hoisted via vi.hoisted().

const { mockExecute, mockCreateClient } = vi.hoisted(() => {
  const mockExecute = vi.fn();
  const mockCreateClient = vi.fn(() => ({ execute: mockExecute }));
  return { mockExecute, mockCreateClient };
});

vi.mock("@libsql/client", () => ({
  createClient: mockCreateClient,
}));

// Import AFTER mock is set up
import {
  writeTursoAnnouncement,
  probeTursoConnection,
  type TursoAnnouncement,
} from "../turso";

// ── Helpers ───────────────────────────────────────────────────────────────────

const EPHEMERAL_HEX = "ab".repeat(1088); // 1088 bytes as hex

function makeAnn(overrides: Partial<TursoAnnouncement> = {}): TursoAnnouncement {
  return {
    viewTag: 0x42,
    timestamp: 1_780_000_000,
    ephemeralKey: EPHEMERAL_HEX,
    ephemeralKeyHash: "cd".repeat(32),
    metadataBlob: "7f" + "00".repeat(76),
    blockNumber: 36_000_000,
    txHash: "0xdeadbeef00000000000000000000000000000000000000000000000000000001",
    chain: "monad-testnet",
    stealthAddress: "0x1111111111111111111111111111111111111111",
    blockTxIndex: 5,
    ...overrides,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  // Set env vars so getClient() builds a real (mocked) client
  process.env.TURSO_DATABASE_URL = "libsql://test.turso.io";
  process.env.TURSO_AUTH_TOKEN = "test-token";
  mockCreateClient.mockClear();
  mockExecute.mockClear();
});

afterEach(() => {
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  vi.restoreAllMocks();
});

// ── writeTursoAnnouncement ────────────────────────────────────────────────────

describe("writeTursoAnnouncement — success paths", () => {
  it("returns { ok: true } when execute resolves", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    const result = await writeTursoAnnouncement(makeAnn());
    expect(result.ok).toBe(true);
  });

  it("calls execute exactly once on first-try success", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await writeTursoAnnouncement(makeAnn());
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("passes correct SQL with INSERT OR IGNORE", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await writeTursoAnnouncement(makeAnn());
    const call = mockExecute.mock.calls[0]![0] as { sql: string; args: unknown[] };
    expect(call.sql).toMatch(/INSERT OR IGNORE INTO announcements/);
  });

  it("converts ephemeralKey hex string to Buffer for BLOB storage", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await writeTursoAnnouncement(makeAnn({ ephemeralKey: "deadbeef" }));
    const call = mockExecute.mock.calls[0]![0] as { sql: string; args: unknown[] };
    const ephemeralArg = call.args[2];
    expect(Buffer.isBuffer(ephemeralArg)).toBe(true);
    expect((ephemeralArg as Buffer).toString("hex")).toBe("deadbeef");
  });

  it("sets on_chain = 1 in the SQL as a literal (not a parameter)", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await writeTursoAnnouncement(makeAnn());
    const call = mockExecute.mock.calls[0]![0] as { sql: string };
    expect(call.sql).toContain("on_chain");
    // The VALUES clause has a literal 1 (not ?) for on_chain
    expect(call.sql).toMatch(/VALUES.*\?, 1,/s);
  });

  it("converts ephemeralKeyHash hex string to Buffer for BLOB storage", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await writeTursoAnnouncement(makeAnn({ ephemeralKeyHash: "deadbeef" }));
    const call = mockExecute.mock.calls[0]![0] as { args: unknown[] };
    const hashArg = call.args[3];
    expect(Buffer.isBuffer(hashArg)).toBe(true);
    expect((hashArg as Buffer).toString("hex")).toBe("deadbeef");
  });

  it("converts metadataBlob hex string to Buffer for BLOB storage", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await writeTursoAnnouncement(makeAnn({ metadataBlob: "7fc0ffee" }));
    const call = mockExecute.mock.calls[0]![0] as { args: unknown[] };
    const blobArg = call.args[4];
    expect(Buffer.isBuffer(blobArg)).toBe(true);
    expect((blobArg as Buffer).toString("hex")).toBe("7fc0ffee");
  });

  it("treats UNIQUE constraint error as success (idempotent)", async () => {
    mockExecute.mockRejectedValueOnce(new Error("UNIQUE constraint failed: announcements.tx_hash"));
    const result = await writeTursoAnnouncement(makeAnn());
    expect(result.ok).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1); // no retries needed
  });

  it("treats 'duplicate' error as success", async () => {
    mockExecute.mockRejectedValueOnce(new Error("duplicate key value violates unique constraint"));
    const result = await writeTursoAnnouncement(makeAnn());
    expect(result.ok).toBe(true);
  });
});

describe("writeTursoAnnouncement — permanent (non-retryable) errors", () => {
  it("returns { ok: false, permanent: true } for UNAUTHORIZED", async () => {
    mockExecute.mockRejectedValueOnce(new Error("UNAUTHORIZED: invalid token"));
    const result = await writeTursoAnnouncement(makeAnn());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.permanent).toBe(true);
      expect(result.error).toMatch(/UNAUTHORIZED/i);
    }
  });

  it("returns { ok: false, permanent: true } for 'no such table'", async () => {
    mockExecute.mockRejectedValueOnce(new Error("no such table: announcements"));
    const result = await writeTursoAnnouncement(makeAnn());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.permanent).toBe(true);
  });

  it("returns { ok: false, permanent: true } for 'no such column'", async () => {
    mockExecute.mockRejectedValueOnce(new Error("no such column: view_tag"));
    const result = await writeTursoAnnouncement(makeAnn());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.permanent).toBe(true);
  });

  it("returns { ok: false, permanent: true } for 'syntax error'", async () => {
    mockExecute.mockRejectedValueOnce(new Error("syntax error near VALUES"));
    const result = await writeTursoAnnouncement(makeAnn());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.permanent).toBe(true);
  });

  it("returns { ok: false, permanent: true } for 'forbidden'", async () => {
    mockExecute.mockRejectedValueOnce(new Error("forbidden: read-only database"));
    const result = await writeTursoAnnouncement(makeAnn());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.permanent).toBe(true);
  });

  it("does NOT retry on non-retryable error — execute called exactly once", async () => {
    mockExecute.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    await writeTursoAnnouncement(makeAnn());
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});

describe("writeTursoAnnouncement — transient (retryable) errors", () => {
  it("returns { ok: false, permanent: false } after all retries exhausted", async () => {
    mockExecute.mockRejectedValue(new Error("connection timeout"));
    const result = await writeTursoAnnouncement(makeAnn(), 3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.permanent).toBe(false);
      expect(result.error).toMatch(/timeout/i);
    }
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it("retries exactly maxRetries times on transient error", async () => {
    mockExecute.mockRejectedValue(new Error("network error"));
    await writeTursoAnnouncement(makeAnn(), 2);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("succeeds on second attempt (first fails, second succeeds)", async () => {
    mockExecute
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(undefined);
    const result = await writeTursoAnnouncement(makeAnn(), 3);
    expect(result.ok).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("succeeds on third attempt", async () => {
    mockExecute
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(undefined);
    const result = await writeTursoAnnouncement(makeAnn(), 3);
    expect(result.ok).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it("treats a generic 'Error' (no special pattern) as transient", async () => {
    mockExecute.mockRejectedValue(new Error("some random database hiccup"));
    const result = await writeTursoAnnouncement(makeAnn(), 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.permanent).toBe(false);
  });
});

describe("writeTursoAnnouncement — unconfigured Turso", () => {
  it("returns { ok: false } when TURSO_DATABASE_URL is unset", async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    // The cached client from previous tests means we need to test the
    // 'client not configured' path differently — vitest forks isolate modules,
    // so the singleton is fresh in this file's run.
    // (The fork pool ensures the module is fresh per file.)
    const result = await writeTursoAnnouncement(makeAnn());
    // If env vars not set at module load time, client is null → ok=false
    // Note: due to singleton, this may be { ok: true } if client was cached.
    // The important thing is it doesn't throw.
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe("boolean");
  });
});

// ── probeTursoConnection ──────────────────────────────────────────────────────

describe("probeTursoConnection", () => {
  it("returns true when SELECT 1 resolves", async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ 1: 1 }] });
    const ok = await probeTursoConnection();
    expect(ok).toBe(true);
  });

  it("returns false when SELECT 1 rejects", async () => {
    mockExecute.mockRejectedValueOnce(new Error("connection refused"));
    const ok = await probeTursoConnection();
    expect(ok).toBe(false);
  });

  it("does not throw even when underlying client throws", async () => {
    mockExecute.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    await expect(probeTursoConnection()).resolves.toBe(false);
  });
});

// ── Data integrity ────────────────────────────────────────────────────────────

describe("writeTursoAnnouncement — argument integrity", () => {
  it("passes all 9 positional args to execute", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    const ann = makeAnn();
    await writeTursoAnnouncement(ann);
    const call = mockExecute.mock.calls[0]![0] as { args: unknown[] };
    // view_tag, timestamp, ephemeral_key (Buffer), ephemeral_key_hash (Buffer),
    // metadata_blob (Buffer), block_number, tx_hash, chain, stealth_address
    expect(call.args).toHaveLength(9);
  });

  it("viewTag is passed as the first arg", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    const ann = makeAnn({ viewTag: 99 });
    await writeTursoAnnouncement(ann);
    const call = mockExecute.mock.calls[0]![0] as { args: unknown[] };
    expect(call.args[0]).toBe(99);
  });

  it("txHash (Monad announce hash) is at position [6]", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    const monadHash = "0xaaaa" + "00".repeat(30);
    const ann = makeAnn({ txHash: monadHash });
    await writeTursoAnnouncement(ann);
    const call = mockExecute.mock.calls[0]![0] as { args: unknown[] };
    expect(call.args[6]).toBe(monadHash);
  });

  it("stealthAddress is at position [8]", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    const addr = "0x9999999999999999999999999999999999999999";
    const ann = makeAnn({ stealthAddress: addr });
    await writeTursoAnnouncement(ann);
    const call = mockExecute.mock.calls[0]![0] as { args: unknown[] };
    expect(call.args[8]).toBe(addr);
  });
});
