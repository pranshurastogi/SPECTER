import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { privateKeyToAddress } from "viem/accounts";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Scan,
  Loader2,
  Wallet,
  Clock,
  AlertTriangle,
  Check,
  Upload,
  KeyRound,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Info,
  Lock,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { api, ApiError, type DiscoveryDto, type ScanStatsDto } from "@/lib/api";
import { CopyButton } from "@/components/ui/copy-button";
import { EthereumIcon, SuiIcon } from "@/components/ui/chain-icons";
import { formatCryptoAmount } from "@/lib/utils";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revealedPk, setRevealedPk] = useState(false);
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);
  const [addressMatch, setAddressMatch] = useState<boolean | null>(null);
  const [suiPrivateKeyBech32, setSuiPrivateKeyBech32] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const PAGE_SIZE = 10;
  const paginatedDiscoveries = discoveries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalPages = Math.ceil(discoveries.length / PAGE_SIZE) || 1;

  useEffect(() => {
    setPage(0);
  }, [discoveries.length]);

  useEffect(() => {
    if (selectedPayment && revealedPk) {
      try {
        const pkHex = selectedPayment.eth_private_key.startsWith("0x")
          ? selectedPayment.eth_private_key.slice(2)
          : selectedPayment.eth_private_key;
        const bytes = new Uint8Array(pkHex.length / 2);
        for (let i = 0; i < pkHex.length; i += 2) {
          bytes[i / 2] = parseInt(pkHex.substring(i, i + 2), 16);
        }
        if (selectedPayment.chain === "sui") {
          const keypair = Secp256k1Keypair.fromSecretKey(bytes);
          const derived = keypair.getPublicKey().toSuiAddress();
          const expected = normalizeSuiAddress(selectedPayment.stealth_sui_address);
          setDerivedAddress(derived);
          setAddressMatch(normalizeSuiAddress(derived) === expected);
          setSuiPrivateKeyBech32(keypair.getSecretKey());
        } else {
          const derived = privateKeyToAddress(`0x${pkHex}` as `0x${string}`);
          setDerivedAddress(derived.toLowerCase());
          setAddressMatch(derived.toLowerCase() === selectedPayment.stealth_address.toLowerCase());
          setSuiPrivateKeyBech32(null);
        }
      } catch (err) {
        console.error("Failed to derive address:", err);
        setDerivedAddress(null);
        setAddressMatch(null);
        setSuiPrivateKeyBech32(null);
      }
    } else {
      setDerivedAddress(null);
      setAddressMatch(null);
      setSuiPrivateKeyBech32(null);
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
    const stripHex = (s: string) => s.replace(/^0x/i, "").trim();
    try {
      const scanRes = await api.scanPayments({
        viewing_sk: stripHex(keys.viewing_sk),
        spending_pk: stripHex(keys.spending_pk),
        spending_sk: stripHex(keys.spending_sk),
      });
      setDiscoveries([...scanRes.discoveries].sort((a, b) => b.timestamp - a.timestamp));
      setStats(scanRes.stats);
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

      <main className="flex-1 pt-48 pb-12 flex flex-col items-center">
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

          {/* Load keys + Scan */}
          <Card className="w-full border-border bg-card/50 shadow-lg rounded-xl">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <KeyRound className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-display font-semibold text-foreground">
                    Load or paste keys
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    JSON keys from <Link to="/setup" className="text-primary hover:underline">Setup</Link>
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-muted bg-muted/30 p-3 mb-4 flex items-start gap-2">
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Keys are never stored on the backend. Use only on trusted devices.
                </p>
              </div>
              <div className="space-y-3">
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
                <div className="flex gap-2">
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
                    Load
                  </Button>
                </div>
              </div>
              {keys && (
                <div className="mt-3 flex items-center gap-2 text-sm text-success p-3 rounded-lg bg-success/10 border border-success/20">
                  <Lock className="h-4 w-4 shrink-0 text-success" />
                  Secret data loaded
                </div>
              )}
              {loadError && (
                <div className="mt-3 flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {loadError}
                </div>
              )}

              <div className="mt-6">
                <Button
                  variant="quantum"
                  size="lg"
                  onClick={handleScan}
                  disabled={!keys || scanState === "scanning"}
                  className="w-full"
                >
                  {scanState === "scanning" ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Scanning…
                    </>
                  ) : (
                    <>
                      <Scan className="h-4 w-4 mr-2" />
                      Start scan
                    </>
                  )}
                </Button>
              </div>

              <AnimatePresence mode="wait">
                {(scanState === "complete" || scanState === "error") && (
                  <motion.div
                    key="complete"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-4 mt-6"
                  >
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/20">
                      <Check className="h-4 w-4 text-success shrink-0" />
                      <span className="text-sm font-medium text-success">
                        {discoveries.length} payment(s) found
                      </span>
                    </div>
                    <div className="space-y-2">
                      {paginatedDiscoveries.map((d) => {
                        const addr = d.chain === "sui" ? d.stealth_sui_address : d.stealth_address;
                        const shortAddr = addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
                        const ChainIcon = d.chain === "sui" ? SuiIcon : EthereumIcon;
                        return (
                          <div
                            key={`${d.stealth_address}-${d.announcement_id}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedPayment(d)}
                            onKeyDown={(e) => e.key === "Enter" && setSelectedPayment(d)}
                            className="p-3 rounded-lg bg-muted/40 border border-border flex items-center gap-3 cursor-pointer hover:bg-muted/60 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <ChainIcon className={`h-4 w-4 ${d.chain === "sui" ? "text-[#4DA2FF]" : "text-primary"}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap text-xs">
                                <span className="font-mono truncate" title={addr}>
                                  {shortAddr}
                                </span>
                                {d.amount !== "" && (
                                  <span className="font-medium text-foreground shrink-0">
                                    {formatCryptoAmount(d.amount)}{" "}
                                    {d.chain === "sui" ? "SUI" : d.channel_id ? "USDC" : "ETH"}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                <Clock className="h-3 w-3" />
                                {formatTimestamp(d.timestamp)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between gap-2 pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                          disabled={page === 0}
                        >
                          Previous
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {page + 1} / {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                          disabled={page >= totalPages - 1}
                        >
                          Next
                        </Button>
                      </div>
                    )}
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
                    {/* Chain */}
                    <div>
                      <span className="text-xs text-muted-foreground">Chain</span>
                      <div className="flex items-center gap-2 mt-1">
                        {selectedPayment.chain === "sui" ? (
                          <>
                            <SuiIcon size={18} className="text-[#4DA2FF]" />
                            <span className="font-medium">Sui</span>
                          </>
                        ) : (
                          <>
                            <EthereumIcon size={18} />
                            <span className="font-medium">Ethereum</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Address for chain only */}
                    <div>
                      <span className="text-xs text-muted-foreground">
                        {selectedPayment.chain === "sui" ? "Sui address" : "EVM address"}
                      </span>
                      <div className="flex items-center gap-2 flex-wrap mt-1">
                        <code className="text-xs font-mono break-all flex-1 min-w-0">
                          {selectedPayment.chain === "sui"
                            ? selectedPayment.stealth_sui_address
                            : selectedPayment.stealth_address}
                        </code>
                        <CopyButton
                          text={
                            selectedPayment.chain === "sui"
                              ? selectedPayment.stealth_sui_address ?? ""
                              : selectedPayment.stealth_address
                          }
                          label="Copy"
                          successMessage="Copied"
                          variant="outline"
                          size="sm"
                          showLabel={true}
                        />
                      </div>
                    </div>

                    {/* Amount */}
                    <div>
                      <span className="text-xs text-muted-foreground">Amount</span>
                      <p className="font-medium mt-1">
                        {selectedPayment.amount
                          ? `${formatCryptoAmount(selectedPayment.amount)} ${
                              selectedPayment.chain === "sui"
                                ? "SUI"
                                : selectedPayment.channel_id
                                  ? "USDC"
                                  : "ETH"
                            }`
                          : "—"}
                      </p>
                    </div>

                    {/* Timestamp */}
                    <div>
                      <span className="text-xs text-muted-foreground">Timestamp</span>
                      <p className="font-medium mt-1">{formatTimestamp(selectedPayment.timestamp)}</p>
                    </div>

                    {selectedPayment.channel_id && (
                      <div className="p-3 rounded-lg bg-muted/50 border border-border">
                        <p className="text-xs text-muted-foreground">
                          Yellow channel (USDC). Funds will appear at this address after the sender closes the channel and it settles on Sepolia.
                        </p>
                      </div>
                    )}

                    {/* View private key */}
                    <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground">
                          Import this private key into a secure wallet.
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
                          {selectedPayment.chain === "sui" && suiPrivateKeyBech32
                            ? suiPrivateKeyBech32
                            : selectedPayment.eth_private_key}
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
                            text={
                              selectedPayment.chain === "sui" && suiPrivateKeyBech32
                                ? suiPrivateKeyBech32
                                : selectedPayment.eth_private_key
                            }
                            label="Copy pvt key"
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
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
