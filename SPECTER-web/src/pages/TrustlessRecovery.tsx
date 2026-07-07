import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { formatUnits } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import {
  ShieldQuestion,
  ShieldCheck,
  Upload,
  Loader2,
  KeyRound,
  AlertTriangle,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Lock,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Server,
  Zap,
  ArrowDown,
  ArrowUp,
  Terminal,
  ArrowRight,
  HardDrive,
  ClipboardPaste,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { Card, CardContent } from "@/components/ui/base/card";
import { CopyButton } from "@/components/ui/specialized/copy-button";
import { ScanRadar } from "@/components/ui/specialized/scan-radar";
import { StageFlowLoader, type FlowStage } from "@/components/ui/specialized/stage-flow-loader";
import { toast } from "@/components/ui/base/sonner";
import { UnlockSavedKeys } from "@/components/features/keys/UnlockSavedKeys";
import { RecoveryScriptBlock } from "@/components/features/RecoveryScriptBlock";
import { RecoveryStepTracker, type RecoveryStep } from "@/components/features/RecoveryStepTracker";
import { listVaultEntries, type DecryptedKeys } from "@/lib/crypto/keyVault";
import { formatCryptoAmount } from "@/lib/utils";
import { DEFAULT_MONAD_RPC_URL } from "@/lib/recovery/config";
import {
  recoverPayments,
  type RecoveredPayment,
  type ScannedAnnouncement,
} from "@/lib/recovery/recover";
import { isScanAborted, type ScanProgress } from "@/lib/recovery/announcer";
import { getChainDecimals, getChainStandard } from "@/lib/blockchain/chainRegistry";
import { isEvmChain, type EvmTxChain } from "@/lib/blockchain/sendChains";
import { fetchEvmBalances, balanceKey, type BalanceMap } from "@/lib/claim/balances";

/** Where announcements are read from. */
type Source = "registry" | "rpc";

/** Direct-RPC sweep direction. */
type Direction = "newest" | "oldest";

/** Results shown per page once a scan reaches its final state. */
const RESULTS_PAGE_SIZE = 10;

/** Abbreviate an address for the compact scanned-announcement feed. */
function shortAddress(addr?: string): string {
  if (!addr) return "unknown address";
  return addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-8)}` : addr;
}

/** The key subset recovery needs. */
interface RecoveryInput {
  viewing_pk: string;
  viewing_sk: string;
  spending_pk: string;
  spending_sk: string;
}

type Phase = "idle" | "scanning" | "done" | "cancelled" | "error";

/** Extract the fields recovery needs from a pasted/uploaded backup. */
function ingest(text: string): RecoveryInput {
  const data = JSON.parse(text) as Record<string, unknown>;
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string).trim() : "");
  const viewing_pk = str("viewing_pk");
  const viewing_sk = str("viewing_sk");
  const spending_pk = str("spending_pk");
  const spending_sk = str("spending_sk");
  // The spending secret is required: since the V2 protocol the spendable
  // stealth key is derived from it (the public spend key alone only detects
  // the address). A full specter-keys.json backup always contains it.
  if (!viewing_pk || !viewing_sk || !spending_pk || !spending_sk) {
    throw new Error("Keys must contain viewing_pk, viewing_sk, spending_pk and spending_sk");
  }
  return { viewing_pk, viewing_sk, spending_pk, spending_sk };
}

/** One of the 3 ways to load keys, shown as a compact horizontal chooser. */
function MethodCard({
  icon: Icon,
  label,
  sublabel,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sublabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-colors ${
        disabled
          ? "border-white/[0.06] bg-black/10 text-white/25 cursor-not-allowed"
          : "border-white/[0.08] bg-black/20 hover:border-primary/40 hover:bg-primary/[0.06]"
      }`}
    >
      <Icon className={`h-4 w-4 ${disabled ? "text-white/20" : "text-primary"}`} />
      <span className={`text-[11px] font-medium leading-tight ${disabled ? "" : "text-foreground"}`}>
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground leading-tight">{sublabel}</span>
    </button>
  );
}

/** Registry (fast) vs Direct RPC (trustless) — an animated pill toggle, the
 * highlight sliding between options via a shared framer-motion layoutId. */
function TrustToggle({ value, onChange }: { value: Source; onChange: (s: Source) => void }) {
  const options: {
    id: Source;
    label: string;
    detail: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: "registry", label: "Fast", detail: "SPECTER registry", icon: Zap },
    { id: "rpc", label: "Trustless", detail: "Direct RPC", icon: ShieldCheck },
  ];

  return (
    <div className="grid grid-cols-2 gap-1 rounded-full border border-white/[0.08] bg-black/20 p-1">
      {options.map((opt) => {
        const active = value === opt.id;
        const Icon = opt.icon;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className="relative flex items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition-colors"
          >
            {active && (
              <motion.span
                layoutId="trust-toggle-bubble"
                className="absolute inset-0 rounded-full bg-primary/15 border border-primary/30"
                transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
              />
            )}
            <Icon
              className={`relative z-10 h-3.5 w-3.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
            />
            <span className="relative z-10 flex flex-col items-start leading-tight">
              <span className={active ? "text-foreground" : "text-muted-foreground"}>{opt.label}</span>
              <span className="text-[10px] text-muted-foreground/70">{opt.detail}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** One recovered payment with its own reveal/verify state. */
function RecoveredPaymentCard({
  p,
  liveBalance,
  liveBalanceChecked,
}: {
  p: RecoveredPayment;
  /** Live on-chain balance in base units, when the read succeeded. */
  liveBalance?: bigint;
  /** True once a live-balance read has been attempted (success or failure). */
  liveBalanceChecked: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const addr = p.stealthAddress;
  const shortAddr = `${addr.slice(0, 10)}…${addr.slice(-8)}`;
  const canCheckLive = p.chain !== null && isEvmChain(p.chain);

  // Independently re-derive the address from the revealed private key so the
  // user can see, with their own eyes, that the key controls the funds.
  let derivedOk: boolean | null = null;
  if (revealed) {
    try {
      const derived = privateKeyToAddress(p.ethPrivateKey as `0x${string}`);
      derivedOk = derived.toLowerCase() === addr.toLowerCase();
    } catch {
      derivedOk = false;
    }
  }

  const liveDisplay =
    p.chain && liveBalance !== undefined
      ? `${formatCryptoAmount(formatUnits(liveBalance, getChainDecimals(p.chain)))} ${getChainStandard(p.chain).currencySymbol}`
      : null;

  return (
    <div className="rounded-lg border border-white/[0.08] bg-black/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <code className="text-xs font-mono break-all" title={addr}>
          {shortAddr}
        </code>
        <div className="flex items-center gap-2">
          {p.chain && (
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/55">
              {p.chain}
            </span>
          )}
          {p.amountDisplay && (
            <span className="text-xs font-medium text-foreground" title="Amount reported in the announcement metadata">
              {formatCryptoAmount(p.amountDisplay)} {p.currencySymbol ?? ""}
              <span className="text-muted-foreground font-normal"> announced</span>
            </span>
          )}
        </div>
      </div>

      {/* Live on-chain balance — read directly from the RPC, independent of
          whatever the announcement metadata claims. Zero SPECTER calls. */}
      {canCheckLive && (
        <div className="flex items-center gap-1.5 text-[11px]">
          {liveDisplay ? (
            <>
              <ShieldCheck className="h-3 w-3 text-emerald-400 shrink-0" />
              <span className="text-emerald-400/90">On-chain now: {liveDisplay}</span>
            </>
          ) : liveBalanceChecked ? (
            <span className="text-muted-foreground">Live balance unavailable — check an explorer</span>
          ) : (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Checking live balance…</span>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <CopyButton
          text={addr}
          label="Copy address"
          successMessage="Address copied"
          variant="outline"
          size="sm"
          showLabel
        />
        {p.announcementTxHash && (
          <a
            href={`https://testnet.monadvision.com/tx/${p.announcementTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Announcement
          </a>
        )}
      </div>

      {!revealed ? (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setRevealed(true)}>
          <Eye className="h-4 w-4 mr-2" />
          Reveal private key
        </Button>
      ) : (
        <div className="space-y-2 p-3 rounded-lg bg-muted/40 border border-border">
          <code className="text-xs font-mono break-all block bg-background/80 p-2 rounded border overflow-x-auto">
            {p.ethPrivateKey}
          </code>
          {derivedOk === true && (
            <div className="specter-confirm">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="specter-confirm-text">Key controls this address</span>
            </div>
          )}
          {derivedOk === false && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <XCircle className="h-4 w-4 shrink-0" />
              Derived address mismatch
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <CopyButton
              text={p.ethPrivateKey}
              label="Copy private key"
              successMessage="Copied"
              variant="quantum"
              size="sm"
              className="flex-1 min-w-[120px]"
              showLabel
            />
            <Button variant="ghost" size="sm" onClick={() => setRevealed(false)}>
              <EyeOff className="h-4 w-4 mr-1.5" />
              Hide
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const STEPS: RecoveryStep[] = [
  { id: "keys", label: "Keys", icon: KeyRound },
  { id: "trust", label: "Trust level", icon: ShieldQuestion },
  { id: "scan", label: "Scan", icon: Search },
  { id: "recover", label: "Recover", icon: CheckCircle2 },
];

type KeyMethod = "vault" | "upload" | "paste";

export default function TrustlessRecovery() {
  const [keys, setKeys] = useState<RecoveryInput | null>(null);
  const [keyMethod, setKeyMethod] = useState<KeyMethod | null>(null);
  const [vaultCount] = useState<number>(() => {
    try {
      return listVaultEntries().length;
    } catch {
      return 0;
    }
  });
  const [paste, setPaste] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rpcUrl, setRpcUrl] = useState(DEFAULT_MONAD_RPC_URL);
  const [showRpc, setShowRpc] = useState(false);
  const [source, setSource] = useState<Source>("registry");
  const [direction, setDirection] = useState<Direction>("newest");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [results, setResults] = useState<RecoveredPayment[]>([]);
  const [scanned, setScanned] = useState<ScannedAnnouncement[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [resultsPage, setResultsPage] = useState(0);
  const [balances, setBalances] = useState<BalanceMap>(new Map());
  const [balancesChecked, setBalancesChecked] = useState(false);
  const [selfHostOpen, setSelfHostOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadFromText = (text: string) => {
    setLoadError(null);
    try {
      setKeys(ingest(text));
      setPaste("");
      toast.success("Keys loaded");
    } catch (err) {
      setKeys(null);
      setLoadError(err instanceof Error ? err.message : "Invalid keys JSON");
    }
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => loadFromText(reader.result as string);
    reader.readAsText(file);
  };

  const onVaultUnlock = (dk: DecryptedKeys) => {
    setLoadError(null);
    setKeys({
      viewing_pk: dk.viewing_pk,
      viewing_sk: dk.viewing_sk,
      spending_pk: dk.spending_pk,
      spending_sk: dk.spending_sk,
    });
    setPaste("");
    toast.success("Keys unlocked");
  };

  /** Back to a clean slate: drop keys and any scan/results state with them. */
  const handleChangeKeys = () => {
    setKeys(null);
    setKeyMethod(null);
    setPaste("");
    setLoadError(null);
    setPhase("idle");
    setProgress(null);
    setStatus(null);
    setResults([]);
    setScanned([]);
    setScanError(null);
    setResultsPage(0);
    setBalances(new Map());
    setBalancesChecked(false);
  };

  const runScan = async () => {
    if (!keys) {
      toast.error("Load your keys first");
      return;
    }
    if (!rpcUrl.trim()) {
      toast.error("Enter an RPC URL");
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase("scanning");
    setResults([]);
    setScanned([]);
    setProgress(null);
    setStatus(null);
    setScanError(null);
    setResultsPage(0);
    setBalances(new Map());
    setBalancesChecked(false);
    try {
      const found = await recoverPayments(keys, rpcUrl.trim(), {
        source,
        direction,
        signal: ac.signal,
        onProgress: (p) => {
          if (p.kind === "status") setStatus(p.message);
          else setProgress(p);
        },
        // Stream each recovered payment to the UI the moment it's matched.
        onMatch: (p) => setResults((prev) => [...prev, p]),
        // Live feed of what the (slow) Direct-RPC sweep is checking — capped,
        // newest-first, so a long scan can't grow the list unbounded.
        onScanned: (s) => setScanned((prev) => [s, ...prev].slice(0, 16)),
      });
      // Replace the streamed list with the final newest-first ordering.
      setResults(found);
      setPhase("done");
      toast[found.length > 0 ? "success" : "info"](
        found.length > 0 ? `Recovered ${found.length} payment(s)` : "No payments found for these keys",
      );
    } catch (err) {
      if (isScanAborted(err)) {
        // Keep whatever was already matched on screen — those keys are real:
        // every announcement this scan fetched was fully trial-decapsulated
        // before the next one started, so nothing is left half-processed.
        setPhase("cancelled");
        setProgress(null);
        setStatus(null);
        toast.info("Scan cancelled");
        return;
      }
      setScanError(err instanceof Error ? err.message : "Recovery scan failed");
      setPhase("error");
      toast.error("Recovery scan failed");
    } finally {
      abortRef.current = null;
    }
  };

  const cancelScan = () => abortRef.current?.abort();

  // Once the scan reaches a final state, independently verify the announced
  // amounts against a live on-chain read (same public RPC, zero SPECTER
  // calls) — the announcement metadata is reported by whichever source found
  // it and isn't otherwise cross-checked.
  useEffect(() => {
    if (phase !== "done" && phase !== "cancelled") return;
    const targets = results
      .filter((p): p is RecoveredPayment & { chain: EvmTxChain } => p.chain !== null && isEvmChain(p.chain))
      .map((p) => ({ chain: p.chain, address: p.stealthAddress }));
    if (targets.length === 0) {
      setBalancesChecked(true);
      return;
    }
    let cancelled = false;
    fetchEvmBalances(targets)
      .then((map) => {
        if (!cancelled) setBalances(map);
      })
      .finally(() => {
        if (!cancelled) setBalancesChecked(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on phase settling, not on every streamed result
  }, [phase]);

  // The frontier walks from the start edge toward the far edge of the range;
  // how far it's travelled (as a fraction of the whole range) is the progress.
  // Newest-first counts down from the tip; oldest-first counts up from deploy.
  const rpcPct =
    progress && progress.kind === "rpc"
      ? Math.min(
          100,
          Math.round(
            (Number(
              direction === "newest"
                ? progress.latestBlock - progress.scannedToBlock
                : progress.scannedToBlock - progress.fromBlock,
            ) /
              Math.max(1, Number(progress.latestBlock - progress.fromBlock))) *
              100,
          ),
        )
      : 0;

  // A single, honest "stage": the sweep and the trial-decapsulation of each
  // announcement happen together as data streams in (there's no separate
  // "fetch everything, then decrypt everything" phase to report), so this
  // reuses StageFlowLoader's chrome (spinner / elapsed timer / error state)
  // for one live-updating stage rather than fabricating sequential ones.
  const scanStages: FlowStage[] = [
    {
      id: "sweep",
      label: source === "registry" ? "Reading SPECTER's registry" : "Sweeping chain logs directly",
      description:
        status ??
        (progress?.kind === "rpc"
          ? direction === "newest"
            ? `Block ${progress.scannedToBlock.toString()} → ${progress.fromBlock.toString()} · ${progress.found} found`
            : `Block ${progress.fromBlock.toString()} → ${progress.scannedToBlock.toString()} · ${progress.found} found`
          : progress?.kind === "indexer"
            ? `${progress.rowsFetched.toLocaleString()} announcements checked · ${progress.found} verified`
            : "Starting scan…"),
    },
  ];

  const stepIndex = !keys ? 0 : phase === "idle" ? 1 : phase === "scanning" || phase === "error" ? 2 : 3;

  const pageCount = Math.max(1, Math.ceil(results.length / RESULTS_PAGE_SIZE));
  const pagedResults =
    phase === "scanning"
      ? results
      : results.slice(resultsPage * RESULTS_PAGE_SIZE, resultsPage * RESULTS_PAGE_SIZE + RESULTS_PAGE_SIZE);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 pt-48 pb-12 flex flex-col items-center">
        <div className="w-full max-w-lg mx-auto px-4">
          {/* Explainer */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 mb-4">
              <ShieldQuestion className="h-6 w-6 text-primary" />
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground">
              Recover without SPECTER
            </h1>
            <p className="text-sm text-muted-foreground mt-3">
              If SPECTER disappears, your funds don't. Every step below runs in this browser — your
              keys are never sent anywhere.
            </p>
          </div>

          <RecoveryStepTracker steps={STEPS} activeIndex={stepIndex} />

          {/* Step 1 — keys */}
          <Card className="w-full border-border bg-card/50 shadow-lg rounded-xl">
            <CardContent className="p-5 space-y-3">
              {keys ? (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <KeyRound className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Keys loaded</p>
                    <p className="text-[11px] text-muted-foreground">never leave this device</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleChangeKeys}
                    disabled={phase === "scanning"}
                    className="text-muted-foreground"
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <KeyRound className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-display font-semibold text-foreground text-sm">Your keys</h2>
                      <p className="text-xs text-muted-foreground">
                        The backup from <Link to="/setup" className="text-primary hover:underline">Setup</Link>
                      </p>
                    </div>
                  </div>

                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onFile(f);
                      e.target.value = "";
                    }}
                  />

                  {keyMethod === null ? (
                    <div className="grid grid-cols-3 gap-2">
                      <MethodCard
                        icon={HardDrive}
                        label="Saved keys"
                        sublabel={vaultCount > 0 ? `${vaultCount} saved` : "None yet"}
                        disabled={vaultCount === 0}
                        onClick={() => setKeyMethod("vault")}
                      />
                      <MethodCard
                        icon={Upload}
                        label="Upload file"
                        sublabel="specter-keys.json"
                        onClick={() => fileRef.current?.click()}
                      />
                      <MethodCard
                        icon={ClipboardPaste}
                        label="Paste JSON"
                        sublabel="from backup"
                        onClick={() => setKeyMethod("paste")}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setKeyMethod(null)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        Choose a different method
                      </button>

                      {keyMethod === "vault" && <UnlockSavedKeys onUnlock={onVaultUnlock} />}

                      {keyMethod === "paste" && (
                        <div className="flex gap-2">
                          <Input
                            placeholder='{"viewing_pk":"...","viewing_sk":"...","spending_pk":"...","spending_sk":"..."}'
                            value={paste}
                            onChange={(e) => setPaste(e.target.value)}
                            className="font-mono text-xs flex-1"
                            autoFocus
                          />
                          <Button variant="outline" onClick={() => loadFromText(paste)} disabled={!paste.trim()}>
                            Load
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {loadError && (
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {loadError}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Step 2 (trust level) + Step 3 (scan) — only once keys are loaded */}
          {keys && (
            <Card className="mt-4 w-full border-border bg-card/50 shadow-lg rounded-xl">
              <CardContent className="p-5 space-y-5">
                {/* Trust-level choice */}
                <div className="space-y-1.5">
                  {phase === "scanning" ? (
                    <div className="flex items-center justify-center gap-1.5 rounded-full border border-primary/30 bg-primary/15 px-3 py-2 text-xs font-medium text-foreground">
                      {source === "registry" ? (
                        <Zap className="h-3.5 w-3.5" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                      {source === "registry" ? "Fast · SPECTER registry" : "Trustless · Direct RPC"}
                      <span className="text-[10px] text-muted-foreground">· scanning</span>
                    </div>
                  ) : (
                    <TrustToggle value={source} onChange={setSource} />
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {source === "registry" ? (
                      <>
                        Reads SPECTER's public registry (no login, no API key). SPECTER could only ever
                        <em> fail to show</em> a payment here — it can never forge one, because a
                        spendable key can only come from your own secret keys, which stay in this
                        browser. Falls back to Direct RPC automatically if it's unreachable.
                      </>
                    ) : (
                      <>
                        Fully trustless: reads the announcer's logs straight from the RPC below and
                        verifies each ciphertext against its on-chain hash. Zero SPECTER calls — but the
                        public node is slow (can take ~20–30 min).
                      </>
                    )}
                  </p>

                  {/* Direct-RPC scan order. Locked to a label while a scan runs
                      (the progress line then shows the active direction). */}
                  {source === "rpc" && phase !== "scanning" && (
                    <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/[0.08] bg-black/20 p-1">
                      <button
                        type="button"
                        onClick={() => setDirection("newest")}
                        className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                          direction === "newest"
                            ? "bg-primary/15 text-foreground border border-primary/30"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                        Newest first
                      </button>
                      <button
                        type="button"
                        onClick={() => setDirection("oldest")}
                        className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                          direction === "oldest"
                            ? "bg-primary/15 text-foreground border border-primary/30"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                        Oldest first
                      </button>
                    </div>
                  )}
                </div>

                {/* RPC override */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowRpc((v) => !v)}
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Server className="h-3.5 w-3.5" />
                    <span>Monad RPC endpoint</span>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showRpc ? "rotate-180" : ""}`} />
                  </button>
                  {showRpc && (
                    <div className="mt-2 space-y-1.5">
                      <Input
                        value={rpcUrl}
                        onChange={(e) => setRpcUrl(e.target.value)}
                        placeholder="https://rpc-testnet.monadinfra.com"
                        className="font-mono text-xs"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Defaults to a public, key-less node. Paste your own to trust nothing but your RPC.
                      </p>
                    </div>
                  )}
                </div>

                {/* Scan trigger */}
                {phase === "idle" && (
                  <Button variant="quantum" size="lg" className="w-full" onClick={runScan}>
                    <Search className="h-4 w-4 mr-2" />
                    Recover my funds
                  </Button>
                )}

                {/* Live scan */}
                {(phase === "scanning" || phase === "error") && (
                  <div className="space-y-3">
                    {phase === "scanning" && (
                      <ScanRadar
                        caption={
                          source === "registry" ? "Sweeping the announcement registry" : "Sweeping chain logs"
                        }
                      />
                    )}
                    <StageFlowLoader
                      stages={scanStages}
                      activeIndex={0}
                      error={phase === "error" ? scanError : null}
                      hint={
                        phase === "scanning"
                          ? "Your keys never leave this browser — nothing is sent to any server."
                          : undefined
                      }
                    />

                    {phase === "scanning" && progress?.kind === "rpc" && (
                      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${rpcPct}%` }} />
                      </div>
                    )}

                    {/* Live feed of scanned announcements (Direct RPC only) so the
                        slow sweep visibly shows the addresses it's checking, with
                        any that match these keys highlighted. */}
                    {phase === "scanning" && source === "rpc" && scanned.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          Scanning announcements
                        </p>
                        <div className="max-h-40 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/20 divide-y divide-white/[0.04] [scrollbar-width:thin]">
                          {scanned.map((s) => (
                            <div
                              key={`${s.blockNumber.toString()}-${s.stealthAddress ?? s.txHash}`}
                              className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                            >
                              <code
                                className={`text-[11px] font-mono truncate ${
                                  s.matched ? "text-primary" : "text-muted-foreground/60"
                                }`}
                                title={s.stealthAddress}
                              >
                                {shortAddress(s.stealthAddress)}
                              </code>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[10px] text-muted-foreground/40 font-mono">
                                  blk {s.blockNumber.toString()}
                                </span>
                                {s.matched && <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {phase === "scanning" && (
                      <Button variant="ghost" size="sm" className="w-full" onClick={cancelScan}>
                        <XCircle className="h-4 w-4 mr-1.5" />
                        Cancel
                      </Button>
                    )}
                    {phase === "error" && (
                      <Button variant="outline" className="w-full" onClick={runScan}>
                        <Search className="h-4 w-4 mr-2" />
                        Retry scan
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step 4 — results */}
          {keys && (results.length > 0 || phase === "done" || phase === "cancelled") && (
            <Card className="mt-4 w-full border-border bg-card/50 shadow-lg rounded-xl">
              <CardContent className="p-5 space-y-3">
                {phase === "done" && (
                  <div className="specter-confirm">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span className="specter-confirm-text">
                      {results.length} payment{results.length !== 1 ? "s" : ""} recovered
                    </span>
                  </div>
                )}
                {phase === "scanning" && results.length > 0 && (
                  <div className="specter-confirm">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span className="specter-confirm-text">
                      Recovering live — {results.length} found so far
                    </span>
                  </div>
                )}
                {phase === "cancelled" && (
                  <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    <p className="text-xs text-foreground">
                      Scan cancelled — the {results.length} recovered payment{results.length !== 1 ? "s" : ""}{" "}
                      below {results.length !== 1 ? "are" : "is"} final and safe to use. Nothing was left
                      half-processed: a payment only ever appears here after full verification.
                    </p>
                  </div>
                )}

                {results.length > 0 && (
                  <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      These private keys control real funds. Import them into a wallet you trust to
                      sweep the balance, and never paste them into a site you don't.
                    </p>
                  </div>
                )}

                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.1)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb:hover]:bg-white/20">
                  {pagedResults.map((p) => (
                    <RecoveredPaymentCard
                      key={`${p.announcementTxHash}-${p.stealthAddress}`}
                      p={p}
                      liveBalance={
                        p.chain ? balances.get(balanceKey(p.chain as EvmTxChain, p.stealthAddress)) : undefined
                      }
                      liveBalanceChecked={balancesChecked}
                    />
                  ))}
                </div>

                {phase !== "scanning" && results.length > RESULTS_PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={resultsPage === 0}
                      onClick={() => setResultsPage((p) => Math.max(0, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                      Prev
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      Page {resultsPage + 1} of {pageCount}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={resultsPage >= pageCount - 1}
                      onClick={() => setResultsPage((p) => Math.min(pageCount - 1, p + 1))}
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                )}

                {phase === "done" && results.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center">
                    No announcements matched these keys.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Two escape hatches — collapsed by default so they don't crowd
              the page; click a header to expand it. */}
          <RecoveryScriptBlock collapsible />

          {/* Self-host escape hatch: this page still has to be *served* from
              somewhere. If SPECTER's hosting is down too, run it yourself. */}
          <div className="mt-6 rounded-xl border border-white/[0.08] bg-card/30 p-5 space-y-3">
            <button
              type="button"
              onClick={() => setSelfHostOpen((v) => !v)}
              className="flex items-center justify-between gap-2 w-full text-left"
            >
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-primary" />
                <h2 className="font-display font-semibold text-foreground text-sm">
                  SPECTER is down? Run it yourself.
                </h2>
              </div>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${selfHostOpen ? "rotate-180" : ""}`}
              />
            </button>

            {selfHostOpen && (
              <>
                <p className="text-xs text-muted-foreground">
                  SPECTER is open source. Clone it and this exact recovery tool runs on your machine —
                  against a public Monad RPC, with zero SPECTER calls.
                </p>
                <div className="relative">
                  <pre className="text-[11px] font-mono leading-relaxed block bg-background/80 p-3 pr-12 rounded-lg border border-white/[0.08] overflow-x-auto">
                    <code>
                      {[
                        "git clone https://github.com/pranshurastogi/SPECTER.git",
                        "cd SPECTER/SPECTER-web && cp .env.example .env",
                        "npm install && npm run dev",
                      ].map((line) => (
                        <span key={line} className="block">
                          <span className="select-none text-muted-foreground/60">$ </span>
                          {line}
                        </span>
                      ))}
                    </code>
                  </pre>
                  <div className="absolute top-1.5 right-1.5">
                    <CopyButton
                      text={
                        "git clone https://github.com/pranshurastogi/SPECTER.git\n" +
                        "cd SPECTER/SPECTER-web && cp .env.example .env\n" +
                        "npm install && npm run dev"
                      }
                      showLabel={false}
                      variant="ghost"
                      size="icon"
                      successMessage="Commands copied"
                      tooltip="Copy commands"
                    />
                  </div>
                </div>
                <Link
                  to="/self-host"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  Full self-host guide
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
