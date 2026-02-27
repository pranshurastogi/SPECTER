import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Check,
  Loader2,
  ExternalLink,
  Lock,
  RefreshCw,
  AlertCircle,
  Wallet,
  PlusCircle,
  ChevronDown,
  ChevronUp,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Send,
  X as XIcon,
  LogOut,
  Shield,
  Info,
  Copy,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { CopyButton } from "@/components/ui/copy-button";
import { HeadingScramble } from "@/components/ui/heading-scramble";
import { PixelCanvas } from "@/components/ui/pixel-canvas";
import { formatAddress } from "@/lib/utils";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import { chain } from "@/lib/chainConfig";
import {
  YellowClient,
  YellowConnectionStatus,
  type YellowEvent,
  type ChannelInfo,
  type LedgerBalance,
  type LogLevel,
} from "@/lib/yellowClient";
import {
  fetchTokenBalance,
  isLowBalance,
  YTEST_USD_FAUCET,
  SEPOLIA_ETH_FAUCET,
  type TokenBalance,
} from "@/lib/yellowBalances";
import type { Address } from "viem";
import { parseUnits } from "viem";

// ── Constants ────────────────────────────────────────────────────────────────

const CARD_PIXEL_COLORS = ["#eab30818", "#fbbf2414", "#f59e0b12", "#fcd34d10"];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
// Default ytest.usd token on Sepolia sandbox (updated dynamically from assets broadcast)
const DEFAULT_YTEST_TOKEN = "0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb" as Address;

const ease = [0.43, 0.13, 0.23, 0.96] as const;
const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.3 } },
};
const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

// ── Log entry type ───────────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
}

// ── Timeline steps ───────────────────────────────────────────────────────────

const TIMELINE_STEPS = [
  { label: "Connect Wallet", description: "Link your Ethereum wallet" },
  { label: "Authenticate", description: "Sign EIP-712 auth with Yellow" },
  { label: "Load Data", description: "Fetch channels & balances" },
  { label: "Create Channel", description: "Open a state channel on-chain" },
  { label: "Fund Channel", description: "Allocate funds via resize" },
  { label: "Transfer", description: "Off-chain instant transfer" },
  { label: "Close Channel", description: "Settle on-chain" },
  { label: "Withdraw", description: "Withdraw from custody contract" },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function YellowPage() {
  const { primaryWallet } = useDynamicContext();

  // Testnet / Mainnet toggle
  const [isTestnet, setIsTestnet] = useState(true);

  // Yellow client
  const clientRef = useRef<YellowClient | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<YellowConnectionStatus>(
    YellowConnectionStatus.Disconnected
  );

  // Timeline
  const [currentStep, setCurrentStep] = useState(0);

  // Data
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [ledgerBalances, setLedgerBalances] = useState<LedgerBalance[]>([]);
  const [ethBalance, setEthBalance] = useState<TokenBalance | null>(null);
  const [ytestBalance, setYtestBalance] = useState<TokenBalance | null>(null);
  const [ytestTokenAddress, setYtestTokenAddress] = useState<Address>(DEFAULT_YTEST_TOKEN);

  // Forms
  const [createAmount, setCreateAmount] = useState("1");
  const [resizeChannelId, setResizeChannelId] = useState("");
  const [resizeAmount, setResizeAmount] = useState("1");
  const [transferDest, setTransferDest] = useState("");
  const [transferAmount, setTransferAmount] = useState("1");
  const [transferAsset, setTransferAsset] = useState("ytest.usd");
  const [closeChannelId, setCloseChannelId] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("1");

  // Loading
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // Log panel
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logExpanded, setLogExpanded] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Network config display
  const [networkConfig, setNetworkConfig] = useState<{
    custody: string;
    adjudicator: string;
    wsUrl: string;
  } | null>(null);

  // ── Balance polling ────────────────────────────────────────────────────────

  const fetchWalletBalances = useCallback(async () => {
    if (!primaryWallet?.address) return;
    const addr = primaryWallet.address as Address;
    // Fetch independently so one failure doesn't block the other
    try {
      const eth = await fetchTokenBalance(ZERO_ADDRESS, addr, 18, "ETH");
      setEthBalance(eth);
    } catch (err) {
      console.warn("[Yellow] ETH balance fetch failed:", err);
    }
    try {
      const ytest = await fetchTokenBalance(ytestTokenAddress, addr, 6, "ytest.usd");
      setYtestBalance(ytest);
    } catch (err) {
      console.warn("[Yellow] ytest.usd balance fetch failed:", err);
    }
  }, [primaryWallet?.address, ytestTokenAddress]);

  useEffect(() => {
    fetchWalletBalances();
    const interval = setInterval(fetchWalletBalances, 30000);
    return () => clearInterval(interval);
  }, [fetchWalletBalances]);

  // ── Event handler ──────────────────────────────────────────────────────────

  const handleYellowEvent = useCallback((event: YellowEvent) => {
    if (event.type === "log" && event.level && event.message) {
      setLogs((prev) => [
        ...prev,
        {
          id: `${event.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: event.timestamp,
          level: event.level!,
          message: event.message!,
        },
      ]);
    }
    if (event.type === "status" && event.connectionStatus) {
      setConnectionStatus(event.connectionStatus);
    }
    if (event.type === "channels" && event.channels) {
      setChannels(event.channels);
    }
    if (event.type === "balances" && event.balances) {
      setLedgerBalances(event.balances);
    }
    if (event.type === "config" && event.config) {
      const net = event.config.networks?.find((n) => n.chainId === chain.id);
      if (net) {
        setNetworkConfig({
          custody: net.custodyAddress,
          adjudicator: net.adjudicatorAddress,
          wsUrl: isTestnet
            ? "wss://clearnet-sandbox.yellow.com/ws"
            : "wss://clearnet.yellow.com/ws",
        });
      }
      // Update token address from server's supported assets for this chain
      const chainAsset = event.config.assets?.find((a) => a.chainId === chain.id);
      if (chainAsset?.token) {
        setYtestTokenAddress(chainAsset.token);
      }
    }
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Update step based on connection status
  useEffect(() => {
    if (primaryWallet?.address && currentStep === 0) {
      setCurrentStep(1);
    }
  }, [primaryWallet?.address, currentStep]);

  // ── Connect & Auth ─────────────────────────────────────────────────────────

  const handleConnectAndAuth = useCallback(async () => {
    if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
      toast.error("Please connect an Ethereum wallet first");
      return;
    }

    setIsConnecting(true);
    try {
      const client = new YellowClient();
      clientRef.current = client;
      client.onEvent(handleYellowEvent);

      // Get wallet client from Dynamic Labs
      const walletClient = await (primaryWallet as any).getWalletClient(
        chain.id.toString()
      );

      setCurrentStep(2);
      await client.connect(walletClient);

      // Connected - load data
      setCurrentStep(3);
      try {
        await client.getLedgerBalances();
        await client.getChannels();
      } catch {
        // Non-fatal
      }

      toast.success("Connected to Yellow Network!");
    } catch (err: any) {
      toast.error(err?.message ?? "Connection failed");
      setCurrentStep(1);
    } finally {
      setIsConnecting(false);
    }
  }, [primaryWallet, handleYellowEvent]);

  // ── Create Channel ─────────────────────────────────────────────────────────

  const handleCreateChannel = useCallback(async () => {
    const client = clientRef.current;
    if (!client) {
      toast.error("Not connected");
      return;
    }

    setIsCreating(true);
    try {
      const amount = parseUnits(createAmount, 6);
      const result = await client.createChannel(ytestTokenAddress, amount);
      toast.success(`Channel created: ${result.channelId.slice(0, 10)}...`);
      setCurrentStep(Math.max(currentStep, 4));
      // Refresh data
      await client.getChannels();
      await client.getLedgerBalances();
    } catch (err: any) {
      toast.error(err?.message ?? "Channel creation failed");
    } finally {
      setIsCreating(false);
    }
  }, [createAmount, ytestTokenAddress, currentStep]);

  // ── Resize Channel ─────────────────────────────────────────────────────────

  const handleResizeChannel = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !resizeChannelId) {
      toast.error("Select a channel first");
      return;
    }

    setIsResizing(true);
    try {
      const amount = parseUnits(resizeAmount, 6);
      const result = await client.resizeChannel(resizeChannelId as `0x${string}`, amount);
      toast.success(`Channel resized! tx: ${result.txHash.slice(0, 10)}...`);
      setCurrentStep(Math.max(currentStep, 5));
      await client.getChannels();
      await client.getLedgerBalances();
    } catch (err: any) {
      toast.error(err?.message ?? "Resize failed");
    } finally {
      setIsResizing(false);
    }
  }, [resizeChannelId, resizeAmount, currentStep]);

  // ── Transfer ───────────────────────────────────────────────────────────────

  const handleTransfer = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !transferDest) {
      toast.error("Enter a destination address");
      return;
    }

    setIsTransferring(true);
    try {
      await client.transfer(transferDest as Address, [
        { asset: transferAsset, amount: transferAmount },
      ]);
      toast.success("Transfer complete!");
      setCurrentStep(Math.max(currentStep, 6));
      await client.getLedgerBalances();
    } catch (err: any) {
      toast.error(err?.message ?? "Transfer failed");
    } finally {
      setIsTransferring(false);
    }
  }, [transferDest, transferAmount, transferAsset, currentStep]);

  // ── Close Channel ──────────────────────────────────────────────────────────

  const handleCloseChannel = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !closeChannelId) {
      toast.error("Select a channel to close");
      return;
    }

    setIsClosing(true);
    try {
      const result = await client.closeChannel(closeChannelId as `0x${string}`);
      toast.success(`Channel closed! tx: ${result.txHash.slice(0, 10)}...`);
      setCurrentStep(Math.max(currentStep, 7));
      await client.getChannels();
      await client.getLedgerBalances();
    } catch (err: any) {
      toast.error(err?.message ?? "Close failed");
    } finally {
      setIsClosing(false);
    }
  }, [closeChannelId, currentStep]);

  // ── Withdraw ───────────────────────────────────────────────────────────────

  const handleWithdraw = useCallback(async () => {
    const client = clientRef.current;
    if (!client) {
      toast.error("Not connected");
      return;
    }

    setIsWithdrawing(true);
    try {
      const amount = parseUnits(withdrawAmount, 6);
      const result = await client.withdraw(ytestTokenAddress, amount);
      toast.success(`Withdrawn! tx: ${result.txHash.slice(0, 10)}...`);
      setCurrentStep(8);
      await client.getLedgerBalances();
      fetchWalletBalances();
    } catch (err: any) {
      toast.error(err?.message ?? "Withdrawal failed");
    } finally {
      setIsWithdrawing(false);
    }
  }, [withdrawAmount, ytestTokenAddress, fetchWalletBalances]);

  // ── Disconnect ─────────────────────────────────────────────────────────────

  const handleDisconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setConnectionStatus(YellowConnectionStatus.Disconnected);
    setChannels([]);
    setLedgerBalances([]);
    setLogs([]);
    setCurrentStep(primaryWallet?.address ? 1 : 0);
    toast.info("Disconnected from Yellow Network");
  }, [primaryWallet?.address]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
    };
  }, []);

  const isConnected = connectionStatus === YellowConnectionStatus.Connected;
  const openChannels = channels.filter((c) => c.status === "open");

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <Header />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8 space-y-8">
        {/* Title + Toggle */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="space-y-4"
        >
          <motion.div variants={fadeIn} className="flex items-center justify-between">
            <div>
              <HeadingScramble
                text="Yellow Network"
                className="text-3xl md:text-4xl font-bold text-amber-400"
              />
              <p className="text-zinc-400 mt-1">
                State channels for instant, off-chain transfers via Nitrolite SDK
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-sm ${isTestnet ? "text-amber-400" : "text-zinc-500"}`}>
                Testnet
              </span>
              <Switch
                checked={!isTestnet}
                onCheckedChange={(checked) => setIsTestnet(!checked)}
              />
              <span className={`text-sm ${!isTestnet ? "text-amber-400" : "text-zinc-500"}`}>
                Mainnet
              </span>
            </div>
          </motion.div>
        </motion.div>

        {/* Mainnet overlay */}
        <AnimatePresence>
          {!isTestnet && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            >
              <div className="text-center space-y-6">
                <Lock className="w-16 h-16 text-amber-400 mx-auto" />
                <h2 className="text-2xl font-bold text-amber-400">Mainnet Coming Soon</h2>
                <p className="text-zinc-400 max-w-md">
                  Yellow Network mainnet integration is under development.
                  Switch to testnet to try state channels on Sepolia.
                </p>
                <Button
                  onClick={() => setIsTestnet(true)}
                  className="bg-amber-500 hover:bg-amber-600 text-black"
                >
                  Switch to Testnet
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Balance Cards */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ETH Balance */}
            <Card className="relative overflow-hidden bg-zinc-900/50 border-zinc-800 p-4">
              <PixelCanvas colors={CARD_PIXEL_COLORS} gap={6} speed={20} />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-zinc-400">Sepolia ETH</span>
                  <Badge
                    variant="outline"
                    className={
                      ethBalance && isLowBalance(ethBalance.formatted, 18, 0.01)
                        ? "border-amber-500/50 text-amber-400"
                        : "border-green-500/50 text-green-400"
                    }
                  >
                    {ethBalance && isLowBalance(ethBalance.formatted, 18, 0.01)
                      ? "Low"
                      : "OK"}
                  </Badge>
                </div>
                <p className="text-2xl font-mono font-bold text-white">
                  {ethBalance
                    ? `${parseFloat(ethBalance.formatted).toFixed(4)} ETH`
                    : "-- ETH"}
                </p>
                {ethBalance && isLowBalance(ethBalance.formatted, 18, 0.01) && (
                  <a
                    href={SEPOLIA_ETH_FAUCET}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 mt-2"
                  >
                    Get Sepolia ETH <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </Card>

            {/* ytest.usd Balance */}
            <Card className="relative overflow-hidden bg-zinc-900/50 border-zinc-800 p-4">
              <PixelCanvas colors={CARD_PIXEL_COLORS} gap={6} speed={20} />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-zinc-400">ytest.usd (Wallet)</span>
                  <Badge
                    variant="outline"
                    className={
                      ytestBalance && isLowBalance(ytestBalance.formatted, 6, 10)
                        ? "border-amber-500/50 text-amber-400"
                        : "border-green-500/50 text-green-400"
                    }
                  >
                    {ytestBalance && isLowBalance(ytestBalance.formatted, 6, 10)
                      ? "Low"
                      : "OK"}
                  </Badge>
                </div>
                <p className="text-2xl font-mono font-bold text-white">
                  {ytestBalance
                    ? `${parseFloat(ytestBalance.formatted).toFixed(2)} ytest.usd`
                    : "-- ytest.usd"}
                </p>
                {ytestBalance && isLowBalance(ytestBalance.formatted, 6, 10) && (
                  <a
                    href={YTEST_USD_FAUCET}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 mt-2"
                  >
                    Get ytest.usd tokens <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </Card>
          </div>
        </motion.div>

        {/* Wallet Connection Bar */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <Card className="bg-zinc-900/50 border-zinc-800 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wallet className="w-5 h-5 text-amber-400" />
                <div>
                  {primaryWallet?.address ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">
                        {formatAddress(primaryWallet.address)}
                      </span>
                      <CopyButton text={primaryWallet.address} />
                      <Badge
                        variant="outline"
                        className={
                          isConnected
                            ? "border-green-500/50 text-green-400"
                            : "border-zinc-500/50 text-zinc-400"
                        }
                      >
                        {isConnected ? "Yellow Connected" : connectionStatus}
                      </Badge>
                    </div>
                  ) : (
                    <span className="text-zinc-400 text-sm">
                      Connect your wallet using the button above
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!isConnected && primaryWallet?.address && (
                  <Button
                    onClick={handleConnectAndAuth}
                    disabled={isConnecting}
                    className="bg-amber-500 hover:bg-amber-600 text-black"
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {connectionStatus === YellowConnectionStatus.WaitingForSignature
                          ? "Sign in Wallet..."
                          : "Connecting..."}
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 mr-2" />
                        Connect & Authenticate
                      </>
                    )}
                  </Button>
                )}
                {isConnected && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnect}
                    className="border-zinc-700 text-zinc-400 hover:text-white"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Disconnect
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Process Timeline */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <Card className="bg-zinc-900/50 border-zinc-800 p-6">
            <h3 className="text-lg font-semibold text-amber-400 mb-4">Process Timeline</h3>
            <div className="space-y-1">
              {TIMELINE_STEPS.map((step, i) => {
                const stepNum = i + 1;
                const isComplete = currentStep > i;
                const isActive = currentStep === i;
                return (
                  <div key={i} className="flex items-start gap-3">
                    {/* Step indicator */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${isComplete
                          ? "bg-green-500/20 border-green-500 text-green-400"
                          : isActive
                            ? "bg-amber-500/20 border-amber-500 text-amber-400 animate-pulse"
                            : "bg-zinc-800 border-zinc-700 text-zinc-500"
                          }`}
                      >
                        {isComplete ? <Check className="w-4 h-4" /> : stepNum}
                      </div>
                      {i < TIMELINE_STEPS.length - 1 && (
                        <div
                          className={`w-0.5 h-6 ${isComplete ? "bg-green-500/40" : "bg-zinc-800"
                            }`}
                        />
                      )}
                    </div>
                    {/* Step content */}
                    <div className="pt-1">
                      <p
                        className={`text-sm font-medium ${isComplete
                          ? "text-green-400"
                          : isActive
                            ? "text-amber-400"
                            : "text-zinc-500"
                          }`}
                      >
                        {step.label}
                      </p>
                      <p className="text-xs text-zinc-600">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.div>

        {/* Ledger Balances (from Yellow server) */}
        {isConnected && ledgerBalances.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="bg-zinc-900/50 border-zinc-800 p-4">
              <h3 className="text-sm font-semibold text-amber-400 mb-3">Ledger Balances</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {ledgerBalances.map((b) => (
                  <div
                    key={b.asset}
                    className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50"
                  >
                    <p className="text-xs text-zinc-400">{b.asset}</p>
                    <p className="text-lg font-mono font-bold text-white">{b.amount}</p>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}

        {/* Channel Panel + Operations */}
        {isConnected && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="bg-zinc-900/50 border-zinc-800 p-6">
              <Tabs defaultValue="channels" className="w-full">
                <TabsList className="bg-zinc-800/50 border border-zinc-700/50 mb-4">
                  <TabsTrigger value="channels">Channels ({channels.length})</TabsTrigger>
                  <TabsTrigger value="create">Create</TabsTrigger>
                  <TabsTrigger value="resize">Resize</TabsTrigger>
                  <TabsTrigger value="transfer">Transfer</TabsTrigger>
                  <TabsTrigger value="close">Close</TabsTrigger>
                  <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
                </TabsList>

                {/* Channels list */}
                <TabsContent value="channels" className="space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-zinc-300">Active Channels</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          await clientRef.current?.getChannels();
                        } catch { }
                      }}
                      className="text-zinc-400 hover:text-white"
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Refresh
                    </Button>
                  </div>
                  {channels.length === 0 ? (
                    <p className="text-zinc-500 text-sm py-4 text-center">
                      No channels found. Create one to get started.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {channels.map((ch) => (
                        <div
                          key={ch.channelId}
                          className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-zinc-300">
                                {ch.channelId.slice(0, 10)}...{ch.channelId.slice(-6)}
                              </span>
                              <CopyButton text={ch.channelId} />
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                ch.status === "open"
                                  ? "border-green-500/50 text-green-400"
                                  : ch.status === "closed"
                                    ? "border-red-500/50 text-red-400"
                                    : "border-amber-500/50 text-amber-400"
                              }
                            >
                              {ch.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs text-zinc-400">
                            <span>Amount: {ch.amount}</span>
                            <span>Token: {formatAddress(ch.token)}</span>
                            <span>Chain: {ch.chainId}</span>
                            <span>v{ch.version}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Create Channel */}
                <TabsContent value="create" className="space-y-4">
                  <div>
                    <Label className="text-zinc-300">Deposit Amount (ytest.usd)</Label>
                    <Input
                      type="number"
                      value={createAmount}
                      onChange={(e) => setCreateAmount(e.target.value)}
                      placeholder="1"
                      className="bg-zinc-800 border-zinc-700 mt-1"
                    />
                  </div>
                  <Button
                    onClick={handleCreateChannel}
                    disabled={isCreating || !createAmount}
                    className="bg-amber-500 hover:bg-amber-600 text-black w-full"
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating Channel...
                      </>
                    ) : (
                      <>
                        <PlusCircle className="w-4 h-4 mr-2" />
                        Create Channel
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-zinc-500">
                    Creates a state channel on Sepolia. Requires ytest.usd tokens and ETH for gas.
                  </p>
                </TabsContent>

                {/* Resize Channel */}
                <TabsContent value="resize" className="space-y-4">
                  <div>
                    <Label className="text-zinc-300">Channel</Label>
                    <select
                      value={resizeChannelId}
                      onChange={(e) => setResizeChannelId(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-md p-2 text-sm mt-1 text-white"
                    >
                      <option value="">Select a channel...</option>
                      {openChannels.map((ch) => (
                        <option key={ch.channelId} value={ch.channelId}>
                          {ch.channelId.slice(0, 10)}...{ch.channelId.slice(-6)} ({ch.status})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-zinc-300">Allocate Amount (ytest.usd)</Label>
                    <Input
                      type="number"
                      value={resizeAmount}
                      onChange={(e) => setResizeAmount(e.target.value)}
                      placeholder="1"
                      className="bg-zinc-800 border-zinc-700 mt-1"
                    />
                  </div>
                  <Button
                    onClick={handleResizeChannel}
                    disabled={isResizing || !resizeChannelId}
                    className="bg-amber-500 hover:bg-amber-600 text-black w-full"
                  >
                    {isResizing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Resizing...
                      </>
                    ) : (
                      <>
                        <ArrowUpRight className="w-4 h-4 mr-2" />
                        Resize Channel
                      </>
                    )}
                  </Button>
                </TabsContent>

                {/* Transfer */}
                <TabsContent value="transfer" className="space-y-4">
                  <div>
                    <Label className="text-zinc-300">Destination Address</Label>
                    <Input
                      value={transferDest}
                      onChange={(e) => setTransferDest(e.target.value)}
                      placeholder="0x..."
                      className="bg-zinc-800 border-zinc-700 mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-zinc-300">Asset</Label>
                      <Input
                        value={transferAsset}
                        onChange={(e) => setTransferAsset(e.target.value)}
                        placeholder="ytest.usd"
                        className="bg-zinc-800 border-zinc-700 mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-zinc-300">Amount</Label>
                      <Input
                        type="number"
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        placeholder="1"
                        className="bg-zinc-800 border-zinc-700 mt-1"
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleTransfer}
                    disabled={isTransferring || !transferDest || !transferAmount}
                    className="bg-amber-500 hover:bg-amber-600 text-black w-full"
                  >
                    {isTransferring ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Transferring...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Transfer (Off-chain)
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-zinc-500">
                    Instant off-chain transfer. No gas fees.
                  </p>
                </TabsContent>

                {/* Close Channel */}
                <TabsContent value="close" className="space-y-4">
                  <div>
                    <Label className="text-zinc-300">Channel to Close</Label>
                    <select
                      value={closeChannelId}
                      onChange={(e) => setCloseChannelId(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-md p-2 text-sm mt-1 text-white"
                    >
                      <option value="">Select a channel...</option>
                      {openChannels.map((ch) => (
                        <option key={ch.channelId} value={ch.channelId}>
                          {ch.channelId.slice(0, 10)}...{ch.channelId.slice(-6)} ({ch.status})
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    onClick={handleCloseChannel}
                    disabled={isClosing || !closeChannelId}
                    variant="destructive"
                    className="w-full"
                  >
                    {isClosing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Closing...
                      </>
                    ) : (
                      <>
                        <XIcon className="w-4 h-4 mr-2" />
                        Close Channel
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-zinc-500">
                    Settles the channel on-chain. Funds move to custody contract.
                  </p>
                </TabsContent>

                {/* Withdraw */}
                <TabsContent value="withdraw" className="space-y-4">
                  <div>
                    <Label className="text-zinc-300">Withdraw Amount (ytest.usd)</Label>
                    <Input
                      type="number"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="1"
                      className="bg-zinc-800 border-zinc-700 mt-1"
                    />
                  </div>
                  <Button
                    onClick={handleWithdraw}
                    disabled={isWithdrawing || !withdrawAmount}
                    className="bg-green-600 hover:bg-green-700 text-white w-full"
                  >
                    {isWithdrawing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Withdrawing...
                      </>
                    ) : (
                      <>
                        <ArrowDownRight className="w-4 h-4 mr-2" />
                        Withdraw from Custody
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-zinc-500">
                    Withdraws tokens from the custody contract back to your wallet.
                  </p>
                </TabsContent>
              </Tabs>
            </Card>
          </motion.div>
        )}

        {/* Live Log Panel */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <button
              onClick={() => setLogExpanded(!logExpanded)}
              className="w-full p-4 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold text-zinc-300">
                  Live Log ({logs.length})
                </span>
              </div>
              {logExpanded ? (
                <ChevronUp className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              )}
            </button>
            <AnimatePresence>
              {logExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4">
                    <div className="bg-black/50 rounded-lg border border-zinc-800 p-3 max-h-64 overflow-y-auto font-mono text-xs space-y-1">
                      {logs.length === 0 ? (
                        <p className="text-zinc-600">No log entries yet. Connect to start.</p>
                      ) : (
                        logs.map((entry) => (
                          <div key={entry.id} className="flex gap-2">
                            <span className="text-zinc-600 shrink-0">
                              {new Date(entry.timestamp).toLocaleTimeString()}
                            </span>
                            <span
                              className={
                                entry.level === "error"
                                  ? "text-red-400"
                                  : entry.level === "warn"
                                    ? "text-amber-400"
                                    : "text-green-400"
                              }
                            >
                              [{entry.level.toUpperCase()}]
                            </span>
                            <span className="text-zinc-300">{entry.message}</span>
                          </div>
                        ))
                      )}
                      <div ref={logEndRef} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </motion.div>

        {/* Network Config Info */}
        {networkConfig && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="bg-zinc-900/50 border-zinc-800 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Info className="w-4 h-4 text-zinc-400" />
                <span className="text-sm font-semibold text-zinc-400">Network Configuration</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="bg-zinc-800/50 rounded p-2">
                  <span className="text-zinc-500">Custody</span>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="font-mono text-zinc-300">
                      {formatAddress(networkConfig.custody)}
                    </span>
                    <CopyButton text={networkConfig.custody} />
                  </div>
                </div>
                <div className="bg-zinc-800/50 rounded p-2">
                  <span className="text-zinc-500">Adjudicator</span>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="font-mono text-zinc-300">
                      {formatAddress(networkConfig.adjudicator)}
                    </span>
                    <CopyButton text={networkConfig.adjudicator} />
                  </div>
                </div>
                <div className="bg-zinc-800/50 rounded p-2">
                  <span className="text-zinc-500">WebSocket</span>
                  <p className="font-mono text-zinc-300 mt-1">{networkConfig.wsUrl}</p>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </main>

      <Footer />
    </div>
  );
}
