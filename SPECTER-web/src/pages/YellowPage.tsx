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
  AlertTriangle,
  Activity,
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
const DEFAULT_YTEST_TOKEN = "0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb" as Address;
const ETHERSCAN_BASE = "https://sepolia.etherscan.io";

const ease = [0.43, 0.13, 0.23, 0.96] as const;
const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.3 } },
};
const stagger = { visible: { transition: { staggerChildren: 0.08 } } };

// ── Types ─────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
}

interface TxEntry {
  id: string;
  timestamp: number;
  label: string;
  hash: string;
  status: "pending" | "confirmed" | "failed";
}

// ── Timeline steps ────────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function YellowPage() {
  const { primaryWallet, setShowAuthFlow, handleLogOut } = useDynamicContext();

  const [isTestnet, setIsTestnet] = useState(true);

  // Yellow client
  const clientRef = useRef<YellowClient | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<YellowConnectionStatus>(
    YellowConnectionStatus.Disconnected
  );
  const [yellowAddress, setYellowAddress] = useState<string | null>(null);

  // Timeline
  const [currentStep, setCurrentStep] = useState(0);

  // Data
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [ledgerBalances, setLedgerBalances] = useState<LedgerBalance[]>([]);
  const [ethBalance, setEthBalance] = useState<TokenBalance | null>(null);
  const [ytestBalance, setYtestBalance] = useState<TokenBalance | null>(null);
  const [ytestTokenAddress, setYtestTokenAddress] = useState<Address>(DEFAULT_YTEST_TOKEN);

  // Transactions
  const [transactions, setTransactions] = useState<TxEntry[]>([]);
  const addTx = useCallback((label: string, hash: string) => {
    const entry: TxEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      label,
      hash,
      status: "pending",
    };
    setTransactions((prev) => [entry, ...prev].slice(0, 20));
    // Optimistically mark confirmed after 15s (no receipt polling needed for UX)
    setTimeout(() => {
      setTransactions((prev) =>
        prev.map((t) => (t.id === entry.id ? { ...t, status: "confirmed" } : t))
      );
    }, 15000);
  }, []);

  // Forms
  const [createAmount, setCreateAmount] = useState("1");
  const [resizeChannelId, setResizeChannelId] = useState("");
  const [resizeAmount, setResizeAmount] = useState("10");
  const [transferDest, setTransferDest] = useState("");
  const [transferAmount, setTransferAmount] = useState("1");
  const [transferAsset, setTransferAsset] = useState("ytest.usd");
  const [closeChannelId, setCloseChannelId] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("1");

  // Loading states
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncingYellow, setIsSyncingYellow] = useState(false);
  const [resizeError, setResizeError] = useState<string | null>(null);

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

  // Active panel tab
  const [activeTab, setActiveTab] = useState("channels");

  // ── Balance polling ────────────────────────────────────────────────────────

  const fetchWalletBalances = useCallback(async () => {
    if (!primaryWallet?.address) return;
    const addr = primaryWallet.address as Address;
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

  // ── Unified sync helpers (channels + ledger + wallet) ──────────────────────

  const syncYellowOnce = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      await client.getLedgerBalances();
      await client.getChannels();
      fetchWalletBalances();
    } catch {
      // Errors are already surfaced via events/logs; keep this silent here.
    }
  }, [fetchWalletBalances]);

  const pollYellowAfterTx = useCallback(
    async (retries = 3, intervalMs = 5000) => {
      const client = clientRef.current;
      if (!client) return;
      setIsSyncingYellow(true);
      try {
        for (let i = 0; i < retries; i++) {
          await syncYellowOnce();
          if (i < retries - 1) {
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
          }
        }
      } finally {
        setIsSyncingYellow(false);
      }
    },
    [syncYellowOnce]
  );

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
      const chainAsset = event.config.assets?.find((a) => a.chainId === chain.id);
      if (chainAsset?.token) {
        setYtestTokenAddress(chainAsset.token);
      }
    }
  }, [isTestnet]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Update step when wallet connects
  useEffect(() => {
    if (primaryWallet?.address && currentStep === 0) setCurrentStep(1);
  }, [primaryWallet?.address, currentStep]);

  // ── Connect & Auth ─────────────────────────────────────────────────────────

  const handleConnectAndAuth = useCallback(async () => {
    if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
      toast.error("Please connect an Ethereum wallet first");
      return;
    }

    setIsConnecting(true);
    // Always tear down any leftover client first
    clientRef.current?.disconnect();
    clientRef.current = null;
    setChannels([]);
    setLedgerBalances([]);
    setYellowAddress(null);

    try {
      const client = new YellowClient();
      clientRef.current = client;
      client.onEvent(handleYellowEvent);

      const walletClient = await (primaryWallet as any).getWalletClient(
        chain.id.toString()
      );
      if (!walletClient) throw new Error("Failed to get wallet client from Dynamic Labs");

      setCurrentStep(2);
      toast.info("Sign the EIP-712 message in your wallet when prompted", { duration: 6000 });
      await client.connect(walletClient);

      setYellowAddress(client.getConnectedAddress());
      setCurrentStep(3);

      // Load initial data (may take a few seconds while the server warms up)
      await syncYellowOnce();

      toast.success("✓ Connected to Yellow Network!");
    } catch (err: any) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      setYellowAddress(null);
      setConnectionStatus(YellowConnectionStatus.Disconnected);

      const msg = err?.message ?? "Connection failed";
      if (msg.toLowerCase().includes("rejected") || msg.toLowerCase().includes("user denied")) {
        toast.error("Signature rejected — please approve the sign request in your wallet");
      } else if (msg.toLowerCase().includes("parse")) {
        toast.error(
          "Server rejected auth. If this persists, wait 60s and try again (old session may still be active).",
          { duration: 8000 }
        );
      } else if (msg.toLowerCase().includes("timeout")) {
        toast.error("Connection timed out — check your internet connection and try again");
      } else {
        toast.error(`Connection failed: ${msg}`, { duration: 6000 });
      }
      setCurrentStep(1);
    } finally {
      setIsConnecting(false);
    }
  }, [primaryWallet, handleYellowEvent]);

  // ── Refresh data ────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    setIsRefreshing(true);
    try {
      await syncYellowOnce();
    } catch (err: any) {
      toast.error(`Refresh failed: ${err?.message ?? "Unknown error"}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [syncYellowOnce]);

  // ── Create Channel ──────────────────────────────────────────────────────────

  const handleCreateChannel = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { toast.error("Not connected to Yellow Network"); return; }

    if (!createAmount || parseFloat(createAmount) <= 0) {
      toast.error("Enter a valid deposit amount");
      return;
    }

    if (ethBalance && isLowBalance(ethBalance.formatted, 18, 0.005)) {
      toast.error("Insufficient Sepolia ETH for gas. Get ETH from the faucet first.", { duration: 6000 });
      return;
    }

    setIsCreating(true);
    try {
      const amount = parseUnits(createAmount, 6);
      toast.info("Creating channel on-chain… this may take 30–60 seconds", { duration: 10000 });
      const result = await client.createChannel(ytestTokenAddress, amount);
      addTx("Create Channel", result.txHash);
      toast.success(`Channel created! TX: ${result.txHash.slice(0, 10)}...`);
      setCurrentStep(Math.max(currentStep, 4));
      setActiveTab("channels");
      // Give the chain + clearnode a few seconds to index the new channel.
      void pollYellowAfterTx();
    } catch (err: any) {
      const msg = err?.message ?? "Channel creation failed";
      if (msg.toLowerCase().includes("already exists")) {
        toast.error("An open channel already exists. Close it before creating a new one.");
      } else {
        toast.error(`Create failed: ${msg}`, { duration: 6000 });
      }
    } finally {
      setIsCreating(false);
    }
  }, [createAmount, ytestTokenAddress, currentStep, ethBalance, addTx]);

  // ── Resize Channel ──────────────────────────────────────────────────────────

  const handleResizeChannel = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { toast.error("Not connected"); return; }
    if (!resizeChannelId) { toast.error("Select a channel to resize"); return; }
    if (!resizeAmount || parseFloat(resizeAmount) <= 0) {
      toast.error("Enter a valid allocation amount");
      return;
    }

    setResizeError(null);
    setIsResizing(true);
    try {
      const amount = parseUnits(resizeAmount, 6);
      toast.info("Allocating funds from Unified Balance…", { duration: 8000 });
      const result = await client.resizeChannel(resizeChannelId as `0x${string}`, amount);
      addTx("Resize Channel", result.txHash);
      toast.success(`Channel funded! TX: ${result.txHash.slice(0, 10)}...`);
      setCurrentStep(Math.max(currentStep, 5));
      setActiveTab("channels");
      void pollYellowAfterTx();
    } catch (err: any) {
      const msg = (err?.message ?? "").toLowerCase();
      const fullMessage = err?.message ?? "Unknown error";
      setResizeError(fullMessage);

      if (msg.includes("resize already ongoing")) {
        toast.error(
          "A resize for this channel is already in progress. Wait for the previous transaction to confirm, or close the channel from the Close tab.",
          { duration: 8000 }
        );
        void pollYellowAfterTx(2, 4000);
      } else if (msg.includes("insufficient") || msg.includes("balance")) {
        toast.error(
          "Not enough ytest.usd in your Unified Balance. Get more from the faucet, then try again.",
          { duration: 6000 }
        );
      } else if (msg.includes("user rejected") || msg.includes("denied")) {
        toast.error("Transaction was rejected in your wallet.");
      } else if (msg.includes("timeout")) {
        toast.error("Request timed out. Check your connection and try again, or use the Close tab if the channel is stuck.");
      } else {
        toast.error(`Fund failed: ${fullMessage}`, { duration: 8000 });
      }
    } finally {
      setIsResizing(false);
    }
  }, [resizeChannelId, resizeAmount, currentStep, addTx, pollYellowAfterTx]);

  // ── Transfer ────────────────────────────────────────────────────────────────

  const handleTransfer = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { toast.error("Not connected"); return; }
    if (!transferDest) { toast.error("Enter a destination address"); return; }
    if (!transferDest.startsWith("0x") || transferDest.length !== 42) {
      toast.error("Invalid destination address — must be a valid 0x Ethereum address");
      return;
    }
    if (!transferAmount || parseFloat(transferAmount) <= 0) {
      toast.error("Enter a valid transfer amount");
      return;
    }

    setIsTransferring(true);
    try {
      await client.transfer(transferDest as Address, [
        { asset: transferAsset, amount: transferAmount },
      ]);
      toast.success(`Transferred ${transferAmount} ${transferAsset} (off-chain, instant!)`);
      setCurrentStep(Math.max(currentStep, 6));
      await client.getLedgerBalances();
    } catch (err: any) {
      toast.error(`Transfer failed: ${err?.message ?? "Unknown error"}`, { duration: 6000 });
    } finally {
      setIsTransferring(false);
    }
  }, [transferDest, transferAmount, transferAsset, currentStep]);

  // ── Close Channel ───────────────────────────────────────────────────────────

  const handleCloseChannel = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { toast.error("Not connected"); return; }
    if (!closeChannelId) { toast.error("Select a channel to close"); return; }

    if (ethBalance && isLowBalance(ethBalance.formatted, 18, 0.005)) {
      toast.error("Insufficient Sepolia ETH for gas. Get ETH from the faucet first.", { duration: 6000 });
      return;
    }

    setIsClosing(true);
    try {
      toast.info("Closing channel on-chain… this may take 30–60 seconds", { duration: 10000 });
      const result = await client.closeChannel(closeChannelId as `0x${string}`);
      addTx("Close Channel", result.txHash);
      setCurrentStep(Math.max(currentStep, 7));
      setCloseChannelId("");
      toast.success(`Channel closed on-chain! TX: ${result.txHash.slice(0, 10)}...`);
      setActiveTab("channels");
      // Poll so the channel status + Unified Balance/custody reflect the close when the tx confirms.
      void pollYellowAfterTx();
    } catch (err: any) {
      const msg = (err?.message ?? "Close failed").toLowerCase();
      if (msg.includes("invalid signature") || msg.includes("unauthorized") || msg.includes("unauthorised")) {
        toast.error(
          "Close rejected: this channel may belong to a different wallet or session. Only YOUR open channels can be closed.",
          { duration: 8000 }
        );
      } else if (msg.includes("timeout")) {
        toast.error("Close timed out — the server may be busy. Try again.");
      } else {
        toast.error(`Close failed: ${err?.message ?? "Unknown error"}`, { duration: 6000 });
      }
    } finally {
      setIsClosing(false);
    }
  }, [closeChannelId, currentStep, ethBalance, addTx]);

  // ── Withdraw ────────────────────────────────────────────────────────────────

  const handleWithdraw = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { toast.error("Not connected"); return; }
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      toast.error("Enter a valid withdrawal amount");
      return;
    }

    if (ethBalance && isLowBalance(ethBalance.formatted, 18, 0.005)) {
      toast.error("Insufficient Sepolia ETH for gas.", { duration: 6000 });
      return;
    }

    setIsWithdrawing(true);
    try {
      const amount = parseUnits(withdrawAmount, 6);
      toast.info("Withdrawing from custody contract…", { duration: 8000 });
      const result = await client.withdraw(ytestTokenAddress, amount);
      addTx("Withdraw", result.txHash);
      toast.success(`Withdrawn! TX: ${result.txHash.slice(0, 10)}...`);
      setCurrentStep(8);
      // After withdrawal, sync Unified Balance + wallet balances.
      void pollYellowAfterTx();
    } catch (err: any) {
      toast.error(`Withdrawal failed: ${err?.message ?? "Unknown error"}`, { duration: 6000 });
    } finally {
      setIsWithdrawing(false);
    }
  }, [withdrawAmount, ytestTokenAddress, fetchWalletBalances, ethBalance, addTx]);

  // ── State reset ─────────────────────────────────────────────────────────────

  const resetYellowState = useCallback((keepLogs = false) => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setConnectionStatus(YellowConnectionStatus.Disconnected);
    setIsConnecting(false);
    setChannels([]);
    setLedgerBalances([]);
    setYellowAddress(null);
    if (!keepLogs) setLogs([]);
    setCloseChannelId("");
    setResizeChannelId("");
  }, []);

  const handleDisconnect = useCallback(() => {
    resetYellowState(true);
    setCurrentStep(primaryWallet?.address ? 1 : 0);
    toast.info("Disconnected from Yellow Network");
  }, [primaryWallet?.address, resetYellowState]);

  const handleFullDisconnect = useCallback(() => {
    resetYellowState();
    setCurrentStep(0);
    setEthBalance(null);
    setYtestBalance(null);
    handleLogOut();
    toast.info("Wallet disconnected");
  }, [resetYellowState, handleLogOut]);

  // Handle wallet disconnection
  const prevWalletRef = useRef(primaryWallet?.address);
  useEffect(() => {
    const prev = prevWalletRef.current;
    const curr = primaryWallet?.address;
    prevWalletRef.current = curr;
    if (prev && !curr) {
      resetYellowState(true);
      setCurrentStep(0);
      setEthBalance(null);
      setYtestBalance(null);
    }
    if (!prev && curr) setCurrentStep(1);
  }, [primaryWallet?.address, resetYellowState]);

  useEffect(() => {
    return () => { clientRef.current?.disconnect(); };
  }, []);

  const isConnected = connectionStatus === YellowConnectionStatus.Connected;
  // Treat any non-closed channel as \"active\" so states like \"resizing\" still appear
  const openChannels = channels.filter(
    (c) => c.channelId && c.status.toLowerCase() !== "closed"
  );
  const needsETH = ethBalance !== null && isLowBalance(ethBalance.formatted, 18, 0.005);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <Header />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8 space-y-6">

        {/* ── Title ── */}
        <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-2">
          <motion.div variants={fadeIn} className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <HeadingScramble className="text-3xl md:text-4xl font-bold text-amber-400">Yellow Network</HeadingScramble>
              <p className="text-zinc-400 mt-1">State channels for instant, off-chain transfers via Nitrolite SDK</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-sm ${isTestnet ? "text-amber-400" : "text-zinc-500"}`}>Testnet</span>
              <Switch checked={!isTestnet} onCheckedChange={(c) => setIsTestnet(!c)} />
              <span className={`text-sm ${!isTestnet ? "text-amber-400" : "text-zinc-500"}`}>Mainnet</span>
            </div>
          </motion.div>
        </motion.div>

        {/* ── Mainnet overlay ── */}
        <AnimatePresence>
          {!isTestnet && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            >
              <div className="text-center space-y-6">
                <Lock className="w-16 h-16 text-amber-400 mx-auto" />
                <h2 className="text-2xl font-bold text-amber-400">Mainnet Coming Soon</h2>
                <p className="text-zinc-400 max-w-md">Yellow Network mainnet integration is under development. Switch to testnet to try on Sepolia.</p>
                <Button onClick={() => setIsTestnet(true)} className="bg-amber-500 hover:bg-amber-600 text-black">Switch to Testnet</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Gas warning banner ── */}
        {primaryWallet?.address && needsETH && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-amber-300 font-medium">Low Sepolia ETH — you need ETH for gas to create/close channels</p>
                <p className="text-xs text-zinc-400 mt-0.5">Balance: {parseFloat(ethBalance?.formatted ?? "0").toFixed(5)} ETH</p>
              </div>
              <a href={SEPOLIA_ETH_FAUCET} target="_blank" rel="noopener noreferrer"
                className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 shrink-0 border border-amber-500/40 rounded px-2 py-1">
                Get ETH <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </motion.div>
        )}

        {/* ── Balance Cards ── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="relative overflow-hidden bg-zinc-900/50 border-zinc-800 p-4">
              <PixelCanvas colors={CARD_PIXEL_COLORS} gap={6} speed={20} />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-zinc-400">Sepolia ETH (wallet)</span>
                  <Badge variant="outline"
                    className={needsETH ? "border-amber-500/50 text-amber-400" : "border-green-500/50 text-green-400"}>
                    {needsETH ? "Low — get ETH" : "OK"}
                  </Badge>
                </div>
                <p className="text-2xl font-mono font-bold text-white">
                  {ethBalance ? `${parseFloat(ethBalance.formatted).toFixed(5)} ETH` : "— ETH"}
                </p>
                <a href={SEPOLIA_ETH_FAUCET} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-zinc-500 hover:text-amber-400 flex items-center gap-1 mt-2">
                  Sepolia faucet <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </Card>

            <Card className="relative overflow-hidden bg-zinc-900/50 border-zinc-800 p-4">
              <PixelCanvas colors={CARD_PIXEL_COLORS} gap={6} speed={20} />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-zinc-400">ytest.usd (wallet)</span>
                  <Badge variant="outline"
                    className={ytestBalance && isLowBalance(ytestBalance.formatted, 6, 10)
                      ? "border-amber-500/50 text-amber-400"
                      : "border-green-500/50 text-green-400"}>
                    {ytestBalance && isLowBalance(ytestBalance.formatted, 6, 10) ? "Low" : "OK"}
                  </Badge>
                </div>
                <p className="text-2xl font-mono font-bold text-white">
                  {ytestBalance ? `${parseFloat(ytestBalance.formatted).toFixed(2)} ytest.usd` : "— ytest.usd"}
                </p>
                <a href={YTEST_USD_FAUCET} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-zinc-500 hover:text-amber-400 flex items-center gap-1 mt-2">
                  Get ytest.usd tokens <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </Card>
          </div>
        </motion.div>

        {/* ── Wallet + Yellow Connection Bar ── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <Card className="bg-zinc-900/50 border-zinc-800 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <Wallet className="w-5 h-5 text-amber-400 shrink-0" />
                {primaryWallet?.address ? (
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-zinc-500">Wallet</span>
                      <span className="font-mono text-sm">{formatAddress(primaryWallet.address)}</span>
                      <CopyButton text={primaryWallet.address} />
                    </div>
                    {isConnected && yellowAddress ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="border-green-500/50 text-green-400 text-xs w-fit">Yellow Connected</Badge>
                        <span className="text-xs text-zinc-500">session for {formatAddress(yellowAddress)}</span>
                      </div>
                    ) : (
                      <Badge variant="outline" className={`text-xs w-fit ${
                        connectionStatus === YellowConnectionStatus.Error ? "border-red-500/50 text-red-400" :
                        connectionStatus === YellowConnectionStatus.WaitingForSignature ? "border-amber-500/50 text-amber-400 animate-pulse" :
                        connectionStatus === YellowConnectionStatus.Authenticating ? "border-blue-500/50 text-blue-400 animate-pulse" :
                        "border-zinc-600/50 text-zinc-400"
                      }`}>
                        {connectionStatus === YellowConnectionStatus.WaitingForSignature ? "⏳ Sign in wallet…" :
                         connectionStatus === YellowConnectionStatus.Authenticating ? "⏳ Authenticating…" :
                         connectionStatus === YellowConnectionStatus.Error ? "⚠ Auth error — try again" :
                         "Not connected to Yellow"}
                      </Badge>
                    )}
                  </div>
                ) : (
                  <Button variant="outline" size="sm"
                    className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                    onClick={() => setShowAuthFlow(true)}>
                    <Wallet className="w-4 h-4 mr-2" />Connect Wallet
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {primaryWallet?.address && !isConnected && (
                  <>
                    <Button onClick={handleConnectAndAuth} disabled={isConnecting}
                      className="bg-amber-500 hover:bg-amber-600 text-black">
                      {isConnecting ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {connectionStatus === YellowConnectionStatus.WaitingForSignature ? "Sign in wallet…" :
                           connectionStatus === YellowConnectionStatus.Authenticating ? "Authenticating…" : "Connecting…"}
                        </>
                      ) : (
                        <><Zap className="w-4 h-4 mr-2" />Connect Yellow</>
                      )}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleFullDisconnect}
                      className="text-zinc-500 hover:text-zinc-300">
                      Disconnect Wallet
                    </Button>
                  </>
                )}
                {isConnected && (
                  <>
                    <Button variant="outline" size="sm" onClick={handleRefresh}
                      disabled={isRefreshing}
                      className="border-zinc-700 text-zinc-400 hover:text-white">
                      <RefreshCw className={`w-4 h-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDisconnect}
                      className="border-zinc-700 text-zinc-400 hover:text-white">
                      <LogOut className="w-4 h-4 mr-2" />Disconnect Yellow
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleFullDisconnect}
                      className="border-red-700/50 text-red-400 hover:text-red-300 hover:border-red-600">
                      Disconnect Wallet
                    </Button>
                  </>
                )}
              </div>
            </div>
          </Card>
        </motion.div>

        {/* ── Process Timeline ── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <Card className="bg-zinc-900/50 border-zinc-800 p-6">
            <h3 className="text-sm font-semibold text-amber-400 mb-4">Process Timeline</h3>
            <div className="space-y-1">
              {TIMELINE_STEPS.map((step, i) => {
                const isComplete = currentStep > i;
                const isActive = currentStep === i;
                return (
                  <div key={i} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                        isComplete ? "bg-green-500/20 border-green-500 text-green-400" :
                        isActive ? "bg-amber-500/20 border-amber-500 text-amber-400 animate-pulse" :
                        "bg-zinc-800 border-zinc-700 text-zinc-500"
                      }`}>
                        {isComplete ? <Check className="w-3.5 h-3.5" /> : i + 1}
                      </div>
                      {i < TIMELINE_STEPS.length - 1 && (
                        <div className={`w-0.5 h-5 ${isComplete ? "bg-green-500/40" : "bg-zinc-800"}`} />
                      )}
                    </div>
                    <div className="pt-1">
                      <p className={`text-xs font-medium ${isComplete ? "text-green-400" : isActive ? "text-amber-400" : "text-zinc-500"}`}>
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

        {/* ── Ledger Balances ── */}
        {isConnected && ledgerBalances.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="bg-zinc-900/50 border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-amber-400">Ledger Balances (Yellow Unified Balance)</h3>
                <a href={YTEST_USD_FAUCET} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-zinc-500 hover:text-amber-400 flex items-center gap-1">
                  Get ytest.usd <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {ledgerBalances.map((b) => (
                  <div key={b.asset} className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
                    <p className="text-xs text-zinc-400">{b.asset}</p>
                    <p className="text-lg font-mono font-bold text-white">{b.amount}</p>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}

        {/* ── Channel Panel + Operations ── */}
        {isConnected && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="bg-zinc-900/50 border-zinc-800 p-6">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                {isSyncingYellow && (
                  <div className="flex items-center gap-2 mb-2 text-xs text-zinc-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Syncing with Yellow… balances and channels will update automatically.</span>
                  </div>
                )}
                <TabsList className="bg-zinc-800/50 border border-zinc-700/50 mb-4 flex-wrap h-auto gap-1">
                  <TabsTrigger value="channels">My Channels ({openChannels.length} open)</TabsTrigger>
                  <TabsTrigger value="create">Create</TabsTrigger>
                  <TabsTrigger value="resize">Fund</TabsTrigger>
                  <TabsTrigger value="transfer">Transfer</TabsTrigger>
                  <TabsTrigger value="close">Close</TabsTrigger>
                  <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
                </TabsList>

                {/* ── Channels list ── */}
                <TabsContent value="channels" className="space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-300">Your Channels</h3>
                      {yellowAddress && (
                        <p className="text-xs text-zinc-500 mt-0.5">Filtered for wallet {formatAddress(yellowAddress)}</p>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleRefresh}
                      disabled={isRefreshing} className="text-zinc-400 hover:text-white">
                      <RefreshCw className={`w-3 h-3 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />Refresh
                    </Button>
                  </div>
                  {channels.length === 0 ? (
                    <div className="text-center py-8 space-y-2">
                      <p className="text-zinc-500 text-sm">No channels found for your wallet.</p>
                      <p className="text-zinc-600 text-xs">
                        Switch to <button className="text-amber-400 hover:underline" onClick={() => setActiveTab("create")}>Create</button> to open your first state channel.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {channels.filter((ch) => ch.channelId).map((ch) => (
                        <div key={ch.channelId}
                          className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50 hover:border-zinc-600/50 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-zinc-300">
                                {ch.channelId?.slice(0, 10)}…{ch.channelId?.slice(-6)}
                              </span>
                              <CopyButton text={ch.channelId ?? ""} />
                              <a href={`${ETHERSCAN_BASE}/address/${ch.channelId}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-zinc-500 hover:text-amber-400">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                            <Badge variant="outline" className={
                              ch.status === "open" ? "border-green-500/50 text-green-400" :
                              ch.status === "closed" ? "border-red-500/50 text-red-400" :
                              "border-amber-500/50 text-amber-400"
                            }>
                              {ch.status ?? "unknown"}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs text-zinc-400 flex-wrap">
                            <span>Amount: <span className="text-zinc-200">{ch.amount ?? "—"}</span></span>
                            <span>Token: {ch.token ? formatAddress(ch.token) : "—"}</span>
                            <span>Chain: {ch.chainId ?? "—"}</span>
                            <span>v{ch.version ?? 0}</span>
                            {ch.status === "open" && (
                              <div className="flex items-center gap-1 ml-auto">
                                <Button variant="ghost" size="sm"
                                  className="h-5 text-xs text-amber-400 hover:text-amber-300 px-1.5"
                                  onClick={() => { setResizeChannelId(ch.channelId); setActiveTab("resize"); }}>
                                  Fund
                                </Button>
                                <Button variant="ghost" size="sm"
                                  className="h-5 text-xs text-red-400 hover:text-red-300 px-1.5"
                                  onClick={() => { setCloseChannelId(ch.channelId); setActiveTab("close"); }}>
                                  Close
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* ── Create Channel ── */}
                <TabsContent value="create" className="space-y-4">
                  <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/30 text-xs text-zinc-400 space-y-1">
                    <p>Creates an on-chain state channel via the Nitrolite custody contract.</p>
                    <p>After creating, use <strong className="text-amber-400">Fund</strong> to allocate ytest.usd from your Unified Balance.</p>
                    <p>Requires Sepolia ETH for gas.</p>
                  </div>
                  {needsETH && (
                    <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded p-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Need ETH for gas —
                      <a href={SEPOLIA_ETH_FAUCET} target="_blank" rel="noopener noreferrer" className="underline">get Sepolia ETH</a>
                    </div>
                  )}
                  <div>
                    <Label className="text-zinc-300">Initial Amount (ytest.usd)</Label>
                    <Input type="number" value={createAmount} onChange={(e) => setCreateAmount(e.target.value)}
                      placeholder="1" className="bg-zinc-800 border-zinc-700 mt-1" />
                    <p className="text-xs text-zinc-600 mt-1">Note: actual on-chain funding happens via the Fund tab after creation.</p>
                  </div>
                  <Button onClick={handleCreateChannel} disabled={isCreating || !createAmount || needsETH}
                    className="bg-amber-500 hover:bg-amber-600 text-black w-full">
                    {isCreating ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating Channel…</>
                    ) : (
                      <><PlusCircle className="w-4 h-4 mr-2" />Create Channel</>
                    )}
                  </Button>
                </TabsContent>

                {/* ── Fund Channel (Resize) ── */}
                <TabsContent value="resize" className="space-y-4">
                  <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/30 text-xs text-zinc-400 space-y-1">
                    <p>Allocates ytest.usd from your <strong className="text-zinc-200">Unified Balance</strong> into the channel.</p>
                    <p>Requires Sepolia ETH for gas. Make sure you have ytest.usd in your Unified Balance first.</p>
                  </div>
                  {resizeError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-red-300">Fund failed</p>
                        <p className="text-red-200/90 mt-1 break-words">{resizeError}</p>
                        <p className="text-xs text-zinc-500 mt-2">
                          If it says &quot;resize already ongoing&quot;, wait for the last resize tx to confirm or close this channel from the Close tab.
                        </p>
                        <Button type="button" variant="ghost" size="sm" className="mt-2 text-red-300 hover:text-red-200" onClick={() => setResizeError(null)}>
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  )}
                  {openChannels.length === 0 && (
                    <div className="text-amber-400 text-xs bg-amber-500/10 rounded p-2">
                      No open channels. <button className="underline" onClick={() => setActiveTab("create")}>Create one first.</button>
                    </div>
                  )}
                  <div>
                    <Label className="text-zinc-300">Channel</Label>
                    <select value={resizeChannelId} onChange={(e) => { setResizeChannelId(e.target.value); setResizeError(null); }}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-md p-2 text-sm mt-1 text-white">
                      <option value="">Select a channel…</option>
                      {openChannels.map((ch) => (
                        <option key={ch.channelId} value={ch.channelId}>
                          {ch.channelId.slice(0, 10)}…{ch.channelId.slice(-6)} — current: {ch.amount}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-zinc-300">Allocate Amount (ytest.usd)</Label>
                    <Input type="number" value={resizeAmount} onChange={(e) => { setResizeAmount(e.target.value); setResizeError(null); }}
                      placeholder="10" className="bg-zinc-800 border-zinc-700 mt-1" />
                  </div>
                  <Button onClick={handleResizeChannel} disabled={isResizing || !resizeChannelId || !resizeAmount}
                    className="bg-amber-500 hover:bg-amber-600 text-black w-full">
                    {isResizing ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Funding…</>
                    ) : (
                      <><ArrowUpRight className="w-4 h-4 mr-2" />Fund Channel</>
                    )}
                  </Button>
                </TabsContent>

                {/* ── Transfer ── */}
                <TabsContent value="transfer" className="space-y-4">
                  <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/30 text-xs text-zinc-400">
                    <p>Instant off-chain transfer from your Unified Balance. No gas fees. Requires an open funded channel.</p>
                  </div>
                  <div>
                    <Label className="text-zinc-300">Destination Address</Label>
                    <Input value={transferDest} onChange={(e) => setTransferDest(e.target.value)}
                      placeholder="0x…" className="bg-zinc-800 border-zinc-700 mt-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-zinc-300">Asset</Label>
                      <Input value={transferAsset} onChange={(e) => setTransferAsset(e.target.value)}
                        placeholder="ytest.usd" className="bg-zinc-800 border-zinc-700 mt-1" />
                    </div>
                    <div>
                      <Label className="text-zinc-300">Amount</Label>
                      <Input type="number" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)}
                        placeholder="1" className="bg-zinc-800 border-zinc-700 mt-1" />
                    </div>
                  </div>
                  <Button onClick={handleTransfer} disabled={isTransferring || !transferDest || !transferAmount}
                    className="bg-amber-500 hover:bg-amber-600 text-black w-full">
                    {isTransferring ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Transferring…</>
                    ) : (
                      <><Send className="w-4 h-4 mr-2" />Transfer (Off-chain)</>
                    )}
                  </Button>
                </TabsContent>

                {/* ── Close Channel ── */}
                <TabsContent value="close" className="space-y-4">
                  <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/30 text-xs text-zinc-400 space-y-1">
                    <p>Settles the channel on-chain. Funds move to the custody contract for withdrawal.</p>
                    <p>Only YOUR open channels can be closed. Requires Sepolia ETH for gas.</p>
                  </div>
                  {needsETH && (
                    <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded p-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Need ETH for gas — <a href={SEPOLIA_ETH_FAUCET} target="_blank" rel="noopener noreferrer" className="underline">get Sepolia ETH</a>
                    </div>
                  )}
                  {openChannels.length === 0 && (
                    <div className="text-zinc-500 text-xs bg-zinc-800/30 rounded p-2">No open channels to close.</div>
                  )}
                  <div>
                    <Label className="text-zinc-300">Channel to Close</Label>
                    <select value={closeChannelId} onChange={(e) => setCloseChannelId(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-md p-2 text-sm mt-1 text-white">
                      <option value="">Select a channel…</option>
                      {openChannels.map((ch) => (
                        <option key={ch.channelId} value={ch.channelId}>
                          {ch.channelId.slice(0, 10)}…{ch.channelId.slice(-6)} — {ch.amount} ({ch.status})
                        </option>
                      ))}
                    </select>
                  </div>
                  {closeChannelId && (() => {
                    const ch = channels.find((c) => c.channelId === closeChannelId);
                    if (!ch) return null;
                    return (
                      <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-400">Channel ID</span>
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-zinc-300">{formatAddress(closeChannelId)}</span>
                            <CopyButton text={closeChannelId} />
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-400">Amount</span>
                          <span className="text-zinc-200">{ch.amount}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-400">Token</span>
                          <span className="font-mono text-zinc-300">{ch.token ? formatAddress(ch.token) : "—"}</span>
                        </div>
                      </div>
                    );
                  })()}
                  <Button onClick={handleCloseChannel} disabled={isClosing || !closeChannelId || needsETH}
                    variant="destructive" className="w-full">
                    {isClosing ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Closing Channel…</>
                    ) : (
                      <><XIcon className="w-4 h-4 mr-2" />Close Channel</>
                    )}
                  </Button>
                </TabsContent>

                {/* ── Withdraw ── */}
                <TabsContent value="withdraw" className="space-y-4">
                  <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/30 text-xs text-zinc-400">
                    <p>Withdraws settled ytest.usd from the custody contract back to your wallet.</p>
                    <p>Only works after a channel has been closed on-chain. Requires ETH for gas.</p>
                  </div>
                  {needsETH && (
                    <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded p-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Need ETH for gas — <a href={SEPOLIA_ETH_FAUCET} target="_blank" rel="noopener noreferrer" className="underline">get Sepolia ETH</a>
                    </div>
                  )}
                  <div>
                    <Label className="text-zinc-300">Withdraw Amount (ytest.usd)</Label>
                    <Input type="number" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="1" className="bg-zinc-800 border-zinc-700 mt-1" />
                  </div>
                  <Button onClick={handleWithdraw} disabled={isWithdrawing || !withdrawAmount || needsETH}
                    className="bg-green-600 hover:bg-green-700 text-white w-full">
                    {isWithdrawing ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Withdrawing…</>
                    ) : (
                      <><ArrowDownRight className="w-4 h-4 mr-2" />Withdraw from Custody</>
                    )}
                  </Button>
                </TabsContent>
              </Tabs>
            </Card>
          </motion.div>
        )}

        {/* ── On-chain Transactions ── */}
        {transactions.length > 0 && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="bg-zinc-900/50 border-zinc-800 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold text-zinc-300">On-chain Transactions</span>
                <Badge variant="outline" className="border-zinc-700 text-zinc-500 text-xs ml-auto">
                  {transactions.length}
                </Badge>
              </div>
              <div className="space-y-2">
                {transactions.map((tx) => (
                  <div key={tx.id}
                    className="flex items-center justify-between bg-zinc-800/40 rounded-lg px-3 py-2 border border-zinc-700/40">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        tx.status === "confirmed" ? "bg-green-400" :
                        tx.status === "failed" ? "bg-red-400" :
                        "bg-amber-400 animate-pulse"
                      }`} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-zinc-300">{tx.label}</p>
                        <p className="text-xs text-zinc-500">
                          {new Date(tx.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs ${
                        tx.status === "confirmed" ? "text-green-400" :
                        tx.status === "failed" ? "text-red-400" :
                        "text-amber-400"
                      }`}>
                        {tx.status === "pending" ? "pending…" : tx.status}
                      </span>
                      <span className="font-mono text-xs text-zinc-500">
                        {tx.hash.slice(0, 8)}…{tx.hash.slice(-6)}
                      </span>
                      <CopyButton text={tx.hash} />
                      <a href={`${ETHERSCAN_BASE}/tx/${tx.hash}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-zinc-500 hover:text-amber-400">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}

        {/* ── Live Log Panel ── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <button onClick={() => setLogExpanded(!logExpanded)}
              className="w-full p-4 flex items-center justify-between text-left">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold text-zinc-300">Live Log ({logs.length})</span>
                {logs.length > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); setLogs([]); }}
                    className="text-xs text-zinc-500 hover:text-zinc-300 ml-2 px-2 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 transition-colors">
                    Clear
                  </button>
                )}
              </div>
              {logExpanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
            </button>
            <AnimatePresence>
              {logExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                  className="overflow-hidden">
                  <div className="px-4 pb-4">
                    <div className="bg-black/50 rounded-lg border border-zinc-800 p-3 max-h-80 overflow-y-auto font-mono text-xs space-y-1">
                      {logs.length === 0 ? (
                        <p className="text-zinc-600">No log entries yet. Connect to start.</p>
                      ) : (
                        logs.map((entry) => {
                          // Make TX hashes clickable
                          const txMatch = entry.message?.match(/TX:\s*(0x[a-fA-F0-9]{64})/);
                          const isError = entry.level === "error";
                          return (
                            <div key={entry.id}
                              className={`flex gap-2 ${isError ? "bg-red-500/5 rounded px-1 -mx-1" : ""}`}>
                              <span className="text-zinc-600 shrink-0">
                                {new Date(entry.timestamp).toLocaleTimeString()}
                              </span>
                              <span className={`shrink-0 ${
                                isError ? "text-red-400" :
                                entry.level === "warn" ? "text-amber-400" : "text-green-400"
                              }`}>
                                [{entry.level.toUpperCase()}]
                              </span>
                              <span className="text-zinc-300 break-all">
                                {txMatch ? (
                                  <>
                                    {entry.message.split(txMatch[0])[0]}
                                    <a href={`${ETHERSCAN_BASE}/tx/${txMatch[1]}`}
                                      target="_blank" rel="noopener noreferrer"
                                      className="text-amber-400 hover:text-amber-300 underline underline-offset-2">
                                      TX: {txMatch[1].slice(0, 10)}…{txMatch[1].slice(-8)}
                                    </a>
                                    <CopyButton text={txMatch[1]} />
                                    {entry.message.split(txMatch[0]).slice(1).join(txMatch[0])}
                                  </>
                                ) : entry.message}
                              </span>
                            </div>
                          );
                        })
                      )}
                      <div ref={logEndRef} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </motion.div>

        {/* ── Network Config ── */}
        {networkConfig && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="bg-zinc-900/50 border-zinc-800 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Info className="w-4 h-4 text-zinc-400" />
                <span className="text-sm font-semibold text-zinc-400">Network Configuration</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="bg-zinc-800/50 rounded p-2">
                  <span className="text-zinc-500">Custody Contract</span>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="font-mono text-zinc-300">{formatAddress(networkConfig.custody)}</span>
                    <CopyButton text={networkConfig.custody} />
                    <a href={`${ETHERSCAN_BASE}/address/${networkConfig.custody}`} target="_blank" rel="noopener noreferrer"
                      className="text-zinc-500 hover:text-amber-400"><ExternalLink className="w-3 h-3" /></a>
                  </div>
                </div>
                <div className="bg-zinc-800/50 rounded p-2">
                  <span className="text-zinc-500">Adjudicator</span>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="font-mono text-zinc-300">{formatAddress(networkConfig.adjudicator)}</span>
                    <CopyButton text={networkConfig.adjudicator} />
                    <a href={`${ETHERSCAN_BASE}/address/${networkConfig.adjudicator}`} target="_blank" rel="noopener noreferrer"
                      className="text-zinc-500 hover:text-amber-400"><ExternalLink className="w-3 h-3" /></a>
                  </div>
                </div>
                <div className="bg-zinc-800/50 rounded p-2">
                  <span className="text-zinc-500">WebSocket</span>
                  <p className="font-mono text-zinc-300 mt-1 break-all">{networkConfig.wsUrl}</p>
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
