import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { formatUnits } from "viem";
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
  ExternalLink,
  HardDrive,
  HelpCircle,
  Info,
  Lock,
  RefreshCw,
  Activity,
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
import { StageFlowLoader, type FlowStage } from "@/components/ui/specialized/stage-flow-loader";
import { ScanRadar } from "@/components/ui/specialized/scan-radar";
import { UnlockSavedKeys } from "@/components/features/keys/UnlockSavedKeys";
import { VaultUnlockForm } from "@/components/features/keys/VaultUnlockForm";
import { SaveToDeviceDialog } from "@/components/features/keys/SaveToDeviceDialog";
import { listVaultEntries, getEntryUnlockMethod, type VaultEntry, type DecryptedKeys } from "@/lib/crypto/keyVault";
import { Fingerprint } from "lucide-react";
import { analytics } from "@/lib/analytics";
import {
  getChainDecimals,
  getExplorerTxUrl,
  getSendChainConfig,
  getTxChainFromBackendName,
  getTxChainFromSourceChainId,
  type TxChain,
} from "@/lib/blockchain/sendChains";

type ScanState = "idle" | "loading_keys" | "scanning" | "complete" | "error";
type KeySource = "vault" | "file" | "paste";

interface KeysFromFile {
  viewing_sk: string;
  spending_pk: string;
  spending_sk: string;
  viewing_pk: string;
  meta_address: string;
}

/**
 * Resolves which chain a discovered payment was made on.
 *
 * Priority: the EIP-155 `source_chain_id` decrypted from the on-chain
 * metadata blob (most reliable), then the registry's stored chain name
 * ("monad-testnet", "sepolia", "sui", …). Returns null — rendered as
 * "Unknown" — instead of guessing a default chain.
 */
function resolveDiscoveryChain(d: DiscoveryDto): TxChain | null {
  return getTxChainFromSourceChainId(d.source_chain_id) ?? getTxChainFromBackendName(d.chain);
}

interface DiscoveryAmount {
  /** Human-readable amount (e.g. "0.1234"), null when unknown/zero. */
  display: string | null;
  /** Numeric value in display units, for per-chain totals. */
  value: number;
}

/**
 * The backend returns `amount` in base units as a hex uint256 (decrypted
 * from the metadata blob) — e.g. 0.1234 MON arrives as 0x...b66e428aa20000.
 * Converts to display units using the chain's native decimals (18 for EVM
 * wei, 9 for Sui MIST). Legacy announcements that stored a pre-formatted
 * decimal string ("0.1234") pass through unchanged.
 */
function describeDiscoveryAmount(d: DiscoveryDto, chain: TxChain | null): DiscoveryAmount {
  const raw = (d.amount ?? "").trim();
  if (!raw) return { display: null, value: 0 };

  // Unknown chains assume EVM wei (18) — the most common base unit.
  const decimals = getChainDecimals(chain ?? "ethereum");
  let baseUnits: bigint | null = null;
  try {
    if (/^0x[0-9a-fA-F]+$/.test(raw)) baseUnits = BigInt(raw);
    else if (/^\d+$/.test(raw)) baseUnits = BigInt(raw);
  } catch {
    baseUnits = null;
  }

  if (baseUnits !== null) {
    if (baseUnits === 0n) return { display: null, value: 0 };
    const units = formatUnits(baseUnits, decimals);
    return { display: formatCryptoAmount(units), value: Number(units) };
  }

  // Legacy pre-formatted decimal string ("0.1234").
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return { display: null, value: 0 };
  return { display: formatCryptoAmount(raw), value: numeric };
}

function discoveryCurrencySymbol(d: DiscoveryDto, chain: TxChain | null): string {
  if (d.channel_id) return "USDC";
  return chain ? getSendChainConfig(chain).currencySymbol : "";
}

function chainIcon(chain: TxChain | null) {
  if (chain === "sui") return <SuiIcon className="h-4 w-4 text-[#4DA2FF]" />;
  if (chain === "arbitrum") return <ArbitrumIcon className="h-4 w-4 text-[#96BEDC]" />;
  if (chain === "monad") return <MonadIcon className="h-4 w-4 text-[#9E7BFF]" />;
  if (chain === "ethereum") return <EthereumIcon className="h-4 w-4 text-primary" />;
  return <HelpCircle className="h-4 w-4 text-white/40" />;
}

function chainAccentClass(chain: TxChain): string {
  if (chain === "sui") return "text-[#4DA2FF]";
  if (chain === "arbitrum") return "text-[#96BEDC]";
  if (chain === "monad") return "text-[#9E7BFF]";
  return "text-primary";
}

/** Animated integer counter — eases up to `value` whenever it changes. */
function CountUp({ value, durationMs = 900 }: { value: number; durationMs?: number }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (value <= 0) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <>{display.toLocaleString()}</>;
}

export default function ScanPayments() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [keys, setKeys] = useState<KeysFromFile | null>(null);
  const [keysPaste, setKeysPaste] = useState("");
  const [keySource, setKeySource] = useState<KeySource | null>(null);
  // Full key set (incl. viewing_pk + meta_address) — required by the vault.
  // Only populated when the uploaded/pasted JSON is a complete backup.
  const [fullKeySet, setFullKeySet] = useState<DecryptedKeys | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [keysSavedToVault, setKeysSavedToVault] = useState(false);
  const [savePromptDismissed, setSavePromptDismissed] = useState(false);

  // Quick unlock & scan state
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>(() => {
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

  // Stage loader state for the scan pipeline.
  const [scanStageIndex, setScanStageIndex] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [registryTotal, setRegistryTotal] = useState<number | null>(null);
  const stageTimersRef = useRef<number[]>([]);

  const clearStageTimers = useCallback(() => {
    for (const t of stageTimersRef.current) window.clearTimeout(t);
    stageTimersRef.current = [];
  }, []);

  useEffect(() => clearStageTimers, [clearStageTimers]);

  /**
   * The backend runs the whole scan in one POST (registry fetch → ML-KEM
   * trial decapsulation → key derivation → metadata decryption). The stages
   * are surfaced in the loader with the live registry size so the user knows
   * exactly what the wait is.
   */
  const scanStages: FlowStage[] = useMemo(
    () => [
      {
        id: "fetch",
        label: "Fetching announcements",
        description:
          registryTotal !== null
            ? `Loading ${registryTotal.toLocaleString()} announcements from the SPECTER registry`
            : "Loading the announcement registry from the SPECTER backend",
      },
      {
        id: "decapsulate",
        label: "ML-KEM-768 trial decapsulation",
        description:
          registryTotal !== null
            ? `Testing ${registryTotal.toLocaleString()} announcements against your viewing key (view-tag filtered)`
            : "Testing every announcement against your viewing key (view-tag filtered)",
      },
      {
        id: "derive",
        label: "Deriving stealth keys",
        description: "Recovering one-time private keys and decrypting payment metadata",
      },
    ],
    [registryTotal],
  );

  const PAGE_SIZE = 10;
  const filteredDiscoveries = discoveries.filter((d) => {
    if (chainFilter === "all") return true;
    return resolveDiscoveryChain(d) === chainFilter;
  });
  const paginatedDiscoveries = filteredDiscoveries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalPages = Math.ceil(filteredDiscoveries.length / PAGE_SIZE) || 1;
  const selectedPaymentChain = selectedPayment ? resolveDiscoveryChain(selectedPayment) : null;
  const selectedPaymentConfig = selectedPaymentChain ? getSendChainConfig(selectedPaymentChain) : null;
  const selectedPaymentAmount = selectedPayment
    ? describeDiscoveryAmount(selectedPayment, selectedPaymentChain)
    : null;
  const totalsByChain = discoveries.reduce<Record<TxChain, { count: number; amount: number }>>(
    (acc, discovery) => {
      const chain = resolveDiscoveryChain(discovery);
      if (!chain) return acc; // unknown-chain payments are listed but not totalled
      acc[chain].count += 1;
      acc[chain].amount += describeDiscoveryAmount(discovery, chain).value;
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
      const selectedChain = resolveDiscoveryChain(selectedPayment);
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

  /**
   * Parses a keys JSON (file or paste). The minimal scan set is
   * viewing_sk + spending_pk + spending_sk; when the JSON is a complete
   * specter-keys.json backup (viewing_pk + meta_address present) we also
   * keep the full set so the user can encrypt-and-save it to this device.
   */
  const ingestKeysJson = (text: string, source: "file" | "paste"): boolean => {
    setLoadError(null);
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : "");
      const viewing_sk = str("viewing_sk");
      const spending_pk = str("spending_pk");
      const spending_sk = str("spending_sk");
      if (!viewing_sk || !spending_pk || !spending_sk) {
        setLoadError(
          `${source === "file" ? "Keys file" : "Pasted JSON"} must contain viewing_sk, spending_pk, spending_sk`,
        );
        setKeys(null);
        setFullKeySet(null);
        setKeySource(null);
        return false;
      }
      setKeys({ viewing_sk, spending_pk, spending_sk });
      setKeySource(source);
      setKeysSavedToVault(false);

      const viewing_pk = str("viewing_pk");
      const meta_address = str("meta_address");
      setFullKeySet(
        viewing_pk && meta_address
          ? { spending_pk, spending_sk, viewing_pk, viewing_sk, meta_address }
          : null,
      );

      if (source === "file") {
        setKeysPaste("");
        analytics.scanKeysLoadedFromFile();
      } else {
        analytics.scanKeysLoadedFromPaste();
      }
      toast.success("Keys loaded");
      return true;
    } catch {
      setLoadError("Invalid JSON");
      setKeys(null);
      setFullKeySet(null);
      setKeySource(null);
      return false;
    }
  };

  const loadKeysFromFile = (file: File) => {
    setLoadError(null);
    const reader = new FileReader();
    reader.onload = () => {
      ingestKeysJson(reader.result as string, "file");
    };
    reader.readAsText(file);
  };

  const loadKeysFromPaste = () => {
    ingestKeysJson(keysPaste, "paste");
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
    setScanError(null);
    setScanStageIndex(0);

    // Fetch the registry size in parallel so the loader can show how many
    // announcements are being tested. Cosmetic only — never blocks the scan.
    api
      .getRegistryStats()
      .then((s) => setRegistryTotal(s.total_announcements))
      .catch(() => setRegistryTotal(null));

    // Advance the cosmetic stage markers while the single backend call runs.
    clearStageTimers();
    stageTimersRef.current.push(window.setTimeout(() => setScanStageIndex(1), 900));

    const stripHex = (s: string) => s.replace(/^0x/i, "").trim();
    try {
      const scanRes = await api.scanPayments({
        viewing_sk: stripHex(scanKeys.viewing_sk),
        spending_pk: stripHex(scanKeys.spending_pk),
        spending_sk: stripHex(scanKeys.spending_sk),
      });
      clearStageTimers();
      // Flash the final stage as done, then reveal results.
      setScanStageIndex(2);
      stageTimersRef.current.push(
        window.setTimeout(() => {
          setScanStageIndex(scanStages.length);
          setDiscoveries([...scanRes.discoveries].sort((a, b) => b.timestamp - a.timestamp));
          setStats(scanRes.stats);
          setScanState("complete");
          analytics.scanCompleted(scanRes.discoveries.length);
          if (scanRes.discoveries.length > 0) {
            toast.success(`Found ${scanRes.discoveries.length} payment(s)`);
          } else {
            toast.info("No payments found");
          }
        }, 450),
      );
    } catch (err) {
      clearStageTimers();
      const message = err instanceof ApiError ? err.message : "Scan failed";
      const isNetwork =
        err instanceof ApiError &&
        (message.includes("reach") || message.includes("fetch") || message.includes("Failed to fetch"));
      const displayMessage = isNetwork
        ? "Cannot reach the SPECTER backend. Check your connection and retry."
        : message;
      analytics.scanError(message);
      setScanError(displayMessage);
      setScanState("error");
      toast.error(displayMessage);
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
    setKeySource("vault");
    setFullKeySet(null); // already in the vault — no need to offer saving
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

          {/* Quick Unlock & Scan — compact card when saved vault keys exist */}
          {vaultEntries.length > 0 && !keys && scanState === "idle" && (
            <div className="w-full mb-4 rounded-xl border border-primary/20 bg-primary/[0.04] backdrop-blur-md">
              <div className="px-4 py-3 flex items-center gap-3">
                {/* Identity icon */}
                <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  {getEntryUnlockMethod(vaultEntries[0]!) === "passkey"
                    ? <Fingerprint className="h-4 w-4 text-primary" />
                    : <Lock className="h-4 w-4 text-primary" />}
                </div>
                {/* Label + date */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {vaultEntries.length === 1
                      ? vaultEntries[0]!.label
                      : `${vaultEntries.length} saved identities`}
                  </p>
                  {vaultEntries.length === 1 && (
                    <p className="text-[11px] text-muted-foreground">
                      saved {new Date(vaultEntries[0]!.createdAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
              <div className="px-4 pb-3">
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
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <KeyRound className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display font-semibold text-foreground text-sm">
                    {vaultEntries.length > 0 && !keys ? "Use a different key" : "Load keys"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Upload or paste your JSON backup from <Link to="/setup" className="text-primary hover:underline">Setup</Link>
                  </p>
                </div>
              </div>

              {/* Only show UnlockSavedKeys when there are no vault entries (no quick-unlock card above) */}
              {vaultEntries.length === 0 && (
                <UnlockSavedKeys
                  onUnlock={(dk: DecryptedKeys) => {
                    setKeys({
                      viewing_sk: dk.viewing_sk,
                      spending_pk: dk.spending_pk,
                      spending_sk: dk.spending_sk,
                      viewing_pk: dk.viewing_pk,
                      meta_address: dk.meta_address,
                    });
                    setKeySource("vault");
                    setFullKeySet(null);
                    setKeysPaste("");
                    setLoadError(null);
                    setSavePromptDismissed(true);
                  }}
                />
              )}

              <div className="space-y-2">
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

              {/* Offer local encryption for uploaded/pasted backups — same
                  passkey/password vault as Generate Keys. Hidden for keys
                  that already came from the vault. */}
              <AnimatePresence initial={false}>
                {keys && fullKeySet && (keySource === "file" || keySource === "paste") && !keysSavedToVault && (
                  <motion.div
                    key="save-offer"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setSaveDialogOpen(true)}
                      className="mt-2 flex items-center gap-3 w-full p-3 rounded-lg border border-primary/20 bg-primary/[0.06] hover:bg-primary/[0.1] hover:border-primary/40 transition-colors text-left"
                    >
                      <HardDrive className="h-4 w-4 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">
                          Encrypt &amp; save to this device
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Skip the upload next time — unlock with a passkey or password, keys never leave this browser
                        </p>
                      </div>
                      <Fingerprint className="h-4 w-4 text-primary/60 shrink-0 ml-auto" />
                    </button>
                  </motion.div>
                )}
                {keysSavedToVault && (
                  <motion.div
                    key="save-done"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 flex items-center gap-2 p-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] text-xs text-emerald-300/90">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Saved on this device — next time use quick unlock above
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
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

              {/* Live scan pipeline — shows which stage is running */}
              <AnimatePresence>
                {(scanState === "scanning" || scanState === "error") && (
                  <motion.div
                    key="scan-loader"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-5 space-y-3"
                  >
                    {scanState === "scanning" && (
                      <ScanRadar
                        caption={
                          registryTotal !== null
                            ? `Sweeping ${registryTotal.toLocaleString()} announcements`
                            : "Sweeping the announcement registry"
                        }
                      />
                    )}
                    <StageFlowLoader
                      stages={scanStages}
                      activeIndex={scanStageIndex}
                      error={scanState === "error" ? scanError : null}
                      hint={
                        scanState === "scanning"
                          ? "Your keys never leave this request — nothing is stored server-side."
                          : undefined
                      }
                    />
                    {scanState === "error" && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => handleScan()}
                        disabled={!keys}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Retry scan
                      </Button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence mode="wait">
                {scanState === "complete" && (
                  <motion.div
                    key="complete"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 26 }}
                    className="space-y-4 mt-6"
                  >
                    <motion.div
                      className="specter-confirm"
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.05 }}
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span className="specter-confirm-text">
                        {filteredDiscoveries.length} stealth payment{filteredDiscoveries.length !== 1 ? "s" : ""} detected
                      </span>
                    </motion.div>

                    {/* Scan statistics from the backend */}
                    {stats && (
                      <motion.div
                        className="relative overflow-hidden rounded-lg border border-white/[0.07] bg-black/30 px-3 py-2.5"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                      >
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                        <div className="flex items-center gap-1.5 mb-2">
                          <Activity className="h-3 w-3 text-primary/70" />
                          <span className="font-display text-[10px] font-bold tracking-[0.16em] uppercase text-white/30">
                            Scan report
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                          <div>
                            <p className="font-mono text-sm text-white/85 tabular-nums">
                              <CountUp value={stats.total_scanned} />
                            </p>
                            <p className="text-[10px] text-white/35">scanned</p>
                          </div>
                          <div>
                            <p className="font-mono text-sm text-white/85 tabular-nums">
                              <CountUp value={stats.view_tag_matches} />
                            </p>
                            <p className="text-[10px] text-white/35">view-tag matches</p>
                          </div>
                          <div>
                            <p className="font-mono text-sm text-emerald-400/90 tabular-nums">
                              <CountUp value={stats.discoveries} />
                            </p>
                            <p className="text-[10px] text-white/35">discoveries</p>
                          </div>
                          <div>
                            <p className="font-mono text-sm text-white/85 tabular-nums">
                              {stats.duration_ms < 1000
                                ? `${stats.duration_ms}ms`
                                : `${(stats.duration_ms / 1000).toFixed(1)}s`}
                            </p>
                            <p className="text-[10px] text-white/35">
                              {stats.rate > 0 ? `${Math.round(stats.rate)}/s` : "duration"}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                    {discoveries.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {(Object.keys(totalsByChain) as TxChain[])
                          .filter((chain) => totalsByChain[chain].count > 0)
                          .map((chain, i) => {
                            const cfg = getSendChainConfig(chain);
                            const total = totalsByChain[chain];
                            return (
                              <motion.div
                                key={chain}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.15 + i * 0.06 }}
                                whileHover={{ y: -2 }}
                                className="rounded-lg border border-white/[0.08] bg-black/25 px-2.5 py-2 transition-colors hover:border-white/[0.16] hover:bg-black/40"
                              >
                                <div className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${chainAccentClass(chain)}`}>
                                  {chainIcon(chain)}
                                  {cfg.shortLabel}
                                </div>
                                <div className="text-xs text-white/70 mt-1">
                                  {formatCryptoAmount(total.amount.toFixed(6))} {cfg.currencySymbol}
                                </div>
                                <div className="text-[10px] text-white/35">{total.count} payment{total.count !== 1 ? "s" : ""}</div>
                              </motion.div>
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
                    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.1)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb:hover]:bg-white/20">
                      {filteredDiscoveries.map((d, i) => {
                        const mappedChain = resolveDiscoveryChain(d);
                        const addr = mappedChain === "sui" ? d.stealth_sui_address : d.stealth_address;
                        const shortAddr = addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
                        const chainCfg = mappedChain ? getSendChainConfig(mappedChain) : null;
                        const amount = describeDiscoveryAmount(d, mappedChain);
                        return (
                          <motion.div
                            key={`${d.stealth_address}-${d.announcement_id}`}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 + i * 0.05, type: "spring", stiffness: 320, damping: 28 }}
                            whileHover={{ x: 3 }}
                            role="button"
                            tabIndex={0}
                            onClick={() => { analytics.scanPaymentSelected(mappedChain ?? "unknown"); setSelectedPayment(d); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { analytics.scanPaymentSelected(mappedChain ?? "unknown"); setSelectedPayment(d); } }}
                            className="p-3 rounded-lg bg-black/35 border border-white/[0.08] flex items-center gap-3 cursor-pointer hover:bg-white/[0.04] hover:border-primary/30 transition-colors"
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
                                  {chainCfg?.shortLabel ?? "Unknown"}
                                </span>
                                {amount.display && (
                                  <span className="font-medium text-foreground shrink-0 inline-flex items-center gap-1">
                                    {amount.display} {discoveryCurrencySymbol(d, mappedChain)}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                <Clock className="h-3 w-3" />
                                {formatTimestamp(d.timestamp)}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
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
                        {chainIcon(selectedPaymentChain)}
                        <span className="font-medium">
                          {selectedPaymentConfig?.label ?? "Unknown chain"}
                        </span>
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
                        {selectedPaymentAmount?.display
                          ? `${selectedPaymentAmount.display} ${discoveryCurrencySymbol(selectedPayment, selectedPaymentChain)}`
                          : "—"}
                      </p>
                    </div>

                    {/* Source payment tx */}
                    {selectedPayment.payment_tx_hash && (
                      <div>
                        <span className="text-xs text-muted-foreground">Payment transaction</span>
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          <code className="text-xs font-mono break-all flex-1 min-w-0">
                            {selectedPayment.payment_tx_hash}
                          </code>
                          {selectedPaymentChain &&
                            getExplorerTxUrl(selectedPaymentChain, selectedPayment.payment_tx_hash) && (
                              <a
                                href={getExplorerTxUrl(selectedPaymentChain, selectedPayment.payment_tx_hash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Explorer
                              </a>
                            )}
                        </div>
                      </div>
                    )}

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

      {/* Encrypt-and-save uploaded keys to the local vault (passkey/password) */}
      {fullKeySet && (
        <SaveToDeviceDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          keys={fullKeySet}
          onSaved={() => {
            setKeysSavedToVault(true);
            try {
              setVaultEntries(listVaultEntries());
            } catch {
              /* vault unavailable — list refresh is cosmetic */
            }
          }}
        />
      )}
    </div>
  );
}
