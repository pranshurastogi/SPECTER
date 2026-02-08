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
  Clock,
  ArrowDownRight,
  ArrowUpRight,
  Hash,
  Activity,
  Wallet,
  Network,
  Share2,
  PlusCircle,
  Layers,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  DataReadout,
  HoloButton,
  ProgressBar,
  DataViz,
  GlowingOrb,
  ScrollingRow,
  type HoloCardTypeInfo,
} from "@/components/ui/scrolling-holographic-card-feed";
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
  type ResolveEnsResponse,
} from "@/lib/api";
import { formatAddress } from "@/lib/utils";
import { TooltipLabel } from "@/components/ui/tooltip-label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "react-router-dom";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import { chain } from "@/lib/chainConfig";
import { getYellowClient, setYellowWsUrl } from "@/lib/yellowService";
import { createOnChainYellowChannel } from "@/lib/nitroliteYellow";
import {
  fetchBalancesForTokens,
  isLowBalance,
  LOW_BALANCE_THRESHOLD,
  YELLOW_SANDBOX_FAUCET,
  SEPOLIA_FAUCET_LINKS,
  type TokenBalance,
} from "@/lib/yellowBalances";

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

/** Real Sepolia transaction hashes are 0x + 64 hex chars. Placeholder refs are shorter. */
function isRealTxHash(h: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(h);
}

/** Resolve token display from address or symbol */
function tokenLabel(token: string): string {
  if (token === "USDC" || token.toLowerCase() === "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238") return "USDC";
  if (token === "ETH" || token === "0x0000000000000000000000000000000000000000") return "ETH";
  return token.length > 10 ? `${token.slice(0, 6)}...` : token;
}

type YellowTab = "dashboard" | "create" | "discover" | "activity";

// ═══════════════════════════════════════════════════════════════════════════
// Activity Log types
// ═══════════════════════════════════════════════════════════════════════════

const YELLOW_ACTIVITY_STORAGE_KEY = "specter_yellow_activity";

type ActivityType = "channel_created" | "channel_funded" | "transfer_sent" | "transfer_received" | "channel_closed" | "channel_discovered";

interface ActivityEvent {
  id: string;
  type: ActivityType;
  timestamp: number;
  channel_id: string;
  amount: string;
  token: string;
  details: string;
  tx_hash?: string;
  session_id?: string;
  from?: string;
  to?: string;
}

function loadActivityFromStorage(): ActivityEvent[] {
  try {
    const raw = localStorage.getItem(YELLOW_ACTIVITY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ActivityEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveActivityToStorage(events: ActivityEvent[]): void {
  try {
    localStorage.setItem(YELLOW_ACTIVITY_STORAGE_KEY, JSON.stringify(events));
  } catch {
    // ignore
  }
}

function createActivityId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
// Activity Log Component
// ═══════════════════════════════════════════════════════════════════════════

const activityTypeConfig: Record<ActivityType, { label: string; color: string; bgColor: string; icon: typeof Share2 }> = {
  channel_created: { label: "Channel Created", color: "text-yellow-400", bgColor: "bg-yellow-500/10 border-yellow-500/20", icon: Share2 },
  channel_funded: { label: "Channel Funded", color: "text-green-400", bgColor: "bg-green-500/10 border-green-500/20", icon: DollarSign },
  transfer_sent: { label: "Transfer Sent", color: "text-blue-400", bgColor: "bg-blue-500/10 border-blue-500/20", icon: ArrowUpRight },
  transfer_received: { label: "Transfer Received", color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/20", icon: ArrowDownRight },
  channel_closed: { label: "Channel Closed", color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/20", icon: X },
  channel_discovered: { label: "Channel Discovered", color: "text-purple-400", bgColor: "bg-purple-500/10 border-purple-500/20", icon: Search },
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ActivityLog({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <motion.div
        variants={fadeIn}
        initial="hidden"
        animate="visible"
        className="text-center py-16 rounded-xl border border-dashed border-border"
      >
        <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-30" />
        <p className="text-muted-foreground mb-1">No activity yet</p>
        <p className="text-xs text-muted-foreground">
          Create, fund, or discover channels to see activity here
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="space-y-2"
    >
      {events.map((event) => {
        const cfg = activityTypeConfig[event.type];
        const Icon = cfg.icon;
        return (
          <motion.div
            key={event.id}
            variants={fadeIn}
            className={`relative overflow-hidden rounded-lg border ${cfg.bgColor} p-4 transition-all hover:scale-[1.005]`}
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${cfg.bgColor} shrink-0`}>
                <Icon className={`w-4 h-4 ${cfg.color}`} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={`text-sm font-medium ${cfg.color}`}>
                    {cfg.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0">
                    <Clock className="w-3 h-3" />
                    {formatTimestamp(event.timestamp)}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground mb-2">
                  {event.details}
                </p>

                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                  {/* Amount */}
                  {event.amount && event.amount !== "0" && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-background/50 font-medium">
                      <DollarSign className="w-3 h-3 text-green-400" />
                      {event.amount} {tokenLabel(event.token)}
                    </span>
                  )}

                  {/* Channel ID */}
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-background/50 font-mono text-muted-foreground">
                    <Hash className="w-3 h-3" />
                    {formatAddress(event.channel_id)}
                  </span>

                  {/* Tx Hash Link */}
                  {event.tx_hash && isRealTxHash(event.tx_hash) && (
                    <a
                      href={`https://sepolia.etherscan.io/tx/${event.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-background/50 text-yellow-400 hover:text-yellow-300 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Etherscan
                    </a>
                  )}

                  {/* Session ID */}
                  {event.session_id && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-background/50 font-mono text-muted-foreground">
                      <Radio className="w-3 h-3" />
                      Session: {event.session_id.slice(0, 8)}...
                    </span>
                  )}

                  {/* From/To */}
                  {event.from && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-background/50 font-mono text-muted-foreground">
                      From: {formatAddress(event.from)}
                    </span>
                  )}
                  {event.to && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-background/50 font-mono text-muted-foreground">
                      To: {formatAddress(event.to)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Create Channel Wizard
// ═══════════════════════════════════════════════════════════════════════════

type CreateStep = 1 | 2 | 3 | 4 | 5;

function CreatePrivateChannel({
  config,
  onCreated,
  onActivity,
}: {
  config: YellowConfigResponse | null;
  onCreated: (ch: LocalChannel) => void;
  onActivity: (event: ActivityEvent) => void;
}) {
  const { primaryWallet, setShowAuthFlow } = useDynamicContext();
  const [step, setStep] = useState<CreateStep>(1);
  const [recipient, setRecipient] = useState("");
  const eligibleTokens = config?.supported_tokens ?? [];
  const [selectedToken, setSelectedToken] = useState<string>(
    () => eligibleTokens[0]?.address ?? "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
  );
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolveStatus, setResolveStatus] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedENS, setResolvedENS] = useState<ResolveEnsResponse | null>(null);
  const [resolvedMetaAddress, setResolvedMetaAddress] = useState<string | null>(null);
  const [channelResult, setChannelResult] = useState<YellowCreateChannelResponse | null>(null);
  const [tokenBalances, setTokenBalances] = useState<Record<string, TokenBalance>>({});
  const [balancesLoading, setBalancesLoading] = useState(false);
  const evmConnected = !!primaryWallet;

  // Sync selected token when config loads (eligible tokens may change)
  useEffect(() => {
    if (eligibleTokens.length && !eligibleTokens.some((t) => t.address === selectedToken)) {
      setSelectedToken(eligibleTokens[0].address);
    }
  }, [config?.supported_tokens, eligibleTokens.length]);

  // Fetch balances for eligible tokens when wallet and config are available
  useEffect(() => {
    if (!primaryWallet || !eligibleTokens.length) {
      setTokenBalances({});
      return;
    }
    let cancelled = false;
    setBalancesLoading(true);
    const wallet = primaryWallet as { getWalletClient?(chainId: string): Promise<{ account?: { address: string } } | null> };
    void wallet
      .getWalletClient?.(chain.id.toString())
      .then((wc) => wc?.account?.address)
      .then(async (address) => {
        if (!address || cancelled) return;
        const balances = await fetchBalancesForTokens(
          eligibleTokens.map((t) => ({ address: t.address, symbol: t.symbol, decimals: t.decimals })),
          address as `0x${string}`
        );
        if (!cancelled) setTokenBalances(balances);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setBalancesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [primaryWallet, config?.supported_tokens, eligibleTokens.length]);

  const stepLabels = [
    "Enter Recipient",
    "Create onchain channel",
    "Register stealth",
    "Fund app session",
    "Done",
  ];

  // Step 1: Resolve recipient (mirror Send page: ENS or meta-address hex)
  const handleResolve = async () => {
    const name = recipient.trim();
    if (!name) {
      setResolveError("Enter a recipient ENS name (e.g. bob.eth) or meta address hex");
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
    setResolveStatus("Resolving...");
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

  // Steps 2-5: Create onchain channel (Nitrolite), register stealth (API), fund app session (Yellow)
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
    if (!config) {
      toast.error("Loading Yellow configuration.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      setStep(2);
      const walletClient = await primaryWallet.getWalletClient(chain.id.toString());
      if (!walletClient?.account) {
        const msg = isEthereumWallet(primaryWallet)
          ? "Switch your wallet to Sepolia network, then try again."
          : "Connect an Ethereum wallet (Sepolia) to create the channel.";
        toast.error(msg);
        setIsLoading(false);
        return;
      }
      const amountNum = parseFloat(amount || "100");
      const tokenInfo = eligibleTokens.find((t) => t.address === selectedToken);
      const decimals = tokenInfo?.decimals ?? 6;
      const amountWei = BigInt(Math.floor(amountNum * 10 ** decimals));

      // Onchain channel creation via Yellow ClearNode (session key + EIP-712 auth per Yellow Quickstart)
      let channelId: string | undefined;
      let txHash: string | undefined;
      const rpcUrl = import.meta.env.VITE_ETH_RPC_URL || import.meta.env.VITE_ALCHEMY_RPC_SEPOLIA;

      try {
        const onChain = await createOnChainYellowChannel(
          {
            custodyAddress: config.custody_address as `0x${string}`,
            adjudicatorAddress: config.adjudicator_address as `0x${string}`,
            chainId: config.chain_id,
            wsUrl: config.ws_url,
            rpcUrl: rpcUrl || undefined,
          },
          walletClient,
          amountWei
        );
        channelId = onChain.channelId;
        txHash = onChain.txHash;
      } catch (onChainError) {
        console.warn("[Yellow] Onchain create failed, using backend only:", onChainError);
        // Backend will generate a random channel_id
      }

      setStep(3);
      const result = await api.yellowCreateChannel({
        recipient: recipientForApi,
        token: selectedToken,
        amount: amount || "100",
        channel_id: channelId, // undefined if onchain failed
      });
      setChannelResult(result);

      setStep(4);
      const userAddress = walletClient.account.address;
      const amountSixDecimals = Math.floor(amountNum * 1e6).toString();
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

      const successMsg = txHash 
        ? "Private channel created onchain and funded."
        : "Private channel created (backend only mode).";
      toast.success(successMsg);

      const fundedAmount = amount || "100";
      const tokenSymbol = tokenInfo?.symbol ?? "USDC";
      const newChannel: LocalChannel = {
        channel_id: result.channel_id,
        stealth_address: result.stealth_address,
        status: "open",
        token: tokenSymbol,
        amount: fundedAmount,
        recipient: resolvedENS?.ens_name ?? recipient,
        created_at: Date.now() / 1000,
        tx_hash: txHash || undefined, // may be undefined if onchain failed
        session_id: sessionId,
      };
      onCreated(newChannel);

      onActivity({
        id: createActivityId(),
        type: "channel_created",
        timestamp: Date.now(),
        channel_id: result.channel_id,
        amount: fundedAmount,
        token: "USDC",
        details: txHash 
          ? `Opened onchain channel to ${resolvedENS?.ens_name ?? formatAddress(result.stealth_address)} with ${fundedAmount} ${tokenSymbol}`
          : `Created channel to ${resolvedENS?.ens_name ?? formatAddress(result.stealth_address)} (backend only, ${fundedAmount} ${tokenSymbol})`,
        tx_hash: txHash,
        session_id: sessionId,
        from: userAddress,
        to: result.stealth_address,
      });

      // Log funding activity
      onActivity({
        id: createActivityId(),
        type: "channel_funded",
        timestamp: Date.now(),
        channel_id: result.channel_id,
        amount: fundedAmount,
        token: tokenSymbol,
        details: `Funded ${fundedAmount} ${tokenSymbol} via Yellow Network session${sessionId ? ` (${sessionId.slice(0, 8)}...)` : ""}`,
        session_id: sessionId,
        from: userAddress,
        to: result.stealth_address,
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
      <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-lg backdrop-blur-sm p-6 sm:p-8">
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
                      tooltip="ENS name (e.g. bob.eth) or paste meta address hex from Setup. Only the recipient can discover this channel."
                    />
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={recipient}
                      onChange={(e) => {
                        setRecipient(e.target.value);
                        setResolveError(null);
                      }}
                      placeholder="bob.eth or meta address hex"
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
                    Eligible token
                  </Label>
                  {eligibleTokens.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background/50 border border-border text-sm text-muted-foreground">
                      Loading tokens.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {eligibleTokens.map((t) => {
                        const key = t.address.toLowerCase();
                        const tb = tokenBalances[key];
                        const low = tb ? isLowBalance(tb.formatted, t.decimals, LOW_BALANCE_THRESHOLD) : false;
                        const isSelected = selectedToken.toLowerCase() === key;
                        const isSandbox = config?.ws_url?.includes("sandbox");
                        return (
                          <div
                            key={key}
                            onClick={() => setSelectedToken(t.address)}
                            className={`flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-yellow-500/10 border-yellow-500/30"
                                : "bg-background/50 border-border hover:border-yellow-500/20"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <DollarSign className="w-4 h-4 text-green-400 shrink-0" />
                              <span className="text-sm font-medium">{t.symbol}</span>
                              {balancesLoading ? (
                                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                              ) : tb ? (
                                <span className="text-xs text-muted-foreground font-mono">
                                  Balance: {parseFloat(tb.formatted).toLocaleString(undefined, { maximumFractionDigits: 4 })} {t.symbol}
                                </span>
                              ) : null}
                            </div>
                            {low && tb && (
                              <span className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                                {isSandbox ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs text-yellow-500 hover:text-yellow-400 h-7 px-2"
                                        onClick={async () => {
                                          const w = primaryWallet as unknown as { getWalletClient?(c: string): Promise<{ account?: { address: string } } | null> };
                                          const wc = await w?.getWalletClient?.(chain.id.toString());
                                          const addr = wc?.account?.address;
                                          if (!addr) {
                                            toast.error("Connect wallet first");
                                            return;
                                          }
                                          try {
                                            const r = await fetch(YELLOW_SANDBOX_FAUCET, {
                                              method: "POST",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ userAddress: addr }),
                                            });
                                            if (r.ok) toast.success("Test tokens requested. Check your Yellow balance.");
                                            else toast.error("Faucet request failed. Try again.");
                                          } catch {
                                            toast.error("Faucet request failed.");
                                          }
                                        }}
                                      >
                                        Request test tokens
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Request ytest.usd from Yellow Sandbox faucet</TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <a
                                    href={SEPOLIA_FAUCET_LINKS[0].url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-yellow-500 hover:text-yellow-400 flex items-center gap-1"
                                  >
                                    Get test tokens <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground flex items-center gap-1">
                    <TooltipLabel
                      label="Funding amount"
                      tooltip="Amount to deposit into the channel. Ensure you have sufficient balance (see above)."
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
                  {resolvedMetaAddress && eligibleTokens.length > 0 && (
                    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-1">
                      <p className="text-xs font-medium text-yellow-400">
                        Channel funding: {amount || "100"}{" "}
                        {eligibleTokens.find((x) => x.address === selectedToken)?.symbol ?? "USDC"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Funds will be locked in a Yellow Network state channel on Sepolia.
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
                    { s: 3, label: "Open Yellow channel", icon: Network },
                    { s: 4, label: "Fund channel with USDC", icon: DollarSign },
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
                        <span className="text-muted-foreground">Funded:</span>
                        <span className="text-green-400 font-medium">
                          {amount || "100"} USDC
                        </span>
                      </div>
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
                className="rounded-xl py-6 font-bold bg-yellow-500 hover:bg-yellow-600 text-black"
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
  onViewChannel,
  onMigrateChannel,
  onActivity,
}: {
  onDiscovered: (channels: LocalChannel[]) => void;
  onViewChannel?: (ch: LocalChannel) => void;
  onMigrateChannel?: (ch: LocalChannel) => void;
  onActivity: (event: ActivityEvent) => void;
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

        const localChannels = result.channels.map((ch) => ({
          channel_id: ch.channel_id,
          stealth_address: ch.stealth_address,
          eth_private_key: ch.eth_private_key,
          status: ch.status,
          token: ch.token || "USDC",
          amount: ch.amount || "0",
          created_at: ch.discovered_at,
        }));
        onDiscovered(localChannels);

        // Log discovery activity for each channel
        for (const ch of result.channels) {
          onActivity({
            id: createActivityId(),
            type: "channel_discovered",
            timestamp: Date.now(),
            channel_id: ch.channel_id,
            amount: ch.amount || "0",
            token: ch.token || "USDC",
            details: `Discovered channel with ${ch.amount || "0"} ${ch.token || "USDC"} at stealth address ${formatAddress(ch.stealth_address)}`,
            to: ch.stealth_address,
          });
        }
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
      <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-lg backdrop-blur-sm p-6 sm:p-8">
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
                placeholder="Hex encoded viewing secret key"
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
                placeholder="Hex encoded spending public key"
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
                placeholder="Hex encoded spending secret key"
                className="bg-background/50 border-border font-mono text-xs"
                type="password"
              />
            </div>
          </div>

          <Button
            onClick={handleScan}
            disabled={isScanning}
            className="w-full rounded-xl py-6 font-bold bg-yellow-500 hover:bg-yellow-600 text-black"
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
              {discovered.map((ch) => {
                const localCh: LocalChannel = {
                  channel_id: ch.channel_id,
                  stealth_address: ch.stealth_address,
                  eth_private_key: ch.eth_private_key,
                  status: ch.status,
                  token: ch.token || "USDC",
                  amount: ch.amount || "0",
                  created_at: ch.discovered_at,
                };
                return (
                  <motion.div
                    key={ch.channel_id}
                    variants={fadeIn}
                    className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 space-y-3"
                  >
                    <div className="space-y-2 text-xs font-mono">
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
                        <span className="text-muted-foreground">Balance:</span>
                        <span className="flex items-center gap-1 text-green-400 font-medium">
                          <DollarSign className="w-3 h-3" />
                          {ch.amount || "0"} {tokenLabel(ch.token || "USDC")}
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
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-yellow-500/20">
                      {onViewChannel && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onViewChannel(localCh)}
                          className="text-xs border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                        >
                          <Eye className="w-3 h-3 mr-1" />
                          View Channel
                        </Button>
                      )}
                      {onMigrateChannel && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onMigrateChannel(localCh)}
                          className="text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                        >
                          <ArrowRight className="w-3 h-3 mr-1" />
                          Add to My Channels
                        </Button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
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
// View Channel Modal (discovered channel details + actions)
// ═══════════════════════════════════════════════════════════════════════════

function ViewChannelModal({
  channel,
  onClose,
  onTransfer,
  onFund,
  onCloseChannel,
}: {
  channel: LocalChannel;
  onClose: () => void;
  onTransfer: (ch: LocalChannel) => void;
  onFund: (ch: LocalChannel) => void;
  onCloseChannel: (ch: LocalChannel) => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="bg-card border border-border rounded-3xl shadow-xl p-0 w-full max-w-md max-h-[90vh] overflow-y-auto"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-t-3xl bg-muted/30 border-b border-border px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Balance</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            {channel.amount} {tokenLabel(channel.token)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{channel.status}</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-display font-bold flex items-center gap-2">
              <Lock className="w-5 h-5 text-yellow-400" />
              Channel Details
            </h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground rounded-lg p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Channel ID</span>
              <div className="font-mono flex items-center gap-2 mt-0.5">
                {formatAddress(channel.channel_id)}
                <CopyButton text={channel.channel_id} />
              </div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Stealth address</span>
              <div className="font-mono flex items-center gap-2 mt-0.5">
                {formatAddress(channel.stealth_address)}
                <CopyButton text={channel.stealth_address} />
              </div>
            </div>
          </div>
          {channel.status === "open" && (
            <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
              <Button
                size="sm"
                variant="outline"
                onClick={() => { onTransfer(channel); onClose(); }}
                className="flex-1 rounded-xl border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
              >
                <Send className="w-3 h-3 mr-1" />
                Transfer
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { onFund(channel); onClose(); }}
                className="flex-1 rounded-xl border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
              >
                <DollarSign className="w-3 h-3 mr-1" />
                Fund
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { onCloseChannel(channel); onClose(); }}
                className="flex-1 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                <X className="w-3 h-3 mr-1" />
                Close
              </Button>
            </div>
          )}
        </div>
      </motion.div>
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
      className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-md p-0"
    >
      {/* Amount / balance block (WithdrawalCard-style) */}
      <div className="rounded-t-2xl bg-muted/30 border-b border-border px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Balance</p>
        <p className="mt-1 text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-400" />
          {channel.amount} {tokenLabel(channel.token)}
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className={`text-xs flex items-center gap-1 ${statusColor}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${statusDot}`} />
            {channel.status}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-yellow-500/20 text-yellow-400 px-2 py-0.5 text-[10px] font-medium">
            <Radio className="w-3 h-3" />
            Announcement
          </span>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Row: icon + name + details (account-style) */}
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-yellow-500/20 text-yellow-400">
            <Lock className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">
              {channel.recipient ? channel.recipient : formatAddress(channel.channel_id)}
            </p>
            <p className="text-sm text-muted-foreground font-mono flex items-center gap-1">
              {formatAddress(channel.channel_id)}
              <CopyButton text={channel.channel_id} size="icon" />
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">Stealth</span>
            <div className="font-mono flex items-center gap-1 mt-0.5">
              {formatAddress(channel.stealth_address)}
              <CopyButton text={channel.stealth_address} />
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Created</span>
            <div className="mt-0.5">{new Date(channel.created_at * 1000).toLocaleDateString()}</div>
          </div>
          {channel.tx_hash && (
            <div className="col-span-2">
              <span className="text-muted-foreground">
                {isRealTxHash(channel.tx_hash) ? "Tx" : "Ref"}
              </span>
              <div className="flex items-center gap-1 mt-0.5">
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
          <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onTransfer(channel)}
                  className="flex-1 min-w-0 text-xs rounded-xl border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                >
                  <Send className="w-3 h-3 mr-1 shrink-0" />
                  Transfer
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px]">
                Send USDC offchain to another address. Gasless and instant.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onFund(channel)}
                  className="flex-1 min-w-0 text-xs rounded-xl border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                >
                  <DollarSign className="w-3 h-3 mr-1 shrink-0" />
                  Fund
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px]">
                Add USDC from your wallet into this channel.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onClose(channel)}
                  className="flex-1 min-w-0 text-xs rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10"
                >
                  <X className="w-3 h-3 mr-1 shrink-0" />
                  Close
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px]">
                Close channel and settle USDC balance on Sepolia.
              </TooltipContent>
            </Tooltip>
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
  onActivity,
  onBalanceUpdate,
}: {
  channel: LocalChannel;
  onClose: () => void;
  onActivity: (event: ActivityEvent) => void;
  onBalanceUpdate: (channelId: string, newBalance: string) => void;
}) {
  const { primaryWallet, setShowAuthFlow } = useDynamicContext();
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const needsWallet = !channel.eth_private_key && (!primaryWallet || !isEthereumWallet(primaryWallet));

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
          setShowAuthFlow?.(true);
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

      // Update local balance
      const currentBalance = parseFloat(channel.amount || "0");
      const transferAmount = parseFloat(amount);
      const newBalance = Math.max(0, currentBalance - transferAmount).toFixed(2);
      onBalanceUpdate(channel.channel_id, newBalance);

      onActivity({
        id: createActivityId(),
        type: "transfer_sent",
        timestamp: Date.now(),
        channel_id: channel.channel_id,
        amount,
        token: "USDC",
        details: `Transferred ${amount} USDC offchain to ${formatAddress(destination)}`,
        from: senderAddress,
        to: destination,
      });

      toast.success(`Transferred ${amount} USDC offchain.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="bg-card border border-border rounded-3xl shadow-xl p-0 w-full max-w-md"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-t-3xl bg-muted/30 border-b border-border px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Channel balance</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            {channel.amount} USDC
          </p>
        </div>
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-display font-bold">Off-Chain Transfer</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground rounded-lg p-1">
              <X className="w-5 h-5" />
            </button>
          </div>

          {needsWallet && (
          <div className="mb-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
              <Wallet className="h-4 w-4 shrink-0" />
              <span>Connect wallet to sign the transfer</span>
            </div>
            <Button
              size="sm"
              onClick={() => setShowAuthFlow?.(true)}
              className="bg-amber-500 hover:bg-amber-600 text-black"
            >
              <Wallet className="w-4 h-4 mr-2" />
              Connect Ethereum Wallet
            </Button>
          </div>
        )}

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
            <Label className="text-xs text-muted-foreground">Amount (USDC)</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              type="number"
              className="bg-background/50 border-border"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl">
            Cancel
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={isLoading || needsWallet}
            className="flex-1 rounded-xl py-6 font-bold bg-yellow-500 hover:bg-yellow-600 text-black"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Transfer USDC
          </Button>
        </div>
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
  onActivity,
}: {
  channel: LocalChannel;
  onClose: () => void;
  onFunded: (newBalance: string) => void;
  onActivity: (event: ActivityEvent) => void;
}) {
  const { primaryWallet, setShowAuthFlow } = useDynamicContext();
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const needsWallet = !primaryWallet || !isEthereumWallet(primaryWallet);

  const handleFund = async () => {
    if (!amount) {
      toast.error("Enter an amount");
      return;
    }
    if (needsWallet) {
      setShowAuthFlow?.(true);
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
      const { sessionId } = await yellow.createSession({
        messageSigner,
        userAddress,
        partnerAddress: channel.stealth_address,
        asset: "usdc",
        amountUser: "0",
        amountPartner: newPartnerSix.toString(),
      });
      const newBalance = (currentSix / 1e6 + parseFloat(amount)).toFixed(2);

      onActivity({
        id: createActivityId(),
        type: "channel_funded",
        timestamp: Date.now(),
        channel_id: channel.channel_id,
        amount,
        token: "USDC",
        details: `Added ${amount} USDC to channel. New balance: ${newBalance} USDC`,
        session_id: sessionId,
        from: userAddress,
        to: channel.stealth_address,
      });

      toast.success(`Funded ${amount} USDC! New balance: ${newBalance} USDC`);
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
        className="bg-card border border-border rounded-3xl shadow-xl p-0 w-full max-w-md"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-t-3xl bg-muted/30 border-b border-border px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current balance</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            {channel.amount} USDC
          </p>
          <p className="text-xs font-mono text-muted-foreground mt-1">{formatAddress(channel.channel_id)}</p>
        </div>
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-display font-bold">Add USDC Funds</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground rounded-lg p-1">
              <X className="w-5 h-5" />
            </button>
          </div>

          {needsWallet && (
            <div className="mb-4 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                <Wallet className="h-4 w-4 shrink-0" />
                <span>Connect wallet to fund the channel</span>
              </div>
              <Button
                size="sm"
                onClick={() => setShowAuthFlow?.(true)}
                className="rounded-xl bg-amber-500 hover:bg-amber-600 text-black"
              >
                <Wallet className="w-4 h-4 mr-2" />
                Connect Ethereum Wallet
              </Button>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Amount to Add (USDC)</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              type="number"
              className="bg-background/50 border-border rounded-xl"
            />
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={handleFund}
              disabled={isLoading || needsWallet}
              className="flex-1 rounded-xl py-6 font-bold bg-yellow-500 hover:bg-yellow-600 text-black"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <DollarSign className="w-4 h-4 mr-2" />
              )}
              Fund USDC
            </Button>
          </div>
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
  onActivity,
}: {
  channel: LocalChannel;
  onClose: () => void;
  onClosed: () => void;
  onActivity: (event: ActivityEvent) => void;
}) {
  const { primaryWallet, setShowAuthFlow } = useDynamicContext();
  const [settlementStep, setSettlementStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txHashIsPlaceholder, setTxHashIsPlaceholder] = useState(false);
  const needsWallet = !channel.eth_private_key && (!primaryWallet || !isEthereumWallet(primaryWallet));

  const handleClose = async () => {
    if (needsWallet) {
      setShowAuthFlow?.(true);
      return;
    }
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
          setShowAuthFlow?.(true);
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
        fundsDestination: channel.stealth_address,
      });

      // Step 2: Record close with backend (returns settlement tx info when available)
      setSettlementStep(2);
      const result = await api.yellowCloseChannel({
        channel_id: channel.channel_id,
      });
      setTxHash(result.tx_hash);
      setTxHashIsPlaceholder(result.tx_hash_is_placeholder ?? !isRealTxHash(result.tx_hash));

      // Step 3: Settlement
      setSettlementStep(3);
      await new Promise((r) => setTimeout(r, 800));

      // Step 4: Complete
      setSettlementStep(4);

      const settledAmount = result.final_balances.length > 0
        ? result.final_balances[0].amount
        : channel.amount;

      onActivity({
        id: createActivityId(),
        type: "channel_closed",
        timestamp: Date.now(),
        channel_id: channel.channel_id,
        amount: settledAmount,
        token: "USDC",
        details: `Channel closed. ${settledAmount} USDC settled to stealth address ${formatAddress(channel.stealth_address)}`,
        tx_hash: result.tx_hash,
        from: senderAddress,
        to: channel.stealth_address,
      });

      toast.success(`Channel closed! ${settledAmount} USDC settled.`);
      onClosed();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Settlement failed");
    } finally {
      setIsLoading(false);
    }
  };

  const steps = [
    { label: "Send close to Yellow Network", detail: "Signed close request" },
    { label: "Record close", detail: txHash ? `Ref: ${formatAddress(txHash)}` : "Recording..." },
    { label: "Settlement on Sepolia", detail: `${channel.amount} USDC to stealth address` },
    { label: "Complete", detail: "Funds settled to your stealth address" },
  ];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="bg-card border border-border rounded-3xl shadow-xl p-0 w-full max-w-md"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-t-3xl bg-muted/30 border-b border-border px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Channel balance</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            {channel.amount} USDC
          </p>
          <p className="text-xs font-mono text-muted-foreground mt-1">{formatAddress(channel.channel_id)}</p>
        </div>
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-display font-bold">Close & Settle</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground rounded-lg p-1">
              <X className="w-5 h-5" />
            </button>
          </div>

        {settlementStep === 0 ? (
          <div className="space-y-4">
            {needsWallet && (
              <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                  <Wallet className="h-4 w-4 shrink-0" />
                  <span>Connect wallet to sign the close request</span>
                </div>
                <Button
                  size="sm"
                  onClick={() => setShowAuthFlow?.(true)}
                  className="bg-amber-500 hover:bg-amber-600 text-black"
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  Connect Ethereum Wallet
                </Button>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Close is sent to Yellow Network. {channel.amount} USDC will be settled to your stealth address on Sepolia.
            </p>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-muted-foreground flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
              <span>L1 settlement tx appears on Sepolia after Yellow finalizes. The ref below is for tracking until then.</span>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl">
                Cancel
              </Button>
              <Button
                onClick={handleClose}
                disabled={needsWallet}
                className="flex-1 rounded-xl font-bold bg-destructive hover:bg-destructive/90"
              >
                {needsWallet ? "Connect Wallet First" : "Close Channel"}
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
                        {txHash && stepNum === 2 && isRealTxHash(txHash) && (
                          <a
                            href={`https://sepolia.etherscan.io/tx/${txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-yellow-400 hover:text-yellow-300"
                            title="View on Etherscan"
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

            {/* No onchain tx: current flow does not create or close real custody channels */}
            {settlementStep === 4 && txHashIsPlaceholder && (
              <div className="mt-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-left">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Close was sent to Yellow Network. In this integration, <strong>no onchain channel is created or closed</strong> (we don’t call the custody contract to lock or settle USDC), so you won’t see a Sepolia transaction or balance change. See Yellow.md → “Why you don’t see onchain transactions” for details and how to get real settlement.
                </p>
              </div>
            )}
          </div>
        )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Network Stats
// ═══════════════════════════════════════════════════════════════════════════

function YellowStats({ config, totalUSDC }: { config: YellowConfigResponse | null; totalUSDC: string }) {
  if (!config) return null;

  return (
    <motion.div
      variants={fadeIn}
      className="rounded-3xl border border-border bg-card p-6 shadow-lg mb-6"
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
        {[
          { label: "Network", value: "Sepolia", color: "" },
          { label: "Total USDC", value: `$${totalUSDC}`, color: "text-green-400" },
          { label: "Token", value: "USDC", color: "text-yellow-400" },
          { label: "Status", value: "Connected", color: "text-green-400" },
        ].map((stat) => (
          <div key={stat.label} className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {stat.label}
            </p>
            <p className={`mt-1 text-2xl font-bold tracking-tight sm:text-3xl ${stat.color || "text-foreground"}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Yellow Page
// ═══════════════════════════════════════════════════════════════════════════

export default function YellowPage() {
  const { primaryWallet, setShowAuthFlow, handleLogOut } = useDynamicContext();
  const evmConnected = !!primaryWallet;
  const [activeTab, setActiveTab] = useState<YellowTab>("dashboard");
  const [channels, setChannels] = useState<LocalChannel[]>(() => loadChannelsFromStorage());
  const [config, setConfig] = useState<YellowConfigResponse | null>(null);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>(() => loadActivityFromStorage());
  const [transferChannel, setTransferChannel] = useState<LocalChannel | null>(null);
  const [fundChannel, setFundChannel] = useState<LocalChannel | null>(null);
  const [closeChannel, setCloseChannel] = useState<LocalChannel | null>(null);
  const [viewingChannel, setViewingChannel] = useState<LocalChannel | null>(null);
  const [channelPanelMinimized, setChannelPanelMinimized] = useState(false);

  // Persist channels to localStorage whenever they change
  useEffect(() => {
    saveChannelsToStorage(channels);
  }, [channels]);

  // Persist activity to localStorage
  useEffect(() => {
    saveActivityToStorage(activityEvents);
  }, [activityEvents]);

  const addActivity = useCallback((event: ActivityEvent) => {
    setActivityEvents((prev) => [event, ...prev]);
  }, []);

  // Load Yellow config on mount
  const [configError, setConfigError] = useState<string | null>(null);
  const fetchConfig = useCallback(() => {
    setConfigError(null);
    api
      .yellowConfig()
      .then((c) => {
        setConfig(c);
        setConfigError(null);
        // Use same WebSocket URL as backend (e.g. prod) so create/close/fund hit the right Yellow endpoint
        setYellowWsUrl(c.ws_url);
      })
      .catch(() => {
        setConfig(null);
        setYellowWsUrl(null);
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
  const totalUSDC = channels
    .filter((c) => c.status === "open")
    .reduce((sum, c) => sum + parseFloat(c.amount || "0"), 0)
    .toFixed(2);

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
              <Network className="w-8 h-8 text-yellow-400" />
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

          {/* Wallet connection bar */}
          <motion.div
            className="mb-6"
            variants={fadeIn}
            initial="hidden"
            animate="visible"
          >
            {evmConnected ? (
              <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500/20">
                    <Wallet className="w-4 h-4 text-green-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Connected (Sepolia)</p>
                    <p className="text-sm font-mono truncate">{formatAddress(primaryWallet?.address ?? "")}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleLogOut()}
                  className="text-xs text-muted-foreground hover:text-destructive shrink-0"
                >
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/20">
                    <Wallet className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Wallet not connected</p>
                    <p className="text-xs text-muted-foreground">Connect an Ethereum wallet (Sepolia) to create, fund, and close channels</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => setShowAuthFlow?.(true)}
                  className="bg-yellow-500 hover:bg-yellow-600 text-black shrink-0"
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  Connect Wallet
                </Button>
              </div>
            )}
          </motion.div>

          {/* Holographic scrolling card feed */}
          <motion.div
            className="relative my-8 overflow-hidden"
            variants={fadeIn}
            initial="hidden"
            animate="visible"
          >
            <div className="pointer-events-none absolute top-0 bottom-0 left-0 w-24 bg-gradient-to-r from-background to-transparent z-10" />
            <div className="pointer-events-none absolute top-0 bottom-0 right-0 w-24 bg-gradient-to-l from-background to-transparent z-10" />
            <ScrollingRow
              cards={[
                { id: "r1", component: DataReadout, props: { value: "USDC" } },
                { id: "b1", component: HoloButton, props: { text: "PRIVATE" } },
                { id: "p1", component: ProgressBar, props: { progress: 75 } },
                { id: "v1", component: DataViz, props: { bars: 5 } },
                { id: "o1", component: GlowingOrb, props: {} },
                { id: "r2", component: DataReadout, props: { value: "Sepolia" } },
                { id: "b2", component: HoloButton, props: { text: "CHANNEL" } },
                { id: "p2", component: ProgressBar, props: { progress: 40 } },
                { id: "v2", component: DataViz, props: { bars: 4 } },
                { id: "o2", component: GlowingOrb, props: { color: "rgb(234, 179, 8)" } },
              ] as HoloCardTypeInfo[]}
              duration="85s"
              direction="left"
            />
            <ScrollingRow
              cards={[
                { id: "r3", component: DataReadout, props: { value: "STEALTH" } },
                { id: "b3", component: HoloButton, props: { text: "OFF-CHAIN" } },
                { id: "p3", component: ProgressBar, props: { progress: 90 } },
                { id: "v3", component: DataViz, props: { bars: 6 } },
                { id: "r4", component: DataReadout, props: { value: "SPECTER" } },
                { id: "b4", component: HoloButton, props: { text: "SECURE" } },
                { id: "p4", component: ProgressBar, props: { progress: 55 } },
              ] as HoloCardTypeInfo[]}
              duration="92s"
              direction="right"
            />
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
          <YellowStats config={config} totalUSDC={totalUSDC} />

          {/* Channel counts */}
          <motion.div
            className="grid grid-cols-3 gap-4 mb-6"
            variants={fadeIn}
            initial="hidden"
            animate="visible"
          >
            <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 shadow-md p-5 text-center">
              <p className="text-3xl font-bold tracking-tight text-yellow-400">{activeCount}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active</p>
            </div>
            <div className="rounded-2xl border border-border bg-card shadow-md p-5 text-center">
              <p className="text-3xl font-bold tracking-tight text-foreground">
                {channels.filter((c) => c.status === "pending").length}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pending</p>
            </div>
            <div className="rounded-2xl border border-border bg-card shadow-md p-5 text-center">
              <p className="text-3xl font-bold tracking-tight text-foreground">{closedCount}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Closed</p>
            </div>
          </motion.div>

          {/* Channel panel with minimize/maximize and vertical scroll */}
          <div className="rounded-2xl border border-border bg-card/50 shadow-md overflow-hidden">
            <button
              type="button"
              onClick={() => setChannelPanelMinimized((p) => !p)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-muted/30 hover:bg-muted/50 transition-colors text-left"
              aria-expanded={!channelPanelMinimized}
            >
              <span className="text-sm font-semibold text-foreground">
                {channelPanelMinimized ? "Channels" : "Channels"}
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                {channelPanelMinimized ? (
                  <>
                    <span className="text-xs">Expand</span>
                    <ChevronDown className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    <span className="text-xs">Minimize</span>
                    <ChevronUp className="w-4 h-4" />
                  </>
                )}
              </span>
            </button>
            {!channelPanelMinimized && (
              <div className="p-4">
                <Tabs
                  value={activeTab}
                  onValueChange={(v) => setActiveTab(v as YellowTab)}
                >
                  <TabsList className="grid w-full grid-cols-4 mb-4 h-12 p-1.5 rounded-xl bg-muted/50 border border-border">
              <TabsTrigger
                value="dashboard"
                className="text-xs sm:text-sm rounded-lg data-[state=active]:bg-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-sm transition-all duration-200"
              >
                My Channels
              </TabsTrigger>
              <TabsTrigger
                value="create"
                className="text-xs sm:text-sm rounded-lg data-[state=active]:bg-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-sm transition-all duration-200"
              >
                Create Channel
              </TabsTrigger>
              <TabsTrigger
                value="discover"
                className="text-xs sm:text-sm rounded-lg data-[state=active]:bg-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-sm transition-all duration-200"
              >
                Discover
              </TabsTrigger>
              <TabsTrigger
                value="activity"
                className="text-xs sm:text-sm flex items-center justify-center gap-1 rounded-lg data-[state=active]:bg-yellow-500 data-[state=active]:text-black data-[state=active]:shadow-sm transition-all duration-200"
              >
                <Activity className="w-3 h-3" />
                Activity
                {activityEvents.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-yellow-500/20 text-yellow-400">
                    {activityEvents.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <div className="max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-xl pr-1 -mr-1" style={{ maxHeight: "min(60vh, 600px)" }} aria-label="Channel content">
            <TabsContent value="dashboard" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
              <motion.div
                variants={stagger}
                initial="hidden"
                animate="visible"
                className="space-y-4"
              >
                {channels.length === 0 ? (
                  <motion.div
                    variants={fadeIn}
                    className="text-center py-16 rounded-3xl border-2 border-dashed border-border bg-card/30"
                  >
                    <Layers className="w-14 h-14 text-muted-foreground mx-auto mb-4 opacity-40" />
                    <p className="text-foreground font-semibold mb-1">No channels yet</p>
                    <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto">
                      Create a private channel or discover incoming ones
                    </p>
                    <div className="flex gap-3 justify-center flex-wrap">
                      <Button
                        size="lg"
                        onClick={() => setActiveTab("create")}
                        className="rounded-xl bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
                      >
                        <PlusCircle className="w-4 h-4 mr-2" />
                        Create Channel
                      </Button>
                      <Button
                        size="lg"
                        variant="outline"
                        onClick={() => setActiveTab("discover")}
                        className="rounded-xl border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                      >
                        <Search className="w-4 h-4 mr-2" />
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

            <TabsContent value="create" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
              <CreatePrivateChannel
                config={config}
                onCreated={(ch) => {
                  setChannels((prev) => [ch, ...prev]);
                  setActiveTab("dashboard");
                }}
                onActivity={addActivity}
              />
            </TabsContent>

            <TabsContent value="discover" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
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
                onViewChannel={(ch) => setViewingChannel(ch)}
                onMigrateChannel={(ch) => {
                  setChannels((prev) =>
                    prev.some((c) => c.channel_id === ch.channel_id)
                      ? prev
                      : [ch, ...prev]
                  );
                  setActiveTab("dashboard");
                  toast.success("Channel added to My Channels");
                }}
                onActivity={addActivity}
              />
            </TabsContent>

            <TabsContent value="activity" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
              <motion.div
                className="space-y-4"
                variants={fadeIn}
                initial="hidden"
                animate="visible"
              >
                <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-lg backdrop-blur-sm p-6 sm:p-8">
                  <PixelCanvas colors={CARD_PIXEL_COLORS} gap={8} speed={25} />
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-display font-bold flex items-center gap-2">
                        <Activity className="w-5 h-5 text-yellow-400" />
                        Channel Activity
                      </h2>
                      {activityEvents.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setActivityEvents([]);
                            toast.success("Activity log cleared");
                          }}
                          className="text-xs border-border text-muted-foreground hover:text-foreground"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-6">
                      Real-time log of all Yellow Network operations — channel creation, funding, transfers, and settlements.
                    </p>
                    <ActivityLog events={activityEvents} />
                  </div>
                </div>
              </motion.div>
            </TabsContent>
            </div>
          </Tabs>
              </div>
            )}
          </div>

          {/* Network info */}
          {config && (
            <motion.div
              variants={fadeIn}
              initial="hidden"
              animate="visible"
              className="mt-8 rounded-3xl border border-border bg-card shadow-md p-6"
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
                  <span className="text-muted-foreground">Token: </span>
                  <span>USDC (Sepolia)</span>
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
            onActivity={addActivity}
            onBalanceUpdate={(channelId, newBalance) => {
              setChannels((prev) =>
                prev.map((c) =>
                  c.channel_id === channelId ? { ...c, amount: newBalance } : c
                )
              );
            }}
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
            onActivity={addActivity}
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
            onActivity={addActivity}
          />
        )}
        {viewingChannel && (
          <ViewChannelModal
            channel={viewingChannel}
            onClose={() => setViewingChannel(null)}
            onTransfer={setTransferChannel}
            onFund={setFundChannel}
            onCloseChannel={setCloseChannel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
