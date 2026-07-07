/**
 * Reads SPECTER announcements straight from the chain — no SPECTER backend.
 *
 * This mirrors `SPECTER/event-poller/src/index.ts` (the canonical indexer),
 * but runs in the browser against whatever RPC the user trusts. The deployed
 * `Announcement` event carries only `keccak256(ciphertext)`; the full
 * 1088-byte ML-KEM ciphertext lives in the `announce()` calldata, so each log
 * costs one extra `getTransaction` to recover and verify.
 *
 * This is the fully-trustless fallback source (zero SPECTER calls). Public
 * Monad RPCs cap `eth_getLogs` at 100-block windows and ~25 req/sec, so the
 * sweep here is adaptive (auto-shrinks the window to the RPC's real cap),
 * rate-limited (token-spaced under the cap, with backoff on 429), and
 * cancellable via an `AbortSignal`.
 */

import {
  createPublicClient,
  decodeFunctionData,
  http,
  keccak256,
  parseAbiItem,
  type Hex,
} from "viem";
import {
  ANNOUNCER_ADDRESS,
  ANNOUNCER_DEPLOY_BLOCK,
  LOG_SCAN_CHUNK,
  MIN_LOG_SCAN_CHUNK,
  RPC_MAX_REQUESTS_PER_SEC,
  RPC_SCAN_CONCURRENCY,
} from "./config";

/** Deployed event — ciphertext is referenced only by its keccak256 hash. */
const ANNOUNCEMENT_EVENT = parseAbiItem(
  "event Announcement(uint256 schemeId, address indexed stealthAddress, address indexed caller, bytes32 ephemeralKeyHash, bytes metadata)",
);

/** Both the 3-arg and the schemeId-prefixed 4-arg announce() signatures. */
const ANNOUNCE_ABI = [
  {
    type: "function",
    name: "announce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "stealthAddress", type: "address" },
      { name: "ephemeralPubKey", type: "bytes" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "announce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schemeId", type: "uint256" },
      { name: "stealthAddress", type: "address" },
      { name: "ephemeralPubKey", type: "bytes" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/** A single on-chain announcement, ready to feed into `scanAnnouncement`. */
export interface ChainAnnouncement {
  /** Full 1088-byte ML-KEM ciphertext, 0x-prefixed. */
  readonly ephemeralCiphertext: Hex;
  /** Plaintext view-tag (byte 0 of the metadata block). */
  readonly viewTag: number;
  /**
   * Raw on-chain metadata block (0x-prefixed); decoded for amount/chain on
   * match. Absent for the registry source, which already knows amount/chain
   * (and on-chain metadata is now an AEAD blob that can't be decoded here).
   */
  readonly metadata?: Hex;
  /** The announced stealth address, when the source carries it (cross-check only). */
  readonly stealthAddress?: Hex;
  readonly txHash: Hex;
  /** Block number for the RPC path; the registry uses the row id as a recency key. */
  readonly blockNumber: bigint;
  /**
   * Pre-decoded payment fields, supplied by sources that already know them
   * (the backend registry). When present, `recover.ts` uses these instead of
   * decoding `metadata`.
   */
  readonly sourceChainId?: number;
  readonly amount?: bigint;
  readonly paymentTxHash?: string;
}

/**
 * Progress emitted while collecting announcements. Discriminated by `kind` so
 * the UI can render both the block-sweep (RPC) and the row-fetch (indexer)
 * paths, plus transient status messages (e.g. an indexer→RPC fallback).
 */
export type ScanProgress =
  | {
      readonly kind: "rpc";
      /** Highest block scanned so far (monotonic). */
      readonly scannedToBlock: bigint;
      /** Chain tip the scan is walking toward. */
      readonly latestBlock: bigint;
      /** First block of the scan (deploy block). */
      readonly fromBlock: bigint;
      /** Announcements collected so far. */
      readonly found: number;
    }
  | {
      readonly kind: "indexer";
      /** Announcement rows pulled from the indexer so far. */
      readonly rowsFetched: number;
      /** Announcements collected so far (post-verification). */
      readonly found: number;
    }
  | {
      readonly kind: "status";
      /** Human-readable transient status (e.g. "indexer unavailable…"). */
      readonly message: string;
    };

export interface FetchOptions {
  /** Called after each block window so the UI can show progress. */
  readonly onProgress?: (p: ScanProgress) => void;
  /**
   * Called the moment each announcement is recovered+verified, so the caller
   * can trial-decapsulate and stream matches live instead of waiting for the
   * whole sweep to finish.
   */
  readonly onAnnouncement?: (ann: ChainAnnouncement) => void;
  /** Optional override for the first block to scan (defaults to deploy block). */
  readonly fromBlock?: bigint;
  /**
   * Sweep direction. `"newest"` (default) walks the chain tip → deploy block so
   * recent payments surface first; `"oldest"` walks deploy block → tip.
   */
  readonly direction?: "newest" | "oldest";
  /** Cancels the scan; in-flight work stops and `fetchAnnouncements` rejects. */
  readonly signal?: AbortSignal;
}

/** Thrown (and recognised) when a scan is cancelled via its `AbortSignal`. */
export class ScanAbortedError extends Error {
  constructor() {
    super("scan aborted");
    this.name = "ScanAbortedError";
  }
}

export function isScanAborted(err: unknown): boolean {
  return (
    err instanceof ScanAbortedError ||
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/** Recover the ML-KEM ciphertext from announce() calldata (ephemeralPubKey arg). */
function decodeEphemeralKey(input: Hex): Hex {
  const decoded = decodeFunctionData({ abi: ANNOUNCE_ABI, data: input });
  const args = decoded.args as readonly unknown[];
  return (args.length === 3 ? args[1] : args[2]) as Hex;
}

/** Extract the plaintext view-tag (byte 0) from the metadata blob. */
function extractViewTag(metadata: Hex): number {
  const hex = metadata.startsWith("0x") ? metadata.slice(2) : metadata;
  if (hex.length < 2) throw new Error("metadata too short: missing view_tag");
  return parseInt(hex.slice(0, 2), 16);
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ScanAbortedError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new ScanAbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** An RPC's getLogs range cap, parsed from its rejection message when present. */
function parseRangeLimit(message: string): number | null {
  const patterns = [
    /limited to (?:a )?(\d+) range/i,
    /Maximum allowed number of requested blocks is (\d+)/i,
    /ranges over (\d+) blocks/i,
    /block range.*?(\d+)/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

const isRangeTooLargeError = (message: string): boolean =>
  /range|too large|too many blocks|exceeded|limited to \d+ range/i.test(message);

const isRateLimitError = (message: string): boolean =>
  /\b429\b|rate.?limit|too many requests|requests limited to \d+\/sec|limit exceeded/i.test(
    message,
  );

/**
 * Token-spaced rate gate: serialises the *start* of each RPC call so we never
 * exceed ~`ratePerSec` request starts/second (requests still overlap in flight).
 */
function createRateGate(ratePerSec: number) {
  const minIntervalMs = 1000 / ratePerSec;
  let nextAt = 0;
  return async function gate(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new ScanAbortedError();
    const now = Date.now();
    const startAt = Math.max(now, nextAt);
    nextAt = startAt + minIntervalMs;
    const wait = startAt - now;
    if (wait > 0) await sleep(wait, signal);
  };
}

/**
 * Minimal structural shape of an `Announcement` log. viem's generic client
 * type doesn't surface the decoded `args` without the event in the type
 * position, so we narrow to exactly the fields this sweep reads.
 */
interface RawAnnouncementLog {
  readonly args: {
    readonly stealthAddress?: Hex;
    readonly ephemeralKeyHash?: Hex;
    readonly metadata?: Hex;
  };
  readonly transactionHash: Hex | null;
  readonly blockNumber: bigint | null;
}

/**
 * Sweep the announcer's `Announcement` logs from the deploy block to the
 * chain tip, recovering and verifying each ciphertext. Returns every
 * announcement on-chain — matching them to the user's keys happens in
 * `recover.ts`, entirely client-side.
 */
export async function fetchAnnouncements(
  rpcUrl: string,
  opts: FetchOptions = {},
): Promise<ChainAnnouncement[]> {
  const { signal } = opts;
  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 30_000, retryCount: 2, retryDelay: 1_500 }),
  });
  const gate = createRateGate(RPC_MAX_REQUESTS_PER_SEC);

  if (signal?.aborted) throw new ScanAbortedError();
  await gate(signal);
  const latestBlock = await client.getBlockNumber();
  const fromBlock = opts.fromBlock ?? ANNOUNCER_DEPLOY_BLOCK;
  const direction = opts.direction ?? "newest";

  const announcements: ChainAnnouncement[] = [];

  // Shared, monotonically-shrinking window size (adapts to the RPC's real cap).
  let windowSize = LOG_SCAN_CHUNK;
  // Shared cursor over the block range. `"newest"` sweeps from the chain tip
  // DOWN to the deploy block (recent payments surface within seconds); `"oldest"`
  // sweeps from the deploy block UP to the tip. Workers claim windows here.
  let cursor = direction === "newest" ? latestBlock : fromBlock;
  // Blocks fully processed (for a smooth, monotonic progress bar).
  let scannedBlocks = 0n;

  const reportProgress = () => {
    // The frontier walks from the start edge toward the far edge of the range.
    let scannedTo: bigint;
    if (direction === "newest") {
      const frontier = latestBlock - scannedBlocks; // walks DOWN toward fromBlock
      scannedTo = frontier < fromBlock ? fromBlock : frontier;
    } else {
      const frontier = fromBlock + scannedBlocks; // walks UP toward latestBlock
      scannedTo = frontier > latestBlock ? latestBlock : frontier;
    }
    opts.onProgress?.({
      kind: "rpc",
      scannedToBlock: scannedTo,
      latestBlock,
      fromBlock,
      found: announcements.length,
    });
  };

  /** getLogs for [start, end], adapting the window down on range-cap rejections. */
  async function getLogsAdaptive(
    start: bigint,
    end: bigint,
  ): Promise<RawAnnouncementLog[]> {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new ScanAbortedError();
      await gate(signal);
      try {
        const logs = await client.getLogs({
          address: ANNOUNCER_ADDRESS,
          event: ANNOUNCEMENT_EVENT,
          fromBlock: start,
          toBlock: end,
        });
        return logs as unknown as RawAnnouncementLog[];
      } catch (err) {
        if (isScanAborted(err)) throw err;
        const msg = err instanceof Error ? err.message : String(err);

        if (isRateLimitError(msg)) {
          await sleep(Math.min(8_000, 1_000 * 2 ** attempt), signal);
          continue;
        }

        const span = end - start + 1n;
        if (isRangeTooLargeError(msg) && span > 1n) {
          const parsed = parseRangeLimit(msg);
          const next =
            parsed !== null && BigInt(parsed) < span
              ? BigInt(parsed)
              : span / 2n;
          const newSize = next < MIN_LOG_SCAN_CHUNK ? MIN_LOG_SCAN_CHUNK : next;
          // Remember the smaller cap for every future window.
          if (newSize < windowSize) windowSize = newSize;
          // Re-split THIS range at the new size and gather sub-results.
          const out: RawAnnouncementLog[] = [];
          for (let s = start; s <= end; s += newSize) {
            const e = s + newSize - 1n > end ? end : s + newSize - 1n;
            const sub = await getLogsAdaptive(s, e);
            for (const l of sub) out.push(l);
          }
          return out;
        }

        // Transient/other error: a couple of retries, then give up on this window.
        if (attempt < 2) {
          await sleep(750 * (attempt + 1), signal);
          continue;
        }
        throw err;
      }
    }
  }

  /** Recover + verify the ciphertext for one log, pushing a ChainAnnouncement. */
  async function processLog(log: RawAnnouncementLog): Promise<void> {
    if (!log.transactionHash || log.blockNumber === null) return;
    const { ephemeralKeyHash, metadata, stealthAddress } = log.args;
    if (!ephemeralKeyHash || !metadata || metadata === "0x") return;

    // getTransaction to recover the full ciphertext from announce() calldata.
    let input: Hex | undefined;
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new ScanAbortedError();
      await gate(signal);
      try {
        const tx = await client.getTransaction({ hash: log.transactionHash });
        input = tx.input;
        break;
      } catch (err) {
        if (isScanAborted(err)) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (isRateLimitError(msg)) {
          await sleep(Math.min(8_000, 1_000 * 2 ** attempt), signal);
          continue;
        }
        if (attempt < 2) {
          await sleep(750 * (attempt + 1), signal);
          continue;
        }
        return; // a single unrecoverable tx must not abort the whole sweep
      }
    }
    if (!input) return;

    const ciphertext = decodeEphemeralKey(input);
    if (keccak256(ciphertext).toLowerCase() !== ephemeralKeyHash.toLowerCase()) {
      return; // tampered / mismatched ciphertext — skip
    }

    const ann: ChainAnnouncement = {
      ephemeralCiphertext: ciphertext,
      viewTag: extractViewTag(metadata),
      metadata,
      stealthAddress,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };
    announcements.push(ann);
    opts.onAnnouncement?.(ann);
  }

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) throw new ScanAbortedError();
      // Claim the next window. Reads and writes of `cursor` have no `await`
      // between them, so concurrent workers claim disjoint ranges atomically.
      let start: bigint;
      let end: bigint;
      if (direction === "newest") {
        end = cursor;
        if (end < fromBlock) return;
        start = end - windowSize + 1n < fromBlock ? fromBlock : end - windowSize + 1n;
        cursor = start - 1n; // walking downward
      } else {
        start = cursor;
        if (start > latestBlock) return;
        end = start + windowSize - 1n > latestBlock ? latestBlock : start + windowSize - 1n;
        cursor = end + 1n; // walking upward
      }

      let logs: RawAnnouncementLog[];
      try {
        logs = await getLogsAdaptive(start, end);
      } catch (err) {
        if (isScanAborted(err)) throw err;
        // Whole window failed after retries — skip it rather than abort the sweep.
        logs = [];
      }

      for (const log of logs) {
        try {
          await processLog(log);
        } catch (err) {
          if (isScanAborted(err)) throw err;
          // A single bad log must never abort the whole recovery sweep.
        }
      }

      scannedBlocks += end - start + 1n;
      reportProgress();
    }
  }

  reportProgress();
  const workers = Array.from(
    { length: Math.max(1, RPC_SCAN_CONCURRENCY) },
    () => worker(),
  );
  await Promise.all(workers);

  return announcements;
}
