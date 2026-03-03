import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
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
  CheckCircle2,
  Droplets,
  Network,
  Coins,
  ArrowRight,
  Sparkles,
  Receipt,
  Terminal,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { CopyButton } from "@/components/ui/copy-button";
import { HeadingScramble } from "@/components/ui/heading-scramble";
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
import { formatYtest } from "@/hooks/useYellow";
import ReactorKnob from "@/components/ui/control-knob";
import { LocationMap } from "@/components/ui/expand-map";
import { LimelightNav, type NavItem } from "@/components/ui/limelight-nav";
import AnimatedShaderHero from "@/components/ui/animated-shader-hero";
import type { Address } from "viem";
import { parseUnits } from "viem";

// ── Constants ────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const DEFAULT_YTEST_TOKEN = "0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb" as Address;
const ETHERSCAN_BASE = "https://sepolia.etherscan.io";
const FAUCET_API_URL = "https://clearnet-sandbox.yellow.com/faucet/requestTokens";
const PANEL_TABS = ["overview", "channels", "operations", "transactions", "markets"] as const;

const ease = [0.43, 0.13, 0.23, 0.96] as const;
const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.3 } },
};
const stagger = { visible: { transition: { staggerChildren: 0.08 } } };
const slideIn = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease } },
};
const scaleIn = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.3, ease } },
};

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
  { label: "Connect Wallet", description: "Link your Ethereum wallet", icon: Wallet },
  { label: "Authenticate", description: "Sign EIP-712 auth with Yellow", icon: Shield },
  { label: "Load Data", description: "Fetch channels & balances", icon: RefreshCw },
  { label: "Create Channel", description: "Open a state channel on-chain", icon: PlusCircle },
  { label: "Deposit to Custody", description: "Deposit tokens to custody contract", icon: Lock },
  { label: "Fund Channel", description: "Allocate funds via resize", icon: Coins },
  { label: "Transfer", description: "Off-chain instant transfer", icon: Send },
  { label: "Close Channel", description: "Settle on-chain", icon: XIcon },
  { label: "Withdraw", description: "Withdraw from custody contract", icon: ArrowDownRight },
];

// ── Status Badge Component ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const statusLower = status.toLowerCase();
  const config = {
    open: { color: "border-green-500/50 text-green-400 bg-green-500/10", label: "Open" },
    closed: { color: "border-red-500/50 text-red-400 bg-red-500/10", label: "Closed" },
    resizing: { color: "border-amber-500/50 text-amber-400 bg-amber-500/10 animate-pulse", label: "Resizing" },
    pending: { color: "border-blue-500/50 text-blue-400 bg-blue-500/10 animate-pulse", label: "Pending" },
  }[statusLower] ?? { color: "border-zinc-600/50 text-zinc-400 bg-zinc-600/10", label: status };

  return (
    <Badge variant="outline" className={`${config.color} text-xs font-medium`}>
      {config.label}
    </Badge>
  );
}

// ── Glowing Card Component ────────────────────────────────────────────────────

function GlowCard({
  children,
  className = "",
  glowColor = "amber"
}: {
  children: React.ReactNode;
  className?: string;
  glowColor?: "amber" | "green" | "blue" | "red";
}) {
  const glowColors = {
    amber: "hover:shadow-amber-500/20",
    green: "hover:shadow-green-500/20",
    blue: "hover:shadow-blue-500/20",
    red: "hover:shadow-red-500/20",
  };

  return (
    <Card className={`
      relative overflow-hidden bg-zinc-900/50 border-zinc-800 
      transition-all duration-300 hover:border-zinc-700 
      hover:shadow-lg ${glowColors[glowColor]} ${className}
    `}>
      {children}
    </Card>
  );
}

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
    setTimeout(() => {
      setTransactions((prev) =>
        prev.map((t) => (t.id === entry.id ? { ...t, status: "confirmed" } : t))
      );
    }, 15000);
  }, []);

  // Forms
  const [createAmount, setCreateAmount] = useState("1");
  const [depositAmount, setDepositAmount] = useState("10");
  const [resizeChannelId, setResizeChannelId] = useState("");
  const [resizeAmount, setResizeAmount] = useState("10");
  const [transferDest, setTransferDest] = useState("");
  const [transferAmount, setTransferAmount] = useState("1");
  const [transferAsset, setTransferAsset] = useState("ytest.usd");
  const [transferIntensity, setTransferIntensity] = useState(37);
  const [closeChannelId, setCloseChannelId] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("1");

  // Custody balance
  const [custodyBalance, setCustodyBalance] = useState<bigint | null>(null);

  // Loading states
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncingYellow, setIsSyncingYellow] = useState(false);
  const [isRequestingFaucet, setIsRequestingFaucet] = useState(false);
  const [resizeError, setResizeError] = useState<string | null>(null);

  // Log panel
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logExpanded, setLogExpanded] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Network config display
  const [networkConfig, setNetworkConfig] = useState<{
    custody: string;
    adjudicator: string;
    wsUrl: string;
  } | null>(null);

  // Active panel tab
  const [activeTab, setActiveTab] = useState("overview");

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

  // ── Faucet request ─────────────────────────────────────────────────────────

  const handleRequestFaucet = useCallback(async () => {
    if (!primaryWallet?.address) {
      toast.error("Connect wallet first");
      return;
    }

    setIsRequestingFaucet(true);
    try {
      const response = await fetch(FAUCET_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: primaryWallet.address }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Faucet request failed: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        toast.success("🎉 Faucet tokens requested! Check your Yellow balance in ~30 seconds.");
        // Refresh balances after a short delay
        setTimeout(() => {
          fetchWalletBalances();
          if (clientRef.current) {
            clientRef.current.getLedgerBalances().catch(() => { });
          }
        }, 5000);
      } else {
        toast.error(data.message || "Faucet request failed");
      }
    } catch (err: any) {
      const msg = err?.message ?? "Faucet request failed";
      if (msg.includes("rate") || msg.includes("limit")) {
        toast.error("Rate limited. Please wait before requesting again.");
      } else {
        toast.error(`Faucet error: ${msg}`);
      }
    } finally {
      setIsRequestingFaucet(false);
    }
  }, [primaryWallet?.address, fetchWalletBalances]);

  // ── Unified sync helpers ──────────────────────────────────────────────────

  const syncYellowOnce = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      await client.getLedgerBalances();
      await client.getChannels();
      // Fetch custody balance
      const custBal = await client.getCustodyBalance(ytestTokenAddress);
      setCustodyBalance(custBal);
      fetchWalletBalances();
    } catch {
      // Errors are already surfaced via events/logs
    }
  }, [fetchWalletBalances, ytestTokenAddress]);

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

  // Mark deposit step as completed when a deposit succeeds
  useEffect(() => {
    if (custodyBalance !== null && custodyBalance > 0n) {
      setCurrentStep((prev) => Math.max(prev, 5));
    }
  }, [custodyBalance]);

  // ── Deposit to custody ────────────────────────────────────────────────────

  const handleDeposit = useCallback(async () => {
    const client = clientRef.current;
    if (!client) {
      toast.error("Not connected to Yellow");
      return;
    }

    const amt = parseFloat(depositAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error("Invalid deposit amount");
      return;
    }

    const amountWei = parseUnits(depositAmount, 6);

    setIsDepositing(true);
    try {
      toast.info("Depositing to custody contract...");
      const { txHash } = await client.deposit(ytestTokenAddress, amountWei);
      addTx(`Deposit ${depositAmount} ytest.usd`, txHash);
      toast.success(`Deposited ${depositAmount} ytest.usd to custody!`);

      // Refresh custody balance
      void pollYellowAfterTx(2, 4000);
      setTimeout(async () => {
        if (clientRef.current) {
          const bal = await clientRef.current.getCustodyBalance(ytestTokenAddress);
          setCustodyBalance(bal);
        }
      }, 5000);
    } catch (err: any) {
      const msg = err?.message ?? "Unknown error";
      toast.error(`Deposit failed: ${msg.slice(0, 100)}`, { duration: 8000 });
    } finally {
      setIsDepositing(false);
    }
  }, [depositAmount, ytestTokenAddress, addTx, pollYellowAfterTx]);

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

  // NOTE: auto-scroll removed — logger is now a sticky footer tray

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
          "Server rejected auth. If this persists, wait 60s and try again.",
          { duration: 8000 }
        );
      } else if (msg.toLowerCase().includes("timeout")) {
        toast.error("Connection timed out — check your internet connection");
      } else {
        toast.error(`Connection failed: ${msg}`, { duration: 6000 });
      }
      setCurrentStep(1);
    } finally {
      setIsConnecting(false);
    }
  }, [primaryWallet, handleYellowEvent, syncYellowOnce]);

  // ── Refresh data ───────────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    setIsRefreshing(true);
    try {
      await syncYellowOnce();
      toast.success("Data refreshed");
    } catch (err: any) {
      toast.error(`Refresh failed: ${err?.message ?? "Unknown error"}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [syncYellowOnce]);

  // ── Create Channel ─────────────────────────────────────────────────────────

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
  }, [createAmount, ytestTokenAddress, currentStep, ethBalance, addTx, pollYellowAfterTx]);

  // ── Resize Channel ─────────────────────────────────────────────────────────

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
          "A resize is already in progress. Wait for it to confirm or close the channel.",
          { duration: 8000 }
        );
        void pollYellowAfterTx(2, 4000);
      } else if (msg.includes("insufficient") || msg.includes("balance")) {
        toast.error("Not enough ytest.usd in your Unified Balance.", { duration: 6000 });
      } else if (msg.includes("user rejected") || msg.includes("denied")) {
        toast.error("Transaction was rejected in your wallet.");
      } else if (msg.includes("simulation") || msg.includes("contract")) {
        toast.error("Contract simulation failed. See the error below and the Debug Log for details.", { duration: 10000 });
      } else {
        toast.error(`Fund failed: ${fullMessage.slice(0, 120)}${fullMessage.length > 120 ? "…" : ""}`, { duration: 8000 });
      }
    } finally {
      setIsResizing(false);
    }
  }, [resizeChannelId, resizeAmount, currentStep, addTx, pollYellowAfterTx]);

  // ── Transfer ───────────────────────────────────────────────────────────────

  const handleTransfer = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { toast.error("Not connected"); return; }
    if (!transferDest) { toast.error("Enter a destination address"); return; }
    if (!transferDest.startsWith("0x") || transferDest.length !== 42) {
      toast.error("Invalid destination address");
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

  // ── Close Channel ──────────────────────────────────────────────────────────

  const handleCloseChannel = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { toast.error("Not connected"); return; }
    if (!closeChannelId) { toast.error("Select a channel to close"); return; }

    if (ethBalance && isLowBalance(ethBalance.formatted, 18, 0.005)) {
      toast.error("Insufficient Sepolia ETH for gas.", { duration: 6000 });
      return;
    }

    setIsClosing(true);
    try {
      toast.info("Closing channel on-chain… this may take 30–60 seconds", { duration: 10000 });
      const result = await client.closeChannel(closeChannelId as `0x${string}`);
      addTx("Close Channel", result.txHash);
      setCurrentStep(Math.max(currentStep, 7));
      setCloseChannelId("");
      toast.success(`Channel closed! TX: ${result.txHash.slice(0, 10)}...`);
      setActiveTab("channels");
      void pollYellowAfterTx();
    } catch (err: any) {
      const msg = (err?.message ?? "Close failed").toLowerCase();
      if (msg.includes("invalid signature") || msg.includes("unauthorized")) {
        toast.error("Close rejected: this channel may belong to a different wallet.", { duration: 8000 });
      } else {
        toast.error(`Close failed: ${err?.message ?? "Unknown error"}`, { duration: 6000 });
      }
    } finally {
      setIsClosing(false);
    }
  }, [closeChannelId, currentStep, ethBalance, addTx, pollYellowAfterTx]);

  // ── Withdraw ───────────────────────────────────────────────────────────────

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
      void pollYellowAfterTx();
    } catch (err: any) {
      toast.error(`Withdrawal failed: ${err?.message ?? "Unknown error"}`, { duration: 6000 });
    } finally {
      setIsWithdrawing(false);
    }
  }, [withdrawAmount, ytestTokenAddress, ethBalance, addTx, pollYellowAfterTx]);

  // ── State reset ────────────────────────────────────────────────────────────

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
  const openChannels = channels.filter(
    (c) => c.channelId && c.status.toLowerCase() !== "closed"
  );
  const needsETH = ethBalance !== null && isLowBalance(ethBalance.formatted, 18, 0.005);
  const totalLedgerBalance = ledgerBalances.reduce((sum, b) => sum + parseFloat(b.amount || "0"), 0);
  const confirmedTxCount = transactions.filter((tx) => tx.status === "confirmed").length;
  const pendingTxCount = transactions.filter((tx) => tx.status === "pending").length;
  const suggestedTransferAmount = Math.max(0.1, transferIntensity / 15).toFixed(2);
  const activeTabIndex = Math.max(
    0,
    PANEL_TABS.indexOf(activeTab as (typeof PANEL_TABS)[number])
  );
  const tabNavItems: NavItem[] = [
    { id: "overview", icon: <Activity />, label: "Overview" },
    { id: "channels", icon: <Network />, label: `Channels (${openChannels.length})` },
    { id: "operations", icon: <Zap />, label: "Operations" },
    { id: "transactions", icon: <Receipt />, label: `Transactions (${transactions.length})` },
    { id: "markets", icon: <Terminal />, label: "Activity" },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
        <Header />

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 pt-28 sm:pt-32 pb-16 space-y-6">

          {/* ── Hero Section ── */}
          <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-4">
            <motion.div variants={fadeIn} className="relative overflow-hidden rounded-2xl border border-zinc-800/80 p-4 sm:p-5">
              <AnimatedShaderHero
                showContent={false}
                headline={{ line1: "", line2: "" }}
                subtitle=""
                className="absolute inset-0 min-h-0 opacity-35"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/55 to-black/75 pointer-events-none" />

              <div className="relative z-10 flex items-center justify-between flex-wrap gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                      <Network className="w-5 h-5 text-black" />
                    </div>
                    <div>
                      <HeadingScramble className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">
                        Yellow Network
                      </HeadingScramble>
                      <p className="text-zinc-300 text-xs sm:text-sm">State channels for instant, off-chain transfers</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 bg-black/50 rounded-lg px-3 py-2 border border-zinc-700/70">
                    <span className={`text-sm ${isTestnet ? "text-amber-400 font-medium" : "text-zinc-500"}`}>Sandbox</span>
                    <Switch
                      checked={!isTestnet}
                      onCheckedChange={(c) => setIsTestnet(!c)}
                      className="data-[state=checked]:bg-green-600"
                    />
                    <span className={`text-sm ${!isTestnet ? "text-green-400 font-medium" : "text-zinc-500"}`}>Mainnet</span>
                  </div>
                  {isConnected && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      className="border-zinc-700 bg-black/50 text-zinc-200 hover:text-white"
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>

          {/* ── Mainnet overlay ── */}
          <AnimatePresence>
            {!isTestnet && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center backdrop-blur-sm"
              >
                <div className="text-center space-y-6 p-8">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", damping: 15 }}
                    className="w-20 h-20 rounded-2xl bg-amber-500/20 flex items-center justify-center mx-auto"
                  >
                    <Lock className="w-10 h-10 text-amber-400" />
                  </motion.div>
                  <h2 className="text-2xl font-bold text-white">Mainnet Coming Soon</h2>
                  <p className="text-zinc-400 max-w-md">
                    Yellow Network mainnet integration is under development.
                    Switch to Sandbox (Sepolia) to test the integration.
                  </p>
                  <Button
                    onClick={() => setIsTestnet(true)}
                    className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Switch to Sandbox
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Connection Status Bar ── */}
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <GlowCard className="p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isConnected ? "bg-green-500/20" : "bg-zinc-800"
                    }`}>
                    <Wallet className={`w-5 h-5 ${isConnected ? "text-green-400" : "text-zinc-400"}`} />
                  </div>

                  {primaryWallet?.address ? (
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-zinc-500">Wallet</span>
                        <span className="font-mono text-sm text-white">{formatAddress(primaryWallet.address)}</span>
                        <CopyButton text={primaryWallet.address} />
                      </div>
                      {isConnected && yellowAddress ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Yellow Connected
                          </Badge>
                          <span className="text-xs text-zinc-500">Session: {formatAddress(yellowAddress)}</span>
                        </div>
                      ) : (
                        <Badge variant="outline" className={`text-xs w-fit ${connectionStatus === YellowConnectionStatus.Error
                          ? "border-red-500/50 text-red-400"
                          : connectionStatus === YellowConnectionStatus.WaitingForSignature
                            ? "border-amber-500/50 text-amber-400 animate-pulse"
                            : connectionStatus === YellowConnectionStatus.Authenticating
                              ? "border-blue-500/50 text-blue-400 animate-pulse"
                              : "border-zinc-600/50 text-zinc-400"
                          }`}>
                          {connectionStatus === YellowConnectionStatus.WaitingForSignature
                            ? "⏳ Sign in wallet…"
                            : connectionStatus === YellowConnectionStatus.Authenticating
                              ? "⏳ Authenticating…"
                              : connectionStatus === YellowConnectionStatus.Error
                                ? "⚠ Auth error"
                                : "Not connected to Yellow"}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-zinc-400">No wallet connected</span>
                      <span className="text-xs text-zinc-600">Connect to start using Yellow Network</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {!primaryWallet?.address && (
                    <Button
                      onClick={() => setShowAuthFlow(true)}
                      className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
                    >
                      <Wallet className="w-4 h-4 mr-2" />
                      Connect Wallet
                    </Button>
                  )}
                  {primaryWallet?.address && !isConnected && (
                    <>
                      <Button
                        onClick={handleConnectAndAuth}
                        disabled={isConnecting}
                        className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
                      >
                        {isConnecting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            {connectionStatus === YellowConnectionStatus.WaitingForSignature
                              ? "Sign in wallet…"
                              : "Connecting…"}
                          </>
                        ) : (
                          <>
                            <Zap className="w-4 h-4 mr-2" />
                            Connect Yellow
                          </>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleFullDisconnect}
                        className="text-zinc-500 hover:text-zinc-300"
                      >
                        <LogOut className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                  {isConnected && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDisconnect}
                        className="border-zinc-700 text-zinc-400 hover:text-white"
                      >
                        <LogOut className="w-4 h-4 mr-2" />
                        Disconnect Yellow
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleFullDisconnect}
                        className="border-red-700/50 text-red-400 hover:text-red-300 hover:border-red-600"
                      >
                        Disconnect Wallet
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </GlowCard>
          </motion.div>

          {/* ── Warning Banners ── */}
          <AnimatePresence>
            {primaryWallet?.address && needsETH && (
              <motion.div
                variants={scaleIn}
                initial="hidden"
                animate="visible"
                exit="hidden"
              >
                <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-amber-300 font-medium">Low Sepolia ETH</p>
                    <p className="text-xs text-zinc-400">
                      Balance: {parseFloat(ethBalance?.formatted ?? "0").toFixed(5)} ETH — You need ETH for gas
                    </p>
                  </div>
                  <a
                    href={SEPOLIA_ETH_FAUCET}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                  >
                    <Button variant="outline" size="sm" className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10">
                      Get ETH <ExternalLink className="w-3 h-3 ml-1" />
                    </Button>
                  </a>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Account + Faucet Deck ── */}
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <GlowCard className="p-5 xl:col-span-2">
                <div className="relative z-10">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-200">Balances and Access</h3>
                      <p className="text-xs text-zinc-500 mt-1">
                        Single source of truth for wallet, ledger, and custody. Faucet is embedded here.
                      </p>
                    </div>
                    <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                      Sandbox / Sepolia
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-zinc-500">Wallet ETH</p>
                      <p className="text-lg font-mono text-white mt-1">
                        {ethBalance ? `${parseFloat(ethBalance.formatted).toFixed(4)}` : "—"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-zinc-500">Wallet ytest</p>
                      <p className="text-lg font-mono text-white mt-1">
                        {ytestBalance ? formatYtest(ytestBalance.formatted) : "—"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-amber-300/80">Unified Balance</p>
                      <p className="text-lg font-mono text-amber-200 mt-1">
                        {totalLedgerBalance > 0 ? formatYtest(totalLedgerBalance) : "—"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-zinc-500">Custody</p>
                      <p className="text-lg font-mono text-white mt-1">
                        {custodyBalance !== null ? formatYtest(custodyBalance) : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      onClick={handleRequestFaucet}
                      disabled={isRequestingFaucet || !primaryWallet?.address}
                      size="sm"
                      className="bg-amber-500 hover:bg-amber-600 text-black"
                    >
                      {isRequestingFaucet ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Requesting faucet…
                        </>
                      ) : (
                        <>
                          <Droplets className="w-4 h-4 mr-2" />
                          Request Faucet Tokens
                        </>
                      )}
                    </Button>
                    <a href={YTEST_USD_FAUCET} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-300">
                        Open ytest faucet <ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                    </a>
                  </div>
                </div>
              </GlowCard>

              <GlowCard className="p-5">
                <div className="relative z-10">
                  <h3 className="text-sm font-semibold text-zinc-200">Network Pulse</h3>
                  <p className="text-xs text-zinc-500 mt-1">Interactive map for active sandbox route.</p>
                  <div className="mt-4 flex justify-center">
                    <LocationMap
                      className="mb-6"
                      location="Yellow Sandbox Route"
                      coordinates="Sepolia · wss://clearnet-sandbox.yellow.com/ws"
                    />
                  </div>
                </div>
              </GlowCard>
            </div>
          </motion.div>

          {/* ── Main Panel ── */}
          {isConnected && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <GlowCard className="p-6">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  {isSyncingYellow && (
                    <div className="flex items-center gap-2 mb-4 text-xs text-zinc-500 bg-zinc-800/50 rounded-lg px-3 py-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Syncing with Yellow Network…</span>
                    </div>
                  )}

                  <div className="mb-6 overflow-x-auto pb-1">
                    <LimelightNav
                      className="min-w-max bg-zinc-900/75 border-zinc-800"
                      items={tabNavItems}
                      activeIndex={activeTabIndex}
                      onTabChange={(index) => setActiveTab(PANEL_TABS[index] ?? "overview")}
                      iconContainerClassName="px-3 sm:px-5"
                      iconClassName="text-zinc-200"
                    />
                  </div>

                  {/* ── Overview Tab ── */}
                  <TabsContent value="overview" className="space-y-6">
                    {/* Next Step Guidance */}
                    <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 rounded-xl p-5">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                          {currentStep < 4 ? (
                            <Zap className="w-5 h-5 text-amber-400" />
                          ) : currentStep < 6 ? (
                            <ArrowUpRight className="w-5 h-5 text-amber-400" />
                          ) : (
                            <CheckCircle2 className="w-5 h-5 text-green-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-white mb-1">
                            {currentStep < 4
                              ? "Create Your First Channel"
                              : currentStep < 5
                                ? "Deposit Tokens to Custody"
                                : currentStep < 6
                                  ? "Fund Your Channel"
                                  : currentStep < 7
                                    ? "Make a Transfer"
                                    : "All Steps Complete!"}
                          </h3>
                          <p className="text-xs text-zinc-400 leading-relaxed">
                            {currentStep < 4
                              ? "Open a state channel on-chain to start making instant off-chain transfers. You'll need Sepolia ETH for gas and ytest.usd tokens."
                              : currentStep < 5
                                ? "Move ytest.usd from your wallet into the custody contract. This is required before you can allocate funds to channels."
                                : currentStep < 6
                                  ? "Allocate funds from the custody contract into your open channel to enable off-chain transfers."
                                  : currentStep < 7
                                    ? "Send an instant, gas-free off-chain transfer to any address on the Yellow Network."
                                    : "You've completed the full state channel lifecycle. You can close channels and withdraw funds."}
                          </p>
                          {currentStep < 7 && (
                            <Button
                              onClick={() => setActiveTab("operations")}
                              size="sm"
                              className="mt-3 bg-amber-500 hover:bg-amber-600 text-black font-medium"
                            >
                              <ArrowRight className="w-3.5 h-3.5 mr-1.5" />
                              Go to Operations
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                      <ReactorKnob
                        className="xl:col-span-2"
                        initialValue={transferIntensity}
                        onValueChange={setTransferIntensity}
                      />

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                        <h3 className="text-sm font-semibold text-zinc-200">Execution Preset</h3>
                        <p className="text-xs text-zinc-500 mt-1">
                          Use the control dial to set a transfer intent and push it to Operations.
                        </p>
                        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                          <p className="text-xs text-zinc-500">Suggested transfer</p>
                          <p className="font-mono text-2xl text-amber-300 mt-1">
                            {suggestedTransferAmount}
                            <span className="text-sm text-zinc-500 ml-1">ytest.usd</span>
                          </p>
                        </div>
                        <div className="mt-4 space-y-2">
                          <Button
                            size="sm"
                            className="w-full bg-amber-500 hover:bg-amber-600 text-black"
                            onClick={() => {
                              setTransferAmount(suggestedTransferAmount);
                              setActiveTab("operations");
                            }}
                          >
                            Apply and Open Operations
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full border-zinc-700 text-zinc-300"
                            onClick={handleRequestFaucet}
                            disabled={isRequestingFaucet}
                          >
                            <Droplets className="w-3.5 h-3.5 mr-1.5" />
                            Request faucet tokens
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Channel Status + Quick Actions */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Active Channels Summary */}
                      <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                            <Network className="w-4 h-4 text-amber-400" />
                            Channels
                          </h3>
                          <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-xs">
                            {openChannels.length} open
                          </Badge>
                        </div>
                        {openChannels.length === 0 ? (
                          <p className="text-xs text-zinc-500">No open channels. Create one to start.</p>
                        ) : (
                          <div className="space-y-2">
                            {openChannels.slice(0, 3).map((ch) => (
                              <div key={ch.channelId} className="flex items-center justify-between bg-zinc-800/50 rounded-lg px-3 py-2">
                                <span className="font-mono text-xs text-zinc-300">
                                  {ch.channelId?.slice(0, 8)}…{ch.channelId?.slice(-6)}
                                </span>
                                <span className="text-xs font-mono text-amber-400">
                                  {formatYtest(ch.amount ?? "0")}
                                </span>
                              </div>
                            ))}
                            {openChannels.length > 3 && (
                              <button
                                onClick={() => setActiveTab("channels")}
                                className="text-xs text-amber-400 hover:text-amber-300 mt-1"
                              >
                                View all {openChannels.length} channels →
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Quick Actions */}
                      <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30">
                        <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                          <Zap className="w-4 h-4 text-amber-400" />
                          Quick Actions
                        </h3>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setActiveTab("operations")}
                            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 justify-start text-xs"
                          >
                            <PlusCircle className="w-3.5 h-3.5 mr-1.5 text-green-400" />
                            Create
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setActiveTab("operations")}
                            disabled={openChannels.length === 0}
                            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 justify-start text-xs"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
                            Fund
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setActiveTab("operations")}
                            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 justify-start text-xs"
                          >
                            <Send className="w-3.5 h-3.5 mr-1.5 text-purple-400" />
                            Transfer
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRequestFaucet}
                            disabled={isRequestingFaucet}
                            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 justify-start text-xs"
                          >
                            <Droplets className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />
                            Faucet
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Recent Transactions Mini */}
                    {transactions.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                            <Activity className="w-4 h-4 text-amber-400" />
                            Recent Activity
                          </h3>
                          <button
                            onClick={() => setActiveTab("transactions")}
                            className="text-xs text-amber-400 hover:text-amber-300"
                          >
                            View all →
                          </button>
                        </div>
                        <div className="space-y-2">
                          {transactions.slice(0, 3).map((tx) => (
                            <div
                              key={tx.id}
                              className="flex items-center justify-between bg-zinc-800/40 rounded-lg px-3 py-2 border border-zinc-700/40"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-2 h-2 rounded-full shrink-0 ${tx.status === "confirmed" ? "bg-green-400" :
                                    tx.status === "failed" ? "bg-red-400" :
                                      "bg-amber-400 animate-pulse"
                                  }`} />
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-zinc-300">{tx.label}</p>
                                  <p className="text-xs text-zinc-500">{new Date(tx.timestamp).toLocaleTimeString()}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono text-xs text-zinc-500">
                                  {tx.hash.slice(0, 6)}…{tx.hash.slice(-4)}
                                </span>
                                <a
                                  href={`${ETHERSCAN_BASE}/tx/${tx.hash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-zinc-500 hover:text-amber-400"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Channels Tab ── */}
                  <TabsContent value="channels" className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-300">Your State Channels</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="text-zinc-400 hover:text-white"
                      >
                        <RefreshCw className={`w-3 h-3 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />
                        Refresh
                      </Button>
                    </div>

                    {channels.length === 0 ? (
                      <div className="text-center py-12 space-y-4">
                        <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mx-auto">
                          <Network className="w-8 h-8 text-zinc-600" />
                        </div>
                        <div>
                          <p className="text-zinc-400 font-medium">No channels found</p>
                          <p className="text-zinc-600 text-sm mt-1">Create your first state channel to get started</p>
                        </div>
                        <Button
                          onClick={() => setActiveTab("operations")}
                          className="bg-amber-500 hover:bg-amber-600 text-black"
                        >
                          <PlusCircle className="w-4 h-4 mr-2" />
                          Create Channel
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {channels.filter((ch) => ch.channelId).map((ch) => (
                          <motion.div
                            key={ch.channelId}
                            variants={slideIn}
                            initial="hidden"
                            animate="visible"
                            className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/50 hover:border-zinc-600/50 transition-all"
                          >
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-zinc-700/50 flex items-center justify-center">
                                  <Network className="w-5 h-5 text-amber-400" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm text-zinc-300">
                                      {ch.channelId?.slice(0, 8)}…{ch.channelId?.slice(-6)}
                                    </span>
                                    <CopyButton text={ch.channelId ?? ""} />
                                    <a
                                      href={`${ETHERSCAN_BASE}/address/${ch.channelId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-zinc-500 hover:text-amber-400 transition-colors"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  </div>
                                  <p className="text-xs text-zinc-500">v{ch.version ?? 0}</p>
                                </div>
                              </div>
                              <StatusBadge status={ch.status ?? "unknown"} />
                            </div>

                            <div className="grid grid-cols-3 gap-4 text-sm">
                              <div>
                                <p className="text-xs text-zinc-500">Amount</p>
                                <p className="font-mono text-zinc-200">{formatYtest(ch.amount ?? "0")} ytest.usd</p>
                              </div>
                              <div>
                                <p className="text-xs text-zinc-500">Token</p>
                                <p className="font-mono text-zinc-400 text-xs">{ch.token ? formatAddress(ch.token) : "—"}</p>
                              </div>
                              <div>
                                <p className="text-xs text-zinc-500">Chain</p>
                                <p className="text-zinc-400">{ch.chainId ?? "—"}</p>
                              </div>
                            </div>

                            {ch.status?.toLowerCase() === "open" && (
                              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-zinc-700/50">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => { setResizeChannelId(ch.channelId); setActiveTab("operations"); }}
                                  className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                                >
                                  <ArrowUpRight className="w-3 h-3 mr-1" />
                                  Fund
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => { setCloseChannelId(ch.channelId); setActiveTab("operations"); }}
                                  className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                                >
                                  <XIcon className="w-3 h-3 mr-1" />
                                  Close
                                </Button>
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Operations Tab ── */}
                  <TabsContent value="operations" className="space-y-5">
                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                      <motion.div
                        variants={slideIn}
                        initial="hidden"
                        animate="visible"
                        className="xl:col-span-6 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-4 space-y-4 h-full"
                      >
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-200">Channel Setup</h3>
                          <p className="text-xs text-zinc-500 mt-1">
                            Create a channel, then move wallet funds into custody.
                          </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-fr">
                        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4 space-y-3 h-full flex flex-col">
                          <div className="flex items-center gap-2 text-zinc-300">
                            <PlusCircle className="w-4 h-4 text-emerald-400" />
                            <span className="text-sm font-medium">Create Channel</span>
                          </div>
                          <Input
                            type="number"
                            value={createAmount}
                            onChange={(e) => setCreateAmount(e.target.value)}
                            placeholder="Initial amount (ytest.usd)"
                            className="bg-zinc-900 border-zinc-800"
                          />
                          <Button
                            onClick={handleCreateChannel}
                            disabled={isCreating || !createAmount || needsETH}
                            className="w-full mt-auto bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            {isCreating ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Creating…
                              </>
                            ) : (
                              <>
                                <PlusCircle className="w-4 h-4 mr-2" />
                                Create Channel
                              </>
                            )}
                          </Button>
                        </div>

                        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4 space-y-3 h-full flex flex-col">
                          <div className="flex items-center gap-2 text-zinc-300">
                            <Lock className="w-4 h-4 text-amber-400" />
                            <span className="text-sm font-medium">Deposit to Custody</span>
                          </div>
                          <p className="text-xs text-zinc-500">
                            Custody: {custodyBalance !== null ? formatYtest(custodyBalance) : "—"} ytest.usd
                          </p>
                          <Input
                            type="number"
                            value={depositAmount}
                            onChange={(e) => setDepositAmount(e.target.value)}
                            placeholder="Amount (ytest.usd)"
                            className="bg-zinc-900 border-zinc-800"
                          />
                          <Button
                            onClick={handleDeposit}
                            disabled={isDepositing || !depositAmount || needsETH}
                            className="w-full mt-auto bg-amber-600 hover:bg-amber-700 text-black"
                          >
                            {isDepositing ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Depositing…
                              </>
                            ) : (
                              <>
                                <Lock className="w-4 h-4 mr-2" />
                                Deposit to Custody
                              </>
                            )}
                          </Button>
                        </div>
                        </div>
                      </motion.div>

                      <motion.div
                        variants={slideIn}
                        initial="hidden"
                        animate="visible"
                        className="xl:col-span-6 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-4 space-y-4 h-full"
                      >
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-200">Fund and Transfer</h3>
                          <p className="text-xs text-zinc-500 mt-1">
                            Allocate from custody to channel, then send off-chain.
                          </p>
                        </div>

                        {resizeError && (
                          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
                            <p className="font-medium text-red-300 mb-1">Fund failed</p>
                            <p className="text-red-200/90 break-words font-mono text-xs max-h-24 overflow-y-auto">
                              {resizeError}
                            </p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="mt-2 text-red-300 hover:text-red-200"
                              onClick={() => setResizeError(null)}
                            >
                              Dismiss
                            </Button>
                          </div>
                        )}

                        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4 space-y-3">
                          <div className="flex items-center gap-2 text-zinc-300">
                            <ArrowUpRight className="w-4 h-4 text-sky-400" />
                            <span className="text-sm font-medium">Fund Channel</span>
                          </div>
                          <select
                            value={resizeChannelId}
                            onChange={(e) => {
                              setResizeChannelId(e.target.value);
                              setResizeError(null);
                            }}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-md p-2 text-sm text-white"
                          >
                            <option value="">Select channel…</option>
                            {openChannels.map((ch) => (
                              <option key={ch.channelId} value={ch.channelId}>
                                {ch.channelId.slice(0, 8)}…{ch.channelId.slice(-6)} — {formatYtest(ch.amount)}
                              </option>
                            ))}
                          </select>
                          <Input
                            type="number"
                            value={resizeAmount}
                            onChange={(e) => {
                              setResizeAmount(e.target.value);
                              setResizeError(null);
                            }}
                            placeholder="Amount (ytest.usd)"
                            className="bg-zinc-900 border-zinc-800"
                          />
                          <Button
                            onClick={handleResizeChannel}
                            disabled={isResizing || !resizeChannelId || !resizeAmount}
                            className="w-full bg-sky-600 hover:bg-sky-700 text-white"
                          >
                            {isResizing ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Funding…
                              </>
                            ) : (
                              <>
                                <ArrowUpRight className="w-4 h-4 mr-2" />
                                Fund Channel
                              </>
                            )}
                          </Button>
                        </div>

                        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4 space-y-3">
                          <div className="flex items-center gap-2 text-zinc-300">
                            <Send className="w-4 h-4 text-violet-400" />
                            <span className="text-sm font-medium">Transfer</span>
                          </div>
                          <Input
                            value={transferDest}
                            onChange={(e) => setTransferDest(e.target.value)}
                            placeholder="Destination address (0x...)"
                            className="bg-zinc-900 border-zinc-800"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              value={transferAsset}
                              onChange={(e) => setTransferAsset(e.target.value)}
                              placeholder="Asset"
                              className="bg-zinc-900 border-zinc-800"
                            />
                            <Input
                              type="number"
                              value={transferAmount}
                              onChange={(e) => setTransferAmount(e.target.value)}
                              placeholder="Amount"
                              className="bg-zinc-900 border-zinc-800"
                            />
                          </div>
                          <Button
                            onClick={handleTransfer}
                            disabled={isTransferring || !transferDest || !transferAmount}
                            className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                          >
                            {isTransferring ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Transferring…
                              </>
                            ) : (
                              <>
                                <Send className="w-4 h-4 mr-2" />
                                Transfer
                              </>
                            )}
                          </Button>
                        </div>
                      </motion.div>
                    </div>

                    <motion.div
                      variants={slideIn}
                      initial="hidden"
                      animate="visible"
                      className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-4"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-fr">
                        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4 space-y-3 h-full flex flex-col">
                          <div className="flex items-center gap-2 text-zinc-300">
                            <XIcon className="w-4 h-4 text-rose-400" />
                            <span className="text-sm font-medium">Close Channel</span>
                          </div>
                          <select
                            value={closeChannelId}
                            onChange={(e) => setCloseChannelId(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-md p-2 text-sm text-white"
                          >
                            <option value="">Select channel…</option>
                            {openChannels.map((ch) => (
                              <option key={ch.channelId} value={ch.channelId}>
                                {ch.channelId.slice(0, 8)}…{ch.channelId.slice(-6)}
                              </option>
                            ))}
                          </select>
                          <Button
                            onClick={handleCloseChannel}
                            disabled={isClosing || !closeChannelId || needsETH}
                            variant="destructive"
                            className="w-full mt-auto"
                          >
                            {isClosing ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Closing…
                              </>
                            ) : (
                              <>
                                <XIcon className="w-4 h-4 mr-2" />
                                Close Channel
                              </>
                            )}
                          </Button>
                        </div>

                        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4 space-y-3 h-full flex flex-col">
                          <div className="flex items-center gap-2 text-zinc-300">
                            <ArrowDownRight className="w-4 h-4 text-emerald-400" />
                            <span className="text-sm font-medium">Withdraw from Custody</span>
                          </div>
                          <Input
                            type="number"
                            value={withdrawAmount}
                            onChange={(e) => setWithdrawAmount(e.target.value)}
                            placeholder="Amount (ytest.usd)"
                            className="bg-zinc-900 border-zinc-800"
                          />
                          <Button
                            onClick={handleWithdraw}
                            disabled={isWithdrawing || !withdrawAmount || needsETH}
                            className="w-full mt-auto bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            {isWithdrawing ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Withdrawing…
                              </>
                            ) : (
                              <>
                                <ArrowDownRight className="w-4 h-4 mr-2" />
                                Withdraw
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  </TabsContent>

                  {/* ── Transactions Tab ── */}
                  <TabsContent value="transactions" className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-300">Transaction History</h3>
                      <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-xs">
                        {transactions.length} total
                      </Badge>
                    </div>
                    {transactions.length === 0 ? (
                      <div className="text-center py-12 space-y-4">
                        <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mx-auto">
                          <Receipt className="w-8 h-8 text-zinc-600" />
                        </div>
                        <div>
                          <p className="text-zinc-400 font-medium">No transactions yet</p>
                          <p className="text-zinc-600 text-sm mt-1">Transactions will appear here as you create channels, deposit, and transfer</p>
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-zinc-700/50">
                              <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Status</th>
                              <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Operation</th>
                              <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">TX Hash</th>
                              <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Time</th>
                              <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {transactions.map((tx) => (
                              <tr key={tx.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                                <td className="py-3 px-3">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2.5 h-2.5 rounded-full ${tx.status === "confirmed" ? "bg-green-400" :
                                        tx.status === "failed" ? "bg-red-400" :
                                          "bg-amber-400 animate-pulse"
                                      }`} />
                                    <span className={`text-xs font-medium capitalize ${tx.status === "confirmed" ? "text-green-400" :
                                        tx.status === "failed" ? "text-red-400" :
                                          "text-amber-400"
                                      }`}>
                                      {tx.status}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-3 px-3">
                                  <span className="text-zinc-200 font-medium">{tx.label}</span>
                                </td>
                                <td className="py-3 px-3">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs text-zinc-400">
                                      {tx.hash.slice(0, 10)}…{tx.hash.slice(-8)}
                                    </span>
                                    <CopyButton text={tx.hash} />
                                  </div>
                                </td>
                                <td className="py-3 px-3">
                                  <span className="text-xs text-zinc-500">
                                    {new Date(tx.timestamp).toLocaleString()}
                                  </span>
                                </td>
                                <td className="py-3 px-3 text-right">
                                  <a
                                    href={`${ETHERSCAN_BASE}/tx/${tx.hash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-amber-400 transition-colors"
                                  >
                                    Etherscan <ExternalLink className="w-3 h-3" />
                                  </a>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Activity Tab ── */}
                  <TabsContent value="markets" className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-300">Network Activity</h3>
                      <p className="text-xs text-zinc-500">Live stream from your Yellow session and tx pipeline</p>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                      <div className="xl:col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                        {logs.length === 0 ? (
                          <div className="h-full min-h-52 flex items-center justify-center text-center">
                            <p className="text-sm text-zinc-500">
                              No network logs yet. Run an operation to populate activity.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                            {logs.slice(-25).reverse().map((entry) => (
                              <div
                                key={entry.id}
                                className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    className={`text-[11px] font-mono ${
                                      entry.level === "error"
                                        ? "text-red-400"
                                        : entry.level === "warn"
                                          ? "text-amber-400"
                                          : "text-emerald-400"
                                    }`}
                                  >
                                    {entry.level.toUpperCase()}
                                  </span>
                                  <span className="text-[11px] text-zinc-500">
                                    {new Date(entry.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                                <p className="text-xs text-zinc-300 mt-1 break-words">{entry.message}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                          <h4 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                            Transaction Health
                          </h4>
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                              <span className="text-xs text-zinc-500">Confirmed</span>
                              <span className="font-mono text-sm text-emerald-400">{confirmedTxCount}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                              <span className="text-xs text-zinc-500">Pending</span>
                              <span className="font-mono text-sm text-amber-400">{pendingTxCount}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                              <span className="text-xs text-zinc-500">Open channels</span>
                              <span className="font-mono text-sm text-zinc-200">{openChannels.length}</span>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                          <h4 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase mb-3">
                            Route
                          </h4>
                          <LocationMap
                            location="Settlement Corridor"
                            coordinates={`${openChannels.length} open channel(s) · ${pendingTxCount} pending tx`}
                          />
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </GlowCard>
            </motion.div>
          )}

          {(isConnected || primaryWallet?.address) && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <GlowCard className="p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="text-sm font-semibold text-zinc-300">Workflow Progress</p>
                  <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                    Step {currentStep + 1}/{TIMELINE_STEPS.length}
                  </Badge>
                </div>
                <Progress value={(currentStep / (TIMELINE_STEPS.length - 1)) * 100} className="h-1.5 mb-4" />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-2">
                  {TIMELINE_STEPS.map((step, i) => {
                    const isComplete = currentStep > i;
                    const isActive = currentStep === i;
                    const Icon = step.icon;
                    return (
                      <motion.div
                        key={step.label}
                        initial={{ opacity: 0.5, y: 8 }}
                        animate={{
                          opacity: isComplete || isActive ? 1 : 0.5,
                          y: 0,
                        }}
                        transition={{ duration: 0.25, delay: i * 0.03 }}
                        className={`rounded-lg border p-2 text-center ${
                          isComplete
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : isActive
                              ? "border-amber-500/40 bg-amber-500/10"
                              : "border-zinc-800 bg-zinc-900/40"
                        }`}
                      >
                        <div className="mx-auto w-7 h-7 rounded-md flex items-center justify-center mb-1 bg-black/30">
                          {isComplete ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Icon className="w-3.5 h-3.5 text-zinc-400" />}
                        </div>
                        <p className="text-[10px] leading-tight text-zinc-400">{step.label}</p>
                      </motion.div>
                    );
                  })}
                </div>
              </GlowCard>
            </motion.div>
          )}

          {/* ── Network Config ── */}
          {networkConfig && (
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <GlowCard className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Info className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-semibold text-zinc-400">Network Configuration</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <span className="text-zinc-500">Custody Contract</span>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="font-mono text-zinc-300">{formatAddress(networkConfig.custody)}</span>
                      <CopyButton text={networkConfig.custody} />
                    </div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <span className="text-zinc-500">Adjudicator</span>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="font-mono text-zinc-300">{formatAddress(networkConfig.adjudicator)}</span>
                      <CopyButton text={networkConfig.adjudicator} />
                    </div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <span className="text-zinc-500">WebSocket</span>
                    <p className="font-mono text-zinc-300 mt-1 break-all">{networkConfig.wsUrl}</p>
                  </div>
                </div>
              </GlowCard>
            </motion.div>
          )}
        </main>

        {/* ── Sticky Debug Log Footer Tray ── */}
        <div className="fixed bottom-0 left-0 right-0 z-50">
          <div className="bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800">
            {/* Minimized bar */}
            <button
              onClick={() => setLogExpanded(!logExpanded)}
              className="w-full px-4 py-2 flex items-center justify-between text-left hover:bg-zinc-900/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-medium text-zinc-400">Debug Log</span>
                <Badge variant="outline" className="border-zinc-700 text-zinc-500 text-[10px] px-1.5 py-0">
                  {logs.length}
                </Badge>
                {logs.some(l => l.level === "error") && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                )}
                {logs.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setLogs([]); }}
                    className="text-[10px] text-zinc-600 hover:text-zinc-300 ml-1 px-1.5 py-0.5 rounded border border-zinc-800 hover:border-zinc-600"
                  >
                    Clear
                  </button>
                )}
              </div>
              {logExpanded
                ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                : <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
              }
            </button>

            {/* Expanded log panel */}
            <AnimatePresence>
              {logExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-3">
                    <div className="bg-black/60 rounded-lg border border-zinc-800 p-3 max-h-[35vh] overflow-y-auto font-mono text-xs space-y-1">
                      {logs.length === 0 ? (
                        <p className="text-zinc-600">No log entries yet. Connect to Yellow Network to start.</p>
                      ) : (
                        logs.map((entry) => {
                          const txMatch = entry.message?.match(/TX:\s*(0x[a-fA-F0-9]{64})/);
                          return (
                            <div
                              key={entry.id}
                              className={`flex gap-2 ${entry.level === "error" ? "bg-red-500/5 rounded px-1 -mx-1" : ""}`}
                            >
                              <span className="text-zinc-600 shrink-0">
                                {new Date(entry.timestamp).toLocaleTimeString()}
                              </span>
                              <span className={`shrink-0 ${entry.level === "error" ? "text-red-400" :
                                  entry.level === "warn" ? "text-amber-400" : "text-green-400"
                                }`}>
                                [{entry.level.toUpperCase()}]
                              </span>
                              <span className="text-zinc-300 break-all">
                                {txMatch ? (
                                  <>
                                    {entry.message.split(txMatch[0])[0]}
                                    <a
                                      href={`${ETHERSCAN_BASE}/tx/${txMatch[1]}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-amber-400 hover:text-amber-300 underline"
                                    >
                                      TX: {txMatch[1].slice(0, 8)}…
                                    </a>
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
          </div>
        </div>

        <Footer />
      </div>
  );
}
