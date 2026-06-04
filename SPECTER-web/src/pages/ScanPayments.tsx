import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { privateKeyToAddress } from "viem/accounts";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { HeadingScramble } from "@/components/ui/animations/heading-scramble";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { Card, CardContent } from "@/components/ui/base/card";
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
import { toast } from "@/components/ui/base/sonner";
import { api, ApiError, type DiscoveryDto, type ScanStatsDto } from "@/lib/api";
import { CopyButton } from "@/components/ui/specialized/copy-button";
import {
  ArbitrumIcon,
  EthereumIcon,
  MonadIcon,
  SuiIcon,
} from "@/components/ui/specialized/chain-icons";
import { formatCryptoAmount } from "@/lib/utils";
import { CoreSpinLoader } from "@/components/ui/core-spin-loader";
import { UnlockSavedKeys } from "@/components/features/keys/UnlockSavedKeys";
import { VaultUnlockForm } from "@/components/features/keys/VaultUnlockForm";
import { listVaultEntries, getEntryUnlockMethod, hasStoredKeys, type VaultEntry, type DecryptedKeys } from "@/lib/crypto/keyVault";
import { Fingerprint } from "lucide-react";
import { analytics } from "@/lib/analytics";
import { getSendChainConfig, type TxChain } from "@/lib/blockchain/sendChains";
import { SaveToDeviceDialog } from "@/components/features/keys/SaveToDeviceDialog";
import { HardDrive } from "lucide-react";

type ScanState = "idle" | "loading_keys" | "scanning" | "complete" | "error";

interface KeysFromFile {
  viewing_sk: string;
  spending_pk: string;
  spending_sk: string;
  viewing_pk: string;
  meta_address: string;
}

function normalizeDiscoveryChain(chain: string): TxChain {
  const normalized = chain.trim().toLowerCase();
  if (normalized === "sui") return "sui";
  if (normalized === "arbitrum" || normalized.includes("arb")) return "arbitrum";
  if (normalized === "monad") return "monad";
  return "ethereum";
}

function chainIcon(chain: TxChain) {
  if (chain === "sui") return <SuiIcon className="h-4 w-4 text-[#4DA2FF]" />;
  if (chain === "arbitrum") return <ArbitrumIcon className="h-4 w-4 text-[#96BEDC]" />;
  if (chain === "monad") return <MonadIcon className="h-4 w-4 text-[#9E7BFF]" />;
  return <EthereumIcon className="h-4 w-4 text-primary" />;
}

function chainAccentClass(chain: TxChain): string {
  if (chain === "sui") return "text-[#4DA2FF]";
  if (chain === "arbitrum") return "text-[#96BEDC]";
  if (chain === "monad") return "text-[#9E7BFF]";
  return "text-primary";
}

export default function ScanPayments() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [keys, setKeys] = useState<KeysFromFile | null>(null);
  const [keysPaste, setKeysPaste] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [savePromptDismissed, setSavePromptDismissed] = useState(false);

  // Quick unlock & scan state
  const [vaultEntries] = useState<VaultEntry[]>(() => {
    try { return listVaultEntries(); } catch { return []; }
  });
  const [quickSelectedId, setQuickSelectedId] = useState<string>(() => {
    try { return listVaultEntries()[0]?.id ?? ""; } catch { return ""; }
  });
  const [stats, setStats] = useState<ScanStatsDto | null>(null);
  const [discoveries, setDiscoveries] = useState<DiscoveryDto[]>([]);
  const [selectedPayment, setSelectedPayment] = useState<DiscoveryDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revealedPk, setRevealedPk] = useState(false);
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);
  const [addressMatch, setAddressMatch] = useState<boolean | null>(null);
  const [suiPrivateKeyBech32, setSuiPrivateKeyBech32] = useState<string | null>(null);
  const [chainFilter, setChainFilter] = useState<"all" | TxChain>("all");
  const [page, setPage] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const PAGE_SIZE = 10;
  const filteredDiscoveries = discoveries.filter((d) => {
    if (chainFilter === "all") return true;
    return normalizeDiscoveryChain(d.chain) === chainFilter;
  });
  const paginatedDiscoveries = filteredDiscoveries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalPages = Math.ceil(filteredDiscoveries.length / PAGE_SIZE) || 1;
  const selectedPaymentChain = selectedPayment ? normalizeDiscoveryChain(selectedPayment.chain) : null;
  const selectedPaymentConfig = selectedPaymentChain ? getSendChainConfig(selectedPaymentChain) : null;
  const totalsByChain = discoveries.reduce<Record<TxChain, { count: number; amount: number }>>(
    (acc, discovery) => {
      const chain = normalizeDiscoveryChain(discovery.chain);
      const numericAmount = Number(discovery.amount || "0");
      acc[chain].count += 1;
      acc[chain].amount += Number.isFinite(numericAmount) ? numericAmount : 0;
      return acc;
    },
    {
      ethereum: { count: 0, amount: 0 },
      arbitrum: { count: 0, amount: 0 },
      monad: { count: 0, amount: 0 },
      sui: { count: 0, amount: 0 },
    },
  );

  useEffect(() => {
    setPage(0);
  }, [discoveries.length, chainFilter]);

  useEffect(() => {
    if (selectedPayment && revealedPk) {
      const selectedChain = normalizeDiscoveryChain(selectedPayment.chain);
      try {
        const pkHex = selectedPayment.eth_private_key.startsWith("0x")
          ? selectedPayment.eth_private_key.slice(2)
          : selectedPayment.eth_private_key;
        const bytes = new Uint8Array(pkHex.length / 2);
        for (let i = 0; i < pkHex.length; i += 2) {
          bytes[i / 2] = parseInt(pkHex.substring(i, i + 2), 16);
        }
        if (selectedChain === "sui") {
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
        const viewing_pk = typeof data.viewing_pk === "string" ? data.viewing_pk : "";
        const meta_address = typeof data.meta_address === "string" ? data.meta_address : "";
        if (!viewing_sk || !spending_pk || !spending_sk) {
          setLoadError("Keys file must contain viewing_sk, spending_pk, spending_sk");
          setKeys(null);
          return;
        }
        setKeys({
          viewing_sk,
          spending_pk,
          spending_sk,
          viewing_pk,
          meta_address,
        });
        setKeysPaste("");
        setSavePromptDismissed(false);
        analytics.scanKeysLoadedFromFile();
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
      const viewing_pk = typeof data.viewing_pk === "string" ? data.viewing_pk : "";
      const meta_address = typeof data.meta_address === "string" ? data.meta_address : "";
      if (!viewing_sk || !spending_pk || !spending_sk) {
        setLoadError("Pasted JSON must contain viewing_sk, spending_pk, spending_sk");
        setKeys(null);
        return;
      }
      setKeys({ viewing_sk, spending_pk, spending_sk, viewing_pk, meta_address });
      setSavePromptDismissed(false);
      analytics.scanKeysLoadedFromPaste();
      toast.success("Keys loaded");
    } catch {
      setLoadError("Invalid JSON");
      setKeys(null);
    }
  };

  const handleScan = async (keysOverride?: KeysFromFile, method?: "file" | "vault" | "paste") => {
    const scanKeys = keysOverride ?? keys;
    if (!scanKeys) {
      toast.error("Load keys first");
      return;
    }
    const keyMethod = method ?? (keysPaste ? "paste" : "file");
    analytics.scanInitiated(keyMethod);
    setScanState("scanning");
    setStats(null);
    setDiscoveries([]);
    const stripHex = (s: string) => s.replace(/^0x/i, "").trim();
    try {
      const scanRes = await api.scanPayments({
        viewing_sk: stripHex(scanKeys.viewing_sk),
        spending_pk: stripHex(scanKeys.spending_pk),
        spending_sk: stripHex(scanKeys.spending_sk),
      });
      setDiscoveries([...scanRes.discoveries].sort((a, b) => b.timestamp - a.timestamp));
      setStats(scanRes.stats);
      setScanState("complete");
      analytics.scanCompleted(scanRes.discoveries.length);
      if (scanRes.discoveries.length > 0) {
        toast.success(`Found ${scanRes.discoveries.length} payment(s)`);
      } else {
        toast.info("No payments found");
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Scan failed";
      const isNetwork = err instanceof ApiError && (message.includes("reach") || message.includes("fetch") || message.includes("Failed to fetch"));
      analytics.scanError(message);
      toast.error(isNetwork ? "Cannot reach SPECTER backend." : message);
      setScanState("error");
    }
  };

  const handleVaultUnlockAndScan = async (dk: DecryptedKeys) => {
    const k: KeysFromFile = {
      viewing_sk: dk.viewing_sk,
      spending_pk: dk.spending_pk,
      spending_sk: dk.spending_sk,
      viewing_pk: dk.viewing_pk,
      meta_address: dk.meta_address,
    };
    setKeys(k);
    analytics.scanKeysLoadedFromVault();
    toast.success("Keys unlocked — scanning…");
    await handleScan(k, "vault");
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

  const chainFilters: Array<"all" | TxChain> = ["all", "ethereum", "arbitrum", "monad", "sui"];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 pt-48 pb-12 flex flex-col items-center">
        <div className="w-full max-w-lg mx-auto px-4 flex flex-col items-center">
          {/* Title */}
          <div className="text-center mb-8">
            <HeadingScramble
              as="h1"
              className="font-display text-2xl md:text-3xl font-bold text-foreground"
            >
              Scan for Payments
            </HeadingScramble>
            <p className="text-sm text-muted-foreground mt-2">
              Discover and claim stealth payments.
            </p>
          </div>

          {/* Quick Unlock & Scan — only when vault has keys and none loaded yet */}
          {vaultEntries.length > 0 && !keys && scanState === "idle" && (
            <div className="w-full mb-4 rounded-xl overflow-hidden border border-white/[0.06] bg-black/60 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-white/[0.05] bg-primary/[0.04]">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <span className="font-display text-[10px] font-bold tracking-[0.2em] uppercase text-white/30">
                  Saved identity detected
                </span>
              </div>
              <div className="px-4 py-3 space-y-3">
                {/* Entry picker — only show if multiple */}
                {vaultEntries.length === 1 && (
                  <p className="text-xs text-white/40 font-display flex items-center gap-1">
                    {getEntryUnlockMethod(vaultEntries[0]!) === "passkey" ? (
                      <Fingerprint className="h-3 w-3 text-white/50" />
                    ) : (
                      <Lock className="h-3 w-3 text-white/50" />
                    )}
                    <span className="text-white/70 font-medium">{vaultEntries[0]!.label}</span>
                    {" · "}saved {new Date(vaultEntries[0]!.createdAt).toLocaleDateString()}
                  </p>
                )}

                <VaultUnlockForm
                  entries={vaultEntries}
                  selectedId={quickSelectedId}
                  onSelectId={setQuickSelectedId}
                  onUnlock={handleVaultUnlockAndScan}
                  unlockLabel="Unlock & Scan"
                  variant="scan"
                  showEntryPicker={vaultEntries.length > 1}
                />
              </div>
            </div>
          )}

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

              <UnlockSavedKeys
                onUnlock={(dk: DecryptedKeys) => {
                  setKeys({
                    viewing_sk: dk.viewing_sk,
                    spending_pk: dk.spending_pk,
                    spending_sk: dk.spending_sk,
                    viewing_pk: dk.viewing_pk,
                    meta_address: dk.meta_address,
                  });
                  setKeysPaste("");
                  setLoadError(null);
                  setSavePromptDismissed(true); // Already from vault, no need to prompt
                }}
              />

              <div className="flex items-center gap-2 my-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or load from file</span>
                <div className="flex-1 h-px bg-border" />
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
                <div className="specter-confirm mt-3">
                  <Lock className="h-3.5 w-3.5" />
                  <span className="specter-confirm-text">Keys loaded — ready to scan</span>
                </div>
              )}

              {/* Save to device prompt - only show if keys loaded from file/paste and not dismissed */}
              {keys && !savePromptDismissed && keys.viewing_pk && keys.meta_address && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 p-3 rounded-lg border border-primary/20 bg-primary/5"
                >
                  <div className="flex items-start gap-2.5">
                    <HardDrive className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground mb-1">
                        Save keys locally?
                      </p>
                      <p className="text-xs text-muted-foreground mb-3">
                        Encrypt and store on this device for quick access next time.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowSaveDialog(true)}
                          className="text-xs h-7"
                        >
                          <HardDrive className="h-3 w-3 mr-1.5" />
                          Save now
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSavePromptDismissed(true)}
                          className="text-xs h-7 text-muted-foreground"
                        >
                          Skip
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
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
                  onClick={() => handleScan()}
                  disabled={!keys || scanState === "scanning"}
                  className="w-full"
                >
                  <Scan className="h-4 w-4 mr-2" />
                  Start scan
                </Button>
              </div>

              {/* SaveToDeviceDialog */}
              {keys && keys.viewing_pk && keys.meta_address && (
                <SaveToDeviceDialog
                  open={showSaveDialog}
                  onOpenChange={setShowSaveDialog}
                  keys={{
                    spending_pk: keys.spending_pk,
                    spending_sk: keys.spending_sk,
                    viewing_pk: keys.viewing_pk,
                    viewing_sk: keys.viewing_sk,
                    meta_address: keys.meta_address,
                  }}
                  onSaved={() => {
                    setSavePromptDismissed(true);
                  }}
                />
              )}

              {scanState === "scanning" && (
                <CoreSpinLoader />
              )}

              <AnimatePresence mode="wait">
                {(scanState === "complete" || scanState === "error") && (
                  <motion.div
                    key="complete"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-4 mt-6"
                  >
                    <div className="specter-confirm">
                      <Check className="h-3.5 w-3.5" />
                      <span className="specter-confirm-text">
                        {filteredDiscoveries.length} stealth payment{filteredDiscoveries.length !== 1 ? "s" : ""} detected
                      </span>
                    </div>
                    {discoveries.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {(Object.keys(totalsByChain) as TxChain[])
                          .filter((chain) => totalsByChain[chain].count > 0)
                          .map((chain) => {
                            const cfg = getSendChainConfig(chain);
                            const total = totalsByChain[chain];
                            return (
                              <div
                                key={chain}
                                className="rounded-lg border border-white/[0.08] bg-black/25 px-2.5 py-2"
                              >
                                <div className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${chainAccentClass(chain)}`}>
                                  {chainIcon(chain)}
                                  {cfg.shortLabel}
                                </div>
                                <div className="text-xs text-white/70 mt-1">
                                  {formatCryptoAmount(total.amount.toFixed(6))} {cfg.currencySymbol}
                                </div>
                                <div className="text-[10px] text-white/35">{total.count} payment{total.count !== 1 ? "s" : ""}</div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {chainFilters.map((filter) => {
                        const active = chainFilter === filter;
                        const label = filter === "all" ? "All" : getSendChainConfig(filter).shortLabel;
                        return (
                          <button
                            key={filter}
                            type="button"
                            onClick={() => setChainFilter(filter)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              active
                                ? "border-primary/50 bg-primary/15 text-primary"
                                : "border-white/10 bg-black/30 text-white/50 hover:bg-white/[0.06] hover:text-white/80"
                            }`}
                          >
                            {filter !== "all" && chainIcon(filter)}
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-2">
                      {paginatedDiscoveries.map((d) => {
                        const mappedChain = normalizeDiscoveryChain(d.chain);
                        const addr = mappedChain === "sui" ? d.stealth_sui_address : d.stealth_address;
                        const shortAddr = addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
                        const chainCfg = getSendChainConfig(mappedChain);
                        return (
                          <div
                            key={`${d.stealth_address}-${d.announcement_id}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => { analytics.scanPaymentSelected(mappedChain); setSelectedPayment(d); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { analytics.scanPaymentSelected(mappedChain); setSelectedPayment(d); } }}
                            className="p-3 rounded-lg bg-black/35 border border-white/[0.08] flex items-center gap-3 cursor-pointer hover:bg-white/[0.04] hover:border-white/[0.14] transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.1] flex items-center justify-center shrink-0">
                              {chainIcon(mappedChain)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap text-xs">
                                <span className="font-mono truncate" title={addr}>
                                  {shortAddr}
                                </span>
                                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/55">
                                  {chainCfg.shortLabel}
                                </span>
                                {d.amount !== "" && (
                                  <span className="font-medium text-foreground shrink-0 inline-flex items-center gap-1">
                                    {formatCryptoAmount(d.amount)}{" "}
                                    {d.channel_id ? "USDC" : chainCfg.currencySymbol}
                                    {chainIcon(mappedChain)}
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
                        {selectedPaymentChain && chainIcon(selectedPaymentChain)}
                        <span className="font-medium">{selectedPaymentConfig?.label}</span>
                      </div>
                    </div>

                    {/* Address for chain only */}
                    <div>
                      <span className="text-xs text-muted-foreground">
                        {selectedPaymentChain === "sui" ? "Sui address" : "EVM address"}
                      </span>
                      <div className="flex items-center gap-2 flex-wrap mt-1">
                        <code className="text-xs font-mono break-all flex-1 min-w-0">
                          {selectedPaymentChain === "sui"
                            ? selectedPayment.stealth_sui_address
                            : selectedPayment.stealth_address}
                        </code>
                        <CopyButton
                          text={
                            selectedPaymentChain === "sui"
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
                              selectedPayment.channel_id ? "USDC" : selectedPaymentConfig?.currencySymbol ?? ""
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
                        onClick={() => { analytics.scanPrivateKeyRevealed(); setRevealedPk(true); }}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        View private key
                      </Button>
                    ) : (
                      <div className="space-y-3 p-3 rounded-lg bg-muted/40 border border-border">
                        <code className="text-xs font-mono break-all block bg-background/80 p-2 rounded border overflow-x-auto">
                          {selectedPaymentChain === "sui" && suiPrivateKeyBech32
                            ? suiPrivateKeyBech32
                            : selectedPayment.eth_private_key}
                        </code>
                        {derivedAddress && (
                          addressMatch ? (
                            <div className="specter-confirm">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span className="specter-confirm-text">Address verified</span>
                            </div>
                          ) : (
                            <div className="p-3 rounded-lg border text-xs bg-destructive/10 border-destructive/30 text-destructive">
                              <div className="flex items-center gap-2">
                                <XCircle className="h-4 w-4 shrink-0" />
                                Address mismatch
                              </div>
                              <code className="block mt-1 break-all font-mono">{derivedAddress}</code>
                            </div>
                          )
                        )}
                        <div className="flex gap-2 flex-wrap">
                          <CopyButton
                            text={
                              selectedPaymentChain === "sui" && suiPrivateKeyBech32
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
