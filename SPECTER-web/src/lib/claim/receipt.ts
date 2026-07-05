/**
 * Claim receipts: the durable, user-facing proof of a claim operation.
 *
 * A receipt groups the per-address sweep rows of one claim. It renders in
 * the app, downloads as JSON, and its rows are POSTed (best-effort) to the
 * backend `sweep_records` table keyed by a hashed identity.
 */
import type { EvmTxChain } from "@/lib/blockchain/sendChains";
import type { SweepRowResult } from "./sweep";

export interface ClaimReceiptRow {
  id: string;
  stealthAddress: string;
  /** Wei sent, decimal string. */
  amountBase: string;
  /** Wei deducted as the gas budget, decimal string. */
  feeBase: string;
  txHash: string;
  status: "confirmed" | "failed" | "skipped_dust";
}

export interface ClaimReceipt {
  receiptId: string;
  /** Unix seconds. */
  createdAt: number;
  chain: EvmTxChain;
  /** Backend chain name (server `CHAIN_RPC_<NAME>` key). */
  backendChain: string;
  /** Resolved destination address. */
  destination: string;
  /** What the user typed (ENS name or the address). */
  destinationInput: string;
  rows: ClaimReceiptRow[];
  /** Sum of confirmed row amounts, wei decimal string. */
  totalAmountBase: string;
  /** Sum of confirmed row fees, wei decimal string. */
  totalFeeBase: string;
  confirmed: number;
  failed: number;
  skipped: number;
}

/** Terminal row statuses recorded on a receipt (in-flight ones collapse to failed). */
function terminalStatus(s: SweepRowResult["status"]): ClaimReceiptRow["status"] {
  if (s === "confirmed") return "confirmed";
  if (s === "skipped_dust") return "skipped_dust";
  return "failed";
}

export function buildReceipt(input: {
  chain: EvmTxChain;
  backendChain: string;
  destination: string;
  destinationInput: string;
  rows: SweepRowResult[];
}): ClaimReceipt {
  let totalAmount = 0n;
  let totalFee = 0n;
  let confirmed = 0;
  let failed = 0;
  let skipped = 0;

  const rows: ClaimReceiptRow[] = input.rows.map((r) => {
    const status = terminalStatus(r.status);
    if (status === "confirmed") {
      confirmed += 1;
      totalAmount += r.amountWei;
      totalFee += r.feeWei;
    } else if (status === "skipped_dust") {
      skipped += 1;
    } else {
      failed += 1;
    }
    return {
      id: r.id,
      stealthAddress: r.address,
      amountBase: r.amountWei.toString(),
      feeBase: r.feeWei.toString(),
      txHash: r.txHash,
      status,
    };
  });

  return {
    receiptId: crypto.randomUUID(),
    createdAt: Math.floor(Date.now() / 1000),
    chain: input.chain,
    backendChain: input.backendChain,
    destination: input.destination,
    destinationInput: input.destinationInput,
    rows,
    totalAmountBase: totalAmount.toString(),
    totalFeeBase: totalFee.toString(),
    confirmed,
    failed,
    skipped,
  };
}

/**
 * SHA-256 of the meta-address bytes, lowercase hex — the server-side lookup
 * key for sweep history. Hashing keeps the registry DB unable to map sweep
 * rows back to an identity it doesn't already know.
 */
export async function identityHashFromMetaAddress(metaAddressHex: string): Promise<string> {
  const clean = metaAddressHex.trim().toLowerCase().replace(/^0x/, "");
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) {
    throw new Error("Invalid meta-address hex");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Triggers a browser download of the receipt as pretty-printed JSON. */
export function downloadReceiptJson(receipt: ClaimReceipt): void {
  const blob = new Blob([JSON.stringify(receipt, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `specter-claim-${receipt.receiptId.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
