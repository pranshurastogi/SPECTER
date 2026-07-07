/**
 * "Previously claimed" — the record of past claim operations for this identity.
 *
 * Each claim (one sweep of N stealth addresses) is a group. The group header
 * summarises it (date, chain, total, address count); expanding it reveals every
 * address that was claimed with its own amount and explorer link — so a
 * multi-address claim never looks like a single transaction.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatUnits } from "viem";
import { ChevronDown, Clock, ExternalLink } from "lucide-react";
import {
  ArbitrumIcon,
  EthereumIcon,
  MonadIcon,
  SuiIcon,
} from "@/components/ui/specialized/chain-icons";
import { formatCryptoAmount } from "@/lib/utils";
import {
  getChainDecimals,
  getExplorerTxUrl,
  getSendChainConfig,
  getTxChainFromBackendName,
  type TxChain,
} from "@/lib/blockchain/sendChains";
import type { SweepHistoryGroup } from "@/lib/claim/claimApi";

function chainIcon(chain: TxChain | null) {
  const cls = "h-3.5 w-3.5";
  if (chain === "sui") return <SuiIcon className={cls} />;
  if (chain === "arbitrum") return <ArbitrumIcon className={cls} />;
  if (chain === "monad") return <MonadIcon className={cls} />;
  return <EthereumIcon className={cls} />;
}

function shortAddr(a: string) {
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

function ClaimGroup({ group }: { group: SweepHistoryGroup }) {
  const [open, setOpen] = useState(false);
  const chain = getTxChainFromBackendName(group.chain);
  const cfg = chain ? getSendChainConfig(chain) : null;
  const decimals = chain ? getChainDecimals(chain) : 18;
  const symbol = cfg?.currencySymbol ?? "";
  const dest =
    group.destinationInput !== group.destination
      ? group.destinationInput
      : shortAddr(group.destination);
  const fmt = (wei: bigint) => formatCryptoAmount(formatUnits(wei, decimals));

  return (
    <div className="rounded-lg bg-black/35 border border-white/[0.08] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.1] flex items-center justify-center shrink-0">
          {chainIcon(chain)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm text-emerald-400/90 tabular-nums">
              {fmt(group.totalAmountBase)} {symbol}
            </span>
            <span className="text-[11px] text-white/40">
              {group.confirmedCount} address{group.confirmedCount !== 1 ? "es" : ""}
            </span>
          </div>
          <div className="text-[11px] text-white/40 truncate">
            {new Date(group.createdAt * 1000).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}{" "}
            · to <span className="font-mono">{dest}</span>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-white/35 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2.5 pt-0.5 space-y-1">
              {group.rows.map((r) => {
                const explorer = chain && r.tx_hash ? getExplorerTxUrl(chain, r.tx_hash) : "";
                let amount = "";
                try {
                  amount = fmt(BigInt(r.amount_base));
                } catch {
                  amount = "";
                }
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-black/25 text-[11px]"
                  >
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                        r.status === "confirmed"
                          ? "bg-emerald-400"
                          : r.status === "skipped_dust"
                            ? "bg-white/25"
                            : "bg-destructive"
                      }`}
                    />
                    <span className="font-mono text-white/60 truncate flex-1" title={r.stealth_address}>
                      {shortAddr(r.stealth_address)}
                    </span>
                    {r.status === "confirmed" && amount && (
                      <span className="font-mono text-white/70 tabular-nums shrink-0">
                        {amount} {symbol}
                      </span>
                    )}
                    {explorer ? (
                      <a
                        href={explorer}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary/80 shrink-0"
                        aria-label="View transaction"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="w-3 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ClaimHistory({ groups }: { groups: SweepHistoryGroup[] }) {
  const [sectionOpen, setSectionOpen] = useState(true);
  if (groups.length === 0) return null;

  const totalAddresses = groups.reduce((n, g) => n + g.confirmedCount, 0);

  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/20">
      <button
        type="button"
        onClick={() => setSectionOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-1.5 font-display text-[10px] font-bold tracking-[0.16em] uppercase text-white/35">
          <Clock className="h-3 w-3 text-primary/70" />
          Previously claimed
        </span>
        <span className="text-[11px] text-white/45 flex items-center gap-1.5">
          {totalAddresses} address{totalAddresses !== 1 ? "es" : ""} · {groups.length} claim
          {groups.length !== 1 ? "s" : ""}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${sectionOpen ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {sectionOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2.5 space-y-2 max-h-[320px] overflow-y-auto [scrollbar-width:thin]">
              {groups.map((g) => (
                <ClaimGroup key={g.receiptId} group={g} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
