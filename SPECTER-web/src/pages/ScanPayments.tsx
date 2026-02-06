import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { privateKeyToAddress } from "viem/accounts";
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
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Receipt,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { api, ApiError, type DiscoveryDto, type ScanStatsDto, type RegistryStatsResponse } from "@/lib/api";
import { CopyButton } from "@/components/ui/copy-button";
import { DownloadJsonButton } from "@/components/ui/download-json-button";
import { TooltipLabel } from "@/components/ui/tooltip-label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AnimatedTicket } from "@/components/ui/ticket-confirmation-card";
import { HeadingScramble } from "@/components/ui/heading-scramble";
import { PixelCanvas } from "@/components/ui/pixel-canvas";

const CARD_PIXEL_COLORS = ["#8b5cf618", "#a78bfa14", "#7c3aed12", "#c4b5fd10"];

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
  const [revealedPk, setRevealedPk] = useState(false);
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);
  const [addressMatch, setAddressMatch] = useState<boolean | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derive address from private key when revealed
  useEffect(() => {
    if (!selectedPayment) setShowReceipt(false);
  }, [selectedPayment]);

  useEffect(() => {
    if (selectedPayment && revealedPk) {
      try {
        const pkHex = selectedPayment.eth_private_key.startsWith("0x")
          ? selectedPayment.eth_private_key
          : `0x${selectedPayment.eth_private_key}`;
        const derived = privateKeyToAddress(pkHex as `0x${string}`);
        setDerivedAddress(derived.toLowerCase());
        setAddressMatch(derived.toLowerCase() === selectedPayment.stealth_address.toLowerCase());
      } catch (err) {
        console.error("Failed to derive address:", err);
        setDerivedAddress(null);
        setAddressMatch(null);
      }
    } else {
      setDerivedAddress(null);
      setAddressMatch(null);
    }
  }, [selectedPayment, revealedPk]);

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
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 pt-20 pb-12">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            {/* Compact title */}
            <div className="text-center mb-4">
              <HeadingScramble
                as="h1"
                className="font-display text-2xl font-bold block"
              >
                Scan for Payments
              </HeadingScramble>
              <p className="text-xs text-muted-foreground">Find stealth payments sent to you</p>
            </div>

            {/* STEP 1: LOAD KEYS - Primary action, highly visible */}
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border-2 border-primary/40 p-6 mb-4 shadow-xl">
              <div className="absolute inset-0 overflow-hidden opacity-60 blur-[5px] pointer-events-none">
                <PixelCanvas
                  gap={10}
                  speed={25}
                  colors={CARD_PIXEL_COLORS}
                  variant="default"
                />
              </div>
              <div className="relative z-10">
              <div className="flex items-start gap-3 mb-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg shadow-md">
                  1
                </span>
                <div>
                  <h2 className="font-display font-bold text-xl mb-1 flex items-center gap-2">
                    Load Your Keys
                    <TooltipLabel
                      label=""
                      tooltip="Load the JSON from Generate Keys. It contains viewing_sk (decrypt announcements), spending_pk/spending_sk (derive stealth addresses and sign withdrawals)."
                      className="text-muted-foreground"
                    />
                  </h2>
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
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    Option A: Upload File
                    <TooltipLabel label="" tooltip="Upload the keys JSON from Generate Keys (viewing_sk, spending_pk, spending_sk)." className="text-muted-foreground" />
                  </label>
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
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    Option B: Paste JSON
                    <TooltipLabel label="" tooltip="Paste the same keys JSON here if you don't have the file." className="text-muted-foreground" />
                  </label>
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
            </div>

            {/* STEP 2: SCAN - Secondary action */}
            <div className="relative overflow-hidden rounded-xl glass-card border border-border/50">
              <div className="absolute inset-0 overflow-hidden opacity-60 blur-[5px] pointer-events-none">
                <PixelCanvas
                  gap={10}
                  speed={25}
                  colors={CARD_PIXEL_COLORS}
                  variant="default"
                />
              </div>
              <div className="relative z-10 p-6">
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
                        <h2 className="font-display font-bold text-xl mb-1 flex items-center gap-2">
                          Run Scan
                          <TooltipLabel
                            label=""
                            tooltip="The backend scans announcements and uses your viewing key to find payments intended for you. Only you can see which announcements match."
                            className="text-muted-foreground"
                          />
                        </h2>
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
                        {[
                          { value: stats.total_scanned.toLocaleString(), label: "Scanned", accent: false },
                          { value: String(stats.discoveries), label: "Discoveries", accent: true },
                          { value: `${stats.duration_ms}ms`, label: "Duration", accent: false },
                          { value: `${stats.rate.toFixed(0)}/s`, label: "Rate", accent: false },
                        ].map((item, i) => (
                          <motion.div
                            key={item.label}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05, duration: 0.2 }}
                            className="p-4 rounded-lg bg-muted/50"
                          >
                            <div className={`text-2xl font-display font-bold ${item.accent ? "text-accent" : ""}`}>
                              {item.value}
                            </div>
                            <div className="text-xs text-muted-foreground">{item.label}</div>
                          </motion.div>
                        ))}
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
            </div>

            {/* Withdraw / details modal */}
            <AnimatePresence>
              {selectedPayment && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                  onClick={() => {
                    setSelectedPayment(null);
                    setRevealedPk(false);
                  }}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="relative overflow-hidden rounded-xl glass-card max-w-md w-full max-h-[90vh] overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="absolute inset-0 overflow-hidden opacity-60 blur-[5px] pointer-events-none">
                      <PixelCanvas
                        gap={10}
                        speed={25}
                        colors={CARD_PIXEL_COLORS}
                        variant="default"
                      />
                    </div>
                    <div className="relative z-10 p-6">
                    <h3 className="font-display text-xl font-bold mb-4">Discovered payment</h3>
                    <div className="space-y-4">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                          <TooltipLabel
                            label="Stealth address"
                            tooltip="One-time address for this payment. Use it or the private key to withdraw in your wallet."
                          />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-sm font-mono break-all flex-1 min-w-0">
                            {selectedPayment.stealth_address}
                          </code>
                          <CopyButton
                            text={selectedPayment.stealth_address}
                            label="Copy"
                            successMessage="Address copied"
                            variant="outline"
                            size="sm"
                            showLabel={true}
                            tooltip="Copy stealth address"
                          />
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                          <TooltipLabel
                            label="Announcement #"
                            tooltip="Registry ID of the announcement that revealed this payment."
                          />
                        </div>
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
                      {!revealedPk ? (
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => setRevealedPk(true)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View / export private key
                        </Button>
                      ) : (
                        <div className="space-y-3 p-4 rounded-lg bg-muted/50 border border-border">
                          <p className="text-xs text-muted-foreground">
                            Only use in a secure wallet; don't share.
                          </p>
                          <code className="text-xs font-mono break-all block bg-background/80 p-3 rounded border overflow-x-auto">
                            {selectedPayment.eth_private_key}
                          </code>
                          
                          {/* Address Verification Section */}
                          {derivedAddress && (
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={`p-3 rounded-lg border ${
                                addressMatch
                                  ? "bg-success/10 border-success/30"
                                  : "bg-destructive/10 border-destructive/30"
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                {addressMatch ? (
                                  <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                                ) : (
                                  <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                                )}
                                <div className="flex-1 space-y-2">
                                  <div className="font-medium text-sm flex items-center gap-2">
                                    {addressMatch ? (
                                      <span className="text-success">✓ Address Verified</span>
                                    ) : (
                                      <span className="text-destructive">⚠️ Address Mismatch</span>
                                    )}
                                  </div>
                                  <div className="space-y-1.5 text-xs">
                                    <div>
                                      <span className="text-muted-foreground">Derived from private key:</span>
                                      <code className="block font-mono mt-1 break-all">{derivedAddress}</code>
                                    </div>
                                    {!addressMatch && (
                                      <div className="pt-2 border-t border-border/50">
                                        <span className="text-destructive font-medium">
                                          Backend needs rebuild! Run: cd specter && cargo build --release
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}

                          <div className="flex gap-2 flex-wrap">
                            <CopyButton
                              text={selectedPayment.eth_private_key}
                              label="Copy private key"
                              successMessage="Private key copied. Import in MetaMask: Account menu → Import account."
                              variant="quantum"
                              size="default"
                              className="flex-1 min-w-[140px]"
                              showLabel={true}
                              tooltip="Copy to import in MetaMask or another wallet"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRevealedPk(false)}
                            >
                              <EyeOff className="h-4 w-4 mr-2" />
                              Hide private key
                            </Button>
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-3">
                        <Button
                          variant="outline"
                          className="flex-1 min-w-[100px]"
                          onClick={() => {
                            setSelectedPayment(null);
                            setRevealedPk(false);
                          }}
                        >
                          Close
                        </Button>
                        <Button
                          variant="outline"
                          size="default"
                          className="flex-1 min-w-[100px]"
                          onClick={() => setShowReceipt(true)}
                        >
                          <Receipt className="h-4 w-4 mr-2" />
                          View receipt
                        </Button>
                        <DownloadJsonButton
                          data={{
                            stealth_address: selectedPayment.stealth_address,
                            announcement_id: selectedPayment.announcement_id,
                            timestamp: selectedPayment.timestamp,
                            ...(revealedPk ? { eth_private_key: selectedPayment.eth_private_key } : {}),
                            ...(revealedPk ? { note: "Keep eth_private_key secure. Do not share." } : {}),
                          }}
                          filename={`specter-discovery-${selectedPayment.announcement_id}-${selectedPayment.stealth_address.slice(2, 10)}.json`}
                          label="Download"
                          variant="outline"
                          size="default"
                          tooltip="Save discovery details as JSON"
                        />
                      </div>
                    </div>
                    </div>
                  </motion.div>
                </motion.div>
              )}

            </AnimatePresence>

            <Dialog open={showReceipt} onOpenChange={setShowReceipt}>
              <DialogContent className="max-w-sm border-0 bg-transparent shadow-none p-0 overflow-visible">
                {selectedPayment && (
                  <AnimatedTicket
                    ticketId={String(selectedPayment.announcement_id)}
                    amount={0}
                    date={new Date(selectedPayment.timestamp * 1000)}
                    cardHolder={`Payment #${selectedPayment.announcement_id}`}
                    last4Digits={selectedPayment.stealth_address.replace(/^0x/, "").slice(-4)}
                    barcodeValue={`${selectedPayment.announcement_id}${selectedPayment.stealth_address.slice(2, 14)}`}
                    currency="ETH"
                  />
                )}
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
