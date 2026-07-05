/**
 * The post-scan balance card: one glanceable surface answering "how much is
 * mine, how much of it can I claim right now?" — driven entirely by live
 * on-chain balances (claimable) and recorded claim history (claimed), never
 * by announced amounts, which go stale the moment funds are swept.
 *
 * Per chain: a headline claimable amount plus a segmented bar showing the
 * claimable vs already-claimed split, in the chain's accent colour.
 */
import { motion } from "framer-motion";
import { formatUnits } from "viem";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/base/button";
import {
  ArbitrumIcon,
  EthereumIcon,
  MonadIcon,
  SuiIcon,
} from "@/components/ui/specialized/chain-icons";
import { formatCryptoAmount } from "@/lib/utils";
import {
  getChainDecimals,
  getSendChainConfig,
  type EvmTxChain,
} from "@/lib/blockchain/sendChains";
import type { ClaimableChainSummary } from "./ChainPicker";

const CHAIN_COLOR: Record<EvmTxChain, string> = {
  ethereum: "#8B5CF6",
  arbitrum: "#96BEDC",
  monad: "#9E7BFF",
};

function chainIcon(chain: EvmTxChain) {
  const cls = "h-3.5 w-3.5";
  switch (chain) {
    case "ethereum":
      return <EthereumIcon className={cls} />;
    case "arbitrum":
      return <ArbitrumIcon className={cls} />;
    case "monad":
      return <MonadIcon className={cls} />;
  }
}

export interface ClaimBalanceCardProps {
  /** True while live balances are still being read. */
  loading: boolean;
  /** Funded chains with live claimable totals. */
  chains: ClaimableChainSummary[];
  /** Per-chain totals already claimed (from recorded history). */
  claimedByChain: Map<EvmTxChain, bigint>;
  /** True when funded Sui discoveries exist (claiming not yet supported). */
  suiFunded: boolean;
  onClaim: () => void;
}

export function ClaimBalanceCard({
  loading,
  chains,
  claimedByChain,
  suiFunded,
  onClaim,
}: ClaimBalanceCardProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-black/25 px-4 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary/70" />
        Checking live balances on-chain…
      </div>
    );
  }

  // Every chain that has something claimable or something already claimed.
  const rows = new Map<EvmTxChain, { claimable: bigint; count: number; claimed: bigint }>();
  for (const c of chains) {
    rows.set(c.chain, { claimable: c.totalWei, count: c.count, claimed: 0n });
  }
  for (const [chain, wei] of claimedByChain) {
    if (wei === 0n) continue;
    const row = rows.get(chain) ?? { claimable: 0n, count: 0, claimed: 0n };
    row.claimed = wei;
    rows.set(chain, row);
  }

  if (rows.size === 0 && !suiFunded) return null;

  const claimableChains = chains.filter((c) => c.totalWei > 0n);
  const fundedAddresses = claimableChains.reduce((n, c) => n + c.count, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.04]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

      {/* Header: label + the claim action, on one line. */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-1">
        <div className="min-w-0">
          <p className="font-display text-[10px] font-bold tracking-[0.16em] uppercase text-white/35">
            Your balance
          </p>
          {fundedAddresses > 0 && (
            <p className="text-[11px] text-white/40 mt-0.5">
              in {fundedAddresses} stealth address{fundedAddresses !== 1 ? "es" : ""}
            </p>
          )}
        </div>
        {claimableChains.length > 0 ? (
          <Button variant="quantum" size="sm" onClick={onClaim} className="shrink-0">
            <Wallet className="h-3.5 w-3.5 mr-1.5" />
            Claim
          </Button>
        ) : (
          <span className="text-[11px] text-white/40 shrink-0">Nothing to claim</span>
        )}
      </div>

      <div className="px-4 pb-3.5 pt-1.5 space-y-3">
        {[...rows.entries()].map(([chain, row]) => {
          const cfg = getSendChainConfig(chain);
          const decimals = getChainDecimals(chain);
          const fmt = (wei: bigint) => formatCryptoAmount(formatUnits(wei, decimals));
          const total = row.claimable + row.claimed;
          const claimablePct = total > 0n ? Number((row.claimable * 1000n) / total) / 10 : 0;
          const color = CHAIN_COLOR[chain];
          return (
            <div key={chain}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/60">
                  {chainIcon(chain)}
                  {cfg.shortLabel}
                </span>
                <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
                  {fmt(row.claimable)}{" "}
                  <span className="text-xs font-normal text-white/45">{cfg.currencySymbol}</span>
                </span>
              </div>
              {/* Claimable vs claimed, as one segmented bar. */}
              <div className="mt-1.5 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
                {row.claimable > 0n && (
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${claimablePct}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 22 }}
                  />
                )}
                {row.claimed > 0n && (
                  <div className="h-full flex-1 rounded-full bg-white/[0.12]" />
                )}
              </div>
              <div className="mt-1 flex items-center gap-3 text-[10px] text-white/40">
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  claimable
                </span>
                {row.claimed > 0n && (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/[0.25]" />
                    {fmt(row.claimed)} claimed
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {suiFunded && (
          <div className="flex items-center gap-1.5 text-[10px] text-white/35">
            <SuiIcon className="h-3 w-3 text-[#4DA2FF]/70" />
            Sui payments detected — claiming on Sui is coming soon
          </div>
        )}
      </div>
    </motion.div>
  );
}
