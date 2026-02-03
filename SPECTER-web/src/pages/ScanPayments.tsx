import { useState, useRef } from "react";
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
    try {
      const [scanRes, regRes] = await Promise.all([
        api.scanPayments({
          viewing_sk: keys.viewing_sk,
          spending_pk: keys.spending_pk,
          spending_sk: keys.spending_sk,
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
      toast.error(message);
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

      <main className="flex-1 pt-24 pb-12">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-12"
            >
              <h1 className="font-display text-3xl md:text-4xl font-bold mb-4">
                Scan for Payments
              </h1>
              <p className="text-muted-foreground">
                Find your stealth funds with quantum-safe scanning
              </p>
            </motion.div>

            {/* Load keys */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              transition={{ delay: 0.1 }}
              className="glass-card p-6 mb-6"
            >
              <h3 className="font-display font-semibold mb-3">Your keys</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Load keys from the JSON file you downloaded when generating keys, or paste JSON below.
              </p>
              <div className="space-y-3">
                <div className="flex gap-2">
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
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Load from file
                  </Button>
                  {keys && (
                    <div className="flex items-center gap-2 text-sm text-success">
                      <Check className="h-4 w-4" />
                      Keys loaded
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder='Paste JSON: {"viewing_sk":"...","spending_pk":"...","spending_sk":"..."}'
                    value={keysPaste}
                    onChange={(e) => setKeysPaste(e.target.value)}
                    className="font-mono text-xs bg-background"
                  />
                  <Button variant="outline" onClick={loadKeysFromPaste} disabled={!keysPaste.trim()}>
                    Load
                  </Button>
                </div>
                {loadError && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {loadError}
                  </div>
                )}
              </div>
            </motion.div>

            {/* Registry stats (optional) */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              transition={{ delay: 0.15 }}
              className="glass-card p-6 mb-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {keys?.view_tag !== undefined && (
                    <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                      <span className="font-mono font-bold text-primary">{keys.view_tag}</span>
                    </div>
                  )}
                  <div>
                    <div className="font-medium">Registry</div>
                    <div className="text-sm text-muted-foreground">
                      {registryStats !== null
                        ? `${registryStats.total_announcements.toLocaleString()} announcements`
                        : "Scan to see stats"}
                    </div>
                  </div>
                </div>
                {!registryStats && keys && (
                  <Button variant="ghost" size="sm" onClick={fetchRegistryStats}>
                    Refresh stats
                  </Button>
                )}
                <div className="flex items-center gap-2 text-accent">
                  <Zap className="h-4 w-4" />
                  <span className="text-sm font-medium">99.6% Efficiency</span>
                </div>
              </div>
            </motion.div>

            {/* Main scan card */}
            <div className="glass-card p-8">
              <AnimatePresence mode="wait">
                {scanState === "idle" && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center py-8"
                  >
                    <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-6">
                      <Scan className="h-10 w-10 text-primary" />
                    </div>
                    <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                      Scan the registry to find payments sent to your stealth addresses.
                    </p>
                    <Button
                      variant="quantum"
                      size="xl"
                      onClick={handleScan}
                      disabled={!keys}
                    >
                      Start Scan
                    </Button>
                    {!keys && (
                      <p className="text-sm text-muted-foreground mt-4">
                        Load your keys above first.
                      </p>
                    )}
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
