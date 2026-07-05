/**
 * The claim flow: a modal wizard over the scan results.
 *
 *   chain → destination → confirm → progress → receipt
 *
 * Lives in the same component tree as the scan results because the derived
 * stealth private keys exist only in that page's memory — a separate route
 * would have to smuggle secrets through navigation state.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatUnits } from "viem";
import { AlertTriangle, Info, Loader2, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/base/button";
import { Card, CardContent } from "@/components/ui/base/card";
import { toast } from "@/components/ui/base/sonner";
import { analytics } from "@/lib/analytics";
import { formatCryptoAmount } from "@/lib/utils";
import { parseBlockchainError } from "@/lib/blockchain/errorParser";
import {
  getBackendChainName,
  getChainDecimals,
  getSendChainConfig,
  type EvmTxChain,
} from "@/lib/blockchain/sendChains";
import {
  estimateClaimFees,
  isClaimable,
  sweepValue,
  type ClaimFeeContext,
} from "@/lib/claim/balances";
import {
  sweepAddresses,
  type SweepPlanItem,
  type SweepRowResult,
} from "@/lib/claim/sweep";
import {
  buildReceipt,
  identityHashFromMetaAddress,
  type ClaimReceipt,
} from "@/lib/claim/receipt";
import { recordReceiptBestEffort } from "@/lib/claim/claimApi";
import type { ResolvedDestination } from "@/lib/claim/destination";
import { ChainPicker, type ClaimableChainSummary } from "./ChainPicker";
import { DestinationInput } from "./DestinationInput";
import { ClaimProgress } from "./ClaimProgress";
import { ClaimReceiptView } from "./ClaimReceiptView";

type ClaimStep = "chain" | "destination" | "confirm" | "progress" | "receipt";

export interface ClaimSheetProps {
  open: boolean;
  onClose: () => void;
  /** Funded EVM chains (live balances), pre-computed by the scan page. */
  chains: ClaimableChainSummary[];
  /** True when funded Sui discoveries exist (chip shown as Coming soon). */
  suiFunded: boolean;
  /** Sweep candidates for a chain — address + derived key + live balance. */
  getItems: (chain: EvmTxChain) => SweepPlanItem[];
  /** All discovered stealth addresses, lowercased (self-send guard). */
  ownStealthAddresses: Set<string>;
  /** Identity meta-address (hex) — enables server-side claim history. */
  metaAddress: string | null;
  /** Fired once a claim run finishes, with the confirmed addresses. */
  onClaimed: (receipt: ClaimReceipt) => void;
}

const STEP_TITLES: Record<ClaimStep, string> = {
  chain: "Claim funds",
  destination: "Where should the funds go?",
  confirm: "Review your claim",
  progress: "Claiming…",
  receipt: "Claim receipt",
};

export function ClaimSheet({
  open,
  onClose,
  chains,
  suiFunded,
  getItems,
  ownStealthAddresses,
  metaAddress,
  onClaimed,
}: ClaimSheetProps) {
  const [step, setStep] = useState<ClaimStep>("chain");
  const [chain, setChain] = useState<EvmTxChain | null>(null);
  const [destination, setDestination] = useState<ResolvedDestination | null>(null);
  const [feeCtx, setFeeCtx] = useState<ClaimFeeContext | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [rows, setRows] = useState<SweepRowResult[]>([]);
  const [running, setRunning] = useState(false);
  const [receipt, setReceipt] = useState<ClaimReceipt | null>(null);
  const [recorded, setRecorded] = useState<boolean | null>(null);

  // Fresh wizard every time the sheet opens.
  useEffect(() => {
    if (open) {
      setStep("chain");
      setChain(null);
      setDestination(null);
      setFeeCtx(null);
      setFeeError(null);
      setRows([]);
      setRunning(false);
      setReceipt(null);
      setRecorded(null);
      analytics.claimOpened(chains.length);
      // Single funded chain: skip the picker.
      if (chains.length === 1 && !suiFunded) {
        setChain(chains[0]!.chain);
        setStep("destination");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Estimate fees when entering confirm.
  useEffect(() => {
    if (step !== "confirm" || !chain) return;
    let cancelled = false;
    setFeeCtx(null);
    setFeeError(null);
    estimateClaimFees(chain)
      .then((ctx) => {
        if (!cancelled) setFeeCtx(ctx);
      })
      .catch((err) => {
        if (!cancelled) setFeeError(parseBlockchainError(err).message);
      });
    return () => {
      cancelled = true;
    };
  }, [step, chain]);

  const items = useMemo(() => (chain ? getItems(chain) : []), [chain, getItems]);

  const plan = useMemo(() => {
    if (!feeCtx) return null;
    const claimable = items.filter((i) => isClaimable(i.balanceWei, feeCtx.gasCostWei));
    const dust = items.length - claimable.length;
    const receives = claimable.reduce(
      (acc, i) => acc + sweepValue(i.balanceWei, feeCtx.gasCostWei),
      0n,
    );
    const total = claimable.reduce((acc, i) => acc + i.balanceWei, 0n);
    return { claimable, dust, receives, total };
  }, [items, feeCtx]);

  const mergeRow = useCallback((row: SweepRowResult) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id);
      if (idx === -1) return [...prev, row];
      const next = [...prev];
      next[idx] = row;
      return next;
    });
  }, []);

  const runSweep = useCallback(
    async (sweepItems: SweepPlanItem[]) => {
      if (!chain || !destination) return;
      setRunning(true);
      try {
        await sweepAddresses(chain, sweepItems, destination.address, mergeRow);
      } catch (err) {
        // sweepAddresses reports per-row failures itself; this only fires on
        // unexpected orchestration errors (e.g. all RPC transports down).
        const parsed = parseBlockchainError(err);
        analytics.claimError(parsed.message);
        toast.error(parsed.message);
      } finally {
        setRunning(false);
      }
    },
    [chain, destination, mergeRow],
  );

  const handleClaimAll = useCallback(() => {
    if (!plan || !chain) return;
    analytics.claimStarted(chain, plan.claimable.length);
    setRows([]);
    setStep("progress");
    void runSweep(plan.claimable);
  }, [plan, chain, runSweep]);

  const handleRetryFailed = useCallback(() => {
    const failedAddresses = new Set(
      rows.filter((r) => r.status === "failed").map((r) => r.address.toLowerCase()),
    );
    const retryItems = items.filter((i) => failedAddresses.has(i.address.toLowerCase()));
    if (retryItems.length === 0) return;
    setRows((prev) => prev.filter((r) => r.status !== "failed"));
    void runSweep(retryItems);
  }, [rows, items, runSweep]);

  const recordReceipt = useCallback(
    async (r: ClaimReceipt) => {
      if (!metaAddress) {
        setRecorded(null);
        return;
      }
      try {
        const hash = await identityHashFromMetaAddress(metaAddress);
        setRecorded(await recordReceiptBestEffort(r, hash));
      } catch {
        setRecorded(false);
      }
    },
    [metaAddress],
  );

  const handleShowReceipt = useCallback(() => {
    if (!chain || !destination) return;
    const r = buildReceipt({
      chain,
      backendChain: getBackendChainName(chain),
      destination: destination.address,
      destinationInput: destination.input,
      rows,
    });
    setReceipt(r);
    setStep("receipt");
    analytics.claimCompleted(chain, r.confirmed, r.failed, r.skipped);
    void recordReceipt(r);
    onClaimed(r);
  }, [chain, destination, rows, recordReceipt, onClaimed]);

  const cfg = chain ? getSendChainConfig(chain) : null;
  const decimals = chain ? getChainDecimals(chain) : 18;
  const fmt = (wei: bigint) => formatCryptoAmount(formatUnits(wei, decimals));

  // The sheet must not be dismissible mid-run (keys are signing).
  const canDismiss = !(step === "progress" && running);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => canDismiss && onClose()}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md"
          >
            <Card className="border-border bg-card shadow-xl rounded-xl overflow-hidden">
              <CardContent className="p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-display text-lg font-bold flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-primary" />
                    {STEP_TITLES[step]}
                    {cfg && step !== "chain" && (
                      <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-normal text-white/55">
                        {cfg.shortLabel}
                      </span>
                    )}
                  </h3>
                  {canDismiss && (
                    <button
                      type="button"
                      onClick={onClose}
                      className="text-white/40 hover:text-white/80 transition-colors"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {step === "chain" && (
                  <ChainPicker
                    chains={chains}
                    suiFunded={suiFunded}
                    onSelect={(c) => {
                      analytics.claimChainSelected(c);
                      setChain(c);
                      setStep("destination");
                    }}
                  />
                )}

                {step === "destination" && (
                  <DestinationInput
                    ownStealthAddresses={ownStealthAddresses}
                    onBack={() => setStep("chain")}
                    onConfirm={(dest) => {
                      setDestination(dest);
                      setStep("confirm");
                    }}
                  />
                )}

                {step === "confirm" && (
                  <div className="space-y-3">
                    {feeError ? (
                      <div className="p-3 rounded-lg border text-xs bg-destructive/10 border-destructive/30 text-destructive flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {feeError}
                      </div>
                    ) : !plan ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Estimating network fees…
                      </div>
                    ) : (
                      <>
                        <div className="relative overflow-hidden rounded-lg border border-white/[0.07] bg-black/30 px-3 py-2.5 space-y-1.5 text-xs">
                          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                          <div className="flex justify-between gap-2">
                            <span className="text-white/35">Addresses to claim</span>
                            <span className="text-white/70">{plan.claimable.length}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-white/35">Total balance</span>
                            <span className="font-mono text-white/70">
                              {fmt(plan.total)} {cfg?.currencySymbol}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-white/35">Est. network fee / address</span>
                            <span className="font-mono text-white/70">
                              {feeCtx ? fmt(feeCtx.gasCostWei) : "—"} {cfg?.currencySymbol}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2 pt-1 border-t border-white/[0.06]">
                            <span className="text-white/50">Destination receives</span>
                            <span className="font-mono text-emerald-400/90">
                              ≈ {fmt(plan.receives)} {cfg?.currencySymbol}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2 min-w-0">
                            <span className="text-white/35 shrink-0">To</span>
                            <span
                              className="font-mono text-white/70 truncate"
                              title={destination?.address}
                            >
                              {destination?.kind === "ens"
                                ? destination.input
                                : `${destination?.address.slice(0, 10)}…${destination?.address.slice(-6)}`}
                            </span>
                          </div>
                        </div>

                        {plan.dust > 0 && (
                          <p className="text-[11px] text-white/40 flex items-center gap-1.5">
                            <Info className="h-3 w-3 shrink-0" />
                            {plan.dust} address{plan.dust !== 1 ? "es" : ""} skipped — balance
                            too small to cover its own network fee.
                          </p>
                        )}

                        <div className="p-3 rounded-lg bg-muted/40 border border-border">
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            Claiming sends each stealth balance on-chain to your
                            destination — those transfers become publicly linked,
                            like any withdrawal. Discovery of your payments stays
                            private (post-quantum) either way.
                          </p>
                        </div>

                        <div className="flex gap-2 pt-1">
                          <Button variant="ghost" size="sm" onClick={() => setStep("destination")}>
                            Back
                          </Button>
                          <Button
                            variant="quantum"
                            className="flex-1"
                            disabled={plan.claimable.length === 0}
                            onClick={handleClaimAll}
                          >
                            Claim all to this wallet
                          </Button>
                        </div>
                        <Button variant="outline" size="sm" className="w-full opacity-50" disabled>
                          Custom amount — Coming soon
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {step === "progress" && chain && (
                  <ClaimProgress
                    chain={chain}
                    rows={rows}
                    running={running}
                    onRetryFailed={handleRetryFailed}
                    onDone={handleShowReceipt}
                  />
                )}

                {step === "receipt" && receipt && (
                  <ClaimReceiptView
                    receipt={receipt}
                    recordedToServer={recorded}
                    onRetryRecord={() => void recordReceipt(receipt)}
                    onClose={onClose}
                  />
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
