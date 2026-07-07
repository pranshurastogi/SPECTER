/**
 * Step 4 of the claim flow: live per-address progress. Each row animates
 * through queued → signing → broadcasting → confirming → confirmed (or
 * failed / skipped), with a running total and per-row retry for failures.
 */
import { motion, AnimatePresence } from "framer-motion";
import { formatUnits } from "viem";
import {
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/base/button";
import { formatCryptoAmount } from "@/lib/utils";
import {
  getChainDecimals,
  getSendChainConfig,
  type EvmTxChain,
} from "@/lib/blockchain/sendChains";
import type { SweepRowResult, SweepRowStatus } from "@/lib/claim/sweep";

const STATUS_LABEL: Record<SweepRowStatus, string> = {
  queued: "Queued",
  signing: "Signing locally…",
  broadcasting: "Broadcasting…",
  confirming: "Waiting for confirmation…",
  confirmed: "Confirmed",
  failed: "Failed",
  skipped_dust: "Skipped — too small to cover gas",
};

function StatusIcon({ status }: { status: SweepRowStatus }) {
  switch (status) {
    case "queued":
      return <Circle className="h-4 w-4 text-white/25" />;
    case "signing":
    case "broadcasting":
    case "confirming":
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    case "confirmed":
      return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "skipped_dust":
      return <MinusCircle className="h-4 w-4 text-white/30" />;
  }
}

interface ClaimProgressProps {
  chain: EvmTxChain;
  rows: SweepRowResult[];
  running: boolean;
  onRetryFailed: () => void;
  onDone: () => void;
}

export function ClaimProgress({ chain, rows, running, onRetryFailed, onDone }: ClaimProgressProps) {
  const cfg = getSendChainConfig(chain);
  const decimals = getChainDecimals(chain);
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const failed = rows.filter((r) => r.status === "failed");
  // A row counts toward progress once it reaches a terminal state.
  const settled = rows.filter(
    (r) => r.status === "confirmed" || r.status === "failed" || r.status === "skipped_dust",
  );
  const totalSwept = confirmed.reduce((acc, r) => acc + r.amountWei, 0n);
  const done = !running;
  const pct = rows.length ? Math.round((settled.length / rows.length) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Overall progress: a single honest number + a filling bar. */}
      <div className="rounded-xl border border-white/[0.07] bg-black/25 px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-foreground">
            {done ? "Claim complete" : "Claiming…"}
          </span>
          <span className="text-xs font-mono tabular-nums text-white/55">
            {settled.length}/{rows.length}
          </span>
        </div>
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary/70 to-emerald-400/80"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
        <div className="mt-2.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-white/40">
            {running ? "Signing on your device — keys never leave" : `${confirmed.length} confirmed`}
          </span>
          <span className="text-xs font-mono tabular-nums text-emerald-400/90">
            {formatCryptoAmount(formatUnits(totalSwept, decimals))} {cfg.currencySymbol}
          </span>
        </div>
      </div>

      <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1 [scrollbar-width:thin]">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`px-3 py-2.5 rounded-lg border flex items-center gap-2.5 ${
                r.status === "failed"
                  ? "bg-destructive/10 border-destructive/30"
                  : r.status === "confirmed"
                    ? "bg-emerald-400/[0.06] border-emerald-400/15"
                    : "bg-black/30 border-white/[0.08]"
              }`}
            >
              <StatusIcon status={r.status} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-mono truncate" title={r.address}>
                  {r.address.slice(0, 10)}…{r.address.slice(-6)}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {r.status === "failed" && r.error ? r.error : STATUS_LABEL[r.status]}
                </p>
              </div>
              {r.status === "confirmed" && (
                <span className="text-xs font-mono text-emerald-400/90 shrink-0 tabular-nums">
                  {formatCryptoAmount(formatUnits(r.amountWei, decimals))}
                </span>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {done && (
        <div className="flex gap-2">
          {failed.length > 0 && (
            <Button variant="outline" size="default" onClick={onRetryFailed} className="flex-1">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Retry {failed.length}
            </Button>
          )}
          <Button variant="quantum" size="default" className="flex-1" onClick={onDone}>
            View receipt
          </Button>
        </div>
      )}
    </div>
  );
}
