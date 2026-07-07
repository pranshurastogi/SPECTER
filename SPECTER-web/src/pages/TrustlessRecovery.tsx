import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { privateKeyToAddress } from "viem/accounts";
import {
  ShieldQuestion,
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
  Server,
  Database,
  Zap,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { Card, CardContent } from "@/components/ui/base/card";
import { CopyButton } from "@/components/ui/specialized/copy-button";
import { toast } from "@/components/ui/base/sonner";
import { UnlockSavedKeys } from "@/components/features/keys/UnlockSavedKeys";
import type { DecryptedKeys } from "@/lib/crypto/keyVault";
import { formatCryptoAmount } from "@/lib/utils";
import { DEFAULT_MONAD_RPC_URL } from "@/lib/recovery/config";
import {
  recoverPayments,
  type RecoveredPayment,
  type ScannedAnnouncement,
} from "@/lib/recovery/recover";
import { isScanAborted, type ScanProgress } from "@/lib/recovery/announcer";

/** Where announcements are read from. */
type Source = "registry" | "rpc";

/** Direct-RPC sweep direction. */
type Direction = "newest" | "oldest";

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

/** One recovered payment with its own reveal/verify state. */
function RecoveredPaymentCard({ p }: { p: RecoveredPayment }) {
  const [revealed, setRevealed] = useState(false);
  const addr = p.stealthAddress;
  const shortAddr = `${addr.slice(0, 10)}…${addr.slice(-8)}`;

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
            <span className="text-xs font-medium text-foreground">
              {formatCryptoAmount(p.amountDisplay)} {p.currencySymbol ?? ""}
            </span>
          )}
        </div>
      </div>

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

export default function TrustlessRecovery() {
  const [keys, setKeys] = useState<RecoveryInput | null>(null);
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
        // Keep whatever was already matched on screen — those keys are real.
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
              If SPECTER ever disappears, your funds are still yours. Every bit of cryptography runs
              in your browser — your keys never leave this page. Use the fast registry (public
              on-chain data only), or flip to <em>Direct RPC</em> to read the chain yourself with
              zero SPECTER calls.
            </p>
          </div>

          <Card className="w-full border-border bg-card/50 shadow-lg rounded-xl">
            <CardContent className="p-5 space-y-5">
              {/* Source toggle: fast registry vs fully-trustless direct RPC.
                  Locked to a labelled chip while a scan is running. */}
              <div className="space-y-1.5">
                {phase === "scanning" ? (
                  <div className="flex items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/15 px-2 py-1.5 text-xs font-medium text-foreground">
                    {source === "registry" ? (
                      <Zap className="h-3.5 w-3.5" />
                    ) : (
                      <Database className="h-3.5 w-3.5" />
                    )}
                    {source === "registry" ? "SPECTER registry (fast)" : "Direct RPC"}
                    <span className="text-[10px] text-muted-foreground">· scanning</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/[0.08] bg-black/20 p-1">
                    <button
                      type="button"
                      onClick={() => setSource("registry")}
                      className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                        source === "registry"
                          ? "bg-primary/15 text-foreground border border-primary/30"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Zap className="h-3.5 w-3.5" />
                      SPECTER registry (fast)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSource("rpc")}
                      className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                        source === "rpc"
                          ? "bg-primary/15 text-foreground border border-primary/30"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Database className="h-3.5 w-3.5" />
                      Direct RPC
                    </button>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {source === "registry"
                    ? "Reads public on-chain announcements from SPECTER's registry — fast, and your keys still never leave this page. Falls back to Direct RPC if it's unreachable."
                    : "Zero SPECTER calls: reads the announcer's logs straight from the RPC below, in the order you choose. Fully trustless, but the public node is slow (can take ~20–30 min)."}
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
                      placeholder="https://testnet-rpc.monad.xyz"
                      className="font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Defaults to a public node. Paste your own to trust nothing but your RPC.
                    </p>
                  </div>
                )}
              </div>

              {/* Load keys */}
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <KeyRound className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display font-semibold text-foreground text-sm">Your keys</h2>
                    <p className="text-xs text-muted-foreground">
                      The backup from <Link to="/setup" className="text-primary hover:underline">Setup</Link> — never leaves this browser
                    </p>
                  </div>
                </div>

                <UnlockSavedKeys onUnlock={onVaultUnlock} />

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
                <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload specter-keys.json
                </Button>
                <div className="flex gap-2">
                  <Input
                    placeholder='{"viewing_pk":"...","viewing_sk":"...","spending_pk":"...","spending_sk":"..."}'
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    className="font-mono text-xs flex-1"
                  />
                  <Button variant="outline" onClick={() => loadFromText(paste)} disabled={!paste.trim()}>
                    Load
                  </Button>
                </div>

                {keys && (
                  <div className="specter-confirm">
                    <Lock className="h-3.5 w-3.5" />
                    <span className="specter-confirm-text">Keys loaded — ready to scan</span>
                  </div>
                )}
                {loadError && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {loadError}
                  </div>
                )}
              </div>

              {/* Scan */}
              <Button
                variant="quantum"
                size="lg"
                className="w-full"
                onClick={runScan}
                disabled={!keys || phase === "scanning"}
              >
                {phase === "scanning" ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Scanning…
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Recover my funds
                  </>
                )}
              </Button>

              {/* Progress */}
              {phase === "scanning" && (
                <div className="space-y-2">
                  {status && (
                    <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                      <p className="text-xs text-foreground">{status}</p>
                    </div>
                  )}

                  {progress?.kind === "rpc" && (
                    <>
                      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${rpcPct}%` }} />
                      </div>
                      <p className="text-[11px] text-muted-foreground text-center">
                        {direction === "newest"
                          ? `Scanning newest → oldest · block ${progress.scannedToBlock.toString()} … ${progress.fromBlock.toString()}`
                          : `Scanning oldest → newest · block ${progress.fromBlock.toString()} … ${progress.scannedToBlock.toString()}`}{" "}
                        · {progress.found} announcement{progress.found !== 1 ? "s" : ""} seen
                      </p>
                      <p className="text-[10px] text-muted-foreground/70 text-center">
                        Direct RPC scan — the public node is rate-limited, so this can take a while.
                      </p>
                    </>
                  )}

                  {progress?.kind === "indexer" && (
                    <>
                      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full w-1/3 bg-primary animate-pulse" />
                      </div>
                      <p className="text-[11px] text-muted-foreground text-center">
                        {progress.rowsFetched} announcement{progress.rowsFetched !== 1 ? "s" : ""} fetched ·{" "}
                        {progress.found} verified
                      </p>
                    </>
                  )}

                  {!progress && (
                    <p className="text-[11px] text-muted-foreground text-center">Starting scan…</p>
                  )}

                  {/* Live feed of scanned announcements (Direct RPC only) so the
                      slow sweep visibly shows the addresses it's checking, with
                      any that match these keys highlighted. */}
                  {source === "rpc" && scanned.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        Scanning announcements
                      </p>
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/20 divide-y divide-white/[0.04]">
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
                              {s.matched && (
                                <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button variant="ghost" size="sm" className="w-full" onClick={cancelScan}>
                    <XCircle className="h-4 w-4 mr-1.5" />
                    Cancel
                  </Button>
                </div>
              )}

              {phase === "error" && scanError && (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{scanError}</span>
                </div>
              )}

              {/* Results — streamed live during the scan, then finalised */}
              {(results.length > 0 || phase === "done" || phase === "cancelled") && (
                <div className="space-y-3">
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
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <XCircle className="h-3.5 w-3.5 shrink-0" />
                      Scan cancelled — showing {results.length} match
                      {results.length !== 1 ? "es" : ""} found so far
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

                  {results.map((p) => (
                    <RecoveredPaymentCard key={`${p.announcementTxHash}-${p.stealthAddress}`} p={p} />
                  ))}

                  {phase === "done" && results.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center">
                      No announcements matched these keys.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  );
}
