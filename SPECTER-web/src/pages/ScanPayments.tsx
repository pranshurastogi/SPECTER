import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Scan,
  Loader2,
  Wallet,
  Clock,
  ArrowDownToLine,
  AlertTriangle,
  Check,
  Zap,
  Upload,
  KeyRound,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { api, ApiError, type DiscoveryDto, type ScanStatsDto, type RegistryStatsResponse } from "@/lib/api";

type ScanState = "idle" | "loading_keys" | "scanning" | "complete" | "error";

interface KeysFromFile {
  viewing_sk: string;
  spending_pk: string;
  spending_sk: string;
  view_tag?: number;
}

export default function ScanPayments() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [keys, setKeys] = useState<KeysFromFile | null>(null);
  const [keysPaste, setKeysPaste] = useState("");
  const [stats, setStats] = useState<ScanStatsDto | null>(null);
  const [discoveries, setDiscoveries] = useState<DiscoveryDto[]>([]);
  const [selectedPayment, setSelectedPayment] = useState<DiscoveryDto | null>(null);
  const [registryStats, setRegistryStats] = useState<RegistryStatsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadKeysFromFile = (file: File) => {
    setLoadError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const data = JSON.parse(text) as Record<string, unknown>;
        const viewing_sk = typeof data.viewing_sk === "string" ? data.viewing_sk : "";
        const spending_pk = typeof data.spending_pk === "string" ? data.spending_pk : "";
        const spending_sk = typeof data.spending_sk === "string" ? data.spending_sk : "";
        if (!viewing_sk || !spending_pk || !spending_sk) {
          setLoadError("Keys file must contain viewing_sk, spending_pk, spending_sk (hex strings)");
          setKeys(null);
          return;
        }
        setKeys({
          viewing_sk,
          spending_pk,
          spending_sk,
          view_tag: typeof data.view_tag === "number" ? data.view_tag : undefined,
        });
        setKeysPaste("");
        toast.success("Keys loaded from file");
      } catch {
        setLoadError("Invalid JSON in keys file");
        setKeys(null);
      }
    };
    reader.readAsText(file);
  };

  const loadKeysFromPaste = () => {
    setLoadError(null);
    try {
      const data = JSON.parse(keysPaste) as Record<string, unknown>;
      const viewing_sk = typeof data.viewing_sk === "string" ? data.viewing_sk : "";
      const spending_pk = typeof data.spending_pk === "string" ? data.spending_pk : "";
      const spending_sk = typeof data.spending_sk === "string" ? data.spending_sk : "";
      if (!viewing_sk || !spending_pk || !spending_sk) {
        setLoadError("Pasted JSON must contain viewing_sk, spending_pk, spending_sk");
        setKeys(null);
        return;
      }
      setKeys({ viewing_sk, spending_pk, spending_sk });
      toast.success("Keys loaded");
    } catch {
      setLoadError("Invalid JSON");
      setKeys(null);
    }
  };

  const handleScan = async () => {
    if (!keys) {
      toast.error("Load keys first (file or paste)");
      return;
    }
    setScanState("scanning");
    setStats(null);
    setDiscoveries([]);
    setRegistryStats(null);
    const stripHex = (s: string) => s.replace(/^0x/i, "").trim();
    try {
      const [scanRes, regRes] = await Promise.all([
        api.scanPayments({
          viewing_sk: stripHex(keys.viewing_sk),
          spending_pk: stripHex(keys.spending_pk),
          spending_sk: stripHex(keys.spending_sk),
          view_tags: keys.view_tag !== undefined ? [keys.view_tag] : undefined,
        }),
        api.getRegistryStats().catch(() => null),
      ]);
      setDiscoveries(scanRes.discoveries);
      setStats(scanRes.stats);
      setRegistryStats(regRes ?? null);
      setScanState("complete");
      if (scanRes.discoveries.length > 0) {
        toast.success(`Found ${scanRes.discoveries.length} payment(s)`);
      } else {
        toast.info("No payments found");
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Scan failed";
      const isNetwork = err instanceof ApiError && (message.includes("reach") || message.includes("fetch") || message.includes("Failed to fetch"));
      toast.error(isNetwork ? "Cannot reach SPECTER backend. Start it with: cargo run --bin specter -- serve --port 3001" : message);
      setScanState("error");
    }
  };

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts * 1000);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return "Just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} hours ago`;
    return d.toLocaleDateString();
  };

  // Load registry stats on mount (optional, for "Your View Tag" / total count)
  const fetchRegistryStats = async () => {
    try {
      const res = await api.getRegistryStats();
      setRegistryStats(res);
    } catch {
      setRegistryStats(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 pt-20 pb-12">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            {/* Compact title */}
            <div className="text-center mb-4">
              <h1 className="font-display text-2xl font-bold">Scan for Payments</h1>
              <p className="text-xs text-muted-foreground">Find stealth payments sent to you</p>
            </div>

            {/* STEP 1: LOAD KEYS - Primary action, highly visible */}
            <div className="bg-gradient-to-br from-primary/5 to-primary/10 border-2 border-primary/40 rounded-xl p-6 mb-4 shadow-xl">
              <div className="flex items-start gap-3 mb-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg shadow-md">
                  1
                </span>
                <div>
                  <h2 className="font-display font-bold text-xl mb-1">Load Your Keys</h2>
                  <p className="text-sm text-foreground/80 leading-relaxed">
                    Use the JSON file from <Link to="/generate" className="text-primary font-semibold hover:underline">Generate Keys</Link> page.
                    That file contains <code className="text-xs bg-muted/70 px-1.5 py-0.5 rounded">viewing_sk</code>,{" "}
                    <code className="text-xs bg-muted/70 px-1.5 py-0.5 rounded">spending_pk</code>, and{" "}
                    <code className="text-xs bg-muted/70 px-1.5 py-0.5 rounded">spending_sk</code>.
                  </p>
                </div>
              </div>

              {/* File picker and paste - side by side */}
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Option A: Upload File</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) loadKeysFromFile(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="default"
                    size="lg"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full"
                  >
                    <Upload className="h-5 w-5 mr-2" />
                    Choose JSON File
                  </Button>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Option B: Paste JSON</label>
                  <div className="flex gap-2">
                    <Input
                      placeholder='{"viewing_sk":"...","spending_pk":"...",...}'
                      value={keysPaste}
                      onChange={(e) => setKeysPaste(e.target.value)}
                      className="font-mono text-xs"
                    />
                    <Button variant="default" onClick={loadKeysFromPaste} disabled={!keysPaste.trim()}>
                      Load
                    </Button>
                  </div>
                </div>
              </div>

              {/* Status messages */}
              {keys && (
                <div className="mt-4 flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400 bg-green-100/80 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-lg px-4 py-3">
                  <Check className="h-5 w-5 shrink-0" />
                  Keys loaded successfully! Proceed to Step 2 below.
                </div>
              )}
              {loadError && (
                <div className="mt-4 flex items-center gap-2 text-sm text-red-700 dark:text-red-400 bg-red-100/80 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg px-4 py-3">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  {loadError}
                </div>
              )}
            </div>

            {/* STEP 2: SCAN - Secondary action */}
            <div className="glass-card p-6 border border-border/50">
              <AnimatePresence mode="wait">
                {scanState === "idle" && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground font-bold text-lg">
                        2
                      </span>
                      <div>
                        <h2 className="font-display font-bold text-xl mb-1">Run Scan</h2>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Scan the SPECTER registry (this backend) for payments sent to your stealth addresses.
                        </p>
                      </div>
                    </div>

                    {keys && (
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground border-t border-border/50 pt-4">
                        {keys.view_tag !== undefined && (
                          <span className="flex items-center gap-1.5 bg-accent/10 px-3 py-1.5 rounded-full">
                            <Zap className="h-4 w-4 text-accent" />
                            View tag {keys.view_tag}
                          </span>
                        )}
                        {registryStats !== null ? (
                          <span className="bg-muted px-3 py-1.5 rounded-full">
                            {registryStats.total_announcements.toLocaleString()} announcements
                          </span>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={fetchRegistryStats} className="h-7 text-xs">
                            Show registry stats
                          </Button>
                        )}
                      </div>
                    )}

                    <div className="text-center pt-2">
                      <Button
                        variant="quantum"
                        size="xl"
                        onClick={handleScan}
                        disabled={!keys}
                        className="min-w-[200px]"
                      >
                        <Scan className="h-5 w-5 mr-2" />
                        Start Scan
                      </Button>
                      {!keys && (
                        <p className="text-sm text-muted-foreground mt-3 flex items-center justify-center gap-2">
                          <KeyRound className="h-4 w-4" />
                          Complete Step 1 above first
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}

                {scanState === "scanning" && (
                  <motion.div
                    key="scanning"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-6 text-center py-8"
                  >
                    <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-4" />
                    <p className="text-muted-foreground">Scanning announcements...</p>
                  </motion.div>
                )}

                {(scanState === "complete" || scanState === "error") && (
                  <motion.div
                    key="complete"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-6"
                  >
                    {stats && (
                      <div className="flex items-center gap-3 p-4 rounded-lg bg-success/10 border border-success/20">
                        <Check className="h-5 w-5 text-success shrink-0" />
                        <span className="font-medium text-success">
                          Scan complete – {discoveries.length} payment(s) found
                        </span>
                      </div>
                    )}

                    {stats && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-display font-bold">
                            {stats.total_scanned.toLocaleString()}
                          </div>
                          <div className="text-xs text-muted-foreground">Scanned</div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-display font-bold text-accent">
                            {stats.discoveries}
                          </div>
                          <div className="text-xs text-muted-foreground">Discoveries</div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-display font-bold">
                            {stats.duration_ms}ms
                          </div>
                          <div className="text-xs text-muted-foreground">Duration</div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-display font-bold">
                            {stats.rate.toFixed(0)}/s
                          </div>
                          <div className="text-xs text-muted-foreground">Rate</div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      {discoveries.map((d, index) => (
                        <motion.div
                          key={`${d.stealth_address}-${d.announcement_id}`}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className="p-4 rounded-lg bg-muted/50 border border-border hover:border-primary/30 transition-colors"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <Wallet className="h-5 w-5 text-primary" />
                              </div>
                              <div>
                                <div className="font-mono text-sm">
                                  {d.stealth_address.slice(0, 10)}...
                                  {d.stealth_address.slice(-8)}
                                </div>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  {formatTimestamp(d.timestamp)}
                                </div>
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => setSelectedPayment(d)}
                          >
                            <ArrowDownToLine className="h-4 w-4 mr-2" />
                            View / Withdraw
                          </Button>
                        </motion.div>
                      ))}
                    </div>

                    <Button variant="outline" className="w-full" onClick={handleScan} disabled={!keys}>
                      <Scan className="h-4 w-4 mr-2" />
                      Scan Again
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Withdraw / details modal */}
            <AnimatePresence>
              {selectedPayment && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                  onClick={() => setSelectedPayment(null)}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="glass-card p-6 max-w-md w-full max-h-[90vh] overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 className="font-display text-xl font-bold mb-4">Discovered payment</h3>
                    <div className="space-y-4">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Stealth address</div>
                        <code className="text-sm font-mono break-all block">
                          {selectedPayment.stealth_address}
                        </code>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Announcement #</div>
                        <span className="font-mono">{selectedPayment.announcement_id}</span>
                      </div>
                      <div className="p-4 rounded-lg bg-warning/10 border border-warning/20">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
                          <div>
                            <h4 className="font-medium text-sm text-warning mb-1">
                              Handle private key securely
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              Use the eth_private_key (or stealth_sk) only in a secure wallet to sign
                              withdrawal transactions. Do not share or expose it.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => setSelectedPayment(null)}
                        >
                          Close
                        </Button>
                        <Button
                          variant="quantum"
                          className="flex-1"
                          onClick={() => {
                            navigator.clipboard.writeText(selectedPayment.stealth_address);
                            toast.success("Address copied");
                          }}
                        >
                          Copy address
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
