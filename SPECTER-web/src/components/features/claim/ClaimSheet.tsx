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
import { AlertTriangle, Loader2, ShieldCheck, Wallet, X } from "lucide-react";
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
import { InfoDot, StepDots, SummaryRow } from "./ClaimPrimitives";

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
  const stepIndex = step === "chain" ? 0 : step === "destination" ? 1 : 2;

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
            {/* Receipt is its own ticket-style card — the plain sheet chrome
                (header + bordered card) would double up on it. */}
            {step === "receipt" && receipt ? (
              <div className="max-h-[90vh] overflow-y-auto px-1 py-2">
                <ClaimReceiptView
                  receipt={receipt}
                  recordedToServer={recorded}
                  onRetryRecord={() => void recordReceipt(receipt)}
                  onClose={onClose}
                />
              </div>
            ) : (
            <Card className="border-border bg-card shadow-xl rounded-xl overflow-hidden">
              <CardContent className="p-6 max-h-[90vh] overflow-y-auto">
                <div className="mb-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-lg font-bold flex items-center gap-2 min-w-0">
                      <Wallet className="h-4 w-4 text-primary shrink-0" />
                      <span className="truncate">{STEP_TITLES[step]}</span>
                      {cfg && step !== "chain" && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-normal text-white/55 shrink-0">
                          {cfg.shortLabel}
                        </span>
                      )}
                    </h3>
                    {canDismiss && (
                      <button
                        type="button"
                        onClick={onClose}
                        className="text-white/40 hover:text-white/80 transition-colors shrink-0"
                        aria-label="Close"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {step !== "receipt" && (
                    <div className="mt-3">
                      <StepDots steps={["Chain", "Destination", "Review"]} current={stepIndex} />
                    </div>
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
                  <div className="space-y-4">
                    {feeError ? (
                      <div className="p-3 rounded-lg border text-xs bg-destructive/10 border-destructive/30 text-destructive flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium">Couldn't estimate network fees</p>
                          <p className="text-destructive/80 mt-0.5">{feeError}</p>
                        </div>
                      </div>
                    ) : !plan ? (
                      <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-primary/70" />
                        Estimating network fees…
                      </div>
                    ) : (
                      <>
                        {/* Hero: what actually lands in the wallet. */}
                        <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-4 text-center">
                          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
                            Destination receives
                          </p>
                          <p className="mt-1.5 font-mono text-2xl font-semibold text-emerald-400/95 tabular-nums">
                            ≈ {fmt(plan.receives)}{" "}
                            <span className="text-base text-emerald-400/70">{cfg?.currencySymbol}</span>
                          </p>
                          <p className="mt-1 text-[11px] text-white/40">
                            from {plan.claimable.length} stealth address
                            {plan.claimable.length !== 1 ? "es" : ""}
                          </p>
                        </div>

                        {/* Aligned breakdown — no placeholder dashes; every row has a real value. */}
                        <div className="rounded-lg border border-white/[0.07] bg-black/25 px-3.5 py-3 space-y-2">
                          <SummaryRow
                            label="Total balance"
                            value={`${fmt(plan.total)} ${cfg?.currencySymbol ?? ""}`}
                          />
                          <SummaryRow
                            label="Network fee (est.)"
                            value={`${feeCtx ? fmt(feeCtx.gasCostWei * BigInt(plan.claimable.length || 1)) : fmt(0n)} ${cfg?.currencySymbol ?? ""}`}
                          />
                          <div className="h-px bg-white/[0.06]" />
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-xs text-white/40 shrink-0 flex items-center gap-1">
                              To
                            </span>
                            <span
                              className="min-w-0 truncate text-right text-xs font-mono text-white/75"
                              title={destination?.address}
                            >
                              {destination?.kind === "ens"
                                ? destination.input
                                : `${destination?.address.slice(0, 10)}…${destination?.address.slice(-6)}`}
                            </span>
                          </div>
                        </div>

                        {/* One quiet line + an info dot instead of a paragraph wall. */}
                        <div className="flex items-center justify-between gap-2 px-0.5">
                          <span className="text-[11px] text-white/40 flex items-center gap-1.5">
                            <ShieldCheck className="h-3.5 w-3.5 text-primary/60 shrink-0" />
                            Signed on your device
                            <InfoDot label="What claiming does">
                              Each stealth balance is sent on-chain to your destination and
                              becomes publicly linked, like any withdrawal. Your keys are
                              signed locally and never leave this device. Discovery of your
                              payments stays post-quantum private either way.
                            </InfoDot>
                          </span>
                          {plan.dust > 0 && (
                            <span className="text-[11px] text-white/35 flex items-center gap-1">
                              {plan.dust} skipped (dust)
                              <InfoDot label="Skipped addresses">
                                {plan.dust} address{plan.dust !== 1 ? "es" : ""} hold too
                                little to cover their own network fee, so they can't be
                                claimed right now.
                              </InfoDot>
                            </span>
                          )}
                        </div>

                        <div className="space-y-2 pt-1">
                          <div className="flex gap-2">
                            <Button variant="ghost" size="default" onClick={() => setStep("destination")}>
                              Back
                            </Button>
                            <Button
                              variant="quantum"
                              className="flex-1"
                              disabled={plan.claimable.length === 0}
                              onClick={handleClaimAll}
                            >
                              Claim {fmt(plan.receives)} {cfg?.currencySymbol}
                            </Button>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full opacity-45 cursor-not-allowed"
                            disabled
                          >
                            Choose a custom amount · coming soon
                          </Button>
                        </div>
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

              </CardContent>
            </Card>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
