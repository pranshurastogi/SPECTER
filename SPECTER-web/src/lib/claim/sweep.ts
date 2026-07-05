/**
 * The sweep engine: signs and broadcasts one native transfer per funded
 * stealth address, entirely in the browser. Private keys come from the
 * in-memory scan result and NEVER leave this module's call stack — signing
 * uses viem's local account, and only the raw signed transaction is sent
 * to the RPC.
 *
 * Execution is sequential (one address at a time): every stealth address is
 * its own account (nonce 0 or later), so there is no ordering dependency,
 * but sequential keeps RPC pressure low and error attribution obvious.
 */
import { privateKeyToAccount } from "viem/accounts";
import {
  getPublicClientForEvm,
  getViemChainForEvm,
  type EvmTxChain,
} from "@/lib/blockchain/sendChains";
import { NATIVE_TRANSFER_GAS, isClaimable, sweepValue } from "./balances";

export type SweepRowStatus =
  | "queued"
  | "signing"
  | "broadcasting"
  | "confirming"
  | "confirmed"
  | "failed"
  | "skipped_dust";

/** One address to sweep. `privateKey` is the derived stealth spend key. */
export interface SweepPlanItem {
  address: string;
  privateKey: string;
  /** Balance observed at planning time (re-read before signing). */
  balanceWei: bigint;
}

/** Live status of one sweep row, streamed to the UI via `onUpdate`. */
export interface SweepRowResult {
  /** Client UUID — also the idempotency key for the server record. */
  id: string;
  address: string;
  status: SweepRowStatus;
  txHash: string;
  /** Value actually sent (wei). 0 until known. */
  amountWei: bigint;
  /** Gas budget deducted from the balance (wei). 0 until known. */
  feeWei: bigint;
  /** Human-readable error for failed rows. */
  error?: string;
}

export interface SweepRunResult {
  rows: SweepRowResult[];
  confirmed: number;
  failed: number;
  skipped: number;
  totalSweptWei: bigint;
}

const RECEIPT_TIMEOUT_MS = 120_000;

const with0x = (s: string): `0x${string}` =>
  (s.startsWith("0x") ? s : `0x${s}`) as `0x${string}`;

/**
 * Sweeps a single address: re-reads the balance, prices the transfer, signs
 * locally, broadcasts, and waits for the receipt. Mutates `row` through the
 * status lifecycle and reports each transition via `onUpdate`.
 */
async function sweepOne(
  chain: EvmTxChain,
  item: SweepPlanItem,
  destination: `0x${string}`,
  row: SweepRowResult,
  onUpdate: (row: SweepRowResult) => void,
): Promise<void> {
  const client = getPublicClientForEvm(chain);
  const update = (patch: Partial<SweepRowResult>) => {
    Object.assign(row, patch);
    onUpdate({ ...row });
  };

  update({ status: "signing" });

  // Fresh balance + fees at execution time — the scan-time numbers may be
  // stale, and a fee spike can turn a claimable address into dust.
  const balance = await client.getBalance({
    address: item.address as `0x${string}`,
  });
  const fees = await client.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? 0n;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 0n;
  const gasCost = NATIVE_TRANSFER_GAS * maxFeePerGas;

  if (!isClaimable(balance, gasCost)) {
    update({ status: "skipped_dust", amountWei: 0n, feeWei: 0n });
    return;
  }

  const value = sweepValue(balance, gasCost);
  const account = privateKeyToAccount(with0x(item.privateKey));
  const viemChain = getViemChainForEvm(chain);
  const nonce = await client.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });

  const signed = await account.signTransaction({
    chainId: viemChain.id,
    to: destination,
    value,
    gas: NATIVE_TRANSFER_GAS,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce,
    type: "eip1559",
  });

  update({ status: "broadcasting", amountWei: value, feeWei: gasCost });
  const txHash = await client.sendRawTransaction({ serializedTransaction: signed });

  update({ status: "confirming", txHash });
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    timeout: RECEIPT_TIMEOUT_MS,
  });

  if (receipt.status !== "success") {
    update({ status: "failed", error: "Transaction reverted on-chain" });
    return;
  }
  update({ status: "confirmed" });
}

/**
 * Runs the full sweep sequentially. A failed address never aborts the batch —
 * it is reported per-row and the run continues; callers can re-invoke with
 * just the failed items to retry.
 */
export async function sweepAddresses(
  chain: EvmTxChain,
  items: SweepPlanItem[],
  destination: string,
  onUpdate: (row: SweepRowResult) => void,
): Promise<SweepRunResult> {
  const dest = destination as `0x${string}`;
  const rows: SweepRowResult[] = items.map((item) => ({
    id: crypto.randomUUID(),
    address: item.address,
    status: "queued",
    txHash: "",
    amountWei: 0n,
    feeWei: 0n,
  }));

  for (let i = 0; i < items.length; i++) {
    const row = rows[i]!;
    try {
      await sweepOne(chain, items[i]!, dest, row, onUpdate);
    } catch (err) {
      row.status = "failed";
      row.error = err instanceof Error ? err.message : "Sweep failed";
      onUpdate({ ...row });
    }
  }

  return summarize(rows);
}

/** Aggregates row outcomes into the run summary. */
export function summarize(rows: SweepRowResult[]): SweepRunResult {
  let confirmed = 0;
  let failed = 0;
  let skipped = 0;
  let totalSweptWei = 0n;
  for (const r of rows) {
    if (r.status === "confirmed") {
      confirmed += 1;
      totalSweptWei += r.amountWei;
    } else if (r.status === "skipped_dust") {
      skipped += 1;
    } else {
      failed += 1;
    }
  }
  return { rows, confirmed, failed, skipped, totalSweptWei };
}
