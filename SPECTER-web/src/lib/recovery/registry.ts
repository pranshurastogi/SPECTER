/**
 * Fast announcement source: SPECTER's deployed backend registry (REST).
 *
 * `GET /api/v1/registry/announcements` returns the FULL 1088-byte ML-KEM
 * ciphertext (`ephemeral_key`) already recovered from calldata at index time,
 * plus the payment's amount/source-chain (which on-chain metadata no longer
 * exposes — it's an AEAD blob now). So, unlike the direct-RPC sweep, this path
 * needs no per-announcement `getTransaction` and no million-block walk: a few
 * paginated reads return everything `recover.ts` needs.
 *
 * Trust note: this serves ONLY public on-chain data — GET reads need no API key
 * and the user's keys never appear in any request. All decapsulation and key
 * derivation still happen in the browser via WASM, and the recovered card
 * self-verifies the derived key. The "Direct RPC" mode remains for those who
 * won't trust even this; `recover.ts` falls back to it automatically on failure.
 */

import { type Hex } from "viem";
import type { ChainAnnouncement, FetchOptions } from "./announcer";
import { ScanAbortedError, isScanAborted } from "./announcer";

/** Rows pulled per REST page. */
const PAGE_SIZE = 500;

/** Shape of one row from `/api/v1/registry/announcements` (see specter-api `dto.rs`). */
interface RegistryAnnouncementDto {
  id: number;
  /** Full 1088-byte ML-KEM ciphertext (hex, no 0x prefix). */
  ephemeral_key: string;
  view_tag: number;
  timestamp: number;
  source_chain_id?: number | null;
  /** Monad announce() tx hash. */
  tx_hash?: string | null;
  /** Source-chain payment tx hash. */
  payment_tx_hash?: string | null;
  /** Amount in base units, hex uint256 (e.g. "0x...de0b6b3a7640000"). */
  amount?: string | null;
  chain?: string | null;
  stealth_address?: string | null;
}

interface ListResponse {
  announcements: RegistryAnnouncementDto[];
  total: number;
}

/** 0x-prefix a hex string the registry may store without the prefix. */
function withPrefix(hex: string): Hex {
  return (hex.startsWith("0x") ? hex : `0x${hex}`) as Hex;
}

/** Parse the registry's base-unit amount (hex/decimal string) to bigint. */
function parseAmount(a: string | null | undefined): bigint | undefined {
  if (!a) return undefined;
  try {
    return BigInt(a);
  } catch {
    return undefined;
  }
}

async function getPage(
  apiBaseUrl: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<ListResponse> {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const url = `${base}/api/v1/registry/announcements?offset=${offset}&limit=${limit}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) {
    throw new Error(`registry responded ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as Partial<ListResponse>;
  return {
    announcements: json.announcements ?? [],
    total: typeof json.total === "number" ? json.total : (json.announcements?.length ?? 0),
  };
}

/**
 * Fetch every announcement from the deployed registry, NEWEST-FIRST.
 *
 * The endpoint returns rows ordered by `id ASC` (oldest→newest) with offset/limit
 * pagination and a full `total`, so we probe the count, then page from the TAIL
 * downward — reversing each page — to emit the most recent announcements first.
 * Throws on any transport/HTTP failure so the caller can fall back to the RPC sweep.
 */
export async function fetchAnnouncementsFromRegistry(
  apiBaseUrl: string,
  opts: FetchOptions = {},
): Promise<ChainAnnouncement[]> {
  const { signal } = opts;
  const announcements: ChainAnnouncement[] = [];
  const seen = new Set<number>();

  if (signal?.aborted) throw new ScanAbortedError();

  // Probe the total (1 cheap row; its data is re-fetched by the final window).
  let total: number;
  try {
    total = (await getPage(apiBaseUrl, 0, 1, signal)).total;
  } catch (err) {
    if (isScanAborted(err)) throw err;
    throw err; // surface to recover.ts → RPC fallback
  }

  let rowsFetched = 0;
  // `hi` is the exclusive upper index of the range [0, hi) still to fetch.
  let hi = total;
  while (hi > 0) {
    if (signal?.aborted) throw new ScanAbortedError();
    const offset = Math.max(0, hi - PAGE_SIZE);
    const limit = hi - offset;

    let rows: RegistryAnnouncementDto[];
    try {
      rows = (await getPage(apiBaseUrl, offset, limit, signal)).announcements;
    } catch (err) {
      if (isScanAborted(err)) throw err;
      throw err; // surface to recover.ts → RPC fallback
    }

    // Rows come oldest→newest within the window; reverse for newest-first.
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rowsFetched++;
      const ann: ChainAnnouncement = {
        ephemeralCiphertext: withPrefix(row.ephemeral_key),
        viewTag: row.view_tag,
        txHash: withPrefix(row.tx_hash ?? "0x"),
        // The registry has no block number; the row id is a monotonic recency key.
        blockNumber: BigInt(row.id),
        stealthAddress: row.stealth_address ? withPrefix(row.stealth_address) : undefined,
        sourceChainId: row.source_chain_id ?? undefined,
        amount: parseAmount(row.amount),
        paymentTxHash: row.payment_tx_hash ?? undefined,
      };
      announcements.push(ann);
      opts.onAnnouncement?.(ann);
    }

    opts.onProgress?.({ kind: "indexer", rowsFetched, found: announcements.length });
    hi = offset;
  }

  return announcements;
}
