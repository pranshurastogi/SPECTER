import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { Card } from "@/components/ui/base/card";
import { Badge } from "@/components/ui/base/badge";
import { Tabs, TabsContent } from "@/components/ui/base/tabs";
import { Progress } from "@/components/ui/base/progress";
import { YellowEnvToggleButton } from "@/components/ui/yellow-env-toggle-button";
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
  ShieldCheck,
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
  Globe,
  Flame,
  BadgeDollarSign,
  CircleDollarSign,
} from "lucide-react";
import { toast } from "@/components/ui/base/sonner";
import { FinancialDashboard } from "@/components/ui/specialized/financial-dashboard";
import { CopyButton } from "@/components/ui/specialized/copy-button";
import { HeadingScramble } from "@/components/ui/animations/heading-scramble";
import { formatAddress } from "@/lib/utils";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import {
  YellowClient,
  YellowConnectionStatus,
  type YellowEvent,
  type ChannelInfo,
  type LedgerBalance,
  type LogLevel,
  type YellowConnectOptions,
} from "@/lib/yellow/yellowClient";
import {
  fetchTokenBalance,
  isLowBalance,
  SANDBOX_FAUCETS,
  getPublicClientForChain,
  getPrimaryAssetInfo,
  getFaucetUrl,
  getNativeCurrencyInfo,
  type TokenBalance,
} from "@/lib/yellow/yellowBalances";
import {
  type YellowEnvironment,
  type YellowNetworkConfig,
  getYellowConfig,
  getNetworkConfig,
  getDefaultChainId,
  getExplorerTxUrl,
  getSupportedChainIds,
  getPrimaryAsset,
} from "@/lib/yellow/yellowConfig";
import { formatYtest } from "@/hooks/useYellow";
import { LocationMap } from "@/components/ui/specialized/expand-map";
import { LimelightNav, type NavItem } from "@/components/ui/specialized/limelight-nav";
import AnimatedShaderHero from "@/components/ui/animations/animated-shader-hero";
import type { Address } from "viem";
import { parseUnits, createWalletClient, custom, http } from "viem";
import { sepolia, base, mainnet, polygon, bsc, linea, baseSepolia, polygonAmoy } from "viem/chains";

// ── Constants ────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const PANEL_TABS = ["overview", "channels", "operations", "activity"] as const;

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

function isUserRejectedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as any;
  const code = anyErr?.code ?? anyErr?.error?.code;
  const name = String(anyErr?.name ?? "").toLowerCase();
  const msg = String(
    anyErr?.message ?? anyErr?.shortMessage ?? anyErr?.cause?.message ?? ""
  ).toLowerCase();

  if (code === 4001) return true; // EIP-1193 user rejected request
  if (name.includes("userrejected") || name.includes("rejectedrequest")) return true;
  if (msg.includes("user rejected") || msg.includes("user denied")) return true;
  return false;
}

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
  /** Yellow environment at time of submission (for persistence/backfill) */
  environment?: YellowEnvironment;
  /** Chain ID at time of submission (for persistence/backfill) */
  chainId?: number;
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

  // Environment toggle: true = sandbox (testnet), false = production (mainnet)
  const [isSandbox, setIsSandbox] = useState(true);

  // Selected chain for Yellow Network operations
  const [selectedChainId, setSelectedChainId] = useState<number>(11155111); // Default: Sepolia

  // Derive environment and config from toggle
  const yellowEnvironment: YellowEnvironment = isSandbox ? "sandbox" : "production";
  const envConfig = useMemo(() => getYellowConfig(yellowEnvironment), [yellowEnvironment]);
  const currentNetworkConfig = useMemo(
    () => getNetworkConfig(yellowEnvironment, selectedChainId),
    [yellowEnvironment, selectedChainId]
  );
  const primaryAssetSymbol = useMemo(() => getPrimaryAsset(yellowEnvironment), [yellowEnvironment]);

  // Update selected chain when environment changes - always set to default for new environment
  const prevEnvironmentRef = useRef(yellowEnvironment);
  useEffect(() => {
    if (prevEnvironmentRef.current !== yellowEnvironment) {
      // Environment changed - set to default chain for new environment
      const defaultChain = getDefaultChainId(yellowEnvironment);
      setSelectedChainId(defaultChain);
      prevEnvironmentRef.current = yellowEnvironment;
    }
  }, [yellowEnvironment]);

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
  const [tokenBalance, setTokenBalance] = useState<TokenBalance | null>(null);
  const [primaryTokenAddress, setPrimaryTokenAddress] = useState<Address>(ZERO_ADDRESS);

  // Transactions
  const [transactions, setTransactions] = useState<TxEntry[]>([]);
  const txStorageKey = useMemo(() => {
    const wallet = (primaryWallet?.address ?? "").toLowerCase();
    return `specter.yellow.txs.${wallet}.${yellowEnvironment}.${selectedChainId}`;
  }, [primaryWallet?.address, yellowEnvironment, selectedChainId]);

  // Load persisted transactions on wallet/env/chain change
  useEffect(() => {
    if (!primaryWallet?.address) {
      setTransactions([]);
      return;
    }
    try {
      const raw = localStorage.getItem(txStorageKey);
      if (!raw) {
        setTransactions([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setTransactions([]);
        return;
      }
      const hydrated: TxEntry[] = parsed
        .filter((t) => t && typeof t.hash === "string" && typeof t.label === "string")
        .map((t) => ({
          id: String(t.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
          timestamp: Number(t.timestamp ?? Date.now()),
          label: String(t.label),
          hash: String(t.hash),
          status: (t.status === "confirmed" || t.status === "failed" || t.status === "pending") ? t.status : "pending",
          environment: (t.environment === "sandbox" || t.environment === "production") ? t.environment : yellowEnvironment,
          chainId: typeof t.chainId === "number" ? t.chainId : selectedChainId,
        }))
        .slice(0, 50);
      setTransactions(hydrated);
    } catch {
      setTransactions([]);
    }
  }, [primaryWallet?.address, txStorageKey, yellowEnvironment, selectedChainId]);

  // Persist transactions for durability across reloads
  useEffect(() => {
    if (!primaryWallet?.address) return;
    try {
      localStorage.setItem(txStorageKey, JSON.stringify(transactions.slice(0, 50)));
    } catch {
      // ignore storage errors (quota, privacy mode)
    }
  }, [transactions, txStorageKey, primaryWallet?.address]);

  const updateTxStatusByHash = useCallback((hash: string, status: TxEntry["status"]) => {
    setTransactions((prev) =>
      prev.map((t) => (t.hash.toLowerCase() === hash.toLowerCase() ? { ...t, status } : t))
    );
  }, []);

  const checkPendingReceipts = useCallback(async () => {
    // Only check for the currently selected env/chain list (storage is per env/chain)
    const client = getPublicClientForChain(yellowEnvironment, selectedChainId);
    const pending = transactions.filter((t) => t.status === "pending");
    if (pending.length === 0) return;

    await Promise.all(
      pending.map(async (t) => {
        try {
          const receipt = await client.getTransactionReceipt({ hash: t.hash as any });
          const ok = (receipt as any)?.status === "success";
          updateTxStatusByHash(t.hash, ok ? "confirmed" : "failed");
        } catch (err: any) {
          // Not mined yet -> viem throws. Keep as pending.
          const msg = String(err?.message ?? "");
          if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("transaction receipt")) return;
        }
      })
    );
  }, [transactions, yellowEnvironment, selectedChainId, updateTxStatusByHash]);

  // Poll pending receipts (survives reloads because tx list is persisted)
  useEffect(() => {
    if (!primaryWallet?.address) return;
    if (transactions.every((t) => t.status !== "pending")) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await checkPendingReceipts();
    };
    void tick();
    const id = window.setInterval(() => { void tick(); }, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [primaryWallet?.address, transactions, checkPendingReceipts]);

  const addTx = useCallback((label: string, hash: string) => {
    const entry: TxEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      label,
      hash,
      status: "pending",
      environment: yellowEnvironment,
      chainId: selectedChainId,
    };
    setTransactions((prev) => [entry, ...prev].slice(0, 50));
  }, [yellowEnvironment, selectedChainId]);

  // Forms
  const [depositAmount, setDepositAmount] = useState("10");
  const [resizeChannelId, setResizeChannelId] = useState("");
  const [resizeAmount, setResizeAmount] = useState("10");
  const [transferDest, setTransferDest] = useState("");
  const [transferAmount, setTransferAmount] = useState("1");
  const [transferAsset, setTransferAsset] = useState(primaryAssetSymbol);
  const [closeChannelId, setCloseChannelId] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("1");

  // Update transfer asset when environment changes
  useEffect(() => {
    setTransferAsset(primaryAssetSymbol);
  }, [primaryAssetSymbol]);

  // Custody balance
  const [custodyBalance, setCustodyBalance] = useState<bigint | null>(null);

  // Loading states
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isClosingAll, setIsClosingAll] = useState(false);
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
  const [networkConfigDisplay, setNetworkConfigDisplay] = useState<{
    custody: string;
    adjudicator: string;
    wsUrl: string;
    chainName: string;
    blockExplorer: string;
  } | null>(null);

  // Active panel tab
  const [activeTab, setActiveTab] = useState("overview");
  const [expandedQuickAction, setExpandedQuickAction] = useState<number | null>(null);

  // Helper to get explorer URL for transaction
  const getExplorerUrl = useCallback(
    (txHash: string) => {
      if (currentNetworkConfig) {
        return `${currentNetworkConfig.blockExplorer}/tx/${txHash}`;
      }
      return `https://etherscan.io/tx/${txHash}`;
    },
    [currentNetworkConfig]
  );

  // ── Balance polling ────────────────────────────────────────────────────────

  const fetchWalletBalances = useCallback(async () => {
    if (!primaryWallet?.address) return;
    const addr = primaryWallet.address as Address;
    const client = getPublicClientForChain(yellowEnvironment, selectedChainId);
    const nativeCurrency = getNativeCurrencyInfo(selectedChainId);

    try {
      const eth = await fetchTokenBalance(ZERO_ADDRESS, addr, nativeCurrency.decimals, nativeCurrency.symbol, client);
      setEthBalance(eth);
    } catch (err) {
      console.warn("[Yellow] Native balance fetch failed:", err);
    }

    // Fetch primary token balance
    const primaryAsset = getPrimaryAssetInfo(yellowEnvironment, selectedChainId);
    if (primaryAsset && primaryAsset.address !== ZERO_ADDRESS) {
      try {
        const tokenBal = await fetchTokenBalance(
          primaryAsset.address,
          addr,
          primaryAsset.decimals,
          primaryAsset.symbol,
          client
        );
        setTokenBalance(tokenBal);
        setPrimaryTokenAddress(primaryAsset.address);
      } catch (err) {
        console.warn("[Yellow] Token balance fetch failed:", err);
      }
    }
  }, [primaryWallet?.address, yellowEnvironment, selectedChainId]);

  useEffect(() => {
    fetchWalletBalances();
    const interval = setInterval(fetchWalletBalances, 30000);
    return () => clearInterval(interval);
  }, [fetchWalletBalances]);

  // ── Faucet request (Sandbox only) ─────────────────────────────────────────

  const faucetUrl = useMemo(
    () => getFaucetUrl(yellowEnvironment, selectedChainId, "token"),
    [yellowEnvironment, selectedChainId]
  );

  const handleRequestFaucet = useCallback(async () => {
    if (!primaryWallet?.address) {
      toast.error("Connect wallet first");
      return;
    }

    if (yellowEnvironment === "production") {
      toast.info("Faucet is only available in Sandbox mode");
      return;
    }

    setIsRequestingFaucet(true);
    try {
      const response = await fetch(SANDBOX_FAUCETS.YTEST_USD, {
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
  }, [primaryWallet?.address, fetchWalletBalances, yellowEnvironment]);

  // ── Unified sync helpers ──────────────────────────────────────────────────

  const syncYellowOnce = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      await client.getLedgerBalances();
      await client.getChannels();
      // Fetch custody balance
      const custBal = await client.getCustodyBalance(primaryTokenAddress);
      setCustodyBalance(custBal);
      fetchWalletBalances();
    } catch {
      // Errors are already surfaced via events/logs
    }
  }, [fetchWalletBalances, primaryTokenAddress]);

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

    const primaryAsset = getPrimaryAssetInfo(yellowEnvironment, selectedChainId);
    const tokenDecimals = primaryAsset?.decimals ?? 6;
    const amountWei = parseUnits(depositAmount, tokenDecimals);

    setIsDepositing(true);
    try {
      toast.info("Depositing to custody contract...");
      const { txHash } = await client.deposit(primaryTokenAddress, amountWei);
      addTx(`Deposit ${depositAmount} ${primaryAssetSymbol}`, txHash);
      toast.success(`Deposited ${depositAmount} ${primaryAssetSymbol} to custody!`);

      void pollYellowAfterTx(2, 4000);
      setTimeout(async () => {
        if (clientRef.current) {
          const bal = await clientRef.current.getCustodyBalance(primaryTokenAddress);
          setCustodyBalance(bal);
        }
      }, 5000);
    } catch (err: any) {
      const msg = err?.message ?? "Unknown error";
      toast.error(`Deposit failed: ${msg.slice(0, 100)}`, { duration: 8000 });
    } finally {
      setIsDepositing(false);
    }
  }, [depositAmount, primaryTokenAddress, primaryAssetSymbol, yellowEnvironment, selectedChainId, addTx, pollYellowAfterTx]);

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
      // Update network config display from server response
      const net = event.config.networks?.find((n) => n.chainId === selectedChainId);
      if (net) {
        setNetworkConfigDisplay({
          custody: net.custodyAddress,
          adjudicator: net.adjudicatorAddress,
          wsUrl: envConfig.wsUrl,
          chainName: currentNetworkConfig?.chainName ?? "Unknown",
          blockExplorer: currentNetworkConfig?.blockExplorer ?? "",
        });
      }
      // Update primary token address from server assets
      const chainAsset = event.config.assets?.find((a) => a.chainId === selectedChainId);
      if (chainAsset?.token) {
        setPrimaryTokenAddress(chainAsset.token as Address);
      }
    }
  }, [selectedChainId, envConfig.wsUrl, currentNetworkConfig]);

  // Update network config display when environment/chain changes
  useEffect(() => {
    if (currentNetworkConfig) {
      setNetworkConfigDisplay({
        custody: currentNetworkConfig.custody,
        adjudicator: currentNetworkConfig.adjudicator,
        wsUrl: envConfig.wsUrl,
        chainName: currentNetworkConfig.chainName,
        blockExplorer: currentNetworkConfig.blockExplorer,
      });
    }
  }, [currentNetworkConfig, envConfig.wsUrl]);

  // Update step when wallet connects
  useEffect(() => {
    if (primaryWallet?.address && currentStep === 0) setCurrentStep(1);
  }, [primaryWallet?.address, currentStep]);

  // ── Get Viem Chain for selected chain ID ────────────────────────────────────

  const getViemChainForId = useCallback((chainId: number) => {
    const chainMap = {
      1: mainnet,
      11155111: sepolia,
      8453: base,
      84532: baseSepolia,
      137: polygon,
      80002: polygonAmoy,
      56: bsc,
      59144: linea,
    } as const;
    return chainMap[chainId as keyof typeof chainMap] ?? mainnet;
  }, []);

  // ── Connect & Auth ─────────────────────────────────────────────────────────

  const handleConnectAndAuth = useCallback(async () => {
    if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
      toast.error("Please connect an Ethereum wallet first");
      return;
    }

    if (!currentNetworkConfig) {
      toast.error(`Chain ${selectedChainId} is not supported in ${yellowEnvironment} mode`);
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

      // Switch wallet to the correct chain using Dynamic Labs API
      try {
        toast.info(`Switching wallet to ${currentNetworkConfig.chainName}...`, { duration: 3000 });
        // Try multiple methods to switch network
        if ((primaryWallet as any).switchNetwork) {
          await (primaryWallet as any).switchNetwork(selectedChainId);
        } else if ((primaryWallet as any).connector?.switchNetwork) {
          await (primaryWallet as any).connector.switchNetwork({ networkChainId: selectedChainId });
        } else {
          // Request chain switch via wallet client
          const tempClient = await (primaryWallet as any).getWalletClient();
          if (tempClient?.switchChain) {
            await tempClient.switchChain({ id: selectedChainId });
          }
        }
        // Small delay to let the wallet switch complete
        await new Promise(r => setTimeout(r, 500));
      } catch (switchErr: any) {
        console.warn("Chain switch warning:", switchErr);
        // If user rejected, don't proceed
        if (switchErr?.code === 4001 || switchErr?.message?.includes("rejected")) {
          throw new Error(`Please switch your wallet to ${currentNetworkConfig.chainName} to continue.`);
        }
        // For other errors (like chain not added), try to continue
        toast.warning(
          `Could not auto-switch to ${currentNetworkConfig.chainName}. ` +
          `Please manually switch your wallet to this network.`,
          { duration: 5000 }
        );
      }

      // Get wallet client for the selected Yellow chain
      const walletClient = await (primaryWallet as any).getWalletClient(
        selectedChainId.toString()
      );
      if (!walletClient) {
        throw new Error(
          `Failed to get wallet client for chain ${selectedChainId}. ` +
          `Make sure your wallet supports ${currentNetworkConfig.chainName} and is connected to it.`
        );
      }

      // Verify we're on the correct chain
      const walletChainId = walletClient.chain?.id;
      if (walletChainId && walletChainId !== selectedChainId) {
        // One more attempt: try to switch via the wallet client directly
        try {
          if (walletClient.switchChain) {
            await walletClient.switchChain({ id: selectedChainId });
            await new Promise(r => setTimeout(r, 300));
          }
        } catch {
          // Ignore errors from this fallback attempt
        }
        
        // Re-check
        const recheckClient = await (primaryWallet as any).getWalletClient(selectedChainId.toString());
        if (recheckClient?.chain?.id !== selectedChainId) {
          throw new Error(
            `Wallet is on chain ${walletChainId} but Yellow requires ${currentNetworkConfig.chainName} (${selectedChainId}). ` +
            `Please manually switch your wallet to ${currentNetworkConfig.chainName} and try again.`
          );
        }
      }

      const connectOptions: YellowConnectOptions = {
        environment: yellowEnvironment,
        chainId: selectedChainId,
      };

      setCurrentStep(2);
      toast.info(
        `Connecting to Yellow ${yellowEnvironment === "production" ? "Mainnet" : "Sandbox"} on ${currentNetworkConfig.chainName}. ` +
        "Sign the EIP-712 message when prompted.",
        { duration: 8000 }
      );
      await client.connect(walletClient, connectOptions);

      setYellowAddress(client.getConnectedAddress());
      setCurrentStep(3);

      await syncYellowOnce();

      toast.success("✓ Connected to Yellow Network!");
      setActiveTab("operations");
    } catch (err: any) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      setYellowAddress(null);
      setConnectionStatus(YellowConnectionStatus.Disconnected);

      const msg = err?.message ?? "Connection failed";
      const lowerMsg = msg.toLowerCase();
      if (isUserRejectedError(err)) {
        toast.error(
          "Signature rejected — open your wallet (or browser popup tray) and approve the sign request, then try again."
        );
      } else if (lowerMsg.includes("timeout")) {
        toast.error(
          "Connection timed out — check your internet, ensure the Yellow WebSocket URL is reachable, then try again."
        );
      } else if (lowerMsg.includes("parse")) {
        toast.error(
          "Server rejected auth. If this persists, wait 60s and try again.",
          { duration: 8000 }
        );
      } else if (lowerMsg.includes("websocket connection failed")) {
        toast.error(
          "Could not reach Yellow Network — check that your VPN or firewall is not blocking WebSocket connections."
        );
      } else {
        toast.error(`Connection failed: ${msg}`, { duration: 6000 });
      }
      setCurrentStep(1);
    } finally {
      setIsConnecting(false);
    }
  }, [primaryWallet, handleYellowEvent, syncYellowOnce, selectedChainId, yellowEnvironment, currentNetworkConfig]);

  // Disconnect when environment or chain changes while connected
  useEffect(() => {
    const client = clientRef.current;
    if (client && client.getStatus() === YellowConnectionStatus.Connected) {
      const connectedEnv = client.getEnvironment();
      const connectedChain = client.getChainId();
      if (connectedEnv !== yellowEnvironment || connectedChain !== selectedChainId) {
        client.disconnect();
        clientRef.current = null;
        setYellowAddress(null);
        setChannels([]);
        setLedgerBalances([]);
        toast.info(
          `Disconnected from ${connectedEnv === "production" ? "Mainnet" : "Sandbox"}. ` +
          `Reconnect to use ${yellowEnvironment === "production" ? "Mainnet" : "Sandbox"}.`
        );
      }
    }
  }, [yellowEnvironment, selectedChainId]);

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

    const nativeCurrency = getNativeCurrencyInfo(selectedChainId);
    if (ethBalance && isLowBalance(ethBalance.formatted, 18, 0.005)) {
      toast.error(
        isSandbox 
          ? `Insufficient ${nativeCurrency.symbol} for gas. Get ${nativeCurrency.symbol} from a faucet first.`
          : `Insufficient ${nativeCurrency.symbol} for gas. Please add ${nativeCurrency.symbol} to your wallet.`, 
        { duration: 6000 }
      );
      return;
    }

    setIsCreating(true);
    try {
      toast.info("Creating channel on-chain… this may take 30–60 seconds", { duration: 10000 });
      const result = await client.createChannel(primaryTokenAddress, 0n);
      addTx("Create Channel", result.txHash);
      toast.success(`Channel created! TX: ${result.txHash.slice(0, 10)}...`);
      setCurrentStep(Math.max(currentStep, 4));
      setActiveTab("operations");
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
  }, [primaryTokenAddress, currentStep, ethBalance, selectedChainId, addTx, pollYellowAfterTx]);

  // ── Resize Channel ─────────────────────────────────────────────────────────

  const handleResizeChannel = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { toast.error("Not connected"); return; }
    if (!resizeChannelId) { toast.error("Select a channel to resize"); return; }
    if (!resizeAmount || parseFloat(resizeAmount) <= 0) {
      toast.error("Enter a valid allocation amount");
      return;
    }

    const primaryAsset = getPrimaryAssetInfo(yellowEnvironment, selectedChainId);
    const tokenDecimals = primaryAsset?.decimals ?? 6;

    setResizeError(null);
    setIsResizing(true);
    try {
      const amount = parseUnits(resizeAmount, tokenDecimals);
      toast.info("Allocating funds from Unified Balance…", { duration: 8000 });
      const result = await client.resizeChannel(resizeChannelId as `0x${string}`, amount);
      addTx(`Resize Channel ${resizeAmount} ${primaryAssetSymbol}`, result.txHash);
      toast.success(`Channel funded! TX: ${result.txHash.slice(0, 10)}...`);
      setCurrentStep(Math.max(currentStep, 5));
      setActiveTab("operations");
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
        toast.error(`Not enough ${primaryAssetSymbol} in your Unified Balance.`, { duration: 6000 });
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
  }, [resizeChannelId, resizeAmount, currentStep, primaryAssetSymbol, yellowEnvironment, selectedChainId, addTx, pollYellowAfterTx]);

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
      const humanAmount = parseFloat(transferAmount);
      if (Number.isNaN(humanAmount) || humanAmount <= 0) {
        throw new Error("Invalid transfer amount");
      }
      // Get decimals for the asset (USDC/ytest.usd = 6 decimals)
      const primaryAsset = getPrimaryAssetInfo(yellowEnvironment, selectedChainId);
      const tokenDecimals = primaryAsset?.decimals ?? 6;
      const multiplier = 10 ** tokenDecimals;
      const rawUnits = BigInt(Math.floor(humanAmount * multiplier));
      await client.transfer(transferDest as Address, [
        { asset: transferAsset, amount: rawUnits.toString() },
      ]);
      toast.success(`Transferred ${transferAmount} ${transferAsset} (off-chain, instant!)`);
      setCurrentStep(Math.max(currentStep, 6));
      await client.getLedgerBalances();
    } catch (err: any) {
      toast.error(`Transfer failed: ${err?.message ?? "Unknown error"}`, { duration: 6000 });
    } finally {
      setIsTransferring(false);
    }
  }, [transferDest, transferAmount, transferAsset, currentStep, yellowEnvironment, selectedChainId]);

  // ── Close Channel ──────────────────────────────────────────────────────────

  const handleCloseChannel = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { toast.error("Not connected"); return; }
    if (!closeChannelId) { toast.error("Select a channel to close"); return; }

    const nativeCurrency = getNativeCurrencyInfo(selectedChainId);
    if (ethBalance && isLowBalance(ethBalance.formatted, 18, 0.005)) {
      toast.error(`Insufficient ${nativeCurrency.symbol} for gas.`, { duration: 6000 });
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
      setActiveTab("operations");
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
  }, [closeChannelId, currentStep, ethBalance, selectedChainId, addTx, pollYellowAfterTx]);

  // ── Close All Channels ────────────────────────────────────────────────────

  const handleCloseAllChannels = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { toast.error("Not connected"); return; }

    const toClose = channels.filter(
      (c) => c.channelId && c.status.toLowerCase() === "open"
    );
    if (toClose.length === 0) {
      toast.info("No open channels to close");
      return;
    }

    const nativeCurrency = getNativeCurrencyInfo(selectedChainId);
    if (ethBalance && isLowBalance(ethBalance.formatted, 18, 0.005)) {
      toast.error(`Insufficient ${nativeCurrency.symbol} for gas.`, { duration: 6000 });
      return;
    }

    setIsClosingAll(true);
    let closed = 0;
    let failed = 0;
    for (const ch of toClose) {
      try {
        toast.info(`Closing ${ch.channelId.slice(0, 8)}…`, { duration: 5000 });
        const result = await client.closeChannel(ch.channelId as `0x${string}`);
        addTx(`Close Channel ${ch.channelId.slice(0, 8)}…`, result.txHash);
        closed++;
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err: any) {
        failed++;
        toast.error(`Failed to close ${ch.channelId.slice(0, 8)}…: ${(err?.message ?? "").slice(0, 80)}`);
      }
    }
    toast.success(`Closed ${closed} channel(s)${failed > 0 ? `, ${failed} failed` : ""}`);
    setCurrentStep(Math.max(currentStep, 7));
    void pollYellowAfterTx();
    setIsClosingAll(false);
  }, [channels, currentStep, ethBalance, selectedChainId, addTx, pollYellowAfterTx]);

  // ── Withdraw ───────────────────────────────────────────────────────────────

  const handleWithdraw = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { toast.error("Not connected"); return; }
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      toast.error("Enter a valid withdrawal amount");
      return;
    }

    const nativeCurrency = getNativeCurrencyInfo(selectedChainId);
    if (ethBalance && isLowBalance(ethBalance.formatted, 18, 0.005)) {
      toast.error(`Insufficient ${nativeCurrency.symbol} for gas.`, { duration: 6000 });
      return;
    }

    const primaryAsset = getPrimaryAssetInfo(yellowEnvironment, selectedChainId);
    const tokenDecimals = primaryAsset?.decimals ?? 6;

    setIsWithdrawing(true);
    try {
      const amount = parseUnits(withdrawAmount, tokenDecimals);
      toast.info("Withdrawing from custody contract…", { duration: 8000 });
      const result = await client.withdraw(primaryTokenAddress, amount);
      addTx(`Withdraw ${withdrawAmount} ${primaryAssetSymbol}`, result.txHash);
      toast.success(`Withdrawn! TX: ${result.txHash.slice(0, 10)}...`);
      setCurrentStep(8);
      void pollYellowAfterTx();
    } catch (err: any) {
      toast.error(`Withdrawal failed: ${err?.message ?? "Unknown error"}`, { duration: 6000 });
    } finally {
      setIsWithdrawing(false);
    }
  }, [withdrawAmount, primaryTokenAddress, primaryAssetSymbol, yellowEnvironment, selectedChainId, ethBalance, addTx, pollYellowAfterTx]);

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
    try {
      resetYellowState(true);
      setCurrentStep(primaryWallet?.address ? 1 : 0);
      toast.info("Disconnected from SPECTER YELLOW");
    } catch (err: any) {
      toast.error(`Disconnect failed: ${err?.message ?? "Unknown error"}`);
    }
  }, [primaryWallet?.address, resetYellowState]);

  const handleFullDisconnect = useCallback(() => {
    try {
      resetYellowState();
      setCurrentStep(0);
      setEthBalance(null);
      setTokenBalance(null);
      handleLogOut();
      toast.info("Wallet disconnected");
    } catch (err: any) {
      toast.error(`Wallet disconnect failed: ${err?.message ?? "Unknown error"}`);
    }
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
      setTokenBalance(null);
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
  const hasOpenChannels = openChannels.length > 0;
  const needsETH = ethBalance !== null && isLowBalance(ethBalance.formatted, 18, 0.005);
  const totalLedgerBalance = ledgerBalances.reduce((sum, b) => sum + parseFloat(b.amount || "0"), 0);
  const unifiedBalanceHuman = totalLedgerBalance > 0 ? totalLedgerBalance / 1_000_000 : 0;
  const hasUnifiedBalance = totalLedgerBalance > 0;
  const hasCustodyBalance = custodyBalance !== null && custodyBalance > 0n;
  const confirmedTxCount = transactions.filter((tx) => tx.status === "confirmed").length;
  const pendingTxCount = transactions.filter((tx) => tx.status === "pending").length;
  const walletTokenNum = tokenBalance ? parseFloat(tokenBalance.formatted) : 0;
  const custodyNum = custodyBalance !== null ? Number(custodyBalance) / 1e6 : 0;

  // Supported chains for current environment
  const supportedChains = useMemo(() => {
    return envConfig.networks.map((n) => ({
      id: n.chainId,
      name: n.chainName,
    }));
  }, [envConfig]);
  const opInputClass = "bg-zinc-900/95 border-zinc-700/80 text-zinc-100 placeholder:text-zinc-500 transition-all duration-200 focus-visible:border-amber-400/70 focus-visible:ring-2 focus-visible:ring-amber-500/25 focus-visible:shadow-[0_0_0_3px_rgba(245,158,11,0.08)]";
  const opSelectClass = "w-full bg-zinc-900/95 border border-zinc-700/80 rounded-md p-2 text-sm text-zinc-100 transition-all duration-200 focus-visible:outline-none focus-visible:border-amber-400/70 focus-visible:ring-2 focus-visible:ring-amber-500/25";
  const opButtonClass = "w-full transition-all duration-200 hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)] hover:-translate-y-[1px] active:translate-y-0";
  const activeTabIndex = Math.max(
    0,
    PANEL_TABS.indexOf(activeTab as (typeof PANEL_TABS)[number])
  );
  const tabNavItems: NavItem[] = [
    { id: "overview", icon: <Activity />, label: "Overview" },
    { id: "channels", icon: <Network />, label: `Channels (${openChannels.length})` },
    { id: "operations", icon: <Zap />, label: "Operations" },
    { id: "activity", icon: <Terminal />, label: "Activity" },
  ];

  useEffect(() => {
    if (activeTab !== "operations" && expandedQuickAction !== null) {
      setExpandedQuickAction(null);
    }
  }, [activeTab, expandedQuickAction]);

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
                      SPECTER YELLOW
                    </HeadingScramble>
                    <p className="text-zinc-300 text-xs sm:text-sm">
                      Instant settlement rails for payments, off-chain speed, onchain security
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {/* Environment Toggle */}
                <YellowEnvToggleButton
                  isSandbox={isSandbox}
                  onToggle={() => setIsSandbox((v) => !v)}
                  disabled={isConnecting || isSyncingYellow}
                />

                {/* Chain Selector */}
                <select
                  value={selectedChainId}
                  onChange={(e) => setSelectedChainId(Number(e.target.value))}
                  className={[
                    "appearance-none bg-black/45 backdrop-blur-md",
                    "border border-zinc-700/70 rounded-xl px-4 py-2.5",
                    "text-sm text-zinc-100",
                    "shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_10px_30px_rgba(0,0,0,0.35)]",
                    "transition-all duration-300",
                    "hover:border-zinc-500/70 hover:bg-black/55",
                    "focus:outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20",
                  ].join(" ")}
                >
                  {supportedChains.map((chain) => (
                    <option key={chain.id} value={chain.id}>
                      {chain.name}
                    </option>
                  ))}
                </select>

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

        {/* ── Environment Info Banner ── */}
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <div className={`rounded-lg border p-3 flex items-center justify-between flex-wrap gap-2 ${
            isSandbox 
              ? "bg-amber-500/10 border-amber-500/30" 
              : "bg-orange-500/10 border-orange-500/30"
          }`}>
            <div className="flex items-center gap-2">
              <Badge className={isSandbox ? "bg-amber-500/20 text-amber-400" : "bg-orange-500/20 text-orange-400"}>
                {isSandbox ? (
                  <><Droplets className="w-3 h-3 mr-1" />SANDBOX</>
                ) : (
                  <><Flame className="w-3 h-3 mr-1" />MAINNET</>
                )}
              </Badge>
              <span className="text-sm text-zinc-300">
                {currentNetworkConfig?.chainName ?? "Unknown Chain"} ({selectedChainId})
              </span>
              <span className="text-xs text-zinc-500">•</span>
              <span className="text-xs text-zinc-400">
                Asset: <span className="font-mono">{primaryAssetSymbol.toUpperCase()}</span>
              </span>
            </div>
            {!isSandbox && (
              <div className="flex items-center gap-2 text-xs">
                <ShieldCheck className="w-4 h-4 text-orange-400" />
                <span className="text-orange-400 font-medium">Live Network — real {primaryAssetSymbol.toUpperCase()} on {currentNetworkConfig?.chainName}</span>
              </div>
            )}
            {isSandbox && (
              <div className="flex items-center gap-1 text-xs text-amber-400">
                <Info className="w-3 h-3" />
                <span>Test environment — use faucet for test tokens</span>
              </div>
            )}
          </div>
        </motion.div>

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
                    <span className="text-xs text-zinc-600">Connect to start using SPECTER YELLOW</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {!primaryWallet?.address && (
                  <Button
                    onClick={() => {
                      try {
                        setShowAuthFlow(true);
                      } catch (err: any) {
                        toast.error(`Could not open wallet connect: ${err?.message ?? "Unknown error"}`);
                      }
                    }}
                    className="bg-white/10 hover:bg-white/15 text-zinc-100 border border-white/10 hover:border-white/20 font-medium rounded-full px-5 h-11 transition-all"
                  >
                    Connect Wallet
                  </Button>
                )}
                {primaryWallet?.address && !isConnected && (
                  <>
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Button
                        onClick={handleConnectAndAuth}
                        disabled={isConnecting}
                        className={`font-medium relative overflow-hidden transition-all rounded-full px-5 h-11 ${
                          isSandbox 
                            ? "bg-amber-500/95 hover:bg-amber-500 text-black" 
                            : "bg-orange-500/95 hover:bg-orange-500 text-black"
                        } shadow-[0_10px_30px_rgba(0,0,0,0.35)]`}
                      >
                        {isConnecting ? (
                          <motion.div
                            className="flex items-center"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                          >
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            <span>
                              {connectionStatus === YellowConnectionStatus.WaitingForSignature
                                ? "Sign in wallet…"
                                : connectionStatus === YellowConnectionStatus.Authenticating
                                  ? "Authenticating…"
                                  : "Connecting…"}
                            </span>
                          </motion.div>
                        ) : (
                          <>Connect {isSandbox ? "Sandbox" : "Mainnet"}</>
                        )}
                      </Button>
                    </motion.div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleFullDisconnect}
                      className="text-zinc-400 hover:text-zinc-200 rounded-full"
                    >
                      Disconnect
                    </Button>
                  </>
                )}
                {isConnected && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDisconnect}
                      className="border-zinc-700/70 bg-transparent text-zinc-300 hover:text-white hover:border-zinc-500 rounded-full h-11 px-5 transition-all"
                    >
                      Disconnect Session
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleFullDisconnect}
                      className="border-zinc-700/70 bg-transparent text-zinc-300 hover:text-white hover:border-zinc-500 rounded-full h-11 px-5 transition-all"
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
                  <p className="text-sm text-amber-300 font-medium">Low {ethBalance?.symbol ?? "ETH"}</p>
                  <p className="text-xs text-zinc-400">
                    Balance: {parseFloat(ethBalance?.formatted ?? "0").toFixed(5)} {ethBalance?.symbol ?? "ETH"} — You need gas for transactions
                  </p>
                </div>
                {isSandbox && getFaucetUrl(yellowEnvironment, selectedChainId, "native") && (
                  <a
                    href={getFaucetUrl(yellowEnvironment, selectedChainId, "native") ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                  >
                    <Button variant="outline" size="sm" className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10">
                      Get {ethBalance?.symbol ?? "ETH"} <ExternalLink className="w-3 h-3 ml-1" />
                    </Button>
                  </a>
                )}
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
                      {isSandbox 
                        ? "Single source of truth for wallet, ledger, and custody. Faucet is embedded here."
                        : `Real-time view of your ${primaryAssetSymbol.toUpperCase()} across wallet, ledger, and custody on ${currentNetworkConfig?.chainName ?? "mainnet"}.`
                      }
                    </p>
                  </div>
                  <Badge 
                    variant="outline" 
                    className={isSandbox ? "border-amber-500/50 text-amber-400" : "border-orange-500/50 text-orange-400"}
                  >
                    {isSandbox ? (
                      <><Droplets className="w-3 h-3 mr-1" />Sandbox</>
                    ) : (
                      <><Globe className="w-3 h-3 mr-1" />{currentNetworkConfig?.chainName ?? "Mainnet"}</>
                    )}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">Wallet {ethBalance?.symbol ?? "ETH"}</p>
                    <p className="text-lg font-mono text-white mt-1">
                      {ethBalance ? `${parseFloat(ethBalance.formatted).toFixed(4)}` : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">Wallet {primaryAssetSymbol.toUpperCase()}</p>
                    <p className="text-lg font-mono text-white mt-1">
                      {tokenBalance ? formatYtest(tokenBalance.formatted) : "—"}
                    </p>
                  </div>
                  <div className={`rounded-xl border p-3 transition-colors ${
                    isSandbox 
                      ? "border-amber-500/30 bg-amber-500/5" 
                      : "border-orange-500/30 bg-orange-500/5"
                  }`}>
                    <p className={`text-[11px] uppercase tracking-wide ${
                      isSandbox ? "text-amber-300/80" : "text-orange-300/80"
                    }`}>Unified Balance</p>
                    <p className={`text-lg font-mono mt-1 ${
                      isSandbox ? "text-amber-200" : "text-orange-200"
                    }`}>
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

                {/* Faucet buttons - only in Sandbox mode */}
                {isSandbox ? (
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
                    {faucetUrl && (
                      <a href={faucetUrl} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-300">
                          Open {primaryAssetSymbol} faucet <ExternalLink className="w-3 h-3 ml-1" />
                        </Button>
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 p-4 rounded-lg bg-gradient-to-r from-orange-500/15 via-yellow-500/10 to-orange-600/5 border border-orange-500/40">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500/30 to-yellow-500/20 flex items-center justify-center shrink-0">
                        <CircleDollarSign className="w-5 h-5 text-orange-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-orange-400 flex items-center gap-1.5">
                          <Flame className="w-3.5 h-3.5" />
                          Live on {currentNetworkConfig?.chainName ?? "Mainnet"}
                        </p>
                        <p className="text-xs text-orange-300/80 mt-0.5">
                          Trading real {primaryAssetSymbol.toUpperCase()} — transactions are final
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </GlowCard>

            <GlowCard className={`p-5 transition-colors ${!isSandbox ? "border-orange-800/30" : ""}`}>
              <div className="relative z-10">
                <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  {isSandbox ? (
                    <Activity className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Globe className="w-4 h-4 text-orange-400" />
                  )}
                  Network Pulse
                </h3>
                <p className="text-xs text-zinc-500 mt-1">
                  {isSandbox 
                    ? "Sandbox environment — test safely with no real value at risk."
                    : `Live on ${currentNetworkConfig?.chainName ?? "Mainnet"} — real-time state channel operations.`
                  }
                </p>
                <div className="mt-4 flex justify-center">
                  <LocationMap
                    className="mb-6"
                    location={`Yellow ${isSandbox ? "Sandbox" : "Production"}`}
                    coordinates={`${currentNetworkConfig?.chainName ?? "Unknown"} · ${isSandbox ? "Test Network" : "Live Network"}`}
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
                  <div className={`rounded-xl p-5 transition-all ${
                    isSandbox 
                      ? "bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20" 
                      : "bg-gradient-to-r from-orange-500/10 via-orange-500/5 to-transparent border border-orange-500/20"
                  }`}>
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isSandbox ? "bg-amber-500/20" : "bg-orange-500/20"
                      }`}>
                        {currentStep < 4 ? (
                          <Zap className={`w-5 h-5 ${isSandbox ? "text-amber-400" : "text-orange-400"}`} />
                        ) : currentStep < 6 ? (
                          <ArrowUpRight className={`w-5 h-5 ${isSandbox ? "text-amber-400" : "text-orange-400"}`} />
                        ) : (
                          <CheckCircle2 className="w-5 h-5 text-green-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-white mb-1">
                          {currentStep < 4
                            ? "Create Your First Channel"
                            : currentStep < 5
                              ? "Fund Your Channel"
                              : currentStep < 6
                                ? "Fund Your Channel"
                                : currentStep < 7
                                  ? "Make a Transfer"
                                  : "All Steps Complete!"}
                        </h3>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          {currentStep < 4
                            ? `Open a state channel on ${currentNetworkConfig?.chainName ?? "the blockchain"} to start making instant off-chain transfers. You'll need ${getNativeCurrencyInfo(selectedChainId).symbol} for gas${isSandbox ? "" : ` and ${primaryAssetSymbol.toUpperCase()} in your wallet`}.`
                            : currentStep < 6
                              ? `Allocate funds from your Unified Balance into your open channel to enable off-chain transfers${!isSandbox ? " with real assets" : ""}.`
                              : currentStep < 7
                                ? `Send an instant, gas-free off-chain transfer to any address on Yellow Network${!isSandbox ? " — real value, instant settlement" : ""}.`
                                : `You've completed the full state channel lifecycle${!isSandbox ? " on mainnet" : ""}. You can close channels and withdraw funds.`}
                        </p>
                        {currentStep < 7 && (
                          <Button
                            onClick={() => setActiveTab("operations")}
                            size="sm"
                            className={`mt-3 font-medium transition-all ${
                              isSandbox 
                                ? "bg-amber-500 hover:bg-amber-600 text-black" 
                                : "bg-orange-500 hover:bg-orange-600 text-black"
                            }`}
                          >
                            <ArrowRight className="w-3.5 h-3.5 mr-1.5" />
                            Go to Operations
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Fund Flow Diagram */}
                  <div className={`rounded-xl border p-5 transition-colors ${
                    isSandbox 
                      ? "border-zinc-800 bg-zinc-900/30" 
                      : "border-orange-800/30 bg-orange-950/20"
                  }`}>
                    <h3 className="text-sm font-semibold text-zinc-200 mb-4 flex items-center gap-2">
                      {isSandbox ? (
                        <Coins className="w-4 h-4 text-amber-400" />
                      ) : (
                        <CircleDollarSign className="w-4 h-4 text-orange-400" />
                      )}
                      How Funds Flow
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { 
                          label: "Wallet", 
                          value: walletTokenNum > 0 ? formatYtest(walletTokenNum.toString()) : "—", 
                          sub: primaryAssetSymbol.toUpperCase(), 
                          color: "border-zinc-700", 
                          highlight: false 
                        },
                        { 
                          label: "Unified Balance", 
                          value: totalLedgerBalance > 0 ? formatYtest(totalLedgerBalance) : "—", 
                          sub: "off-chain ledger", 
                          color: isSandbox ? "border-amber-500/40" : "border-orange-500/40", 
                          highlight: totalLedgerBalance > 0 
                        },
                        { 
                          label: "Channel-Locked", 
                          value: openChannels.length > 0 ? formatYtest(openChannels.reduce((s, c) => s + parseFloat(c.amount || "0"), 0)) : "—", 
                          sub: `${openChannels.length} channel(s)`, 
                          color: "border-sky-500/40", 
                          highlight: openChannels.length > 0 
                        },
                        { 
                          label: "Custody (L1)", 
                          value: custodyNum > 0 ? formatYtest(custodyNum.toString()) : "—", 
                          sub: currentNetworkConfig?.chainName ?? "on-chain", 
                          color: "border-zinc-700", 
                          highlight: false 
                        },
                      ].map((item) => (
                        <div key={item.label} className={`rounded-lg border ${item.color} ${
                          item.highlight 
                            ? (isSandbox ? "bg-amber-500/5" : "bg-orange-500/5") 
                            : "bg-zinc-900/50"
                        } p-3 text-center`}>
                          <p className="text-[11px] uppercase tracking-wide text-zinc-500">{item.label}</p>
                          <p className={`text-lg font-mono mt-1 ${
                            item.highlight 
                              ? (isSandbox ? "text-amber-200" : "text-orange-200") 
                              : "text-white"
                          }`}>{item.value}</p>
                          <p className="text-[10px] text-zinc-600 mt-0.5">{item.sub}</p>
                        </div>
                      ))}
                    </div>
                    <div className={`flex items-center justify-center gap-1 mt-3 text-[10px] ${
                      isSandbox ? "text-zinc-600" : "text-orange-700"
                    }`}>
                      {isSandbox ? (
                        <>
                          <span>Faucet → Unified Balance</span>
                          <ArrowRight className="w-3 h-3" />
                        </>
                      ) : (
                        <>
                          <span>Wallet → Deposit → Unified Balance</span>
                          <ArrowRight className="w-3 h-3" />
                        </>
                      )}
                      <span>Fund → Channel</span>
                      <ArrowRight className="w-3 h-3" />
                      <span>Transfer (instant)</span>
                      <ArrowRight className="w-3 h-3" />
                      <span>Close → Withdraw</span>
                    </div>
                  </div>

                  {/* Channel Status + Quick Actions */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Active Channels Summary */}
                    <div className={`rounded-xl p-4 border transition-colors ${
                      isSandbox 
                        ? "bg-zinc-800/30 border-zinc-700/30" 
                        : "bg-orange-950/20 border-orange-800/30"
                    }`}>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                          <Network className={`w-4 h-4 ${isSandbox ? "text-amber-400" : "text-orange-400"}`} />
                          Channels
                        </h3>
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${
                            isSandbox 
                              ? "border-zinc-700 text-zinc-400" 
                              : "border-orange-700 text-orange-400"
                          }`}
                        >
                          {openChannels.length} open
                        </Badge>
                      </div>
                      {openChannels.length === 0 ? (
                        <p className="text-xs text-zinc-500">No open channels. Create one to start.</p>
                      ) : (
                        <div className="space-y-2">
                          {openChannels.slice(0, 3).map((ch) => (
                            <div key={ch.channelId} className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                              isSandbox ? "bg-zinc-800/50" : "bg-orange-950/30"
                            }`}>
                              <span className="font-mono text-xs text-zinc-300">
                                {ch.channelId?.slice(0, 8)}…{ch.channelId?.slice(-6)}
                              </span>
                              <span className={`text-xs font-mono ${isSandbox ? "text-amber-400" : "text-orange-400"}`}>
                                {formatYtest(ch.amount ?? "0")}
                              </span>
                            </div>
                          ))}
                          {openChannels.length > 3 && (
                            <button
                              onClick={() => setActiveTab("operations")}
                              className={`text-xs mt-1 transition-colors ${
                                isSandbox 
                                  ? "text-amber-400 hover:text-amber-300" 
                                  : "text-orange-400 hover:text-orange-300"
                              }`}
                            >
                              View all {openChannels.length} channels in Operations →
                            </button>
                          )}
                          {openChannels.length > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleCloseAllChannels}
                              disabled={isClosingAll || needsETH}
                              className="w-full mt-2 border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs"
                            >
                              {isClosingAll ? (
                                <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Closing all…</>
                              ) : (
                                <><XIcon className="w-3 h-3 mr-1.5" />Close All Channels</>
                              )}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Quick Actions */}
                    <div className={`rounded-xl p-4 border transition-colors ${
                      isSandbox 
                        ? "bg-zinc-800/30 border-zinc-700/30" 
                        : "bg-orange-950/20 border-orange-800/30"
                    }`}>
                      <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                        {isSandbox ? (
                          <Zap className="w-4 h-4 text-amber-400" />
                        ) : (
                          <Flame className="w-4 h-4 text-orange-400" />
                        )}
                        Quick Actions
                      </h3>
                      <div className={`grid gap-2 ${isSandbox ? "grid-cols-2" : "grid-cols-3"}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setActiveTab("operations"); setExpandedQuickAction(0); }}
                          className={`justify-start text-xs transition-all ${
                            isSandbox 
                              ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" 
                              : "border-orange-700/50 text-zinc-300 hover:bg-orange-900/30 hover:border-orange-600/50"
                          }`}
                        >
                          <PlusCircle className={`w-3.5 h-3.5 mr-1.5 ${isSandbox ? "text-green-400" : "text-orange-400"}`} />
                          Create
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setActiveTab("operations"); setExpandedQuickAction(2); }}
                          disabled={!hasOpenChannels}
                          className={`justify-start text-xs transition-all ${
                            isSandbox 
                              ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" 
                              : "border-orange-700/50 text-zinc-300 hover:bg-orange-900/30 hover:border-orange-600/50"
                          }`}
                        >
                          <ArrowUpRight className={`w-3.5 h-3.5 mr-1.5 ${isSandbox ? "text-blue-400" : "text-sky-400"}`} />
                          Fund
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setActiveTab("operations"); setExpandedQuickAction(3); }}
                          className={`justify-start text-xs transition-all ${
                            isSandbox 
                              ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" 
                              : "border-orange-700/50 text-zinc-300 hover:bg-orange-900/30 hover:border-orange-600/50"
                          }`}
                        >
                          <Send className={`w-3.5 h-3.5 mr-1.5 ${isSandbox ? "text-purple-400" : "text-violet-400"}`} />
                          Transfer
                        </Button>
                        {/* Faucet button - Sandbox only */}
                        {isSandbox && (
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
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Recent Transactions Mini */}
                  {transactions.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                          {isSandbox ? (
                            <Activity className="w-4 h-4 text-amber-400" />
                          ) : (
                            <Receipt className="w-4 h-4 text-orange-400" />
                          )}
                          Recent Activity
                        </h3>
                        <button
                          onClick={() => setActiveTab("activity")}
                          className={`text-xs transition-colors ${
                            isSandbox 
                              ? "text-amber-400 hover:text-amber-300" 
                              : "text-orange-400 hover:text-orange-300"
                          }`}
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
                                href={getExplorerUrl(tx.hash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`transition-colors ${
                                  isSandbox 
                                    ? "text-zinc-500 hover:text-amber-400" 
                                    : "text-zinc-500 hover:text-orange-400"
                                }`}
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
                    <div className="flex items-center gap-2">
                      {openChannels.length > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCloseAllChannels}
                          disabled={isClosingAll || needsETH}
                          className="border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs"
                        >
                          {isClosingAll ? (
                            <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Closing…</>
                          ) : (
                            <><XIcon className="w-3 h-3 mr-1" />Close All</>
                          )}
                        </Button>
                      )}
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
                  </div>

                  {channels.length === 0 ? (
                    <div className="text-center py-12 space-y-4">
                      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto ${
                        isSandbox ? "bg-zinc-800" : "bg-orange-950/50"
                      }`}>
                        <Network className={`w-8 h-8 ${isSandbox ? "text-zinc-600" : "text-orange-700"}`} />
                      </div>
                      <div>
                        <p className="text-zinc-400 font-medium">No channels found</p>
                        <p className="text-zinc-600 text-sm mt-1">
                          {isSandbox 
                            ? "Create your first state channel to get started" 
                            : `Create your first channel on ${currentNetworkConfig?.chainName ?? "mainnet"} to begin`
                          }
                        </p>
                      </div>
                      <Button
                        onClick={() => setActiveTab("operations")}
                        className={`transition-colors ${
                          isSandbox 
                            ? "bg-amber-500 hover:bg-amber-600 text-black" 
                            : "bg-orange-500 hover:bg-orange-600 text-black"
                        }`}
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
                          className={`rounded-xl p-4 border transition-all ${
                            isSandbox 
                              ? "bg-zinc-800/50 border-zinc-700/50 hover:border-zinc-600/50" 
                              : "bg-orange-950/20 border-orange-800/30 hover:border-orange-700/50"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                isSandbox ? "bg-zinc-700/50" : "bg-orange-900/30"
                              }`}>
                                <Network className={`w-5 h-5 ${isSandbox ? "text-amber-400" : "text-orange-400"}`} />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm text-zinc-300">
                                    {ch.channelId?.slice(0, 8)}…{ch.channelId?.slice(-6)}
                                  </span>
                                  <CopyButton text={ch.channelId ?? ""} />
                                  <a
                                    href={`${currentNetworkConfig?.blockExplorer ?? "https://etherscan.io"}/address/${ch.channelId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`transition-colors ${
                                      isSandbox 
                                        ? "text-zinc-500 hover:text-amber-400" 
                                        : "text-zinc-500 hover:text-orange-400"
                                    }`}
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
                              <p className="font-mono text-zinc-200">{formatYtest(ch.amount ?? "0")} {primaryAssetSymbol.toUpperCase()}</p>
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
                                className={`transition-colors ${
                                  isSandbox 
                                    ? "border-amber-500/50 text-amber-400 hover:bg-amber-500/10" 
                                    : "border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
                                }`}
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
                  <FinancialDashboard
                    searchPlaceholder="Search operations, channels, or type a command..."
                    expandedQuickAction={expandedQuickAction}
                    onExpandedQuickActionChange={setExpandedQuickAction}
                    quickActions={[
                      {
                        icon: PlusCircle,
                        title: "Create Channel",
                        description: "Open a new state channel (funding happens in the next step)",
                        renderForm: () => (
                          <>
                            <p className="text-xs text-zinc-500">
                              This creates an empty state channel. You will fund it from your Unified Balance using the
                              <span className="font-medium text-zinc-300"> Fund Channel</span> action.
                            </p>
                            {!hasUnifiedBalance && (
                              <p className={`mt-2 text-[11px] ${isSandbox ? "text-amber-300" : "text-orange-300"}`}>
                                {isSandbox 
                                  ? "Tip: Request faucet tokens first so you have Unified Balance to allocate into the channel."
                                  : `Tip: Deposit ${primaryAssetSymbol.toUpperCase()} first to get Unified Balance for channel allocation.`
                                }
                              </p>
                            )}
                            <Button
                              onClick={handleCreateChannel}
                              disabled={isCreating || needsETH}
                              className={`${opButtonClass} bg-orange-600 hover:bg-orange-700 text-white`}
                              size="sm"
                            >
                              {isCreating ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</>
                              ) : (
                                <><PlusCircle className="w-4 h-4 mr-2" />Create Channel</>
                              )}
                            </Button>
                          </>
                        ),
                      },
                      {
                        icon: Lock,
                        title: "Deposit",
                        description: "Optional: move funds into the L1 custody contract",
                        renderForm: () => {
                          const depAmt = parseFloat(depositAmount) || 0;
                          const exceeds = depAmt > walletTokenNum;
                          return (
                            <>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-500">Wallet {primaryAssetSymbol}</span>
                                <span className="font-mono text-zinc-300">{walletTokenNum > 0 ? formatYtest(walletTokenNum.toString()) : "0.00"}</span>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-500">Custody balance</span>
                                <span className="font-mono text-zinc-300">{custodyNum > 0 ? formatYtest(custodyNum.toString()) : "0.00"}</span>
                              </div>
                              <Input
                                type="number"
                                value={depositAmount}
                                onChange={(e) => setDepositAmount(e.target.value)}
                                placeholder={`Amount (${primaryAssetSymbol})`}
                                className={`${opInputClass} ${exceeds ? "!border-red-500/60" : ""}`}
                              />
                              {exceeds && (
                                <p className="text-[11px] text-red-400">
                                  Exceeds wallet balance ({formatYtest(walletTokenNum.toString())} available)
                                </p>
                              )}
                              <Button
                                onClick={handleDeposit}
                                disabled={isDepositing || !depositAmount || needsETH || exceeds}
                                className={`${opButtonClass} bg-amber-600 hover:bg-amber-700 text-black`}
                                size="sm"
                              >
                                {isDepositing ? (
                                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Depositing…</>
                                ) : (
                                  <><Lock className="w-4 h-4 mr-2" />Deposit</>
                                )}
                              </Button>
                            </>
                          );
                        },
                      },
                      {
                        icon: ArrowUpRight,
                        title: "Fund Channel",
                        description: "Allocate from Unified Balance or custody into a channel",
                        renderForm: () => {
                          const resAmt = parseFloat(resizeAmount) || 0;
                          const maxFund = Math.max(totalLedgerBalance, custodyNum);
                          const exceedsFund = resAmt > 0 && resAmt > maxFund && maxFund > 0;
                          return (
                            <>
                              {!hasOpenChannels && (
                                <p className="text-xs text-zinc-500 mb-2">
                                  You have no open channels yet. Create a channel first, then come back to fund it.
                                </p>
                              )}
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-500">Unified Balance</span>
                                <span className={`font-mono ${totalLedgerBalance > 0 ? "text-amber-300" : "text-zinc-500"}`}>
                                  {totalLedgerBalance > 0 ? formatYtest(totalLedgerBalance) : "0.00"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-500">Custody</span>
                                <span className="font-mono text-zinc-300">{custodyNum > 0 ? formatYtest(custodyNum.toString()) : "0.00"}</span>
                              </div>
                              {!hasUnifiedBalance && !hasCustodyBalance && (
                                <p className={`text-xs ${isSandbox ? "text-amber-300" : "text-orange-300"}`}>
                                  {isSandbox 
                                    ? "No funds available. Request faucet tokens or deposit first."
                                    : `No funds available. Deposit ${primaryAssetSymbol.toUpperCase()} to your wallet first.`
                                  }
                                </p>
                              )}
                              {resizeError && (
                                <div className="rounded-lg border border-red-500/35 bg-red-500/10 p-3 text-xs shadow-[0_6px_20px_rgba(127,29,29,0.2)]">
                                  <p className="text-red-300 break-words font-mono leading-relaxed">{resizeError}</p>
                                  <button
                                    onClick={() => setResizeError(null)}
                                    className="mt-2 inline-flex items-center rounded-md border border-red-400/30 px-2 py-1 text-[11px] text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200"
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              )}
                              <select
                                value={resizeChannelId}
                                onChange={(e) => { setResizeChannelId(e.target.value); setResizeError(null); }}
                                className={opSelectClass}
                                disabled={!hasOpenChannels}
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
                                onChange={(e) => { setResizeAmount(e.target.value); setResizeError(null); }}
                                placeholder={`Amount (${primaryAssetSymbol.toUpperCase()})`}
                                className={`${opInputClass} ${exceedsFund ? "!border-red-500/60" : ""}`}
                              />
                              {exceedsFund && (
                                <p className="text-[11px] text-red-400">
                                  Exceeds available funds ({formatYtest(maxFund)} max)
                                </p>
                              )}
                              <Button
                                onClick={handleResizeChannel}
                                disabled={isResizing || !resizeChannelId || !resizeAmount || (!hasUnifiedBalance && !hasCustodyBalance) || exceedsFund}
                                className={`${opButtonClass} bg-sky-600 hover:bg-sky-700 text-white`}
                                size="sm"
                              >
                                {isResizing ? (
                                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Funding…</>
                                ) : (
                                  <><ArrowUpRight className="w-4 h-4 mr-2" />Fund Channel</>
                                )}
                              </Button>
                            </>
                          );
                        },
                      },
                      {
                        icon: Send,
                        title: "Transfer",
                        description: "Send off-chain (instant, zero gas)",
                        renderForm: () => {
                          const xfrAmt = parseFloat(transferAmount) || 0;
                          const exceedsLedger = xfrAmt > 0 && unifiedBalanceHuman > 0 && xfrAmt > unifiedBalanceHuman;
                          return (
                            <>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-500">Unified Balance</span>
                                <span className={`font-mono ${unifiedBalanceHuman > 0 ? "text-amber-300" : "text-zinc-500"}`}>
                                  {unifiedBalanceHuman > 0 ? formatYtest(unifiedBalanceHuman.toString()) : "0.00"}
                                </span>
                              </div>
                              {!hasOpenChannels && (
                                <p className="text-xs text-zinc-500">No open channels — create and fund a channel before transferring.</p>
                              )}
                              <Input
                                value={transferDest}
                                onChange={(e) => setTransferDest(e.target.value)}
                                placeholder="Destination address (0x...)"
                                className={opInputClass}
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <Input
                                  value={transferAsset}
                                  onChange={(e) => setTransferAsset(e.target.value)}
                                  placeholder="Asset"
                                  className={opInputClass}
                                />
                                <Input
                                  type="number"
                                  value={transferAmount}
                                  onChange={(e) => setTransferAmount(e.target.value)}
                                  placeholder={`Amount (${primaryAssetSymbol.toUpperCase()})`}
                                  className={`${opInputClass} ${exceedsLedger ? "!border-red-500/60" : ""}`}
                                />
                              </div>
                              {exceedsLedger && (
                                <p className="text-[11px] text-red-400">
                                  Exceeds Unified Balance ({formatYtest(unifiedBalanceHuman.toString())} available)
                                </p>
                              )}
                              <Button
                                onClick={handleTransfer}
                                disabled={isTransferring || !transferDest || !transferAmount || exceedsLedger}
                                className={`${opButtonClass} bg-violet-600 hover:bg-violet-700 text-white`}
                                size="sm"
                              >
                                {isTransferring ? (
                                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Transferring…</>
                                ) : (
                                  <><Send className="w-4 h-4 mr-2" />Transfer</>
                                )}
                              </Button>
                            </>
                          );
                        },
                      },
                    ]}
                    recentActivity={transactions.slice(0, 5).map((tx) => {
                      const labelLower = tx.label.toLowerCase();
                      const match = tx.label.match(/(\d+(\.\d+)?)/);
                      const numeric = match ? parseFloat(match[1]) : null;
                      let signedAmount: number | null = null;
                      if (numeric !== null && !Number.isNaN(numeric)) {
                        const isCredit =
                          labelLower.includes("deposit") ||
                          labelLower.includes("resize") ||
                          labelLower.includes("fund");
                        const isDebit =
                          labelLower.includes("withdraw") ||
                          labelLower.includes("close");
                        if (isCredit) signedAmount = numeric;
                        else if (isDebit) signedAmount = -numeric;
                      }
                      const StatusIcon = tx.status === "confirmed" ? CheckCircle2 : tx.status === "failed" ? XIcon : Loader2;
                      return {
                        icon: (
                          <div className={`w-9 h-9 flex items-center justify-center rounded-full text-sm ${tx.status === "confirmed"
                            ? "bg-orange-500/15 text-orange-400"
                            : tx.status === "failed"
                              ? "bg-red-500/15 text-red-400"
                              : "bg-amber-500/15 text-amber-400"
                            }`}>
                            <StatusIcon className={`w-4 h-4 ${tx.status === "pending" ? "animate-spin" : ""}`} />
                          </div>
                        ),
                        title: tx.label,
                        time: new Date(tx.timestamp).toLocaleString(),
                        amount: signedAmount ?? 0,
                      };
                    })}
                    financialServices={[
                      {
                        icon: XIcon,
                        title: "Close Channel",
                        description: "Settle & close open channels",
                        hasAction: true,
                        renderForm: () => (
                          <>
                            <select
                              value={closeChannelId}
                              onChange={(e) => setCloseChannelId(e.target.value)}
                              className={opSelectClass}
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
                              className={opButtonClass}
                              size="sm"
                            >
                              {isClosing ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Closing…</>
                              ) : (
                                <><XIcon className="w-4 h-4 mr-2" />Close Channel</>
                              )}
                            </Button>
                          </>
                        ),
                      },
                      {
                        icon: ArrowDownRight,
                        title: "Withdraw",
                        description: "Withdraw from custody to wallet",
                        hasAction: true,
                        renderForm: () => {
                          const wAmt = parseFloat(withdrawAmount) || 0;
                          const exceedsW = wAmt > 0 && custodyNum > 0 && wAmt > custodyNum;
                          return (
                            <>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-500">Custody balance</span>
                                <span className={`font-mono ${custodyNum > 0 ? "text-orange-300" : "text-zinc-500"}`}>
                                  {custodyNum > 0 ? formatYtest(custodyNum.toString()) : "0.00"} {primaryAssetSymbol.toUpperCase()}
                                </span>
                              </div>
                              {custodyNum <= 0 && (
                                <p className="text-xs text-zinc-500">
                                  No custody balance. Close a channel first to move funds back to custody, then withdraw.
                                </p>
                              )}
                              <Input
                                type="number"
                                value={withdrawAmount}
                                onChange={(e) => setWithdrawAmount(e.target.value)}
                                placeholder={`Amount (${primaryAssetSymbol.toUpperCase()})`}
                                className={`${opInputClass} ${exceedsW ? "!border-red-500/60" : ""}`}
                              />
                              {exceedsW && (
                                <p className="text-[11px] text-red-400">
                                  Exceeds custody balance ({formatYtest(custodyNum.toString())} available)
                                </p>
                              )}
                              {custodyNum > 0 && (
                                <button
                                  onClick={() => setWithdrawAmount(custodyNum.toFixed(2))}
                                  className="text-[11px] text-amber-400 hover:text-amber-300"
                                >
                                  Use max: {formatYtest(custodyNum.toString())}
                                </button>
                              )}
                              <Button
                                onClick={handleWithdraw}
                                disabled={isWithdrawing || !withdrawAmount || needsETH || exceedsW || custodyNum <= 0}
                                className={`${opButtonClass} bg-orange-600 hover:bg-orange-700 text-white`}
                                size="sm"
                              >
                                {isWithdrawing ? (
                                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Withdrawing…</>
                                ) : (
                                  <><ArrowDownRight className="w-4 h-4 mr-2" />Withdraw</>
                                )}
                              </Button>
                            </>
                          );
                        },
                      },
                      {
                        icon: XIcon,
                        title: "Close All Channels",
                        description: `Close all ${openChannels.length} open channel(s) at once`,
                        onClick: handleCloseAllChannels,
                      },
                      // Faucet - only in Sandbox mode
                      ...(isSandbox ? [{
                        icon: Droplets,
                        title: "Faucet",
                        description: "Request testnet tokens",
                        onClick: handleRequestFaucet,
                      }] : []),
                      {
                        icon: RefreshCw,
                        title: "Sync Balances",
                        description: "Refresh all balances & channels",
                        onClick: handleRefresh,
                      },
                    ]}
                  />
                </TabsContent>

              {/* ── Transactions Tab ── */}
              {/* ── Activity Tab (Transactions + Network) ── */}
              <TabsContent value="activity" className="space-y-6">
                {/* Transaction History */}
                <div className="space-y-4">
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
                        <p className="text-zinc-600 text-sm mt-1">
                          Transactions will appear here as you create channels, deposit, and transfer
                        </p>
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
                            <tr
                              key={tx.id}
                              className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
                            >
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-2">
                                  <div
                                    className={`w-2.5 h-2.5 rounded-full ${
                                      tx.status === "confirmed"
                                        ? "bg-green-400"
                                        : tx.status === "failed"
                                          ? "bg-red-400"
                                          : "bg-amber-400 animate-pulse"
                                    }`}
                                  />
                                  <span
                                    className={`text-xs font-medium capitalize ${
                                      tx.status === "confirmed"
                                        ? "text-green-400"
                                        : tx.status === "failed"
                                          ? "text-red-400"
                                          : "text-amber-400"
                                    }`}
                                  >
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
                                  href={getExplorerUrl(tx.hash)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`inline-flex items-center gap-1.5 text-xs transition-colors ${
                                    isSandbox 
                                      ? "text-zinc-500 hover:text-amber-400" 
                                      : "text-zinc-500 hover:text-orange-400"
                                  }`}
                                >
                                  Explorer <ExternalLink className="w-3 h-3" />
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Network Activity + Health */}
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
                                      : "text-orange-400"
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
                          <span className="font-mono text-sm text-orange-400">{confirmedTxCount}</span>
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
                    className={`rounded-lg border p-2 text-center ${isComplete
                      ? "border-orange-500/40 bg-orange-500/10"
                      : isActive
                        ? "border-amber-500/40 bg-amber-500/10"
                        : "border-zinc-800 bg-zinc-900/40"
                      }`}
                  >
                    <div className="mx-auto w-7 h-7 rounded-md flex items-center justify-center mb-1 bg-black/30">
                      {isComplete ? <Check className="w-3.5 h-3.5 text-orange-400" /> : <Icon className="w-3.5 h-3.5 text-zinc-400" />}
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
      {networkConfigDisplay && (
        <motion.div variants={fadeIn} initial="hidden" animate="visible">
          <GlowCard className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Info className="w-4 h-4 text-zinc-400" />
              <span className="text-sm font-semibold text-zinc-400">
                Network Configuration — {networkConfigDisplay.chainName}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="bg-zinc-800/50 rounded-lg p-3">
                <span className="text-zinc-500">Custody Contract</span>
                <div className="flex items-center gap-1 mt-1">
                  <span className="font-mono text-zinc-300">{formatAddress(networkConfigDisplay.custody)}</span>
                  <CopyButton text={networkConfigDisplay.custody} />
                </div>
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-3">
                <span className="text-zinc-500">Adjudicator</span>
                <div className="flex items-center gap-1 mt-1">
                  <span className="font-mono text-zinc-300">{formatAddress(networkConfigDisplay.adjudicator)}</span>
                  <CopyButton text={networkConfigDisplay.adjudicator} />
                </div>
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-3">
                <span className="text-zinc-500">WebSocket</span>
                <p className="font-mono text-zinc-300 mt-1 break-all">{networkConfigDisplay.wsUrl}</p>
              </div>
            </div>
          </GlowCard>
        </motion.div>
      )}
    </main>

      {/* ── Sticky Debug Log Footer Tray ── */ }
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
                                    href={getExplorerUrl(txMatch[1])}
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
    </div >
  );
}
