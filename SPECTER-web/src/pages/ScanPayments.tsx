import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { privateKeyToAddress } from "viem/accounts";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Scan,
  Loader2,
  Wallet,
  Clock,
  ArrowDownToLine,
  AlertTriangle,
  Check,
  Upload,
  KeyRound,
  CheckCircle2,
  XCircle,
  Receipt,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { api, ApiError, type DiscoveryDto, type ScanStatsDto, type RegistryStatsResponse } from "@/lib/api";
import { CopyButton } from "@/components/ui/copy-button";
import { DownloadJsonButton } from "@/components/ui/download-json-button";
import { TooltipLabel } from "@/components/ui/tooltip-label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AnimatedTicket } from "@/components/ui/ticket-confirmation-card";

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
          setLoadError("Keys file must contain viewing_sk, spending_pk, spending_sk");
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
        toast.success("Keys loaded");
      } catch {
        setLoadError("Invalid JSON");
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
      toast.error("Load keys first");
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
      toast.error(isNetwork ? "Cannot reach SPECTER backend." : message);
      setScanState("error");
    }
  };

  const fetchRegistryStats = async () => {
    try {
      const res = await api.getRegistryStats();
      setRegistryStats(res);
    } catch {
      setRegistryStats(null);
    }
  };

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts * 1000);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return "Just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 pt-20 pb-12 flex flex-col items-center">
        <div className="w-full max-w-lg mx-auto px-4 flex flex-col items-center">
          {/* Title */}
          <div className="text-center mb-8">
            <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground">
              Scan for Payments
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Find stealth payments sent to you
            </p>
          </div>

          {/* Step 1: Load keys */}
          <Card className="w-full border-border bg-card/50 shadow-lg rounded-xl mb-4">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <KeyRound className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-display font-semibold text-foreground">
                    Load keys
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    From <Link to="/setup" className="text-primary hover:underline">Setup</Link> (JSON file or paste)
                  </p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
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
                  size="default"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload JSON
                </Button>
                <div className="flex gap-2 sm:col-span-2 sm:flex-row">
                  <Input
                    placeholder='{"viewing_sk":"...",...}'
                    value={keysPaste}
                    onChange={(e) => setKeysPaste(e.target.value)}
                    className="font-mono text-xs flex-1"
                  />
                  <Button
                    variant="outline"
                    size="default"
                    onClick={loadKeysFromPaste}
                    disabled={!keysPaste.trim()}
                  >
                    Paste
                  </Button>
                </div>
              </div>
              {keys && (
                <div className="mt-3 flex items-center gap-2 text-sm text-success">
                  <Check className="h-4 w-4 shrink-0" />
                  Keys loaded. Run scan below.
                </div>
              )}
              {loadError && (
                <div className="mt-3 flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {loadError}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step 2: Scan */}
          <Card className="w-full border-border bg-card/50 shadow-lg rounded-xl">
            <CardContent className="p-6">
              <AnimatePresence mode="wait">
                {scanState === "idle" && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center"
                  >
                    <div className="flex items-center gap-3 mb-4 w-full">
                      <div className="w-9 h-9 rounded-lg bg-muted border border-border flex items-center justify-center">
                        <Scan className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="font-display font-semibold text-foreground">
                          Run scan
                        </h2>
                        <TooltipLabel
                          label=""
                          tooltip="Backend scans announcements with your viewing key. Only you see matches."
                          className="text-xs text-muted-foreground"
                        />
                      </div>
                    </div>
                    {keys && registryStats !== null && (
                      <p className="text-xs text-muted-foreground mb-4 w-full">
                        {registryStats.total_announcements.toLocaleString()} announcements
                        {keys.view_tag !== undefined && ` · View tag ${keys.view_tag}`}
                      </p>
                    )}
                    {keys && registryStats === null && (
                      <Button variant="ghost" size="sm" onClick={fetchRegistryStats} className="mb-4 text-xs">
                        Show registry stats
                      </Button>
                    )}
                    <Button
                      variant="quantum"
                      size="lg"
                      onClick={handleScan}
                      disabled={!keys}
                      className="w-full"
                    >
                      <Scan className="h-4 w-4 mr-2" />
                      Start scan
                    </Button>
                    {!keys && (
                      <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                        <KeyRound className="h-3.5 w-3.5" />
                        Load keys above first
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
                    className="flex flex-col items-center py-8"
                  >
                    <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
                    <p className="text-sm text-muted-foreground">Scanning…</p>
                  </motion.div>
                )}

                {(scanState === "complete" || scanState === "error") && stats && (
                  <motion.div
                    key="complete"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/20">
                      <Check className="h-4 w-4 text-success shrink-0" />
                      <span className="text-sm font-medium text-success">
                        {discoveries.length} payment(s) found
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: stats.total_scanned.toLocaleString(), label: "Scanned" },
                        { value: String(stats.discoveries), label: "Discoveries", accent: true },
                        { value: `${stats.duration_ms}ms`, label: "Duration" },
                        { value: `${stats.rate.toFixed(0)}/s`, label: "Rate" },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="p-3 rounded-lg bg-muted/40 border border-border"
                        >
                          <div className={`text-lg font-display font-bold ${(item as { accent?: boolean }).accent ? "text-primary" : "text-foreground"}`}>
                            {item.value}
                          </div>
                          <div className="text-xs text-muted-foreground">{item.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      {discoveries.map((d) => (
                        <div
                          key={`${d.stealth_address}-${d.announcement_id}`}
                          className="p-3 rounded-lg bg-muted/40 border border-border flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <Wallet className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-mono text-xs truncate">
                                {d.stealth_address.slice(0, 10)}…{d.stealth_address.slice(-8)}
                              </div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {formatTimestamp(d.timestamp)}
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedPayment(d)}
                          >
                            <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5" />
                            View
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="default"
                      className="w-full"
                      onClick={handleScan}
                      disabled={!keys}
                    >
                      <Scan className="h-4 w-4 mr-2" />
                      Scan again
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />

      {/* Payment detail modal */}
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
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md"
            >
              <Card className="border-border bg-card shadow-xl rounded-xl overflow-hidden">
                <CardContent className="p-6 max-h-[90vh] overflow-y-auto">
                  <h3 className="font-display text-lg font-bold mb-4">Discovered payment</h3>
                  <div className="space-y-4">
                    <div>
                      <TooltipLabel
                        label="Stealth address"
                        tooltip="One-time address for this payment."
                        className="text-xs text-muted-foreground mb-1 block"
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs font-mono break-all flex-1 min-w-0">
                          {selectedPayment.stealth_address}
                        </code>
                        <CopyButton
                          text={selectedPayment.stealth_address}
                          label="Copy"
                          successMessage="Copied"
                          variant="outline"
                          size="sm"
                          showLabel={true}
                        />
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Announcement #</span>
                      <span className="font-mono text-sm ml-2">{selectedPayment.announcement_id}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">
                          Use the private key only in a secure wallet. Do not share.
                        </p>
                      </div>
                    </div>
                    {!revealedPk ? (
                      <Button
                        variant="outline"
                        size="default"
                        className="w-full"
                        onClick={() => setRevealedPk(true)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        View private key
                      </Button>
                    ) : (
                      <div className="space-y-3 p-3 rounded-lg bg-muted/40 border border-border">
                        <code className="text-xs font-mono break-all block bg-background/80 p-2 rounded border overflow-x-auto">
                          {selectedPayment.eth_private_key}
                        </code>
                        {derivedAddress && (
                          <div
                            className={`p-3 rounded-lg border text-xs ${
                              addressMatch
                                ? "bg-success/10 border-success/30 text-success"
                                : "bg-destructive/10 border-destructive/30 text-destructive"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {addressMatch ? (
                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                              ) : (
                                <XCircle className="h-4 w-4 shrink-0" />
                              )}
                              {addressMatch ? "Address verified" : "Address mismatch"}
                            </div>
                            {!addressMatch && (
                              <code className="block mt-1 break-all font-mono">{derivedAddress}</code>
                            )}
                          </div>
                        )}
                        <div className="flex gap-2 flex-wrap">
                          <CopyButton
                            text={selectedPayment.eth_private_key}
                            label="Copy key"
                            successMessage="Copied"
                            variant="quantum"
                            size="sm"
                            className="flex-1 min-w-[100px]"
                            showLabel={true}
                          />
                          <Button variant="ghost" size="sm" onClick={() => setRevealedPk(false)}>
                            <EyeOff className="h-4 w-4 mr-1.5" />
                            Hide
                          </Button>
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedPayment(null);
                          setRevealedPk(false);
                        }}
                      >
                        Close
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowReceipt(true)}
                      >
                        <Receipt className="h-4 w-4 mr-1.5" />
                        Receipt
                      </Button>
                      <DownloadJsonButton
                        data={{
                          stealth_address: selectedPayment.stealth_address,
                          announcement_id: selectedPayment.announcement_id,
                          timestamp: selectedPayment.timestamp,
                          ...(revealedPk ? { eth_private_key: selectedPayment.eth_private_key } : {}),
                        }}
                        filename={`specter-discovery-${selectedPayment.announcement_id}.json`}
                        label="Download"
                        variant="outline"
                        size="sm"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
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
  );
}
