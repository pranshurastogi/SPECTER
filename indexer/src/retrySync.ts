/**
 * Turso sync-retry worker.
 *
 * The Envio event handler writes announcements to Turso with 3× retry.
 * When all retries are exhausted (Turso outage, transient auth blip, etc.)
 * the event is marked tursoSynced=false in Envio Postgres — and stays that
 * way permanently, because Envio has no admin API to patch entity fields
 * without a full re-index.
 *
 * This worker provides the missing recovery path:
 *   1. On startup (after a 15 s warmup), query Envio GraphQL for every
 *      event where tursoSynced=false.
 *   2. Re-push each one to Turso via writeTursoAnnouncement() (idempotent:
 *      INSERT OR IGNORE on tx_hash).
 *   3. Repeat every TURSO_RETRY_INTERVAL_MS (default 5 min).
 *
 * Edge cases handled:
 *   - Turso permanent failure (auth/schema)  → circuit opens, no hammering
 *   - Turso transient failure                → per-event 3× retry already
 *                                              inside writeTursoAnnouncement;
 *                                              circuit trips after 10 batch failures
 *   - Envio GraphQL unavailable              → separate circuit, backs off
 *   - Already-retried events re-appearing    → in-memory confirmedSynced set
 *                                              skips them on subsequent cycles
 *   - Concurrent cycle overlap               → isRunning guard
 *   - Process shutdown                       → SIGTERM/SIGINT clears timers
 *   - Unexpected thrown errors in cycle      → exponential backoff, cap 30 min
 *   - ephemeralPubKey wrong length           → logged, write attempted anyway
 *   - blockNumber / blockTimestamp parse fail → event skipped, logged
 */

import { writeTursoAnnouncement, probeTursoConnection, type TursoAnnouncement } from "./turso";

const MONAD_CHAIN = "monad-testnet";

// ── Configuration ──────────────────────────────────────────────────────────

interface RetrySyncConfig {
  /** GraphQL endpoint for the local Envio Hasura instance. */
  graphqlUrl: string;
  /** How often the retry cycle fires (ms). Default: 5 min. */
  intervalMs: number;
  /** Max number of unsynced events to fetch per cycle. Default: 5000. */
  maxFetch: number;
  /**
   * How many consecutive GraphQL fetch failures before the circuit opens.
   * Default: 5.
   */
  graphqlFailureThreshold: number;
  /**
   * How many consecutive Turso write failures before the circuit opens.
   * Default: 10.
   */
  tursoFailureThreshold: number;
  /**
   * How long (ms) an open circuit waits before moving to half-open.
   * Default: 10 min.
   */
  circuitResetMs: number;
  /** Warmup delay before the very first cycle (ms). Default: 15 s. */
  startupDelayMs: number;
}

function loadConfig(): RetrySyncConfig {
  const port = process.env.HASURA_EXTERNAL_PORT ?? "8080";
  const graphqlUrl =
    process.env.ENVIO_GRAPHQL_URL ??
    `http://localhost:${port}/v1/graphql`;

  return {
    graphqlUrl,
    intervalMs: parseEnvInt("TURSO_RETRY_INTERVAL_MS", 5 * 60_000),
    maxFetch: parseEnvInt("TURSO_RETRY_MAX_FETCH", 5_000),
    graphqlFailureThreshold: 5,
    tursoFailureThreshold: 10,
    circuitResetMs: 10 * 60_000,
    startupDelayMs: 15_000,
  };
}

function parseEnvInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

// ── Circuit Breaker ────────────────────────────────────────────────────────

type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private lastFailureAt = 0;

  constructor(
    readonly name: string,
    private readonly threshold: number,
    private readonly resetMs: number
  ) {}

  /**
   * Returns true if a new attempt is allowed.
   * Closed → always allowed.
   * Open    → allowed only once the reset timer has elapsed (→ half-open).
   * Half-open → allowed (one probe attempt).
   */
  canAttempt(): boolean {
    switch (this.state) {
      case "closed":
        return true;
      case "open":
        if (Date.now() - this.lastFailureAt >= this.resetMs) {
          this.state = "half-open";
          log(`circuit(${this.name}) → half-open, probing`);
          return true;
        }
        return false;
      case "half-open":
        return true;
    }
  }

  recordSuccess(): void {
    if (this.state !== "closed") {
      log(`circuit(${this.name}) → closed (recovered)`);
    }
    this.state = "closed";
    this.consecutiveFailures = 0;
  }

  /**
   * Records a failure.
   * @param permanent - If true, the circuit opens indefinitely (until restart).
   *   Use for auth errors, schema mismatches, and other non-recoverable faults.
   */
  recordFailure(permanent = false): void {
    this.consecutiveFailures++;
    this.lastFailureAt = Date.now();

    if (permanent) {
      this.state = "open";
      this.lastFailureAt = Date.now() + 365 * 24 * 60 * 60_000; // effectively never resets
      logError(
        `circuit(${this.name}) → open PERMANENTLY (permanent error). ` +
          `Restart the indexer after fixing the underlying issue.`
      );
      return;
    }

    if (this.consecutiveFailures >= this.threshold) {
      this.state = "open";
      const resetSec = Math.round(this.resetMs / 1_000);
      logError(
        `circuit(${this.name}) → open after ${this.consecutiveFailures} failures. ` +
          `Will probe again in ${resetSec}s.`
      );
    }
  }

  get isOpen(): boolean {
    return this.state === "open";
  }
}

// ── Logging ────────────────────────────────────────────────────────────────

const PREFIX = "[specter-envio/retrySync]";

function log(msg: string): void {
  console.log(`${PREFIX} ${msg}`);
}

function logWarn(msg: string): void {
  console.warn(`${PREFIX} WARN ${msg}`);
}

function logError(msg: string): void {
  console.error(`${PREFIX} ERROR ${msg}`);
}

// ── GraphQL types & query ──────────────────────────────────────────────────

export interface UnsyncedEvent {
  id: string;
  viewTag: number;
  stealthAddress: string;
  /** hex string (with or without 0x prefix) — full 1088-byte ML-KEM ciphertext */
  ephemeralPubKey: string;
  /** keccak256 of the ciphertext (hex, with or without 0x prefix — 32 bytes) */
  ephemeralKeyHash: string;
  /** raw encrypted metadata blob (hex, with or without 0x prefix) */
  metadataRaw: string;
  /** BigInt string — Monad block number */
  blockNumber: string;
  /** BigInt string — unix timestamp of the Monad block */
  blockTimestamp: string;
  /** Monad announce tx hash — dedup key in Turso */
  transactionHash: string;
  /** log index within the Monad tx */
  logIndex: number;
}

interface GraphQLResponse {
  data?: { AnnouncementEvent: UnsyncedEvent[] };
  errors?: Array<{ message: string; extensions?: unknown }>;
}

const UNSYNCED_QUERY = `
  query UnsyncedTurso($limit: Int) {
    AnnouncementEvent(
      where: { tursoSynced: { _eq: false } }
      order_by: { blockNumber: asc, logIndex: asc }
      limit: $limit
    ) {
      id
      viewTag
      stealthAddress
      ephemeralPubKey
      ephemeralKeyHash
      metadataRaw
      blockNumber
      blockTimestamp
      transactionHash
      logIndex
    }
  }
`;

async function fetchUnsyncedEvents(
  graphqlUrl: string,
  limit: number
): Promise<UnsyncedEvent[]> {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: UNSYNCED_QUERY, variables: { limit } }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as GraphQLResponse;

  if (json.errors?.length) {
    const msgs = json.errors.map((e) => e.message).join("; ");
    throw new Error(`GraphQL errors: ${msgs}`);
  }

  return json.data?.AnnouncementEvent ?? [];
}

// ── Event → TursoAnnouncement mapping ─────────────────────────────────────

/**
 * Maps an Envio GraphQL AnnouncementEvent to the shape required by
 * writeTursoAnnouncement. Exported for unit testing.
 *
 * Throws if required numeric fields cannot be parsed, so the caller can
 * skip the event and log the error rather than writing garbage to Turso.
 */
export function mapEventToAnnouncement(event: UnsyncedEvent): TursoAnnouncement {
  const blockNumber = Number(event.blockNumber);
  if (!Number.isFinite(blockNumber) || blockNumber < 0) {
    throw new Error(`Invalid blockNumber: ${event.blockNumber}`);
  }

  const blockTimestamp = Number(event.blockTimestamp);
  if (!Number.isFinite(blockTimestamp) || blockTimestamp < 0) {
    throw new Error(`Invalid blockTimestamp: ${event.blockTimestamp}`);
  }

  // Strip 0x prefix; writeTursoAnnouncement converts hex → Buffer
  const stripHex = (s: string): string => (s.startsWith("0x") ? s.slice(2) : s);

  const ephemeralKey = stripHex(event.ephemeralPubKey);
  const ephemeralKeyHash = stripHex(event.ephemeralKeyHash);
  const metadataBlob = stripHex(event.metadataRaw);

  // Warn on unexpected ephemeral key length but don't reject — mirrors the
  // behaviour of the primary event handler.
  const keyBytes = ephemeralKey.length / 2;
  if (keyBytes !== 1088) {
    logWarn(
      `event ${event.id}: ephemeralPubKey is ${keyBytes} bytes (expected 1088). Writing anyway.`
    );
  }

  return {
    viewTag: event.viewTag,
    timestamp: blockTimestamp,
    ephemeralKey,
    ephemeralKeyHash,
    metadataBlob,
    blockNumber,
    txHash: event.transactionHash, // Monad announce tx hash — dedup key
    chain: MONAD_CHAIN,
    stealthAddress: event.stealthAddress,
    blockTxIndex: event.logIndex,
  };
}

// ── Worker state ───────────────────────────────────────────────────────────

interface WorkerState {
  graphqlCircuit: CircuitBreaker;
  tursoCircuit: CircuitBreaker;
  /**
   * Event IDs (e.g. "0xabc-5") that were successfully written to Turso this
   * session. Prevents redundant re-writes when the same events appear again
   * in subsequent cycles (tursoSynced flag cannot be updated in Envio Postgres
   * without a full re-index).
   */
  confirmedSynced: Set<string>;
  sessionRetried: number;
  sessionFailed: number;
}

// ── Core retry cycle ───────────────────────────────────────────────────────

async function runOneCycle(
  config: RetrySyncConfig,
  state: WorkerState
): Promise<void> {
  // ── GraphQL circuit check ──────────────────────────────────────────────
  if (!state.graphqlCircuit.canAttempt()) {
    logWarn("GraphQL circuit open — skipping cycle");
    return;
  }

  // ── Turso circuit check ────────────────────────────────────────────────
  if (!state.tursoCircuit.canAttempt()) {
    logWarn("Turso circuit open — skipping cycle");
    return;
  }

  // ── Fetch unsynced events ──────────────────────────────────────────────
  let events: UnsyncedEvent[];
  try {
    events = await fetchUnsyncedEvents(config.graphqlUrl, config.maxFetch);
    state.graphqlCircuit.recordSuccess();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`GraphQL fetch failed: ${msg}`);
    state.graphqlCircuit.recordFailure();
    return;
  }

  if (events.length === 0) {
    log("No unsynced events — Turso is fully in sync.");
    return;
  }

  if (events.length >= config.maxFetch) {
    logWarn(
      `Fetched ${events.length} unsynced events (hit the ${config.maxFetch} limit). ` +
        "There may be more — consider running a full re-index or increasing TURSO_RETRY_MAX_FETCH."
    );
  } else {
    log(`Found ${events.length} unsynced event(s) to retry.`);
  }

  // ── Probe Turso before processing the batch ────────────────────────────
  // A quick SELECT 1 surfaces auth/connectivity errors before we attempt
  // hundreds of writes and waste time failing fast on every one.
  const tursoHealthy = await probeTursoConnection();
  if (!tursoHealthy) {
    logError("Turso probe failed — skipping batch. Will retry next cycle.");
    state.tursoCircuit.recordFailure();
    return;
  }
  state.tursoCircuit.recordSuccess();

  // ── Retry loop ─────────────────────────────────────────────────────────
  let cycleSuccess = 0;
  let cycleFailed = 0;
  let cycleSkipped = 0;
  let consecutiveTursoFailures = 0;

  for (const event of events) {
    // Skip events already confirmed this session — avoids redundant writes
    // since tursoSynced stays false in Envio Postgres until a full re-index.
    if (state.confirmedSynced.has(event.id)) {
      cycleSkipped++;
      continue;
    }

    // Abort if the Turso circuit opened mid-batch
    if (state.tursoCircuit.isOpen) {
      logWarn("Turso circuit opened mid-batch — aborting remaining events.");
      break;
    }

    if (!state.tursoCircuit.canAttempt()) {
      logWarn("Turso circuit open — aborting batch.");
      break;
    }

    // Map the GraphQL event to the Turso write shape
    let ann: TursoAnnouncement;
    try {
      ann = mapEventToAnnouncement(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`Skipping event ${event.id} — mapping error: ${msg}`);
      cycleFailed++;
      state.sessionFailed++;
      continue;
    }

    // Attempt the write (writeTursoAnnouncement has its own 3× retry internally)
    const result = await writeTursoAnnouncement(ann);

    if (result.ok) {
      cycleSuccess++;
      state.sessionRetried++;
      consecutiveTursoFailures = 0;
      state.confirmedSynced.add(event.id);
      state.tursoCircuit.recordSuccess();
    } else {
      cycleFailed++;
      state.sessionFailed++;
      consecutiveTursoFailures++;

      if (result.permanent) {
        // Auth failure, schema mismatch, etc. — open circuit permanently.
        logError(
          `Permanent Turso failure on event ${event.id}: ${result.error}. ` +
            "Stopping all writes until restart."
        );
        state.tursoCircuit.recordFailure(true);
        break;
      }

      // Transient failure — record in circuit; if threshold exceeded, the
      // circuit opens and the next iteration's canAttempt() check aborts.
      state.tursoCircuit.recordFailure(false);

      // Heuristic safety valve: if every event so far has failed (no successes
      // at all in this batch), something systemic is wrong — stop early even
      // if the circuit hasn't tripped yet.
      if (cycleSuccess === 0 && consecutiveTursoFailures >= 5) {
        logError(
          `${consecutiveTursoFailures} consecutive Turso failures with no successes. ` +
            "Aborting batch — will retry next cycle."
        );
        break;
      }
    }
  }

  log(
    `Cycle done. retried=${cycleSuccess} failed=${cycleFailed} skipped=${cycleSkipped} ` +
      `| session totals: retried=${state.sessionRetried} failed=${state.sessionFailed} ` +
      `| confirmedSynced cache: ${state.confirmedSynced.size} entries`
  );
}

// ── Worker entrypoint ──────────────────────────────────────────────────────

let _started = false;

/**
 * Starts the Turso sync-retry background worker.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 * Should be called once at indexer startup (e.g., from EventHandlers.ts module level).
 */
export function startRetryWorker(): void {
  if (_started) return;
  _started = true;

  const config = loadConfig();
  const state: WorkerState = {
    graphqlCircuit: new CircuitBreaker(
      "graphql",
      config.graphqlFailureThreshold,
      config.circuitResetMs
    ),
    tursoCircuit: new CircuitBreaker(
      "turso",
      config.tursoFailureThreshold,
      config.circuitResetMs
    ),
    confirmedSynced: new Set(),
    sessionRetried: 0,
    sessionFailed: 0,
  };

  log(
    `Initializing. graphqlUrl=${config.graphqlUrl} ` +
      `interval=${config.intervalMs}ms maxFetch=${config.maxFetch}`
  );

  let isRunning = false;
  let currentTimer: NodeJS.Timeout | null = null;
  let backoffMs = 0;

  async function runCycle(): Promise<void> {
    if (isRunning) {
      logWarn("Previous cycle still running — skipping this tick.");
      return;
    }
    isRunning = true;
    try {
      await runOneCycle(config, state);
      backoffMs = 0; // reset backoff on a clean cycle (even if no events were retried)
    } catch (err) {
      // runOneCycle is designed to not throw, but we guard here anyway.
      const msg = err instanceof Error ? err.message : String(err);
      logError(`Unexpected error in cycle: ${msg}`);
      // Exponential backoff: double each time, cap at 30 minutes.
      backoffMs = Math.min(backoffMs > 0 ? backoffMs * 2 : config.intervalMs, 30 * 60_000);
      logWarn(`Next cycle delayed by ${Math.round(backoffMs / 1_000)}s (backoff).`);
    } finally {
      isRunning = false;
    }
  }

  function scheduleNext(delayMs: number): void {
    currentTimer = setTimeout(() => {
      void (async () => {
        await runCycle();
        // After each cycle, always schedule the next at the normal interval
        // (backoffMs is applied by runCycle adjusting the next scheduleNext call
        // only when an unexpected error occurs — see below).
        scheduleNext(backoffMs > 0 ? backoffMs : config.intervalMs);
      })();
    }, delayMs);
  }

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const cleanup = (): void => {
    log("Shutdown signal received — stopping retry worker.");
    if (currentTimer !== null) {
      clearTimeout(currentTimer);
      currentTimer = null;
    }
  };
  process.once("SIGTERM", cleanup);
  process.once("SIGINT", cleanup);

  // ── Startup: wait for Envio to finish its own initialization ─────────────
  log(`First retry cycle in ${config.startupDelayMs / 1_000}s...`);
  scheduleNext(config.startupDelayMs);
}
