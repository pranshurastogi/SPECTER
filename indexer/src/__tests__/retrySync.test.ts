/**
 * Tests for retrySync.ts — CircuitBreaker state machine and mapEventToAnnouncement.
 *
 * writeTursoAnnouncement and probeTursoConnection are mocked so the retry logic
 * can be exercised without a real Turso connection or Envio GraphQL server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (before any import that transitively imports turso.ts) ───────────────

vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({ execute: vi.fn() })),
}));

import { CircuitBreaker, mapEventToAnnouncement, type UnsyncedEvent } from "../retrySync";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<UnsyncedEvent> = {}): UnsyncedEvent {
  return {
    id: "0xdeadbeef-5",
    viewTag: 0x42,
    stealthAddress: "0x1111111111111111111111111111111111111111",
    // 1088 bytes, no 0x prefix — correct ML-KEM ciphertext size
    ephemeralPubKey: "ab".repeat(1088),
    txHash: "0xfeedface00000000000000000000000000000000000000000000000000000002",
    sourceChainId: "42161",
    amount: "0x" + "00".repeat(31) + "01",
    blockNumber: "36000000",
    blockTimestamp: "1780000000",
    transactionHash: "0xdeadbeef00000000000000000000000000000000000000000000000000000001",
    logIndex: 5,
    ...overrides,
  };
}

// ── CircuitBreaker ────────────────────────────────────────────────────────────

describe("CircuitBreaker — initial state", () => {
  it("starts in closed state — canAttempt() = true", () => {
    const cb = new CircuitBreaker("test", 3, 60_000);
    expect(cb.canAttempt()).toBe(true);
  });

  it("isOpen = false when freshly created", () => {
    const cb = new CircuitBreaker("test", 3, 60_000);
    expect(cb.isOpen).toBe(false);
  });

  it("name is accessible", () => {
    const cb = new CircuitBreaker("my-service", 5, 10_000);
    expect(cb.name).toBe("my-service");
  });
});

describe("CircuitBreaker — success keeps circuit closed", () => {
  it("recordSuccess() on closed circuit stays closed", () => {
    const cb = new CircuitBreaker("test", 3, 60_000);
    cb.recordSuccess();
    expect(cb.isOpen).toBe(false);
    expect(cb.canAttempt()).toBe(true);
  });

  it("multiple successes keep circuit closed", () => {
    const cb = new CircuitBreaker("test", 3, 60_000);
    for (let i = 0; i < 10; i++) cb.recordSuccess();
    expect(cb.isOpen).toBe(false);
  });
});

describe("CircuitBreaker — failure threshold", () => {
  it("single failure below threshold keeps circuit closed", () => {
    const cb = new CircuitBreaker("test", 3, 60_000);
    cb.recordFailure();
    expect(cb.isOpen).toBe(false);
    expect(cb.canAttempt()).toBe(true);
  });

  it("failures below threshold stay closed", () => {
    const cb = new CircuitBreaker("test", 3, 60_000);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen).toBe(false);
  });

  it("failure count reaching threshold opens the circuit", () => {
    const cb = new CircuitBreaker("test", 3, 60_000);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure(); // threshold=3, now open
    expect(cb.isOpen).toBe(true);
    expect(cb.canAttempt()).toBe(false);
  });

  it("threshold=1 opens on first failure", () => {
    const cb = new CircuitBreaker("test", 1, 60_000);
    cb.recordFailure();
    expect(cb.isOpen).toBe(true);
  });

  it("threshold=10 requires 10 failures to open", () => {
    const cb = new CircuitBreaker("test", 10, 60_000);
    for (let i = 0; i < 9; i++) cb.recordFailure();
    expect(cb.isOpen).toBe(false);
    cb.recordFailure();
    expect(cb.isOpen).toBe(true);
  });

  it("success resets consecutive failure count before threshold", () => {
    const cb = new CircuitBreaker("test", 3, 60_000);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess(); // resets count
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen).toBe(false); // count reset to 0 on success → only 2 failures now
  });
});

describe("CircuitBreaker — open state", () => {
  it("canAttempt() returns false when open (before reset)", () => {
    const cb = new CircuitBreaker("test", 1, 60_000);
    cb.recordFailure();
    expect(cb.canAttempt()).toBe(false);
  });

  it("stays open when called repeatedly within resetMs", () => {
    const cb = new CircuitBreaker("test", 1, 60_000);
    cb.recordFailure();
    for (let i = 0; i < 5; i++) {
      expect(cb.canAttempt()).toBe(false);
    }
  });

  it("transitions to half-open after resetMs elapsed", () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const cb = new CircuitBreaker("test", 1, 1_000); // resetMs = 1s
    cb.recordFailure(); // opens at `now`

    // Advance past resetMs
    vi.spyOn(Date, "now").mockReturnValue(now + 1_001);

    // Should transition to half-open and return true
    expect(cb.canAttempt()).toBe(true);

    vi.restoreAllMocks();
  });

  it("recovery from half-open: success → closed", () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const cb = new CircuitBreaker("test", 1, 1_000);
    cb.recordFailure(); // open

    vi.spyOn(Date, "now").mockReturnValue(now + 1_001);
    cb.canAttempt(); // → half-open

    cb.recordSuccess(); // → closed
    expect(cb.isOpen).toBe(false);
    expect(cb.canAttempt()).toBe(true);

    vi.restoreAllMocks();
  });

  it("failure in half-open → opens again", () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const cb = new CircuitBreaker("test", 1, 1_000);
    cb.recordFailure(); // open

    vi.spyOn(Date, "now").mockReturnValue(now + 1_001);
    cb.canAttempt(); // → half-open

    cb.recordFailure(false); // failure in half-open → open again
    expect(cb.isOpen).toBe(true);

    vi.restoreAllMocks();
  });
});

describe("CircuitBreaker — permanent failure", () => {
  it("permanent failure immediately opens the circuit", () => {
    const cb = new CircuitBreaker("test", 100, 60_000); // high threshold
    cb.recordFailure(true);
    expect(cb.isOpen).toBe(true);
  });

  it("permanent failure does not allow half-open even after resetMs", () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const cb = new CircuitBreaker("test", 100, 1_000);
    cb.recordFailure(true); // lastFailureAt set to now + 365 days

    // Advance far past resetMs — but lastFailureAt is a year in the future
    vi.spyOn(Date, "now").mockReturnValue(now + 10_000); // +10s, still < 1 year
    expect(cb.canAttempt()).toBe(false);

    vi.restoreAllMocks();
  });

  it("canAttempt() returns false immediately after permanent failure", () => {
    const cb = new CircuitBreaker("test", 10, 60_000);
    cb.recordFailure(true);
    expect(cb.canAttempt()).toBe(false);
    expect(cb.canAttempt()).toBe(false); // consistent
  });
});

// ── mapEventToAnnouncement ────────────────────────────────────────────────────

describe("mapEventToAnnouncement — valid events", () => {
  it("maps blockNumber string to number", () => {
    const ann = mapEventToAnnouncement(makeEvent({ blockNumber: "36000000" }));
    expect(ann.blockNumber).toBe(36_000_000);
  });

  it("maps blockTimestamp to numeric timestamp", () => {
    const ann = mapEventToAnnouncement(makeEvent({ blockTimestamp: "1780000000" }));
    expect(ann.timestamp).toBe(1_780_000_000);
  });

  it("maps sourceChainId string to number", () => {
    const ann = mapEventToAnnouncement(makeEvent({ sourceChainId: "42161" }));
    expect(ann.sourceChainId).toBe(42161);
  });

  it("maps null sourceChainId to null", () => {
    const ann = mapEventToAnnouncement(makeEvent({ sourceChainId: null }));
    expect(ann.sourceChainId).toBeNull();
  });

  it("maps viewTag through unchanged", () => {
    const ann = mapEventToAnnouncement(makeEvent({ viewTag: 0xcc }));
    expect(ann.viewTag).toBe(0xcc);
  });

  it("maps stealthAddress through unchanged", () => {
    const addr = "0x9999999999999999999999999999999999999999";
    const ann = mapEventToAnnouncement(makeEvent({ stealthAddress: addr }));
    expect(ann.stealthAddress).toBe(addr);
  });

  it("maps logIndex to blockTxIndex", () => {
    const ann = mapEventToAnnouncement(makeEvent({ logIndex: 17 }));
    expect(ann.blockTxIndex).toBe(17);
  });

  it("maps transactionHash (Monad announce tx) to txHash (dedup key)", () => {
    const monadHash = "0xaaaa" + "00".repeat(30);
    const ann = mapEventToAnnouncement(makeEvent({ transactionHash: monadHash }));
    expect(ann.txHash).toBe(monadHash);
  });

  it("maps event.txHash (payment tx) to paymentTxHash", () => {
    const paymentHash = "0xbbbb" + "00".repeat(30);
    const ann = mapEventToAnnouncement(makeEvent({ txHash: paymentHash }));
    expect(ann.paymentTxHash).toBe(paymentHash);
  });

  it("null event.txHash maps to null paymentTxHash", () => {
    const ann = mapEventToAnnouncement(makeEvent({ txHash: null }));
    expect(ann.paymentTxHash).toBeNull();
  });

  it("maps amount through unchanged", () => {
    const amt = "0x" + "ff".repeat(32);
    const ann = mapEventToAnnouncement(makeEvent({ amount: amt }));
    expect(ann.amount).toBe(amt);
  });

  it("null amount maps to null", () => {
    const ann = mapEventToAnnouncement(makeEvent({ amount: null }));
    expect(ann.amount).toBeNull();
  });

  it("chain is always 'monad-testnet'", () => {
    const ann = mapEventToAnnouncement(makeEvent());
    expect(ann.chain).toBe("monad-testnet");
  });
});

describe("mapEventToAnnouncement — ephemeralKey normalization", () => {
  it("strips 0x prefix from ephemeralPubKey", () => {
    const withPrefix = "0x" + "ab".repeat(1088);
    const ann = mapEventToAnnouncement(makeEvent({ ephemeralPubKey: withPrefix }));
    expect(ann.ephemeralKey.startsWith("0x")).toBe(false);
    expect(ann.ephemeralKey).toBe("ab".repeat(1088));
  });

  it("leaves ephemeralPubKey without 0x prefix unchanged", () => {
    const noPrefix = "cd".repeat(1088);
    const ann = mapEventToAnnouncement(makeEvent({ ephemeralPubKey: noPrefix }));
    expect(ann.ephemeralKey).toBe(noPrefix);
  });

  it("does NOT throw for wrong key length — just warns", () => {
    const shortKey = "ab".repeat(100); // 100 bytes, not 1088
    expect(() =>
      mapEventToAnnouncement(makeEvent({ ephemeralPubKey: shortKey }))
    ).not.toThrow();
  });

  it("emits a console.warn for wrong key length", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const shortKey = "ab".repeat(100);
    mapEventToAnnouncement(makeEvent({ ephemeralPubKey: shortKey }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/100.*expected 1088|1088.*100/));
    warnSpy.mockRestore();
  });

  it("does NOT warn for correct 1088-byte key", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mapEventToAnnouncement(makeEvent({ ephemeralPubKey: "ab".repeat(1088) }));
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("zero-length ephemeralPubKey emits a warning but doesn't throw", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      mapEventToAnnouncement(makeEvent({ ephemeralPubKey: "" }))
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("mapEventToAnnouncement — validation errors", () => {
  it("throws for non-numeric blockNumber", () => {
    expect(() =>
      mapEventToAnnouncement(makeEvent({ blockNumber: "not-a-number" }))
    ).toThrow(/Invalid blockNumber/);
  });

  it("throws for negative blockNumber", () => {
    expect(() =>
      mapEventToAnnouncement(makeEvent({ blockNumber: "-1" }))
    ).toThrow(/Invalid blockNumber/);
  });

  it("empty blockNumber parses as 0 and is accepted", () => {
    // Number("") === 0 which passes the >=0 check; this is intentional
    expect(() =>
      mapEventToAnnouncement(makeEvent({ blockNumber: "" }))
    ).not.toThrow();
    const ann = mapEventToAnnouncement(makeEvent({ blockNumber: "" }));
    expect(ann.blockNumber).toBe(0);
  });

  it("throws for non-numeric blockTimestamp", () => {
    expect(() =>
      mapEventToAnnouncement(makeEvent({ blockTimestamp: "bad-ts" }))
    ).toThrow(/Invalid blockTimestamp/);
  });

  it("throws for negative blockTimestamp", () => {
    expect(() =>
      mapEventToAnnouncement(makeEvent({ blockTimestamp: "-100" }))
    ).toThrow(/Invalid blockTimestamp/);
  });

  it("throws for invalid sourceChainId string", () => {
    expect(() =>
      mapEventToAnnouncement(makeEvent({ sourceChainId: "not-a-chain-id" }))
    ).toThrow(/Invalid sourceChainId/);
  });

  it("throws for negative sourceChainId", () => {
    expect(() =>
      mapEventToAnnouncement(makeEvent({ sourceChainId: "-1" }))
    ).toThrow(/Invalid sourceChainId/);
  });

  it("'0' sourceChainId (zero) is valid (maps to 0, not null)", () => {
    // sourceChainId=0 is parsed to number 0, which is valid
    // The null check is only for the null/undefined input, not for numeric 0
    expect(() =>
      mapEventToAnnouncement(makeEvent({ sourceChainId: "0" }))
    ).not.toThrow();
  });

  it("blockNumber '0' is valid", () => {
    expect(() =>
      mapEventToAnnouncement(makeEvent({ blockNumber: "0" }))
    ).not.toThrow();
  });
});

describe("mapEventToAnnouncement — chain-specific values", () => {
  it("correctly maps Ethereum mainnet chain ID (1)", () => {
    const ann = mapEventToAnnouncement(makeEvent({ sourceChainId: "1" }));
    expect(ann.sourceChainId).toBe(1);
  });

  it("correctly maps Monad testnet chain ID (10143)", () => {
    const ann = mapEventToAnnouncement(makeEvent({ sourceChainId: "10143" }));
    expect(ann.sourceChainId).toBe(10143);
  });

  it("correctly maps Base chain ID (8453)", () => {
    const ann = mapEventToAnnouncement(makeEvent({ sourceChainId: "8453" }));
    expect(ann.sourceChainId).toBe(8453);
  });

  it("correctly maps Polygon chain ID (137)", () => {
    const ann = mapEventToAnnouncement(makeEvent({ sourceChainId: "137" }));
    expect(ann.sourceChainId).toBe(137);
  });
});

describe("mapEventToAnnouncement — round-trip integrity", () => {
  it("maps all fields of a full event without data loss", () => {
    const event = makeEvent({
      viewTag: 0x77,
      stealthAddress: "0x2222222222222222222222222222222222222222",
      ephemeralPubKey: "ff".repeat(1088),
      txHash: "0xaaaa" + "00".repeat(30),
      sourceChainId: "137",
      amount: "0x" + "00".repeat(31) + "ff",
      blockNumber: "50000000",
      blockTimestamp: "1790000000",
      transactionHash: "0xbbbb" + "00".repeat(30),
      logIndex: 99,
    });

    const ann = mapEventToAnnouncement(event);

    expect(ann.viewTag).toBe(0x77);
    expect(ann.stealthAddress).toBe("0x2222222222222222222222222222222222222222");
    expect(ann.ephemeralKey).toBe("ff".repeat(1088));
    expect(ann.paymentTxHash).toBe("0xaaaa" + "00".repeat(30));
    expect(ann.sourceChainId).toBe(137);
    expect(ann.amount).toBe("0x" + "00".repeat(31) + "ff");
    expect(ann.blockNumber).toBe(50_000_000);
    expect(ann.timestamp).toBe(1_790_000_000);
    expect(ann.txHash).toBe("0xbbbb" + "00".repeat(30));
    expect(ann.blockTxIndex).toBe(99);
    expect(ann.chain).toBe("monad-testnet");
  });
});

// ── Environment-based config (via parseEnvInt, indirectly tested) ─────────────

describe("parseEnvInt behavior (indirect via mapped fields)", () => {
  afterEach(() => {
    delete process.env.TURSO_RETRY_INTERVAL_MS;
    delete process.env.TURSO_RETRY_MAX_FETCH;
    delete process.env.ENVIO_GRAPHQL_URL;
    delete process.env.HASURA_EXTERNAL_PORT;
  });

  it("mapEventToAnnouncement is not affected by TURSO env vars", () => {
    process.env.TURSO_RETRY_INTERVAL_MS = "bad";
    process.env.TURSO_RETRY_MAX_FETCH = "-1";
    const ann = mapEventToAnnouncement(makeEvent());
    expect(ann.chain).toBe("monad-testnet");
  });
});
