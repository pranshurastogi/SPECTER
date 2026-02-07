import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Check,
  Loader2,
  ArrowRight,
  Search,
  X,
  ExternalLink,
  Copy,
  Zap,
  Shield,
  Send,
  DollarSign,
  Radio,
  Lock,
  Eye,
  RefreshCw,
  AlertCircle,
  Upload,
  Info,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { CopyButton } from "@/components/ui/copy-button";
import { HeadingScramble } from "@/components/ui/heading-scramble";
import { PixelCanvas } from "@/components/ui/pixel-canvas";
import {
  api,
  ApiError,
  type YellowCreateChannelResponse,
  type YellowDiscoveredChannel,
  type YellowConfigResponse,
  type YellowChannelStatusResponse,
  type ResolveEnsResponse,
} from "@/lib/api";
import { formatAddress } from "@/lib/utils";
import { TooltipLabel } from "@/components/ui/tooltip-label";
import { Link } from "react-router-dom";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import { chain } from "@/lib/chainConfig";
import { getYellowClient } from "@/lib/yellowService";

const CARD_PIXEL_COLORS = ["#eab30818", "#fbbf2414", "#f59e0b12", "#fcd34d10"];

const ease = [0.43, 0.13, 0.23, 0.96] as const;

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.3 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

/** Real Sepolia tx hashes are 0x + 64 hex chars. Placeholder refs are shorter. */
function isRealTxHash(h: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(h);
}

type YellowTab = "dashboard" | "create" | "discover";

// ═══════════════════════════════════════════════════════════════════════════
// Channel types for local state
// ═══════════════════════════════════════════════════════════════════════════

const YELLOW_CHANNELS_STORAGE_KEY = "specter_yellow_channels";

interface LocalChannel {
  channel_id: string;
  stealth_address: string;
  eth_private_key?: string;
  status: string;
  token: string;
  amount: string;
  recipient?: string;
  created_at: number;
  tx_hash?: string;
  session_id?: string;
}

function loadChannelsFromStorage(): LocalChannel[] {
  try {
    const raw = localStorage.getItem(YELLOW_CHANNELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalChannel[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveChannelsToStorage(channels: LocalChannel[]): void {
  try {
    localStorage.setItem(YELLOW_CHANNELS_STORAGE_KEY, JSON.stringify(channels));
  } catch {
    // ignore
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Create Channel Wizard
// ═══════════════════════════════════════════════════════════════════════════

type CreateStep = 1 | 2 | 3 | 4 | 5;

function CreatePrivateChannel({
  onCreated,
}: {
  onCreated: (ch: LocalChannel) => void;
}) {
  const { primaryWallet, setShowAuthFlow } = useDynamicContext();
  const [step, setStep] = useState<CreateStep>(1);
  const [recipient, setRecipient] = useState("");
  const [token, setToken] = useState("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolveStatus, setResolveStatus] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedENS, setResolvedENS] = useState<ResolveEnsResponse | null>(null);
  const [resolvedMetaAddress, setResolvedMetaAddress] = useState<string | null>(null);
  const [channelResult, setChannelResult] = useState<YellowCreateChannelResponse | null>(null);
  const evmConnected = !!primaryWallet;

  const stepLabels = [
    "Enter Recipient",
    "Generate Stealth",
    "Open Channel",
    "Fund Channel",
    "Publish",
  ];

  // Step 1: Resolve recipient (mirror Send page: ENS or meta-address hex)
  const handleResolve = async () => {
    const name = recipient.trim();
    if (!name) {
      setResolveError("Enter a recipient ENS name (e.g. bob.eth) or meta-address hex");
      toast.error("Enter recipient");
      return;
    }

    const looksLikeHex = /^[0-9a-fA-F]+$/.test(name.replace(/^0x/, "")) && name.length > 100;
    if (looksLikeHex) {
      const metaHex = name.replace(/^0x/, "").trim();
      setResolvedENS({
        ens_name: "meta-address",
        meta_address: metaHex,
        spending_pk: metaHex.length >= 2370 ? metaHex.slice(2, 2370) : "",
        viewing_pk: metaHex.length >= 4738 ? metaHex.slice(2370, 4738) : "",
      });
      setResolvedMetaAddress(metaHex);
      setResolveError(null);
      toast.success("Meta-address accepted");
      return;
    }

    const normalized = name.includes(".") ? name : `${name}.eth`;
    setResolveStatus("Resolving…");
    setResolveError(null);
    setResolvedENS(null);
    setResolvedMetaAddress(null);

    try {
      const resolved = await api.resolveEns(normalized);
      setResolvedENS(resolved);
      setResolvedMetaAddress(resolved.meta_address);
      setResolveError(null);
      toast.success(`Resolved ${resolved.ens_name}`);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      const message = apiErr?.message ?? "Failed to resolve ENS";
      const code = apiErr?.code;
      if (code === "NO_SPECTER_RECORD" || code === "NO_SUINS_SPECTER_RECORD") {
        setResolveError("no-specter-setup");
      } else {
        setResolveError(message);
      }
      toast.error(message);
    } finally {
      setResolveStatus("");
    }
  };

  // Steps 2-5: Create channel through API, then fund via Yellow Network (Sepolia ClearNode)
  const handleCreateChannel = async () => {
    const recipientForApi = resolvedMetaAddress ?? recipient.trim();
    if (!recipientForApi) {
      toast.error("Resolve recipient first");
      return;
    }
    if (!primaryWallet) {
      toast.error("Connect your wallet first using the Connect button (e.g. in Send or Setup), then try again. Use Sepolia in MetaMask.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      setStep(2);
      await new Promise((r) => setTimeout(r, 800));

      setStep(3);
      const result = await api.yellowCreateChannel({
        recipient: recipientForApi,
        token,
        amount: amount || "100",
      });
      setChannelResult(result);

      setStep(4);
      // Fund channel via Yellow Network: create session with [user, stealth] and allocations
      const walletClient = await primaryWallet.getWalletClient(chain.id.toString());
      if (!walletClient?.account) {
        const msg = isEthereumWallet(primaryWallet)
          ? "Switch your wallet to Sepolia network, then try again."
          : "Connect an Ethereum wallet (Sepolia) to fund the channel.";
        toast.error(msg);
        setIsLoading(false);
        return;
      }
      const userAddress = walletClient.account.address;
      const amountNum = parseFloat(amount || "100");
      const amountSixDecimals = Math.floor(amountNum * 1e6).toString(); // USDC 6 decimals
      const yellow = getYellowClient();
      const messageSigner = async (msg: string) =>
        walletClient.signMessage({ message: msg });
      await yellow.connect();
      const { sessionId } = await yellow.createSession({
        messageSigner,
        userAddress,
        partnerAddress: result.stealth_address,
        asset: "usdc",
        amountUser: "0",
        amountPartner: amountSixDecimals,
      });

      setStep(5);
      await new Promise((r) => setTimeout(r, 500));

      toast.success("Private channel created and funded on Yellow Network!");

      onCreated({
        channel_id: result.channel_id,
        stealth_address: result.stealth_address,
        status: "open",
        token,
        amount: amount || "100",
        recipient: resolvedENS?.ens_name ?? recipient,
        created_at: Date.now() / 1000,
        tx_hash: result.tx_hash,
        session_id: sessionId,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : "Channel creation failed");
      setError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      className="space-y-6"
      variants={fadeIn}
      initial="hidden"
      animate="visible"
    >
      <div className="relative overflow-hidden rounded-xl border border-border bg-card/50 backdrop-blur-sm p-6">
        <PixelCanvas colors={CARD_PIXEL_COLORS} gap={8} speed={25} />

        <div className="relative z-10">
          <h2 className="text-xl font-display font-bold mb-6">
            Create Private Trading Channel
          </h2>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-8">
            {stepLabels.map((label, i) => {
              const stepNum = (i + 1) as CreateStep;
              const isActive = step === stepNum;
              const isComplete = step > stepNum;
              return (
                <div key={i} className="flex items-center gap-2">
                  <div
                    className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all duration-300 ${
                      isComplete
                        ? "bg-yellow-500 text-black"
                        : isActive
                        ? "bg-yellow-500/20 text-yellow-400 ring-2 ring-yellow-500/50"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isComplete ? <Check className="w-4 h-4" /> : stepNum}
                  </div>
                  <span
                    className={`hidden sm:inline text-xs ${
                      isActive ? "text-yellow-400" : "text-muted-foreground"
                    }`}
                  >
                    {label}
                  </span>
                  {i < stepLabels.length - 1 && (
                    <div
                      className={`w-4 sm:w-8 h-px ${
                        isComplete ? "bg-yellow-500" : "bg-border"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Step content */}
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                variants={fadeIn}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground flex items-center gap-1">
                    <TooltipLabel
                      label="Recipient"
                      tooltip="ENS name (e.g. bob.eth) or paste meta-address hex from Setup. Only the recipient can discover this channel."
                    />
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={recipient}
                      onChange={(e) => {
                        setRecipient(e.target.value);
                        setResolveError(null);
                      }}
                      placeholder="bob.eth or meta-address hex"
                      className="flex-1 bg-background/50 border-border"
                    />
                    <Button
                      onClick={handleResolve}
                      disabled={!!resolveStatus || !recipient.trim()}
                      variant="default"
                      className="bg-yellow-500 hover:bg-yellow-600 text-black"
                    >
                      {resolveStatus ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  {resolveStatus && (
                    <p className="text-xs text-muted-foreground flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {resolveStatus}
                    </p>
                  )}
                </div>

                {resolveError && (
                  <div className="space-y-2">
                    {resolveError === "no-specter-setup" ? (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                        <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium">SPECTER not enabled by recipient</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              The recipient must set SPECTER on the{" "}
                              <Link to="/setup" className="text-yellow-600 dark:text-yellow-400 hover:underline">Setup</Link> page first.
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {resolveError}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">
                    Token
                  </Label>
                  <Input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Token address"
                    className="bg-background/50 border-border font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Default: USDC on Sepolia
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground flex items-center gap-1">
                    <TooltipLabel
                      label="Funding amount"
                      tooltip="Amount to deposit into the channel. Ensure you have sufficient USDC (Sepolia) to fund."
                    />
                  </Label>
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="100"
                    type="number"
                    min="0"
                    className="bg-background/50 border-border"
                  />
                  {resolvedMetaAddress && (
                    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-1">
                      <p className="text-xs font-medium text-yellow-400">
                        Channel funding: {amount || "100"} USDC
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Ensure you have sufficient USDC on Sepolia to fund this channel.
                      </p>
                    </div>
                  )}
                </div>

                {resolvedENS && resolvedMetaAddress && (
                  <div className="flex flex-col gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <div className="flex items-center gap-2 text-sm text-green-400">
                      <Check className="w-4 h-4 shrink-0" />
                      <span>Resolved: {resolvedENS.ens_name}</span>
                    </div>
                    <p className="text-xs font-mono text-muted-foreground break-all">
                      {resolvedMetaAddress.slice(0, 24)}...{resolvedMetaAddress.slice(-12)}
                    </p>
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4" />
                    <span>{error}</span>
                  </div>
                )}
              </motion.div>
            )}

            {step >= 2 && step <= 5 && (
              <motion.div
                key="steps-progress"
                variants={fadeIn}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-4"
              >
                {/* Progress steps */}
                <div className="space-y-3">
                  {[
                    { s: 2, label: "Generate stealth address", icon: Shield },
                    { s: 3, label: "Open Yellow channel", icon: Zap },
                    { s: 4, label: "Fund channel", icon: DollarSign },
                    { s: 5, label: "Publish announcement", icon: Radio },
                  ].map(({ s, label, icon: Icon }) => (
                    <div
                      key={s}
                      className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-300 ${
                        step > s
                          ? "bg-yellow-500/10 border border-yellow-500/20"
                          : step === s
                          ? "bg-yellow-500/5 border border-yellow-500/10"
                          : "opacity-40"
                      }`}
                    >
                      {step > s ? (
                        <Check className="w-5 h-5 text-yellow-400" />
                      ) : step === s ? (
                        <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
                      ) : (
                        <Icon className="w-5 h-5 text-muted-foreground" />
                      )}
                      <span
                        className={`text-sm ${
                          step >= s ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {label}
                      </span>
                      {step > s && step === 5 && s === 3 && channelResult && (
                        <span className="ml-auto text-xs font-mono text-yellow-400">
                          {formatAddress(channelResult.channel_id)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {step === 5 && !isLoading && channelResult && (
                  <motion.div
                    variants={fadeIn}
                    initial="hidden"
                    animate="visible"
                    className="mt-4 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20"
                  >
                    <h3 className="text-sm font-bold text-yellow-400 mb-2">
                      Channel Created Successfully
                    </h3>
                    <div className="space-y-1 text-xs font-mono">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Channel ID:</span>
                        <span className="flex items-center gap-1">
                          {formatAddress(channelResult.channel_id)}
                          <CopyButton text={channelResult.channel_id} />
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Stealth Address:</span>
                        <span className="flex items-center gap-1">
                          {formatAddress(channelResult.stealth_address)}
                          <CopyButton text={channelResult.stealth_address} />
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Channel ref:</span>
                        <span className="flex items-center gap-1 font-mono text-muted-foreground">
                          {formatAddress(channelResult.tx_hash)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        No on-chain tx yet; this is a channel reference. Fund the channel to use it.
                      </p>
                    </div>
                  </motion.div>
                )}

                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4" />
                    <span>{error}</span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Wallet connect notice when resolved but not connected */}
          {step === 1 && resolvedMetaAddress && !evmConnected && (
            <div className="mt-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 flex flex-wrap items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="text-sm text-amber-700 dark:text-amber-400">
                Connect an Ethereum wallet (Sepolia) to create and fund the channel.
              </span>
              <Button
                type="button"
                size="sm"
                onClick={() => setShowAuthFlow?.(true)}
                className="bg-amber-500 hover:bg-amber-600 text-black shrink-0"
              >
                Connect wallet
              </Button>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-end mt-6">
            {step === 1 && resolvedMetaAddress && (
              <Button
                onClick={handleCreateChannel}
                disabled={isLoading || !evmConnected}
                className="bg-yellow-500 hover:bg-yellow-600 text-black"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <ArrowRight className="w-4 h-4 mr-2" />
                )}
                Create Channel
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Discover Channels
// ═══════════════════════════════════════════════════════════════════════════

function DiscoverChannels({
  onDiscovered,
}: {
  onDiscovered: (channels: LocalChannel[]) => void;
}) {
  const [viewingSk, setViewingSk] = useState("");
  const [spendingPk, setSpendingPk] = useState("");
  const [spendingSk, setSpendingSk] = useState("");
  const [keysPaste, setKeysPaste] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [discovered, setDiscovered] = useState<YellowDiscoveredChannel[]>([]);
  const [error, setError] = useState<string | null>(null);
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
          setLoadError("Keys file must contain viewing_sk, spending_pk, spending_sk");
          return;
        }
        setViewingSk(viewing_sk);
        setSpendingPk(spending_pk);
        setSpendingSk(spending_sk);
      } catch {
        setLoadError("Invalid JSON or keys format");
      }
    };
    reader.onerror = () => setLoadError("Failed to read file");
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
        setLoadError("Keys must contain viewing_sk, spending_pk, spending_sk");
        return;
      }
      setViewingSk(viewing_sk);
      setSpendingPk(spending_pk);
      setSpendingSk(spending_sk);
    } catch {
      setLoadError("Invalid JSON or keys format");
    }
  };

  const handleScan = async () => {
    if (!viewingSk || !spendingPk || !spendingSk) {
      toast.error("All SPECTER keys are required");
      return;
    }

    setIsScanning(true);
    setError(null);
    setScanProgress(0);
    setDiscovered([]);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setScanProgress((p) => Math.min(p + Math.random() * 15, 90));
    }, 200);

    try {
      const result = await api.yellowDiscoverChannels({
        viewing_sk: viewingSk,
        spending_pk: spendingPk,
        spending_sk: spendingSk,
      });

      clearInterval(progressInterval);
      setScanProgress(100);
      setDiscovered(result.channels);

      if (result.channels.length > 0) {
        toast.success(`Found ${result.channels.length} private channel(s)!`);
        onDiscovered(
          result.channels.map((ch) => ({
            channel_id: ch.channel_id,
            stealth_address: ch.stealth_address,
            eth_private_key: ch.eth_private_key,
            status: ch.status,
            token: "USDC",
            amount: "0",
            created_at: ch.discovered_at,
          }))
        );
      } else {
        toast.info("No private channels found");
      }
    } catch (err) {
      clearInterval(progressInterval);
      const msg = err instanceof ApiError ? err.message : "Scan failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <motion.div
      className="space-y-6"
      variants={fadeIn}
      initial="hidden"
      animate="visible"
    >
      <div className="relative overflow-hidden rounded-xl border border-border bg-card/50 backdrop-blur-sm p-6">
        <PixelCanvas colors={CARD_PIXEL_COLORS} gap={8} speed={25} />

        <div className="relative z-10 space-y-4">
          <h2 className="text-xl font-display font-bold">
            Discover Private Channels
          </h2>
          <p className="text-sm text-muted-foreground">
            Scan SPECTER announcements to find Yellow channels addressed to you.
          </p>

          <div className="rounded-lg border border-muted bg-muted/30 p-3 flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Same keys as <Link to="/scan" className="text-yellow-400 hover:underline">Scan</Link> — from <Link to="/setup" className="text-yellow-400 hover:underline">Setup</Link>. Upload JSON or paste below.
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
              type="button"
              variant="outline"
              size="default"
              className="w-full border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload JSON
            </Button>
            <div className="flex gap-2">
              <Input
                placeholder='{"viewing_sk":"...","spending_pk":"...","spending_sk":"..."}'
                value={keysPaste}
                onChange={(e) => setKeysPaste(e.target.value)}
                className="font-mono text-xs flex-1 bg-background/50 border-border"
              />
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={loadKeysFromPaste}
                disabled={!keysPaste.trim()}
                className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 shrink-0"
              >
                Load
              </Button>
            </div>
            {loadError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {loadError}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Eye className="w-3 h-3" /> Viewing Secret Key
              </Label>
              <Input
                value={viewingSk}
                onChange={(e) => setViewingSk(e.target.value)}
                placeholder="Hex-encoded viewing secret key"
                className="bg-background/50 border-border font-mono text-xs"
                type="password"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Lock className="w-3 h-3" /> Spending Public Key
              </Label>
              <Input
                value={spendingPk}
                onChange={(e) => setSpendingPk(e.target.value)}
                placeholder="Hex-encoded spending public key"
                className="bg-background/50 border-border font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Lock className="w-3 h-3" /> Spending Secret Key
              </Label>
              <Input
                value={spendingSk}
                onChange={(e) => setSpendingSk(e.target.value)}
                placeholder="Hex-encoded spending secret key"
                className="bg-background/50 border-border font-mono text-xs"
                type="password"
              />
            </div>
          </div>

          <Button
            onClick={handleScan}
            disabled={isScanning}
            className="w-full bg-yellow-500 hover:bg-yellow-600 text-black"
          >
            {isScanning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Scanning...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Scan for Channels
              </>
            )}
          </Button>

          {/* Progress bar */}
          {isScanning && (
            <div className="space-y-2">
              <div className="w-full bg-muted rounded-full h-2">
                <motion.div
                  className="bg-yellow-500 h-2 rounded-full"
                  initial={{ width: "0%" }}
                  animate={{ width: `${scanProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Scanning announcements... {Math.round(scanProgress)}%
              </p>
            </div>
          )}

          {/* Results */}
          {discovered.length > 0 && (
            <motion.div
              variants={stagger}
              initial="hidden"
              animate="visible"
              className="space-y-3 mt-4"
            >
              <h3 className="text-sm font-bold text-yellow-400">
                Found {discovered.length} Channel(s)
              </h3>
              {discovered.map((ch) => (
                <motion.div
                  key={ch.channel_id}
                  variants={fadeIn}
                  className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20"
                >
                  <div className="space-y-1 text-xs font-mono">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Channel:</span>
                      <span className="flex items-center gap-1">
                        {formatAddress(ch.channel_id)}
                        <CopyButton text={ch.channel_id} />
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Stealth:</span>
                      <span className="flex items-center gap-1">
                        {formatAddress(ch.stealth_address)}
                        <CopyButton text={ch.stealth_address} />
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Status:</span>
                      <span className="text-green-400 flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
                        {ch.status}
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Channel Card
// ═══════════════════════════════════════════════════════════════════════════

function ChannelCard({
  channel,
  onTransfer,
  onFund,
  onClose,
}: {
  channel: LocalChannel;
  onTransfer: (ch: LocalChannel) => void;
  onFund: (ch: LocalChannel) => void;
  onClose: (ch: LocalChannel) => void;
}) {
  const statusColor =
    channel.status === "open"
      ? "text-green-400"
      : channel.status === "closing"
      ? "text-yellow-400"
      : "text-muted-foreground";

  const statusDot =
    channel.status === "open"
      ? "bg-green-400"
      : channel.status === "closing"
      ? "bg-yellow-400"
      : "bg-muted-foreground";

  return (
    <motion.div
      variants={fadeIn}
      className="relative overflow-hidden rounded-xl border border-border bg-card/50 backdrop-blur-sm p-4"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-medium">
              {channel.recipient
                ? channel.recipient
                : formatAddress(channel.channel_id)}
            </span>
          </div>
          <span className={`text-xs flex items-center gap-1 ${statusColor}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${statusDot}`} />
            {channel.status}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">Stealth:</span>
            <div className="font-mono flex items-center gap-1">
              {formatAddress(channel.stealth_address)}
              <CopyButton text={channel.stealth_address} />
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Balance:</span>
            <div className="font-bold text-foreground">
              {channel.amount} {channel.token === "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" ? "USDC" : channel.token.slice(0, 6)}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Created:</span>
            <div>{new Date(channel.created_at * 1000).toLocaleDateString()}</div>
          </div>
          {channel.tx_hash && (
            <div>
              <span className="text-muted-foreground">
                {isRealTxHash(channel.tx_hash) ? "Tx:" : "Ref:"}
              </span>
              <div className="flex items-center gap-1">
                <span className="font-mono">{formatAddress(channel.tx_hash)}</span>
                {isRealTxHash(channel.tx_hash) && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${channel.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-yellow-400 hover:text-yellow-300"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {channel.status === "open" && (
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onTransfer(channel)}
              className="flex-1 text-xs border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
            >
              <Send className="w-3 h-3 mr-1" />
              Transfer
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onFund(channel)}
              className="flex-1 text-xs border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
            >
              <DollarSign className="w-3 h-3 mr-1" />
              Fund
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onClose(channel)}
              className="flex-1 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              <X className="w-3 h-3 mr-1" />
              Close
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Transfer Modal
// ═══════════════════════════════════════════════════════════════════════════

function TransferModal({
  channel,
  onClose,
}: {
  channel: LocalChannel;
  onClose: () => void;
}) {
  const { primaryWallet } = useDynamicContext();
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleTransfer = async () => {
    if (!destination || !amount) {
      toast.error("Fill in all fields");
      return;
    }
    setIsLoading(true);

    try {
      const yellow = getYellowClient();
      await yellow.connect();
      const amountSix = Math.floor(parseFloat(amount) * 1e6).toString();
      let messageSigner: (msg: string) => Promise<string>;
      let senderAddress: string;
      if (channel.eth_private_key) {
        const { privateKeyToAccount } = await import("viem/accounts");
        const pk = channel.eth_private_key.startsWith("0x")
          ? (channel.eth_private_key as `0x${string}`)
          : (`0x${channel.eth_private_key}` as `0x${string}`);
        const account = privateKeyToAccount(pk);
        senderAddress = account.address;
        messageSigner = async (msg: string) =>
          account.signMessage({ message: msg });
      } else {
        if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
          toast.error("Connect an Ethereum wallet, or use a discovered channel (recipient) to transfer");
          setIsLoading(false);
          return;
        }
        const wc = await primaryWallet.getWalletClient(chain.id.toString());
        if (!wc?.account) throw new Error("Could not get wallet");
        senderAddress = wc.account.address;
        messageSigner = async (msg: string) => wc.signMessage({ message: msg });
      }
      await yellow.sendPayment({
        messageSigner,
        senderAddress,
        amount: amountSix,
        recipient: destination,
      });
      toast.success("Transfer sent on Yellow Network!");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="bg-card border border-border rounded-xl p-6 w-full max-w-md mx-4"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-display font-bold">Off-Chain Transfer</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          Channel: {formatAddress(channel.channel_id)}
        </p>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Destination</Label>
            <Input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="0x..."
              className="bg-background/50 border-border font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Amount</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              type="number"
              className="bg-background/50 border-border"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={isLoading}
            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Transfer
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Fund Channel Modal
// ═══════════════════════════════════════════════════════════════════════════

function FundModal({
  channel,
  onClose,
  onFunded,
}: {
  channel: LocalChannel;
  onClose: () => void;
  onFunded: (newBalance: string) => void;
}) {
  const { primaryWallet } = useDynamicContext();
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleFund = async () => {
    if (!amount) {
      toast.error("Enter an amount");
      return;
    }
    if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
      toast.error("Connect an Ethereum wallet (Sepolia) to add funds");
      return;
    }
    setIsLoading(true);

    try {
      const walletClient = await primaryWallet.getWalletClient(chain.id.toString());
      if (!walletClient?.account) throw new Error("Could not get wallet");
      const userAddress = walletClient.account.address;
      const currentSix = Math.floor(parseFloat(channel.amount || "0") * 1e6);
      const addSix = Math.floor(parseFloat(amount) * 1e6);
      const newPartnerSix = currentSix + addSix;
      const messageSigner = async (msg: string) =>
        walletClient.signMessage({ message: msg });
      const yellow = getYellowClient();
      await yellow.connect();
      await yellow.createSession({
        messageSigner,
        userAddress,
        partnerAddress: channel.stealth_address,
        asset: "usdc",
        amountUser: "0",
        amountPartner: newPartnerSix.toString(),
      });
      const newBalance = (currentSix / 1e6 + parseFloat(amount)).toFixed(2);
      toast.success(`Funded on Yellow! New balance: ${newBalance} USDC`);
      onFunded(newBalance);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Funding failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="bg-card border border-border rounded-xl p-6 w-full max-w-md mx-4"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-display font-bold">Add Funds</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground mb-2">
          Channel: {formatAddress(channel.channel_id)}
        </p>
        <p className="text-sm mb-4">
          Current Balance: <span className="font-bold">{channel.amount} USDC</span>
        </p>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Amount to Add</Label>
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            type="number"
            className="bg-background/50 border-border"
          />
        </div>

        <div className="flex gap-2 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleFund}
            disabled={isLoading}
            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <DollarSign className="w-4 h-4 mr-2" />
            )}
            Fund
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Close Channel / Settlement View
// ═══════════════════════════════════════════════════════════════════════════

function CloseChannelModal({
  channel,
  onClose,
  onClosed,
}: {
  channel: LocalChannel;
  onClose: () => void;
  onClosed: () => void;
}) {
  const { primaryWallet } = useDynamicContext();
  const [settlementStep, setSettlementStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleClose = async () => {
    setIsLoading(true);

    try {
      // Step 1: Send cooperative close to Yellow ClearNode
      setSettlementStep(1);
      const yellow = getYellowClient();
      await yellow.connect();
      let messageSigner: (msg: string) => Promise<string>;
      let senderAddress: string;
      if (channel.eth_private_key) {
        const { privateKeyToAccount } = await import("viem/accounts");
        const pk = channel.eth_private_key.startsWith("0x")
          ? (channel.eth_private_key as `0x${string}`)
          : (`0x${channel.eth_private_key}` as `0x${string}`);
        const account = privateKeyToAccount(pk);
        senderAddress = account.address;
        messageSigner = async (msg: string) =>
          account.signMessage({ message: msg });
      } else {
        if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
          toast.error("Connect wallet or use a discovered channel to close");
          setIsLoading(false);
          return;
        }
        const wc = await primaryWallet.getWalletClient(chain.id.toString());
        if (!wc?.account) throw new Error("Could not get wallet");
        senderAddress = wc.account.address;
        messageSigner = async (msg: string) => wc.signMessage({ message: msg });
      }
      await yellow.closeSession({
        messageSigner,
        senderAddress,
        channelId: channel.channel_id,
      });

      // Step 2: Record close with backend (returns settlement tx info when available)
      setSettlementStep(2);
      const result = await api.yellowCloseChannel({
        channel_id: channel.channel_id,
      });
      setTxHash(result.tx_hash);

      setSettlementStep(3);
      await new Promise((r) => setTimeout(r, 800));
      setSettlementStep(4);
      toast.success("Close sent to Yellow. Settlement on Sepolia when finalized.");
      onClosed();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Settlement failed");
    } finally {
      setIsLoading(false);
    }
  };

  const steps = [
    { label: "Send close to Yellow Network", detail: "Signed close request" },
    { label: "Record close with backend", detail: txHash ? `Ref: ${formatAddress(txHash)}` : "Recording..." },
    { label: "Processing", detail: "Yellow / Sepolia" },
    { label: "Complete", detail: "Channel closed" },
  ];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="bg-card border border-border rounded-xl p-6 w-full max-w-md mx-4"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-display font-bold">Close & Settle</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground mb-2">
          Channel: {formatAddress(channel.channel_id)}
        </p>
        <p className="text-sm mb-4">
          Balance: <span className="font-bold">{channel.amount} USDC</span>
        </p>

        {settlementStep === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will close the channel and settle funds on Sepolia L1.
              Funds will be sent to your stealth address.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={handleClose}
                className="flex-1 bg-destructive hover:bg-destructive/90"
              >
                Close Channel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {steps.map((s, i) => {
              const stepNum = i + 1;
              const isComplete = settlementStep > stepNum;
              const isActive = settlementStep === stepNum;
              return (
                <div
                  key={i}
                  className={`flex items-start gap-3 p-2 rounded-lg transition-all ${
                    isComplete
                      ? "opacity-100"
                      : isActive
                      ? "opacity-100"
                      : "opacity-30"
                  }`}
                >
                  {isComplete ? (
                    <Check className="w-5 h-5 text-green-400 mt-0.5" />
                  ) : isActive ? (
                    <Loader2 className="w-5 h-5 text-yellow-400 animate-spin mt-0.5" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border border-muted-foreground mt-0.5" />
                  )}
                  <div>
                    <p className="text-sm">{s.label}</p>
                    {s.detail && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        {s.detail}
                        {txHash && stepNum === 2 && (
                          <a
                            href={`https://sepolia.etherscan.io/tx/${txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-yellow-400 hover:text-yellow-300"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Progress bar for step 3 */}
            {settlementStep === 3 && (
              <div className="w-full bg-muted rounded-full h-1.5 mt-2">
                <motion.div
                  className="bg-yellow-500 h-1.5 rounded-full"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 1 }}
                />
              </div>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Network Stats
// ═══════════════════════════════════════════════════════════════════════════

function YellowStats({ config }: { config: YellowConfigResponse | null }) {
  if (!config) return null;

  return (
    <motion.div variants={fadeIn} className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {[
        { label: "Network", value: "Sepolia" },
        { label: "Chain ID", value: config.chain_id.toString() },
        { label: "Tokens", value: config.supported_tokens.length.toString() },
        { label: "Status", value: "Connected", color: "text-green-400" },
      ].map((stat) => (
        <div
          key={stat.label}
          className="rounded-lg border border-border bg-card/30 p-3 text-center"
        >
          <p className="text-xs text-muted-foreground">{stat.label}</p>
          <p className={`text-sm font-bold ${stat.color || "text-foreground"}`}>
            {stat.value}
          </p>
        </div>
      ))}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Yellow Page
// ═══════════════════════════════════════════════════════════════════════════

export default function YellowPage() {
  const [activeTab, setActiveTab] = useState<YellowTab>("dashboard");
  const [channels, setChannels] = useState<LocalChannel[]>(() => loadChannelsFromStorage());
  const [config, setConfig] = useState<YellowConfigResponse | null>(null);
  const [transferChannel, setTransferChannel] = useState<LocalChannel | null>(null);
  const [fundChannel, setFundChannel] = useState<LocalChannel | null>(null);
  const [closeChannel, setCloseChannel] = useState<LocalChannel | null>(null);

  // Persist channels to localStorage whenever they change
  useEffect(() => {
    saveChannelsToStorage(channels);
  }, [channels]);

  // Load Yellow config on mount; backend must be running (see Yellow.md for local setup)
  const [configError, setConfigError] = useState<string | null>(null);
  const fetchConfig = useCallback(() => {
    setConfigError(null);
    api
      .yellowConfig()
      .then((c) => {
        setConfig(c);
        setConfigError(null);
      })
      .catch(() => {
        setConfig(null);
        const base = api.getBaseUrl();
        setConfigError(
          `Backend not reachable at ${base}. Start the SPECTER backend first (see Yellow.md): in specter/ run: cargo run --bin specter -- serve --port 3001`
        );
      });
  }, []);
  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const activeCount = channels.filter((c) => c.status === "open").length;
  const closedCount = channels.filter((c) => c.status === "closed").length;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-28 pb-12 px-4">
        <div className="container mx-auto max-w-4xl">
          {/* Header */}
          <motion.div
            className="text-center mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
          >
            <div className="flex items-center justify-center gap-3 mb-3">
              <Zap className="w-8 h-8 text-yellow-400" />
              <HeadingScramble
                text="Yellow Network"
                as="h1"
                className="text-4xl sm:text-5xl font-display font-bold"
              />
            </div>
            <p className="text-muted-foreground max-w-xl mx-auto text-sm">
              Private state channel trading powered by SPECTER stealth addresses.
              Trade anonymously with post-quantum security.
            </p>
          </motion.div>

          {/* Yellow API unavailable */}
          {configError && (
            <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm flex-1">
                <p className="font-medium text-amber-600 dark:text-amber-400">Backend not reachable</p>
                <p className="text-muted-foreground mt-1">{configError}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchConfig}
                className="shrink-0 border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </div>
          )}

          {/* Stats */}
          <YellowStats config={config} />

          {/* Channel counts */}
          <motion.div
            className="grid grid-cols-3 gap-3 mb-6"
            variants={fadeIn}
            initial="hidden"
            animate="visible"
          >
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-center">
              <p className="text-2xl font-bold text-yellow-400">{activeCount}</p>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
            <div className="rounded-xl border border-border bg-card/30 p-4 text-center">
              <p className="text-2xl font-bold">
                {channels.filter((c) => c.status === "pending").length}
              </p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
            <div className="rounded-xl border border-border bg-card/30 p-4 text-center">
              <p className="text-2xl font-bold">{closedCount}</p>
              <p className="text-xs text-muted-foreground">Closed</p>
            </div>
          </motion.div>

          {/* Tabs */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as YellowTab)}
          >
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="dashboard" className="text-xs sm:text-sm">
                My Channels
              </TabsTrigger>
              <TabsTrigger value="create" className="text-xs sm:text-sm">
                Create Channel
              </TabsTrigger>
              <TabsTrigger value="discover" className="text-xs sm:text-sm">
                Discover
              </TabsTrigger>
            </TabsList>

            <TabsContent value="dashboard">
              <motion.div
                variants={stagger}
                initial="hidden"
                animate="visible"
                className="space-y-4"
              >
                {channels.length === 0 ? (
                  <motion.div
                    variants={fadeIn}
                    className="text-center py-12 rounded-xl border border-dashed border-border"
                  >
                    <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-30" />
                    <p className="text-muted-foreground mb-1">No channels yet</p>
                    <p className="text-xs text-muted-foreground mb-4">
                      Create a private channel or discover incoming ones
                    </p>
                    <div className="flex gap-2 justify-center">
                      <Button
                        size="sm"
                        onClick={() => setActiveTab("create")}
                        className="bg-yellow-500 hover:bg-yellow-600 text-black"
                      >
                        <Zap className="w-3 h-3 mr-1" />
                        Create
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveTab("discover")}
                      >
                        <Search className="w-3 h-3 mr-1" />
                        Discover
                      </Button>
                    </div>
                  </motion.div>
                ) : (
                  channels.map((ch) => (
                    <ChannelCard
                      key={ch.channel_id}
                      channel={ch}
                      onTransfer={setTransferChannel}
                      onFund={setFundChannel}
                      onClose={setCloseChannel}
                    />
                  ))
                )}
              </motion.div>
            </TabsContent>

            <TabsContent value="create">
              <CreatePrivateChannel
                onCreated={(ch) => {
                  setChannels((prev) => [ch, ...prev]);
                  setActiveTab("dashboard");
                }}
              />
            </TabsContent>

            <TabsContent value="discover">
              <DiscoverChannels
                onDiscovered={(newChannels) => {
                  setChannels((prev) => {
                    const existing = new Set(prev.map((c) => c.channel_id));
                    const unique = newChannels.filter(
                      (c) => !existing.has(c.channel_id)
                    );
                    return [...unique, ...prev];
                  });
                }}
              />
            </TabsContent>
          </Tabs>

          {/* Network info */}
          {config && (
            <motion.div
              variants={fadeIn}
              initial="hidden"
              animate="visible"
              className="mt-8 rounded-xl border border-border bg-card/30 p-4"
            >
              <h3 className="text-sm font-display font-bold mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4 text-yellow-400" />
                Network Configuration
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <span className="text-muted-foreground">WebSocket: </span>
                  <span className="break-all">{config.ws_url}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Custody: </span>
                  <span className="flex items-center gap-1">
                    {formatAddress(config.custody_address)}
                    <a
                      href={`https://sepolia.etherscan.io/address/${config.custody_address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-yellow-400 hover:text-yellow-300"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Adjudicator: </span>
                  <span className="flex items-center gap-1">
                    {formatAddress(config.adjudicator_address)}
                    <a
                      href={`https://sepolia.etherscan.io/address/${config.adjudicator_address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-yellow-400 hover:text-yellow-300"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Tokens: </span>
                  <span>
                    {config.supported_tokens.map((t) => t.symbol).join(", ")}
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </main>
      <Footer />

      {/* Modals */}
      <AnimatePresence>
        {transferChannel && (
          <TransferModal
            channel={transferChannel}
            onClose={() => setTransferChannel(null)}
          />
        )}
        {fundChannel && (
          <FundModal
            channel={fundChannel}
            onClose={() => setFundChannel(null)}
            onFunded={(newBalance) => {
              setChannels((prev) =>
                prev.map((c) =>
                  c.channel_id === fundChannel.channel_id
                    ? { ...c, amount: newBalance }
                    : c
                )
              );
            }}
          />
        )}
        {closeChannel && (
          <CloseChannelModal
            channel={closeChannel}
            onClose={() => setCloseChannel(null)}
            onClosed={() => {
              setChannels((prev) =>
                prev.map((c) =>
                  c.channel_id === closeChannel.channel_id
                    ? { ...c, status: "closed" }
                    : c
                )
              );
              setCloseChannel(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
