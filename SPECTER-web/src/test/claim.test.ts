import { describe, it, expect } from "vitest";
import {
  balanceKey,
  isClaimable,
  sweepValue,
  NATIVE_TRANSFER_GAS,
} from "@/lib/claim/balances";
import { summarize, type SweepRowResult } from "@/lib/claim/sweep";
import { buildReceipt, identityHashFromMetaAddress } from "@/lib/claim/receipt";
import { groupSweepHistory, claimedAddressSet } from "@/lib/claim/claimApi";
import type { SweepRecordDto } from "@/lib/api";

const GWEI = 1_000_000_000n;

function row(overrides: Partial<SweepRowResult> = {}): SweepRowResult {
  return {
    id: "row-1",
    address: "0x1111111111111111111111111111111111111111",
    status: "confirmed",
    txHash: "0x" + "ab".repeat(32),
    amountWei: 1_000_000_000_000_000n,
    feeWei: 31_500_000_000_000n,
    ...overrides,
  };
}

function historyRow(overrides: Partial<SweepRecordDto> = {}): SweepRecordDto {
  return {
    id: "h-1",
    receipt_id: "rcpt-1",
    chain: "sepolia",
    stealth_address: "0x1111111111111111111111111111111111111111",
    destination: "0x2222222222222222222222222222222222222222",
    destination_input: "alice.eth",
    amount_base: "1000",
    fee_base: "21",
    tx_hash: "0x" + "cd".repeat(32),
    status: "confirmed",
    created_at: 1_750_000_000,
    ...overrides,
  };
}

describe("claim balances math", () => {
  it("keys balances by chain and lowercase address", () => {
    expect(balanceKey("ethereum", "0xABCdef0000000000000000000000000000000001")).toBe(
      "ethereum:0xabcdef0000000000000000000000000000000001",
    );
  });

  it("an address is claimable only when balance exceeds the gas budget", () => {
    const gasCost = NATIVE_TRANSFER_GAS * (1n * GWEI); // 21000 gwei
    expect(isClaimable(gasCost + 1n, gasCost)).toBe(true);
    expect(isClaimable(gasCost, gasCost)).toBe(false); // would send 0
    expect(isClaimable(0n, gasCost)).toBe(false);
  });

  it("sweep value is balance minus gas budget, floored at zero", () => {
    const gasCost = NATIVE_TRANSFER_GAS * (2n * GWEI);
    expect(sweepValue(gasCost + 5n, gasCost)).toBe(5n);
    expect(sweepValue(gasCost - 1n, gasCost)).toBe(0n);
  });
});

describe("sweep summarize", () => {
  it("counts confirmed/failed/skipped and totals only confirmed amounts", () => {
    const rows: SweepRowResult[] = [
      row({ id: "a", amountWei: 100n }),
      row({ id: "b", status: "failed", amountWei: 999n, error: "boom" }),
      row({ id: "c", status: "skipped_dust", amountWei: 0n }),
      row({ id: "d", amountWei: 50n }),
    ];
    const s = summarize(rows);
    expect(s.confirmed).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.totalSweptWei).toBe(150n);
  });
});

describe("claim receipt", () => {
  it("builds totals from confirmed rows only and collapses in-flight to failed", () => {
    const receipt = buildReceipt({
      chain: "ethereum",
      backendChain: "sepolia",
      destination: "0x2222222222222222222222222222222222222222",
      destinationInput: "alice.eth",
      rows: [
        row({ id: "a", amountWei: 100n, feeWei: 10n }),
        // an interrupted row (e.g. tab closed mid-broadcast) records as failed
        row({ id: "b", status: "broadcasting", amountWei: 40n, feeWei: 4n }),
        row({ id: "c", status: "skipped_dust", amountWei: 0n, feeWei: 0n }),
      ],
    });
    expect(receipt.totalAmountBase).toBe("100");
    expect(receipt.totalFeeBase).toBe("10");
    expect(receipt.confirmed).toBe(1);
    expect(receipt.failed).toBe(1);
    expect(receipt.skipped).toBe(1);
    expect(receipt.rows[1]!.status).toBe("failed");
    expect(receipt.receiptId).toMatch(/[0-9a-f-]{36}/);
  });

  it("computes the identity hash as SHA-256 of the meta-address bytes", async () => {
    // SHA-256(0xabcd) — independently verifiable test vector.
    const hash = await identityHashFromMetaAddress("0xABCD");
    expect(hash).toBe(
      "123d4c7ef2d1600a1b3a0f6addc60a10f05a3495c9409f2ecbf4cc095d000a6b",
    );
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // 0x prefix and case must not change the hash.
    expect(await identityHashFromMetaAddress("abcd")).toBe(hash);
  });

  it("rejects malformed meta-address hex", async () => {
    await expect(identityHashFromMetaAddress("0xzz")).rejects.toThrow();
    await expect(identityHashFromMetaAddress("0xabc")).rejects.toThrow(); // odd length
    await expect(identityHashFromMetaAddress("")).rejects.toThrow();
  });
});

describe("sweep history grouping", () => {
  it("groups rows by receipt and sorts groups newest first", () => {
    const groups = groupSweepHistory([
      historyRow({ id: "1", receipt_id: "old", created_at: 100, amount_base: "10" }),
      historyRow({ id: "2", receipt_id: "new", created_at: 200, amount_base: "20" }),
      historyRow({ id: "3", receipt_id: "new", created_at: 201, amount_base: "5" }),
      historyRow({
        id: "4",
        receipt_id: "new",
        created_at: 202,
        amount_base: "999",
        status: "failed",
      }),
    ]);
    expect(groups.map((g) => g.receiptId)).toEqual(["new", "old"]);
    const newest = groups[0]!;
    expect(newest.rows).toHaveLength(3);
    expect(newest.confirmedCount).toBe(2);
    expect(newest.totalAmountBase).toBe(25n); // failed row excluded
  });

  it("collects confirmed stealth addresses lowercased", () => {
    const groups = groupSweepHistory([
      historyRow({ stealth_address: "0xAAAA000000000000000000000000000000000001" }),
      historyRow({
        id: "x",
        stealth_address: "0xBBBB000000000000000000000000000000000002",
        status: "failed",
      }),
    ]);
    const set = claimedAddressSet(groups);
    expect(set.has("0xaaaa000000000000000000000000000000000001")).toBe(true);
    expect(set.has("0xbbbb000000000000000000000000000000000002")).toBe(false);
  });
});
