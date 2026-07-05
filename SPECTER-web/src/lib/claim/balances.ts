/**
 * Live balance annotation for scan discoveries.
 *
 * After a scan, each discovery is a stealth address whose *announced* amount
 * may already have been claimed. This module reads live native balances via
 * the shared per-chain viem clients (fallback transports included) so the UI
 * can hide empty addresses and only offer claiming when funds actually exist.
 */
import {
  getPublicClientForEvm,
  type EvmTxChain,
} from "@/lib/blockchain/sendChains";

/** Gas limit of a plain native transfer. */
export const NATIVE_TRANSFER_GAS = 21_000n;

/**
 * Display/claim dust threshold: 0.0001 native units (1e14 wei — all supported
 * EVM chains use 18 decimals, incl. Sepolia ETH, Arbitrum ETH, and MON).
 * Balances below this are treated as empty: hidden behind the "show empty"
 * toggle and never offered for claiming. Independent of the dynamic gas
 * check, which additionally skips anything that can't pay its own transfer.
 */
export const DUST_THRESHOLD_WEI = 100_000_000_000_000n;

/** True when a live balance is too small to be worth showing or claiming. */
export function isBelowDust(balanceWei: bigint): boolean {
  return balanceWei < DUST_THRESHOLD_WEI;
}

/** Concurrent balance reads per chain (keeps public RPCs happy). */
const BALANCE_CONCURRENCY = 8;

/** `chain:address(lowercase)` → live balance in wei. */
export type BalanceMap = Map<string, bigint>;

export function balanceKey(chain: EvmTxChain, address: string): string {
  return `${chain}:${address.toLowerCase()}`;
}

export interface BalanceTarget {
  chain: EvmTxChain;
  address: string;
}

/**
 * Reads native balances for the given addresses, chunked per chain. An
 * address whose read fails is omitted from the map (treated as "unknown",
 * not zero) so a flaky RPC never hides claimable funds as empty.
 */
export async function fetchEvmBalances(targets: BalanceTarget[]): Promise<BalanceMap> {
  const out: BalanceMap = new Map();

  // De-duplicate (several discoveries can share an address only in theory,
  // but the map key must be unique regardless).
  const unique = new Map<string, BalanceTarget>();
  for (const t of targets) unique.set(balanceKey(t.chain, t.address), t);

  const byChain = new Map<EvmTxChain, BalanceTarget[]>();
  for (const t of unique.values()) {
    const list = byChain.get(t.chain) ?? [];
    list.push(t);
    byChain.set(t.chain, list);
  }

  await Promise.all(
    [...byChain.entries()].map(async ([chain, list]) => {
      const client = getPublicClientForEvm(chain);
      for (let i = 0; i < list.length; i += BALANCE_CONCURRENCY) {
        const chunk = list.slice(i, i + BALANCE_CONCURRENCY);
        await Promise.all(
          chunk.map(async (t) => {
            try {
              const balance = await client.getBalance({
                address: t.address as `0x${string}`,
              });
              out.set(balanceKey(chain, t.address), balance);
            } catch {
              /* unknown — leave out of the map */
            }
          }),
        );
      }
    }),
  );

  return out;
}

/** Current fee context for claim planning on a chain. */
export interface ClaimFeeContext {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Wei deducted from each swept balance: 21000 × maxFeePerGas. */
  gasCostWei: bigint;
}

/** Fetches EIP-1559 fee estimates and derives the per-address sweep cost. */
export async function estimateClaimFees(chain: EvmTxChain): Promise<ClaimFeeContext> {
  const client = getPublicClientForEvm(chain);
  const fees = await client.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? 0n;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 0n;
  return {
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasCostWei: NATIVE_TRANSFER_GAS * maxFeePerGas,
  };
}

/** True when a balance can pay for its own sweep and still send something. */
export function isClaimable(balanceWei: bigint, gasCostWei: bigint): boolean {
  return balanceWei > gasCostWei;
}

/** The value actually sent by a sweep: balance − gas budget (never negative). */
export function sweepValue(balanceWei: bigint, gasCostWei: bigint): bigint {
  return balanceWei > gasCostWei ? balanceWei - gasCostWei : 0n;
}
