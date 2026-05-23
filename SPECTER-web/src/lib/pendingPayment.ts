/**
 * Pending payment vault.
 *
 * Tracks the lifecycle of every stealth payment the user starts on this
 * device, from `create_stealth` (server-built `Announcement` + `payment_id`)
 * all the way through `publish_announcement`.
 *
 * The protocol's main fund-loss failure mode is *not* on-chain — the funds
 * always land at the (correctly derived) stealth address. The way payments
 * become "lost" is if the announcement is never published to the registry,
 * because then the recipient cannot discover them while scanning. This
 * vault is the client-side safety net that lets us:
 *
 *   1. Recover from tab close / refresh / browser crash between
 *      `create_stealth` and `publish_announcement`.
 *   2. Re-attempt `publish_announcement` (via `payment_id` or full
 *      `announcement` fallback) without re-sending the on-chain tx.
 *   3. Surface a banner on `/send` if the user has an incomplete payment
 *      from a previous visit.
 *
 * Storage: `localStorage` (NOT `sessionStorage`) — survives tab close so
 * recovery works across sessions. Bounded by TTL + max entries.
 *
 * What we store:
 *   - `payment_id` (UUID) — server handle
 *   - `announcement` (DTO) — fallback if server-side pending expired
 *   - `stealth_address` / `stealth_sui_address` (so user can verify on-chain)
 *   - `meta_address`, `recipient` (display only)
 *   - `chain`, `tx_hash`, `amount` (filled when wallet tx submits)
 *   - `status`, timestamps
 *
 * What we do NOT store:
 *   - viewing secret key, spending secret key, mnemonics — none of those
 *     are ever in scope here.
 *
 * Threat model: localStorage is not a secret store. The fields we persist
 * are either (a) already public once published, or (b) public identifiers
 * (addresses, recipient names). Nothing here weakens the protocol.
 */

import type { AnnouncementDto } from "@/lib/api";

const STORAGE_KEY = "specter_pending_payments_v1";
const MAX_ENTRIES = 25;
/** 7 days — generous for "I closed my laptop" recovery, short enough to avoid stale junk. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingStatus =
  /** create_stealth succeeded; on-chain tx not yet submitted. */
  | "awaiting_send"
  /** On-chain tx submitted/confirmed; publish_announcement not yet successful. */
  | "sent_unpublished"
  /** Fully resolved; kept briefly for analytics/history before pruning. */
  | "published";

export interface PendingPaymentRecord {
  /** UUID from /stealth/create. Stable across retries. */
  payment_id: string;
  /** Schema version for forward-compatible migrations. */
  schema_version: 1;
  /** Display name of recipient (ENS / SuiNS / "meta-address"). */
  recipient: string;
  /** Public recipient meta-address (hex). Useful for forensic recovery. */
  meta_address: string;
  /** Server-built Ethereum stealth address (always present). */
  stealth_address: string;
  /** Server-built Sui stealth address (present when Sui-derivable). */
  stealth_sui_address: string;
  /** Full announcement DTO; sent as fallback if the server's pending entry expired. */
  announcement: AnnouncementDto;
  /** Chain the user is publishing to (chosen at create or send time). */
  chain: "ethereum" | "sui";
  /** Lifecycle status. */
  status: PendingStatus;
  /** ms since epoch. */
  created_at: number;
  /** ms since epoch — last touched. */
  updated_at: number;
  /** Confirmed transaction hash (filled at status >= sent_unpublished). */
  tx_hash?: string;
  /** Amount in the chain's display unit (filled at status >= sent_unpublished). */
  amount?: string;
  /** Number of publish failures so far — informational, used to throttle alerts. */
  publish_attempts: number;
  /** Last publish error message (truncated), if any. */
  last_publish_error?: string;
}

/** Internal map shape persisted to storage. */
interface PendingStore {
  version: 1;
  records: Record<string, PendingPaymentRecord>;
}

const EMPTY_STORE: PendingStore = { version: 1, records: {} };

/* ────────────────────────────────────────────────────────────────────────── */
/* Internal helpers                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

function logWarn(msg: string, err?: unknown) {
  // We deliberately keep logging cheap and side-effect free. Errors that
  // happen here (quota, JSON parse) MUST NOT propagate to caller code paths
  // that are mid-payment, otherwise we risk a stuck UI.
  console.warn(`[pendingPayment] ${msg}`, err ?? "");
}

function safeNow(): number {
  return Date.now();
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStore(): PendingStore {
  if (!isBrowser()) return { ...EMPTY_STORE, records: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_STORE, records: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as PendingStore).version !== 1 ||
      typeof (parsed as PendingStore).records !== "object" ||
      (parsed as PendingStore).records === null
    ) {
      logWarn("Discarding malformed store; resetting to empty.");
      return { ...EMPTY_STORE, records: {} };
    }
    return parsed as PendingStore;
  } catch (err) {
    logWarn("Failed to read pending store; treating as empty.", err);
    return { ...EMPTY_STORE, records: {} };
  }
}

function writeStore(store: PendingStore): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    // localStorage can throw on quota exceeded or when disabled (private mode
    // / iframe). We MUST swallow — the caller is mid-payment.
    logWarn("Failed to persist pending store (quota or disabled).", err);
  }
}

function pruneInPlace(store: PendingStore, ttlMs: number, now: number): PendingStore {
  const entries = Object.entries(store.records);

  // Drop expired and already-published-and-stale entries.
  const live: Array<[string, PendingPaymentRecord]> = [];
  for (const [id, rec] of entries) {
    const age = now - rec.updated_at;
    if (age > ttlMs) continue;
    if (rec.status === "published" && age > 30 * 60 * 1000 /* 30m */) continue;
    live.push([id, rec]);
  }

  // Enforce max entries, oldest-out by updated_at.
  live.sort((a, b) => b[1].updated_at - a[1].updated_at);
  const kept = live.slice(0, MAX_ENTRIES);

  store.records = Object.fromEntries(kept);
  return store;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Public API                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Persist a freshly created stealth payment.
 *
 * Call this immediately after `api.createStealth(...)` succeeds, BEFORE the
 * user sees the "send" UI. Idempotent: re-saving the same `payment_id`
 * merges rather than duplicating, so refreshing after `markSent` does not
 * clobber the tx hash.
 */
export function savePending(input: {
  payment_id: string;
  recipient: string;
  meta_address: string;
  stealth_address: string;
  stealth_sui_address: string;
  announcement: AnnouncementDto;
  chain: "ethereum" | "sui";
}): PendingPaymentRecord {
  const store = readStore();
  const now = safeNow();
  const existing = store.records[input.payment_id];

  const record: PendingPaymentRecord = existing
    ? {
        ...existing,
        // Allow harmless updates (e.g. chain switch before send) but
        // never regress server-built fields silently.
        recipient: input.recipient || existing.recipient,
        meta_address: input.meta_address || existing.meta_address,
        stealth_address: input.stealth_address || existing.stealth_address,
        stealth_sui_address:
          input.stealth_sui_address || existing.stealth_sui_address,
        announcement: input.announcement ?? existing.announcement,
        chain: input.chain,
        updated_at: now,
      }
    : {
        payment_id: input.payment_id,
        schema_version: 1,
        recipient: input.recipient,
        meta_address: input.meta_address,
        stealth_address: input.stealth_address,
        stealth_sui_address: input.stealth_sui_address,
        announcement: input.announcement,
        chain: input.chain,
        status: "awaiting_send",
        created_at: now,
        updated_at: now,
        publish_attempts: 0,
      };

  store.records[input.payment_id] = record;
  pruneInPlace(store, DEFAULT_TTL_MS, now);
  writeStore(store);
  return record;
}

/**
 * Bump status to `sent_unpublished` and stash the chain + tx hash.
 *
 * Called after the on-chain transaction has been broadcast (and ideally
 * confirmed). If publishing then fails, this is the state we surface to
 * the user with the "Retry publish" CTA.
 */
export function markSent(
  payment_id: string,
  data: { tx_hash: string; chain: "ethereum" | "sui"; amount?: string },
): PendingPaymentRecord | null {
  const store = readStore();
  const rec = store.records[payment_id];
  if (!rec) {
    logWarn(`markSent: no pending record for payment_id=${payment_id}`);
    return null;
  }
  const updated: PendingPaymentRecord = {
    ...rec,
    chain: data.chain,
    tx_hash: data.tx_hash,
    amount: data.amount,
    status: "sent_unpublished",
    updated_at: safeNow(),
  };
  store.records[payment_id] = updated;
  writeStore(store);
  return updated;
}

/**
 * Mark a publish attempt failed. We keep the record alive so the user
 * (or the app, on mount) can retry.
 */
export function markPublishFailed(
  payment_id: string,
  error: string,
): PendingPaymentRecord | null {
  const store = readStore();
  const rec = store.records[payment_id];
  if (!rec) return null;
  const updated: PendingPaymentRecord = {
    ...rec,
    publish_attempts: rec.publish_attempts + 1,
    last_publish_error: error.slice(0, 240),
    updated_at: safeNow(),
  };
  store.records[payment_id] = updated;
  writeStore(store);
  return updated;
}

/**
 * Mark a payment fully complete. The record is left in storage briefly
 * (so a refreshed history view can show it as "published") and pruned
 * on the next read.
 */
export function markPublished(payment_id: string): PendingPaymentRecord | null {
  const store = readStore();
  const rec = store.records[payment_id];
  if (!rec) return null;
  const updated: PendingPaymentRecord = {
    ...rec,
    status: "published",
    last_publish_error: undefined,
    updated_at: safeNow(),
  };
  store.records[payment_id] = updated;
  writeStore(store);
  return updated;
}

/**
 * Convenience: drop a record entirely. Use this when the user explicitly
 * abandons a payment (rare) — for the normal happy path, prefer
 * `markPublished` so the record reflects reality.
 */
export function clearPending(payment_id: string): void {
  const store = readStore();
  if (!(payment_id in store.records)) return;
  delete store.records[payment_id];
  writeStore(store);
}

/** Nuke the whole vault. Used by tests + a hypothetical "reset" UI. */
export function clearAllPending(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    logWarn("Failed to clear pending store.", err);
  }
}

export function getPending(payment_id: string): PendingPaymentRecord | null {
  const store = readStore();
  const pruned = pruneInPlace(store, DEFAULT_TTL_MS, safeNow());
  return pruned.records[payment_id] ?? null;
}

/** All non-expired records, newest-first. */
export function getAllPending(): PendingPaymentRecord[] {
  const store = pruneInPlace(readStore(), DEFAULT_TTL_MS, safeNow());
  return Object.values(store.records).sort((a, b) => b.updated_at - a.updated_at);
}

/** Records the user actually needs to act on (not yet `published`). */
export function getActivePending(): PendingPaymentRecord[] {
  return getAllPending().filter((r) => r.status !== "published");
}

/** True iff there is at least one record awaiting send or publish. */
export function hasIncompletePending(): boolean {
  return getActivePending().length > 0;
}

/** Look up by tx hash — used to wire a sent on-chain transaction back to its pending record. */
export function getPendingByTxHash(txHash: string): PendingPaymentRecord | null {
  if (!txHash) return null;
  const lowered = txHash.toLowerCase();
  return (
    getAllPending().find(
      (r) => r.tx_hash && r.tx_hash.toLowerCase() === lowered,
    ) ?? null
  );
}

/**
 * Build a self-contained JSON the user can re-import to recover a payment
 * if every other safety net fails (lost tab, browser wiped, etc.).
 *
 * This is the same data we keep in storage plus a `_specter` envelope for
 * humans + future migrations.
 */
export function buildRecoveryJson(rec: PendingPaymentRecord) {
  return {
    _specter: {
      kind: "specter.payment.recovery",
      version: 1,
      exported_at: new Date().toISOString(),
      note: "Re-import this file on the Send Payment page to re-publish the announcement.",
    },
    payment_id: rec.payment_id,
    recipient: rec.recipient,
    meta_address: rec.meta_address,
    stealth_address: rec.stealth_address,
    stealth_sui_address: rec.stealth_sui_address,
    chain: rec.chain,
    status: rec.status,
    tx_hash: rec.tx_hash,
    amount: rec.amount,
    announcement: rec.announcement,
    created_at: rec.created_at,
    updated_at: rec.updated_at,
  };
}

/** Run-once cleanup helper for callers that want to GC on app start. */
export function purgeExpired(): void {
  const store = pruneInPlace(readStore(), DEFAULT_TTL_MS, safeNow());
  writeStore(store);
}

/** Test-only: exposed for unit tests. Stable name, do not rename. */
export const __internal = {
  STORAGE_KEY,
  MAX_ENTRIES,
  DEFAULT_TTL_MS,
};
