/**
 * Server persistence for claim receipts — strictly best-effort. A claim is
 * complete the moment its transactions confirm on-chain; recording history
 * rows must never block or fail the user's flow.
 */
import { api, type SweepRecordDto } from "@/lib/api";
import type { ClaimReceipt } from "./receipt";

/**
 * POSTs the receipt's rows to `sweep_records`. Returns true when stored.
 * Idempotent server-side (row ids are UUIDs), so retrying is always safe.
 */
export async function recordReceiptBestEffort(
  receipt: ClaimReceipt,
  identityHash: string,
): Promise<boolean> {
  try {
    await api.recordSweeps({
      receipt_id: receipt.receiptId,
      identity_hash: identityHash,
      chain: receipt.backendChain,
      destination: receipt.destination,
      destination_input: receipt.destinationInput,
      records: receipt.rows.map((r) => ({
        id: r.id,
        stealth_address: r.stealthAddress,
        amount_base: r.amountBase,
        fee_base: r.feeBase,
        tx_hash: r.txHash,
        status: r.status,
      })),
    });
    return true;
  } catch {
    return false;
  }
}

/** One past claim operation (grouped rows), for "Previously claimed". */
export interface SweepHistoryGroup {
  receiptId: string;
  chain: string;
  destination: string;
  destinationInput: string;
  createdAt: number;
  rows: SweepRecordDto[];
  /** Sum of confirmed row amounts, wei. */
  totalAmountBase: bigint;
  confirmedCount: number;
}

/** Groups flat sweep rows (newest-first from the API) by receipt. */
export function groupSweepHistory(rows: SweepRecordDto[]): SweepHistoryGroup[] {
  const groups = new Map<string, SweepHistoryGroup>();
  for (const row of rows) {
    let g = groups.get(row.receipt_id);
    if (!g) {
      g = {
        receiptId: row.receipt_id,
        chain: row.chain,
        destination: row.destination,
        destinationInput: row.destination_input,
        createdAt: row.created_at,
        rows: [],
        totalAmountBase: 0n,
        confirmedCount: 0,
      };
      groups.set(row.receipt_id, g);
    }
    g.rows.push(row);
    g.createdAt = Math.max(g.createdAt, row.created_at);
    if (row.status === "confirmed") {
      g.confirmedCount += 1;
      try {
        g.totalAmountBase += BigInt(row.amount_base);
      } catch {
        /* malformed legacy row — skip from the total */
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Fetches and groups an identity's claim history. Returns [] on any error —
 * history is an enhancement, never a blocker for scanning.
 */
export async function fetchSweepHistory(identityHash: string): Promise<SweepHistoryGroup[]> {
  try {
    const res = await api.listSweeps(identityHash);
    return groupSweepHistory(res.sweeps);
  } catch {
    return [];
  }
}

/** Set of stealth addresses (lowercase) that appear in confirmed history rows. */
export function claimedAddressSet(groups: SweepHistoryGroup[]): Set<string> {
  const set = new Set<string>();
  for (const g of groups) {
    for (const r of g.rows) {
      if (r.status === "confirmed") set.add(r.stealth_address.toLowerCase());
    }
  }
  return set;
}
