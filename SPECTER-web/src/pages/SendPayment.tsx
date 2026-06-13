/**
 * SendPayment screen.
 *
 * Lifecycle (single source of truth: `publishPhase`):
 *
 *     input ──► generated ──► (signing → broadcasting → publishing) ──► published
 *                                        │
 *                                        └─► sent_unpublished_failure ──► (retry) ──► published
 *
 * Fund-loss prevention notes — read these before touching this file:
 *
 *  1. Every successful `api.createStealth(...)` is immediately persisted
 *     via `savePending(...)` (localStorage). This survives tab close /
 *     refresh, so we can recover a payment whose on-chain tx landed but
 *     whose `publish_announcement` never succeeded.
 *
 *  2. Once the wallet tx is submitted, we call `markSent(...)` BEFORE we
 *     even attempt to publish. That way a publish failure cannot orphan
 *     the payment — the user can always retry from the dedicated UI.
 *
 *  3. The "Send & Publish" button has a two-phase loading state so the
 *     user can tell whether the failure was on-chain or off-chain.
 *
 *  4. `sent_publish_failed` is a sticky banner with a Retry button —
 *     never a silent toast — because the recipient will not see the
 *     payment until publish succeeds.
 *
 *  5. On mount we surface every incomplete pending payment so a user
 *     returning hours later can finish what they started.
 *
 * Yellow Network flow is intentionally NOT touched here — this screen is
 * the core SPECTER protocol surface.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/base/button";
import { parseBlockchainError, formatErrorMessage } from "@/lib/blockchain/errorParser";
import { SearchBar } from "@/components/ui/specialized/search-bar";
import {
  Check,
  Zap,
  ArrowRight,
  Loader2,
  Lock,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  User,
  Wallet,
  Clock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ShieldCheck,
  LifeBuoy,
  X,
} from "lucide-react";
import { toast } from "@/components/ui/base/sonner";
import { CopyButton } from "@/components/ui/specialized/copy-button";
import { DownloadJsonButton } from "@/components/ui/specialized/download-json-button";
import { TooltipLabel } from "@/components/ui/specialized/tooltip-label";
import { HeadingScramble } from "@/components/ui/animations/heading-scramble";
import { PixelCanvas } from "@/components/ui/animations/pixel-canvas";
import { AnimatedTicket } from "@/components/ui/specialized/ticket-confirmation-card";
import {
  api,
  ApiError,
  type ResolveEnsResponse,
  type CreateStealthResponse,
  type PublishAnnouncementResponse,
} from "@/lib/api";
import { verifyTx, type TxChain, type VerifiedTx } from "@/lib/blockchain/verifyTx";
import { Input } from "@/components/ui/base/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base/select";
import { Label } from "@/components/ui/base/label";
import { Tabs, TabsContent } from "@/components/ui/base/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/specialized/alert-dialog";

const CARD_PIXEL_COLORS = ["#8b5cf618", "#a78bfa14", "#7c3aed12", "#c4b5fd10"];

/** Human-readable relative timestamp. */
function getRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
import { validateEnsName, EnsResolverError } from "@/lib/blockchain/ensResolver";
import { validateSuinsName, SuinsResolverError } from "@/lib/blockchain/suinsResolver";
import {
  ArbitrumIcon,
  EthereumIcon,
  MonadIcon,
  SuiIcon,
} from "@/components/ui/specialized/chain-icons";
import { formatCryptoAmount } from "@/lib/utils";
import { Link } from "react-router-dom";
import { getRecentRecipients, addRecentRecipient } from "@/lib/recentRecipients";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/base/tooltip";
import {
  getPaymentHistory,
  addPaymentEntry,
  updatePaymentEntryByTxHash,
  type PaymentEntry,
} from "@/lib/paymentHistory";
import {
  savePending,
  markSent,
  markPublished,
  markPublishFailed,
  getActivePending,
  buildRecoveryJson,
  purgeExpired,
  clearPending,
  type PendingPaymentRecord,
} from "@/lib/pendingPayment";
import { analytics } from "@/lib/analytics";
import {
  getAvailableSendChains,
  getBackendChainName,
  getChainDecimals,
  getExplorerTxUrl,
  getPublicClientForEvm,
  getSendChainConfig,
  getSourceChainId,
  getViemChainForEvm,
  isEvmChain,
  type EvmTxChain,
} from "@/lib/blockchain/sendChains";

// Wallet imports
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import {
  useCurrentAccount,
  useDisconnectWallet,
  useSignAndExecuteTransaction,
  useSuiClient,
  ConnectModal,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { parseEther, parseUnits } from "viem";
import { StageFlowLoader, type FlowStage } from "@/components/ui/specialized/stage-flow-loader";
import { Switch } from "@/components/ui/base/switch";

type SendStep = "input" | "generated" | "published";

/**
 * Fine-grained lifecycle of a single send attempt.
 *
 *  - idle: nothing in flight
 *  - signing: wallet popup open, awaiting user signature
 *  - broadcasting: tx submitted, waiting for confirmation
 *  - verifying: tx confirmed, client-side verification against the stealth address
 *  - publishing: verified, calling /registry/announcements (atomic server leg:
 *    resolve pending → encrypt metadata → reserve Turso row → relay Monad → finalize)
 *  - sent_unpublished_failure: ON-CHAIN OK, REGISTRY FAILED — sticky
 *  - published: success
 */
type PublishPhase =
  | "idle"
  | "signing"
  | "broadcasting"
  | "verifying"
  | "publishing"
  | "sent_unpublished_failure"
  | "published";

/** Stage ids surfaced in the flow loader. */
type FlowPhaseId = "signing" | "broadcasting" | "verifying" | "publishing";

const ACTIVE_FLOW_PHASES: ReadonlyArray<PublishPhase> = [
  "signing",
  "broadcasting",
  "verifying",
  "publishing",
];

interface ConfirmDialogState {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
}

const RECOVERY_FILENAME_PREFIX = "specter-recovery";
const DISMISSED_PENDING_SESSION_KEY = "specter.send.dismissed.pending.v1";

function readDismissedPendingIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(DISMISSED_PENDING_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissedPendingIds(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DISMISSED_PENDING_SESSION_KEY, JSON.stringify(ids));
  } catch {
    // best effort only
  }
}

/**
 * Reconstruct the strict subset of `CreateStealthResponse` we need from
 * a persisted pending record, so the user can resume mid-flow.
 */
function stealthResultFromPending(rec: PendingPaymentRecord): CreateStealthResponse {
  return {
    payment_id: rec.payment_id,
    stealth_address: rec.stealth_address,
    stealth_sui_address: rec.stealth_sui_address,
    ephemeral_ciphertext: rec.announcement.ephemeral_key,
    view_tag: rec.announcement.view_tag,
    announcement: rec.announcement,
  };
}

function getChainIcon(chain: TxChain, size = 14) {
  const chainCfg = getSendChainConfig(chain);
  if (chain === "sui") {
    return <SuiIcon size={size} className={chainCfg.colorClass} />;
  }
  if (chain === "arbitrum") {
    return <ArbitrumIcon size={size} className={chainCfg.colorClass} />;
  }
  if (chain === "monad") {
    return <MonadIcon size={size} className={chainCfg.colorClass} />;
  }
  return <EthereumIcon size={size} className={chainCfg.colorClass} />;
}

function ReceiptConfetti() {
  const pieces = Array.from({ length: 20 }, (_, i) => i);
  const colors = ["#a78bfa", "#34d399", "#60a5fa", "#f59e0b", "#f472b6"];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((piece) => (
        <motion.span
          key={piece}
          initial={{ y: -30, x: `${(piece % 10) * 10}%`, opacity: 0, rotate: 0 }}
          animate={{
            y: [0, 100, 180],
            x: [`${(piece % 10) * 10}%`, `${(piece % 10) * 10 + (piece % 2 === 0 ? 3 : -3)}%`],
            opacity: [0, 1, 0],
            rotate: [0, 180, 360],
          }}
          transition={{
            duration: 1.6 + (piece % 4) * 0.2,
            ease: "easeOut",
            delay: (piece % 8) * 0.04,
          }}
          className="absolute top-0 h-2.5 w-1.5 rounded-sm"
          style={{ backgroundColor: colors[piece % colors.length] }}
        />
      ))}
    </div>
  );
}

/**
 * Publish the announcement, preferring the server-held `payment_id` path
 * (correct view tag + encrypted metadata). If the server reports the pending
 * entry expired (24h TTL or restart in dev), automatically retry once with
 * the announcement DTO fallback — the payment still becomes discoverable,
 * but the metadata blob is published unencrypted (logged server-side).
 */
async function publishWithFallback(
  stealth: CreateStealthResponse,
  verified: VerifiedTx,
  chainValue: TxChain,
): Promise<{ res: PublishAnnouncementResponse; usedFallback: boolean }> {
  const base = {
    announcement: stealth.announcement,
    // Dev-mode Monad tx fallback; ignored when the server relayer is active.
    tx_hash: verified.txHash,
    // Source-chain payment tx — what the server RPC-verifies and encrypts.
    payment_tx_hash: verified.txHash,
    source_chain_id: getSourceChainId(chainValue) ?? null,
    // Base units (wei / MIST) — the server compares against tx.value.
    amount: verified.amount,
    chain: getBackendChainName(chainValue),
  };

  try {
    const res = await api.publishAnnouncement({ payment_id: stealth.payment_id, ...base });
    return { res, usedFallback: false };
  } catch (err) {
    const pendingExpired =
      err instanceof ApiError &&
      err.status === 400 &&
      /unknown or expired payment_id/i.test(err.message);
    if (!pendingExpired) throw err;
    console.warn(
      "[send] Server-side pending entry expired — publishing via announcement DTO fallback (metadata will not be encrypted).",
    );
    const res = await api.publishAnnouncement(base);
    return { res, usedFallback: true };
  }
}

function getFundingUrl(chain: TxChain): string {
  if (chain === "arbitrum") return "https://faucet.quicknode.com/arbitrum/sepolia";
  if (chain === "monad") return "https://faucet.monad.xyz";
  if (chain === "sui") return "https://faucet.sui.io/";
  return "https://faucet.quicknode.com/ethereum/sepolia";
}

export default function SendPayment() {
  const [step, setStep] = useState<SendStep>("input");
  const [ensName, setEnsName] = useState("");
  const [amount, setAmount] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [resolveStatus, setResolveStatus] = useState<string>("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedENS, setResolvedENS] = useState<ResolveEnsResponse | null>(null);
  const [stealthResult, setStealthResult] = useState<CreateStealthResponse | null>(null);
  const [activePending, setActivePending] = useState<PendingPaymentRecord | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [announcementId, setAnnouncementId] = useState<number | null>(null);
  const [txHash, setTxHash] = useState("");
  const [publishChain, setPublishChain] = useState<TxChain>("ethereum");
  const [verifiedTx, setVerifiedTx] = useState<VerifiedTx | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [publishPhase, setPublishPhase] = useState<PublishPhase>("idle");
  // Hash of the wallet-broadcast on-chain transaction (needed for retry publish).
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);
  const [pendingVerifiedTx, setPendingVerifiedTx] = useState<VerifiedTx | null>(null);
  // Monad announce() tx hash returned by the publish endpoint (relayer mode).
  const [monadTxHash, setMonadTxHash] = useState<string | null>(null);
  // Flow loader state: which attempt shape is running + where it failed.
  const [attemptOrigin, setAttemptOrigin] = useState<"manual" | "wallet" | "retry" | null>(null);
  const [failedPhase, setFailedPhase] = useState<FlowPhaseId | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);

  // Wallet send state
  const [sendMode, setSendMode] = useState<"manual" | "wallet">("wallet");
  const [walletAmount, setWalletAmount] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [suiConnectOpen, setSuiConnectOpen] = useState(false);
  const [recentRecipients, setRecentRecipients] = useState(() => {
    try { return getRecentRecipients(); } catch { return []; }
  });
  const [paymentHistory, setPaymentHistory] = useState<PaymentEntry[]>(() => {
    try { return getPaymentHistory(); } catch { return []; }
  });
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Recovery banner state (populated on mount + after every status change).
  const [incompletePending, setIncompletePending] = useState<PendingPaymentRecord[]>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dismissedPendingIds, setDismissedPendingIds] = useState<string[]>(() => readDismissedPendingIds());

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const refreshIncompletePending = useCallback(() => {
    try {
      const dismissed = new Set(readDismissedPendingIds());
      setDismissedPendingIds(Array.from(dismissed));
      setIncompletePending(getActivePending().filter((rec) => !dismissed.has(rec.payment_id)));
    } catch {
      setIncompletePending([]);
    }
  }, []);

  const logPayment = useCallback((entry: Omit<PaymentEntry, "timestamp">) => {
    addPaymentEntry(entry);
    setPaymentHistory(getPaymentHistory());
  }, []);

  const upsertHistoryByTxHash = useCallback(
    (txHashKey: string, patch: Partial<PaymentEntry>) => {
      const next = updatePaymentEntryByTxHash(txHashKey, patch);
      if (next) setPaymentHistory(getPaymentHistory());
      return next;
    },
    [],
  );

  const dismissPendingPrompt = useCallback(
    (paymentId: string) => {
      setConfirmDialog({
        open: true,
        title: "Dismiss reminder for this session?",
        description:
          "This will hide this pending-payment reminder until you open a new browser session. You can still recover it from local storage later.",
        confirmLabel: "Dismiss for this session",
        cancelLabel: "Keep reminder",
        onConfirm: () => {
          const next = Array.from(new Set([...dismissedPendingIds, paymentId]));
          writeDismissedPendingIds(next);
          setDismissedPendingIds(next);
          setIncompletePending((prev) => prev.filter((p) => p.payment_id !== paymentId));
          setConfirmDialog(null);
        },
      });
    },
    [dismissedPendingIds],
  );

  // Wallet hooks
  const { primaryWallet, setShowAuthFlow, handleLogOut } = useDynamicContext();
  const suiAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: disconnectSui } = useDisconnectWallet();
  const { mutateAsync: signAndExecuteSui } = useSignAndExecuteTransaction();

  const evmConnected = !!primaryWallet;
  const suiConnected = !!suiAccount;
  const availableSendChains = useMemo(
    () => getAvailableSendChains(Boolean(stealthResult?.stealth_sui_address)),
    [stealthResult?.stealth_sui_address],
  );
  const publishChainConfig = useMemo(() => getSendChainConfig(publishChain), [publishChain]);

  /* ─────────────────────────────────────────────────────────────────────── */
  /* Mount: garbage-collect expired pending + populate recovery banner       */
  /* ─────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    try {
      purgeExpired();
    } catch {
      // never fatal
    }
    refreshIncompletePending();
  }, [refreshIncompletePending]);

  useEffect(() => {
    if (!availableSendChains.includes(publishChain)) {
      setPublishChain(availableSendChains[0] ?? "ethereum");
    }
  }, [availableSendChains, publishChain]);

  /* ─────────────────────────────────────────────────────────────────────── */
  /* Helpers                                                                  */
  /* ─────────────────────────────────────────────────────────────────────── */

  /** True iff there's a payment the user has not yet finished. */
  const hasActiveInFlight = useMemo(() => {
    if (!activePending) return false;
    return activePending.status !== "published";
  }, [activePending]);

  /** True iff funds are already on-chain but registry publish hasn't succeeded. */
  const isSentUnpublished = useMemo(() => {
    return (
      publishPhase === "sent_unpublished_failure" ||
      activePending?.status === "sent_unpublished"
    );
  }, [publishPhase, activePending]);

  useEffect(() => {
    let cancelled = false;
    const fetchBalance = async () => {
      if (sendMode !== "wallet") return;
      setBalanceError(null);
      if (isEvmChain(publishChain)) {
        if (!primaryWallet?.address) {
          setWalletBalance(null);
          return;
        }
        try {
          setIsBalanceLoading(true);
          const client = getPublicClientForEvm(publishChain);
          const bal = await client.getBalance({ address: primaryWallet.address as `0x${string}` });
          if (!cancelled) setWalletBalance((Number(bal) / 1e18).toFixed(6));
        } catch (err) {
          if (!cancelled) {
            setWalletBalance(null);
            setBalanceError(err instanceof Error ? err.message : "Could not fetch balance");
          }
        } finally {
          if (!cancelled) setIsBalanceLoading(false);
        }
        return;
      }

      if (!suiAccount?.address) {
        setWalletBalance(null);
        return;
      }
      try {
        setIsBalanceLoading(true);
        const bal = await suiClient.getBalance({ owner: suiAccount.address });
        const amount = Number(bal.totalBalance ?? "0") / 1e9;
        if (!cancelled) setWalletBalance(amount.toFixed(6));
      } catch (err) {
        if (!cancelled) {
          setWalletBalance(null);
          setBalanceError(err instanceof Error ? err.message : "Could not fetch balance");
        }
      } finally {
        if (!cancelled) setIsBalanceLoading(false);
      }
    };

    void fetchBalance();
    return () => {
      cancelled = true;
    };
  }, [primaryWallet?.address, publishChain, sendMode, suiAccount?.address, suiClient]);

  const walletAmountNum = Number(walletAmount);
  const walletBalanceNum = Number(walletBalance ?? 0);
  const insufficientFunds =
    sendMode === "wallet" &&
    Number.isFinite(walletAmountNum) &&
    walletAmountNum > 0 &&
    Number.isFinite(walletBalanceNum) &&
    walletAmountNum > walletBalanceNum;

  const resetForm = useCallback(() => {
    setStep("input");
    setEnsName("");
    setAmount("");
    setResolvedENS(null);
    setStealthResult(null);
    setActivePending(null);
    setAnnouncementId(null);
    setResolveError(null);
    setResolveStatus("");
    setTxHash("");
    setPublishChain("ethereum");
    setVerifiedTx(null);
    setVerifyError(null);
    setSendMode("wallet");
    setWalletAmount("");
    setIsSending(false);
    setSendError(null);
    setPublishPhase("idle");
    setPendingTxHash(null);
    setPendingVerifiedTx(null);
    setMonadTxHash(null);
    setAttemptOrigin(null);
    setFailedPhase(null);
    setFlowError(null);
    setWalletBalance(null);
    setBalanceError(null);
    setIsBalanceLoading(false);
    refreshIncompletePending();
  }, [refreshIncompletePending]);

  /** Guard wrapper for destructive actions while a payment is in-flight. */
  const guardDestructive = useCallback(
    (opts: {
      title: string;
      description: string;
      confirmLabel: string;
      onConfirm: () => void;
    }) => {
      if (!hasActiveInFlight) {
        opts.onConfirm();
        return;
      }
      setConfirmDialog({
        open: true,
        title: opts.title,
        description: opts.description,
        confirmLabel: opts.confirmLabel,
        cancelLabel: "Keep current payment",
        onConfirm: () => {
          setConfirmDialog(null);
          opts.onConfirm();
        },
      });
    },
    [hasActiveInFlight],
  );

  /* ─────────────────────────────────────────────────────────────────────── */
  /* Resume a previous incomplete payment from the recovery banner          */
  /* ─────────────────────────────────────────────────────────────────────── */
  const resumePending = useCallback(
    (rec: PendingPaymentRecord) => {
      if (dismissedPendingIds.includes(rec.payment_id)) {
        const next = dismissedPendingIds.filter((id) => id !== rec.payment_id);
        writeDismissedPendingIds(next);
        setDismissedPendingIds(next);
      }
      const stealth = stealthResultFromPending(rec);
      setStealthResult(stealth);
      setActivePending(rec);
      setResolvedENS({
        ens_name: rec.recipient,
        meta_address: rec.meta_address,
        spending_pk: "",
        viewing_pk: "",
      });
      setEnsName(rec.recipient);
      setPublishChain(rec.chain);
      setStep("generated");
      setBannerDismissed(true);
      setAnnouncementId(null);
      setVerifyError(null);
      setSendError(null);
      setMonadTxHash(null);
      setAttemptOrigin(null);
      setFailedPhase(null);
      setFlowError(null);

      if (rec.status === "sent_unpublished" && rec.tx_hash) {
        // Funds already on-chain. Switch to manual tab and prefill the
        // tx hash so the user can finish the publish leg in one click.
        setSendMode("manual");
        setTxHash(rec.tx_hash);
        setWalletAmount(rec.amount ?? "");
        setPendingTxHash(rec.tx_hash);
        setPublishPhase("sent_unpublished_failure");
        toast.info("Resuming — funds already sent. Publish the announcement to make it discoverable.");
      } else {
        setPublishPhase("idle");
        setSendMode("wallet");
        toast.info(`Resuming payment to ${rec.recipient}.`);
      }
    },
    [dismissedPendingIds],
  );

  /* ─────────────────────────────────────────────────────────────────────── */
  /* Resolve recipient + create stealth payment                              */
  /* ─────────────────────────────────────────────────────────────────────── */
  const performResolve = useCallback(
    async (overrideName?: string) => {
      const name = (overrideName || ensName).trim();
      if (!name) {
        toast.error("Enter a name (e.g. bob.eth or alice.sui) or paste meta-address (hex)");
        return;
      }

      // Check if it's a hex meta-address
      const looksLikeHex =
        /^[0-9a-fA-F]+$/.test(name.replace(/^0x/, "")) && name.length > 100;
      if (looksLikeHex) {
        analytics.sendResolveInitiated("meta_address");
        const metaHex = name.replace(/^0x/, "").trim();
        const spk = metaHex.length >= 2370 ? metaHex.slice(2, 2370) : "";
        const vpk = metaHex.length >= 4738 ? metaHex.slice(2370, 4738) : "";
        const resolved: ResolveEnsResponse = {
          ens_name: "meta-address",
          meta_address: metaHex,
          spending_pk: spk,
          viewing_pk: vpk,
        };
        setResolvedENS(resolved);
        setResolveError(null);

        setIsResolving(true);
        setResolveStatus("Generating stealth address…");
        try {
          const stealth = await api.createStealth({ meta_address: metaHex });
          setStealthResult(stealth);
          const rec = savePending({
            payment_id: stealth.payment_id,
            recipient: "meta-address",
            meta_address: metaHex,
            stealth_address: stealth.stealth_address,
            stealth_sui_address: stealth.stealth_sui_address,
            announcement: stealth.announcement,
            chain: publishChain,
          });
          setActivePending(rec);
          setStep("generated");
          setPublishPhase("idle");
          analytics.sendResolveSuccess("meta_address", "meta-address");
          analytics.sendStealthGenerated("ethereum");
          toast.success("Stealth address generated");
        } catch (err) {
          const message = err instanceof ApiError ? err.message : "Failed to create stealth payment";
          analytics.sendResolveError("stealth_generation_failed", "meta_address");
          toast.error(message);
        } finally {
          setIsResolving(false);
          setResolveStatus("");
          refreshIncompletePending();
        }
        return;
      }

      const isSuiName = name.endsWith(".sui");
      const normalized = name.includes(".") ? name : `${name}.eth`;
      const nameType = isSuiName ? "sui" : "ens";

      analytics.sendResolveInitiated(nameType);
      setIsResolving(true);
      setResolveStatus("Resolving…");
      setResolveError(null);
      setResolvedENS(null);
      setStealthResult(null);
      setActivePending(null);

      try {
        if (isSuiName) {
          validateSuinsName(normalized);
        } else {
          validateEnsName(normalized);
        }
      } catch (validationError) {
        const msg = validationError instanceof EnsResolverError || validationError instanceof SuinsResolverError
          ? validationError.message
          : "Invalid name format";
        setResolveError(msg);
        analytics.sendResolveError("invalid_name_format", nameType);
        toast.error(msg);
        setIsResolving(false);
        setResolveStatus("");
        return;
      }

      try {
        let resolved: ResolveEnsResponse;
        if (isSuiName) {
          const res = await api.resolveSuins(normalized);
          resolved = {
            ens_name: res.suins_name,
            meta_address: res.meta_address,
            spending_pk: res.spending_pk,
            viewing_pk: res.viewing_pk,
            ipfs_cid: res.ipfs_cid,
          };
        } else {
          resolved = await api.resolveEns(normalized);
        }
        setResolvedENS(resolved);
        setResolveError(null);
        addRecentRecipient(resolved.ens_name);
        setRecentRecipients(getRecentRecipients());
        analytics.sendResolveSuccess(nameType, resolved.ens_name);
        toast.success(`Resolved ${resolved.ens_name}`);

        setResolveStatus("Generating stealth address…");
        const stealth = await api.createStealth({ meta_address: resolved.meta_address });
        setStealthResult(stealth);
        const initialChain: TxChain = isSuiName ? "sui" : "ethereum";
        setPublishChain(initialChain);
        const rec = savePending({
          payment_id: stealth.payment_id,
          recipient: resolved.ens_name,
          meta_address: resolved.meta_address,
          stealth_address: stealth.stealth_address,
          stealth_sui_address: stealth.stealth_sui_address,
          announcement: stealth.announcement,
          chain: initialChain,
        });
        setActivePending(rec);
        setStep("generated");
        setPublishPhase("idle");
        analytics.sendStealthGenerated(initialChain);
        toast.success("Stealth address generated");
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : null;
        const message = apiErr?.message ?? `Failed to resolve ${isSuiName ? "SuiNS" : "ENS"}`;
        const code = apiErr?.code ?? "unknown";
        if (code === "NO_SPECTER_RECORD" || code === "NO_SUINS_SPECTER_RECORD") {
          setResolveError("no-specter-setup");
        } else if (code === "IPFS_ERROR") {
          setResolveError(`${message} Try again later.`);
        } else {
          setResolveError(message);
        }
        analytics.sendResolveError(code, nameType);
        toast.error(message);
      } finally {
        setIsResolving(false);
        setResolveStatus("");
        refreshIncompletePending();
      }
    },
    [ensName, publishChain, refreshIncompletePending],
  );

  const handleResolve = useCallback(
    (overrideName?: string) => {
      guardDestructive({
        title: "Start a new payment?",
        description: hasActiveInFlight && isSentUnpublished
          ? "You have a payment that was sent on-chain but not published. Funds won't be discoverable until you retry publish. Continue anyway?"
          : "You have a stealth address generated for a different recipient. Resolving a new one will discard it. Continue?",
        confirmLabel: "Discard & resolve new",
        onConfirm: () => {
          if (step !== "input") {
            setStep("input");
            setStealthResult(null);
            setActivePending(null);
            setAnnouncementId(null);
            setResolveError(null);
            setPublishPhase("idle");
            setPendingTxHash(null);
            setPendingVerifiedTx(null);
            setMonadTxHash(null);
            setAttemptOrigin(null);
            setFailedPhase(null);
            setFlowError(null);
            setTxHash("");
            setVerifiedTx(null);
          }
          void performResolve(overrideName);
        },
      });
    },
    [
      guardDestructive,
      hasActiveInFlight,
      isSentUnpublished,
      performResolve,
      step,
    ],
  );

  /* ─────────────────────────────────────────────────────────────────────── */
  /* Publish (shared between manual / wallet / retry)                        */
  /* ─────────────────────────────────────────────────────────────────────── */
  /**
   * Attempt to publish the announcement for the current `stealthResult`.
   * Caller MUST pass the on-chain tx hash + chain. We do verification +
   * registry publish in a single critical section so the failure surfaces
   * with the correct phase.
   */
  const attemptPublish = useCallback(
    async (args: {
      stealth: CreateStealthResponse;
      txHashValue: string;
      chainValue: TxChain;
      origin: "manual" | "wallet" | "retry";
      verified?: VerifiedTx;
      /**
       * True when the on-chain tx is already known to be confirmed (wallet
       * receipt landed, or retry of a previously-sent payment). Any failure
       * after this point MUST land in the sticky `sent_unpublished_failure`
       * state — never a transient toast.
       */
      txConfirmed?: boolean;
    }): Promise<boolean> => {
      const { stealth, txHashValue, chainValue, origin } = args;
      const expectedRecipient =
        chainValue === "sui" ? stealth.stealth_sui_address : stealth.stealth_address;
      if (!expectedRecipient) {
        toast.error(`${getSendChainConfig(chainValue).label} stealth address not available`);
        return false;
      }

      setAttemptOrigin(origin);
      setFailedPhase(null);
      setFlowError(null);
      setVerifyError(null);
      setSendError(null);

      // Tracked locally (not via state) so the failure branch can't read a
      // stale closure value — the old `pendingTxHash` check had exactly that
      // bug and could drop a confirmed payment back to `idle`.
      let confirmedOnChain = Boolean(args.txConfirmed || args.verified);

      // ── Stage: verify ──────────────────────────────────────────────────
      // Client-side verification gates the UI and produces the base-unit
      // amount for the publish request. The server independently re-verifies
      // against its own CHAIN_RPC_<CHAIN>.
      setPublishPhase("verifying");
      let verified: VerifiedTx;
      try {
        verified = args.verified ?? (await verifyTx(txHashValue, chainValue, expectedRecipient));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to verify transaction";
        setVerifyError(message);
        setSendError(message);
        setFlowError(message);
        setFailedPhase("verifying");
        if (confirmedOnChain) {
          // Wallet receipt landed but our RPC read failed — conservative
          // sticky failure: the funds may well be at the stealth address.
          setPublishPhase("sent_unpublished_failure");
          try {
            markPublishFailed(stealth.payment_id, message);
          } catch {
            /* never fatal */
          }
        } else {
          setPublishPhase("idle");
        }
        toast.error(message);
        refreshIncompletePending();
        return false;
      }

      confirmedOnChain = true;
      setVerifiedTx(verified);
      setPendingVerifiedTx(verified);
      setPendingTxHash(verified.txHash);

      // ── Stage: pre-publish checkpoint ──────────────────────────────────
      // Upgrade the localStorage record to `sent_unpublished` BEFORE the
      // publish API call so a failure cannot orphan the payment.
      try {
        markSent(stealth.payment_id, {
          tx_hash: verified.txHash,
          chain: chainValue,
          amount: verified.amountFormatted,
        });
      } catch {
        /* never fatal */
      }

      // Log a `sent_unpublished` row eagerly so the history reflects truth
      // even if the page is hard-refreshed before publish completes.
      logPayment({
        recipient: activePending?.recipient ?? resolvedENS?.ens_name ?? "unknown",
        chain: chainValue,
        amount: verified.amountFormatted,
        txHash: verified.txHash,
        announcementId: null,
        status: "sent_unpublished",
        payment_id: stealth.payment_id,
        stealth_address:
          chainValue === "sui" ? stealth.stealth_sui_address : stealth.stealth_address,
      });

      // ── Stage: publish ─────────────────────────────────────────────────
      // Single atomic server leg: resolve pending → validate → RPC-verify →
      // encrypt metadata → reserve Turso row (HMAC dedup) → relay to Monad →
      // finalize row → telemetry.
      setPublishPhase("publishing");
      try {
        const { res, usedFallback } = await publishWithFallback(stealth, verified, chainValue);

        setAnnouncementId(res.id);
        setMonadTxHash(res.monad_tx_hash ?? null);
        upsertHistoryByTxHash(verified.txHash, {
          announcementId: res.id,
          status: "published",
        });
        try {
          markPublished(stealth.payment_id);
          // Once published, the pending vault entry has no operational
          // value — purge so the recovery banner stays clean.
          clearPending(stealth.payment_id);
          setActivePending(null);
        } catch {
          /* never fatal */
        }
        analytics.sendPaymentPublished(chainValue, verified.amountFormatted, origin === "wallet" ? "wallet" : "manual");
        analytics.sendCompleted(chainValue, verified.amountFormatted, origin === "wallet" ? "wallet" : "manual");
        setPublishPhase("published");
        setAttemptOrigin(null);
        const publishedChain = getSendChainConfig(chainValue);
        toast.success(
          `${origin === "wallet" ? "Sent" : "Verified"} ${formatCryptoAmount(verified.amountFormatted)} ${publishedChain.currencySymbol} – announcement published (#${res.id})`,
        );
        if (usedFallback) {
          toast.warning(
            "Published via fallback announcement — the server-side pending entry had expired, so payment metadata was not encrypted.",
          );
        }
        refreshIncompletePending();
        return true;
      } catch (err) {
        let message = err instanceof Error ? err.message : "Failed to publish announcement";
        if (err instanceof ApiError && err.status === 409) {
          message =
            "This payment was already announced (duplicate detected). If a previous publish attempt succeeded, the recipient can already discover it — check the registry before retrying.";
        }
        setSendError(message);
        setFlowError(message);
        setFailedPhase("publishing");
        // The on-chain tx is confirmed at this point — ALWAYS sticky.
        setPublishPhase("sent_unpublished_failure");
        try {
          markPublishFailed(stealth.payment_id, message);
        } catch {
          /* never fatal */
        }
        toast.error(message);
        refreshIncompletePending();
        return false;
      }
    },
    [
      activePending,
      logPayment,
      refreshIncompletePending,
      resolvedENS,
      upsertHistoryByTxHash,
    ],
  );

  /* ─────────────────────────────────────────────────────────────────────── */
  /* Manual publish                                                           */
  /* ─────────────────────────────────────────────────────────────────────── */
  const handleVerifyAndPublish = useCallback(async () => {
    if (!stealthResult) return;
    const hash = txHash.trim();
    if (!hash) {
      toast.error("Enter transaction hash");
      return;
    }
    analytics.sendManualPublishClicked();

    const isRetry = publishPhase === "sent_unpublished_failure";
    setIsPublishing(true);
    try {
      await attemptPublish({
        stealth: stealthResult,
        txHashValue: hash,
        chainValue: publishChain,
        origin: isRetry ? "retry" : "manual",
        // A retry means the tx already landed; failures must stay sticky.
        txConfirmed: isRetry,
      });
    } finally {
      setIsPublishing(false);
    }
  }, [attemptPublish, publishChain, publishPhase, stealthResult, txHash]);

  /* ─────────────────────────────────────────────────────────────────────── */
  /* Wallet send                                                              */
  /* ─────────────────────────────────────────────────────────────────────── */
  const handleWalletSend = useCallback(async () => {
    if (!stealthResult) return;
    const amt = walletAmount.trim();
    if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (insufficientFunds) {
      toast.error(`Insufficient ${publishChainConfig.currencySymbol} on ${publishChainConfig.label}.`);
      return;
    }

    analytics.sendWalletSendClicked(publishChain);
    setIsSending(true);
    setSendError(null);
    setVerifyError(null);
    setAttemptOrigin("wallet");
    setFailedPhase(null);
    setFlowError(null);
    setPublishPhase("signing");

    // Local (non-state) flags so the catch block can't read stale closures.
    let broadcasted = false;
    let txHashResult: string | null = null;

    try {
      if (isEvmChain(publishChain)) {
        if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
          toast.error("Connect an EVM wallet first");
          setIsSending(false);
          setPublishPhase("idle");
          return;
        }
        const evmChain = publishChain as EvmTxChain;
        const targetChain = getViemChainForEvm(evmChain);
        const targetChainName = getSendChainConfig(evmChain).label;
        const walletAny = primaryWallet as unknown as {
          switchNetwork?: (chainId: number) => Promise<void>;
          connector?: { switchNetwork?: (args: { networkChainId: number }) => Promise<void> };
          getWalletClient: (chainId?: string) => Promise<{
            account?: unknown;
            sendTransaction: (args: unknown) => Promise<string>;
            switchChain?: (args: { id: number }) => Promise<void>;
          } | null>;
        };

        try {
          if (walletAny.switchNetwork) {
            await walletAny.switchNetwork(targetChain.id);
          } else if (walletAny.connector?.switchNetwork) {
            await walletAny.connector.switchNetwork({ networkChainId: targetChain.id });
          } else {
            const tempClient = await walletAny.getWalletClient();
            await tempClient?.switchChain?.({ id: targetChain.id });
          }
        } catch (switchErr) {
          const e = switchErr as { code?: number; message?: string };
          if (e?.code === 4001 || e?.message?.toLowerCase().includes("rejected")) {
            toast.error(`Network switch to ${targetChainName} was rejected.`);
            setPublishPhase("idle");
            setIsSending(false);
            return;
          }
          toast.warning(`Could not auto-switch to ${targetChainName}. Please switch manually and retry.`);
        }

        const walletClient = await primaryWallet.getWalletClient(targetChain.id.toString());
        if (!walletClient?.account) {
          toast.error(`Could not access wallet client for ${targetChainName}`);
          setIsSending(false);
          setPublishPhase("idle");
          return;
        }
        // Do NOT pass `chain` here — we already switched chains above, and
        // passing `chain` causes viem to re-validate via the wallet's EIP-1193
        // provider. Some providers (Dynamic Labs / WalletConnect) return a
        // "JSON-RPC protocol version not supported" error during that step for
        // standard testnets (Sepolia, Arbitrum Sepolia). Omitting `chain` also
        // lets the wallet estimate gas natively, avoiding stale maxFeePerGas
        // rejections on Arbitrum Sepolia.
        txHashResult = await walletClient.sendTransaction({
          to: stealthResult.stealth_address as `0x${string}`,
          value: parseEther(amt),
        } as unknown as Parameters<typeof walletClient.sendTransaction>[0]);
        analytics.sendTxSubmitted(evmChain);
        broadcasted = true;
        setPublishPhase("broadcasting");
        setPendingTxHash(txHashResult);
        const evmPublicClient = getPublicClientForEvm(evmChain);
        await evmPublicClient.waitForTransactionReceipt({ hash: txHashResult as `0x${string}` });
      } else {
        if (!suiAccount) {
          toast.error("Connect a Sui wallet first");
          setIsSending(false);
          setPublishPhase("idle");
          return;
        }
        const tx = new Transaction();
        // Exact decimal → MIST conversion (no float rounding).
        const amountMist = parseUnits(amt, getChainDecimals("sui"));
        const [coin] = tx.splitCoins(tx.gas, [amountMist]);
        tx.transferObjects([coin], stealthResult.stealth_sui_address);
        const result = await signAndExecuteSui({ transaction: tx });
        txHashResult = result.digest;
        analytics.sendTxSubmitted("sui");
        broadcasted = true;
        setPublishPhase("broadcasting");
        setPendingTxHash(txHashResult);
        await suiClient.waitForTransaction({ digest: result.digest });
      }

      // Tx confirmed → verify + publish leg. Failures past this point are sticky.
      await attemptPublish({
        stealth: stealthResult,
        txHashValue: txHashResult!,
        chainValue: publishChain,
        origin: "wallet",
        txConfirmed: true,
      });
    } catch (err) {
      const parsed = parseBlockchainError(err);
      const message = formatErrorMessage(parsed);
      setSendError(message);
      setFlowError(message);
      if (!broadcasted || !txHashResult) {
        // We never broadcast (signing rejected / wallet error) → idle again.
        setFailedPhase("signing");
        setPublishPhase("idle");
      } else {
        // Broadcast happened, confirmation read failed → conservatively mark
        // sticky failure so the user can retry publish with the tx hash.
        setFailedPhase("broadcasting");
        setPublishPhase("sent_unpublished_failure");
        try {
          markSent(stealthResult.payment_id, {
            tx_hash: txHashResult,
            chain: publishChain,
            amount: walletAmount || undefined,
          });
          markPublishFailed(stealthResult.payment_id, message);
        } catch {
          /* never fatal */
        }
      }
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  }, [
    attemptPublish,
    insufficientFunds,
    publishChainConfig.currencySymbol,
    publishChainConfig.label,
    primaryWallet,
    publishChain,
    signAndExecuteSui,
    stealthResult,
    suiAccount,
    suiClient,
    walletAmount,
  ]);

  /* ─────────────────────────────────────────────────────────────────────── */
  /* Retry publish (from the sticky sent_unpublished_failure panel)          */
  /* ─────────────────────────────────────────────────────────────────────── */
  const handleRetryPublish = useCallback(async () => {
    if (!stealthResult) return;
    const tx = pendingTxHash ?? txHash.trim();
    if (!tx) {
      toast.error("Missing transaction hash — re-enter it in the Manual tab and try again.");
      return;
    }
    setIsPublishing(true);
    try {
      await attemptPublish({
        stealth: stealthResult,
        txHashValue: tx,
        chainValue: publishChain,
        origin: "retry",
        // Reuse the cached verification — never re-trigger the wallet on retry.
        verified: pendingVerifiedTx ?? undefined,
        txConfirmed: true,
      });
    } finally {
      setIsPublishing(false);
    }
  }, [attemptPublish, pendingTxHash, pendingVerifiedTx, publishChain, stealthResult, txHash]);

  /* ─────────────────────────────────────────────────────────────────────── */
  /* Send Another (with confirm if still in-flight)                          */
  /* ─────────────────────────────────────────────────────────────────────── */
  const handleSendAnother = useCallback(() => {
    guardDestructive({
      title: "Discard current payment?",
      description: isSentUnpublished
        ? "Funds were sent on-chain but the announcement is NOT published. The recipient won't see them until you retry publish."
        : "You have a stealth address generated. Starting a new send will discard it.",
      confirmLabel: "Yes, start a new payment",
      onConfirm: () => {
        analytics.sendAnotherClicked();
        resetForm();
      },
    });
  }, [guardDestructive, isSentUnpublished, resetForm]);

  /* ─────────────────────────────────────────────────────────────────────── */
  /* Derived UI bits                                                          */
  /* ─────────────────────────────────────────────────────────────────────── */

  /** Phase-aware label for the big "Send & Publish" button. */
  const walletButtonLabel = useMemo(() => {
    switch (publishPhase) {
      case "signing":
        return "Awaiting wallet signature…";
      case "broadcasting":
        return publishChain === "sui"
          ? "Waiting for Sui confirmation…"
          : `Waiting for ${publishChainConfig.shortLabel} confirmation…`;
      case "verifying":
        return "Verifying transaction…";
      case "publishing":
        return "Publishing announcement…";
      case "sent_unpublished_failure":
        return "Retry Publish";
      default:
        return "Send & Publish";
    }
  }, [publishChain, publishChainConfig.shortLabel, publishPhase]);

  const manualButtonLabel = useMemo(() => {
    if (publishPhase === "verifying") return "Verifying transaction…";
    if (publishPhase === "publishing") return "Publishing announcement…";
    if (publishPhase === "sent_unpublished_failure") return "Retry Publish";
    return "Publish Payment";
  }, [publishPhase]);

  const showStickyFailure = publishPhase === "sent_unpublished_failure";
  const isWalletBusy =
    isSending || isPublishing || ACTIVE_FLOW_PHASES.includes(publishPhase);

  /* ── Stage flow loader: stages + active index derived from phase ───────── */
  const flowStages = useMemo<FlowStage[]>(() => {
    const verifyStage: FlowStage = {
      id: "verifying",
      label: "Verifying transaction",
      description: `Confirming funds landed at the stealth address on ${publishChainConfig.label}`,
    };
    const publishStage: FlowStage = {
      id: "publishing",
      label: "Publishing announcement",
      description: "Encrypting metadata · relaying to Monad · finalizing registry",
    };
    if (attemptOrigin === "wallet") {
      return [
        {
          id: "signing",
          label: "Awaiting wallet signature",
          description: "Approve the transaction in your wallet",
        },
        {
          id: "broadcasting",
          label: `Broadcasting on ${publishChainConfig.label}`,
          description: "Waiting for on-chain confirmation",
        },
        verifyStage,
        publishStage,
      ];
    }
    return [verifyStage, publishStage];
  }, [attemptOrigin, publishChainConfig.label]);

  const flowActiveIndex = useMemo(() => {
    const phase: FlowPhaseId | null =
      failedPhase ??
      (ACTIVE_FLOW_PHASES.includes(publishPhase) ? (publishPhase as FlowPhaseId) : null);
    if (phase === null) return publishPhase === "published" ? flowStages.length : -1;
    const idx = flowStages.findIndex((s) => s.id === phase);
    return idx === -1 ? flowStages.length : idx;
  }, [failedPhase, flowStages, publishPhase]);

  const showFlowLoader =
    attemptOrigin !== null &&
    publishPhase !== "published" &&
    (ACTIVE_FLOW_PHASES.includes(publishPhase) || failedPhase !== null);

  const recoveryJsonForActive = useMemo(() => {
    if (!activePending) return null;
    return buildRecoveryJson(activePending);
  }, [activePending]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 pt-48 pb-12 flex flex-col items-center">
        <div className="container mx-auto px-4 w-full max-w-2xl flex flex-col items-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-10"
          >
            <HeadingScramble
              as="h1"
              className="font-display text-3xl md:text-4xl font-bold mb-2 block"
            >
              Send Private Payment
            </HeadingScramble>
            <p className="text-muted-foreground text-sm flex items-center justify-center gap-2">
              <Zap className="h-4 w-4 text-primary/80" />
              Private payments across supported chains
            </p>
          </motion.div>

          {/* ─── Mount banner: incomplete payments from previous sessions ─── */}
          {!bannerDismissed && incompletePending.length > 0 && step === "input" && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full mb-6"
            >
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] backdrop-blur-md p-4 shadow-[0_4px_24px_rgba(245,158,11,0.08),inset_0_1px_0_rgba(251,191,36,0.06)]">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/25 shrink-0">
                    <LifeBuoy className="h-4 w-4 text-amber-400" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-xs font-bold tracking-[0.16em] uppercase text-amber-400/80">
                      {incompletePending.length === 1
                        ? "1 payment needs your attention"
                        : `${incompletePending.length} payments need your attention`}
                    </p>
                    <p className="text-xs text-white/55 mt-1">
                      You started a private payment but didn't finish it. Until the announcement is
                      published, the recipient cannot discover the funds.
                    </p>
                    <div className="mt-3 space-y-2">
                      {incompletePending.slice(0, 3).map((rec) => {
                        const sent = rec.status === "sent_unpublished";
                        return (
                          <div
                            key={rec.payment_id}
                            className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/40 px-3 py-2"
                          >
                            <span className={`inline-flex h-5 px-2 items-center rounded-full text-[10px] font-bold tracking-wider uppercase ${sent ? "bg-red-500/20 text-red-300 border border-red-500/30" : "bg-amber-500/15 text-amber-300 border border-amber-500/25"}`}>
                              {sent ? "Sent · unpublished" : "Awaiting send"}
                            </span>
                            <span className="font-mono text-xs text-white/65 truncate">
                              {rec.recipient}
                            </span>
                            <span className="ml-auto flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => dismissPendingPrompt(rec.payment_id)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-white/35 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
                                aria-label="Dismiss this reminder"
                                title="Dismiss this reminder"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => resumePending(rec)}
                              >
                                {sent ? "Retry Publish" : "Resume"}
                              </Button>
                              <DownloadJsonButton
                                data={buildRecoveryJson(rec)}
                                filename={`${RECOVERY_FILENAME_PREFIX}-${rec.payment_id.slice(0, 8)}.json`}
                                label="Recovery"
                                variant="ghost"
                                size="sm"
                                tooltip="Download full recovery JSON"
                                className="h-7 px-2 text-[11px]"
                              />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <p className="text-[10px] text-white/30">
                        Stored locally on this device. Cleared after 7 days or once published.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDialog({
                            open: true,
                            title: "Dismiss all reminders for this session?",
                            description:
                              "This hides all incomplete-payment reminders until you open a new browser session.",
                            confirmLabel: "Dismiss for this session",
                            cancelLabel: "Keep reminders",
                            onConfirm: () => {
                              const ids = incompletePending.map((p) => p.payment_id);
                              const next = Array.from(new Set([...dismissedPendingIds, ...ids]));
                              writeDismissedPendingIds(next);
                              setDismissedPendingIds(next);
                              setIncompletePending([]);
                              setBannerDismissed(true);
                              setConfirmDialog(null);
                            },
                          });
                        }}
                        className="text-[11px] text-white/40 hover:text-white/70 transition-colors"
                      >
                        Dismiss all
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          <div className="w-full max-w-2xl flex flex-col items-center">
            <div className="relative rounded-2xl glass-card w-full overflow-hidden">
              <div className="absolute inset-0 overflow-hidden opacity-60 blur-[5px] pointer-events-none rounded-2xl">
                <PixelCanvas
                  gap={10}
                  speed={25}
                  colors={CARD_PIXEL_COLORS}
                  variant="default"
                />
              </div>
              <div className="relative z-10 p-8 overflow-visible">
                {/* Search bar – always visible */}
                <div className="w-full space-y-3 mb-6">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User className="h-4 w-4 shrink-0" />
                    <TooltipLabel
                      label="Recipient"
                      tooltip="ENS (e.g. bob.eth), SuiNS (e.g. alice.sui), or paste meta-address hex from Setup."
                    />
                  </div>
                  <SearchBar
                    placeholder="bob.eth, alice.sui, or meta-address"
                    value={ensName}
                    onChange={(val) => {
                      setEnsName(val);
                    }}
                    onSearch={(val) => {
                      setEnsName(val);
                      handleResolve(val);
                    }}
                    variant="minimal"
                  />

                  {recentRecipients.length > 0 && step === "input" && !isResolving && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {recentRecipients.map((r) => (
                        <button
                          key={r.name}
                          type="button"
                          onClick={() => {
                            analytics.sendRecentRecipientClicked();
                            setEnsName(r.name);
                            handleResolve(r.name);
                          }}
                          className="inline-flex items-center px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/[0.14] text-xs text-white/50 hover:text-white/80 font-display transition-colors"
                        >
                          {r.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {resolveError && step === "input" && (
                    <div className="mt-2 space-y-2">
                      {resolveError === "no-specter-setup" ? (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                          <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-medium">SPECTER not enabled by owner</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                The recipient can enable it from the{" "}
                                <Link to="/setup" className="text-primary hover:underline">Setup</Link> page.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-destructive">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          {resolveError}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <AnimatePresence mode="wait">
                  {step === "input" && (
                    <motion.div
                      key="input"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-6"
                    >
                      {isResolving && (
                        <StageFlowLoader
                          stages={[
                            {
                              id: "resolve",
                              label: "Resolving recipient",
                              description: "Looking up the SPECTER meta-address (ENS / SuiNS / IPFS)",
                            },
                            {
                              id: "stealth",
                              label: "Generating stealth address",
                              description: "Server-side ML-KEM-768 encapsulation — one-time address, unlinkable on-chain",
                            },
                          ]}
                          activeIndex={resolveStatus.startsWith("Generating") ? 1 : 0}
                        />
                      )}
                    </motion.div>
                  )}

                  {step === "generated" && stealthResult && resolvedENS && (
                    <motion.div
                      key="generated"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-6"
                    >
                      {/* Target identified card */}
                      <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-black/65 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.04)]">
                        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.05] bg-white/[0.02]">
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
                          </span>
                          <span className="font-display text-[10px] font-bold tracking-[0.2em] uppercase text-white/30">
                            Target identified
                          </span>
                          <span className="ml-auto font-display text-sm font-semibold text-white/90 truncate max-w-[180px]">
                            {resolvedENS.ens_name}
                          </span>
                        </div>
                        <div className="px-4 py-3 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-display text-[10px] font-semibold tracking-[0.16em] uppercase text-white/28 shrink-0" style={{ color: "rgba(255,255,255,0.28)" }}>
                              Protocol
                            </span>
                            <div className="flex-1 border-b border-dashed border-white/[0.06]" />
                            <span className="font-display text-xs font-bold text-emerald-400/90 tracking-wide shrink-0">
                              SPECTER ● ACTIVE
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-display text-[10px] font-semibold tracking-[0.16em] uppercase shrink-0" style={{ color: "rgba(255,255,255,0.28)" }}>
                              Security
                            </span>
                            <div className="flex-1 border-b border-dashed border-white/[0.06]" />
                            <span className="font-display text-xs font-semibold text-primary/90 shrink-0">
                              Post-Quantum Safe
                            </span>
                          </div>
                          {resolvedENS.spending_pk && (
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-display text-[10px] font-semibold tracking-[0.16em] uppercase shrink-0" style={{ color: "rgba(255,255,255,0.28)" }}>
                                Spending Key
                              </span>
                              <div className="flex-1 border-b border-dashed border-white/[0.06]" />
                              <span className="font-mono text-[10px] text-white/50 shrink-0">
                                {resolvedENS.spending_pk.slice(0, 10)}···{resolvedENS.spending_pk.slice(-6)}
                              </span>
                            </div>
                          )}
                          {activePending && (
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-display text-[10px] font-semibold tracking-[0.16em] uppercase shrink-0" style={{ color: "rgba(255,255,255,0.28)" }}>
                                Payment ID
                              </span>
                              <div className="flex-1 border-b border-dashed border-white/[0.06]" />
                              <span className="font-mono text-[10px] text-white/50 shrink-0">
                                {activePending.payment_id.slice(0, 8)}…{activePending.payment_id.slice(-4)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Recovery JSON — visible before / during send so user can save it */}
                      {recoveryJsonForActive && announcementId === null && (
                        <div className="rounded-lg border border-white/[0.06] bg-black/40 px-3 py-2.5 flex items-start gap-3">
                          <ShieldCheck className="h-4 w-4 text-emerald-400/80 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-display text-[10px] font-bold tracking-[0.18em] uppercase text-emerald-400/70">
                              Recovery checkpoint
                            </p>
                            <p className="text-[11px] text-white/45 mt-0.5">
                              Save this file before sending. If anything interrupts you, you can re-publish using it.
                            </p>
                          </div>
                          <DownloadJsonButton
                            data={recoveryJsonForActive}
                            filename={`${RECOVERY_FILENAME_PREFIX}-${activePending?.payment_id.slice(0, 8)}.json`}
                            label="Download"
                            variant="outline"
                            size="sm"
                            tooltip="Self-contained recovery JSON (payment_id + announcement)"
                            className="shrink-0"
                          />
                        </div>
                      )}

                      {/* Sticky failure panel — sent on-chain but publish failed */}
                      {showStickyFailure && (
                        <div className="rounded-xl border border-red-500/40 bg-red-500/[0.08] p-4 shadow-[inset_0_1px_0_rgba(248,113,113,0.08)]">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="font-display text-xs font-bold tracking-[0.16em] uppercase text-red-400">
                                Funds sent — announcement not published
                              </p>
                              <p className="text-[12px] text-white/60 mt-1">
                                On-chain transaction is confirmed but the SPECTER registry rejected
                                the publish call. The recipient cannot discover this payment until
                                publish succeeds. Funds are safe — just need one more click.
                              </p>
                              {pendingTxHash && (
                                <p className="font-mono text-[11px] text-white/45 mt-2 break-all">
                                  tx: {pendingTxHash}
                                </p>
                              )}
                              {!showFlowLoader && (sendError ?? activePending?.last_publish_error) && (
                                <p className="text-[11px] text-red-300/80 mt-1.5">
                                  {sendError ?? activePending?.last_publish_error}
                                </p>
                              )}
                              {activePending && activePending.publish_attempts > 0 && (
                                <p className="text-[10px] text-white/35 mt-1">
                                  {activePending.publish_attempts} publish attempt{activePending.publish_attempts !== 1 ? "s" : ""} so far
                                </p>
                              )}
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                  variant="quantum"
                                  size="sm"
                                  onClick={handleRetryPublish}
                                  disabled={isPublishing}
                                >
                                  {isPublishing ? (
                                    <>
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      Publishing…
                                    </>
                                  ) : (
                                    <>
                                      <RefreshCw className="h-3.5 w-3.5" />
                                      Retry publish
                                    </>
                                  )}
                                </Button>
                                {recoveryJsonForActive && (
                                  <DownloadJsonButton
                                    data={recoveryJsonForActive}
                                    filename={`${RECOVERY_FILENAME_PREFIX}-${activePending?.payment_id.slice(0, 8)}.json`}
                                    label="Download recovery JSON"
                                    variant="outline"
                                    size="sm"
                                    tooltip="Self-contained JSON for offline retry"
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Live stage loader — exactly which leg of the flow is running */}
                      {announcementId === null && showFlowLoader && (
                        <motion.div
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mb-4"
                        >
                          <StageFlowLoader
                            stages={flowStages}
                            activeIndex={flowActiveIndex}
                            error={flowError}
                            hint={
                              publishPhase === "publishing"
                                ? "Keep this tab open — publish finishes in one atomic server call."
                                : undefined
                            }
                          />
                        </motion.div>
                      )}

                      {announcementId === null ? (
                        <Tabs
                          value={sendMode}
                          onValueChange={(v) => {
                            const next = v as "manual" | "wallet";
                            setSendMode(next);
                            analytics.sendTabSwitched(next);
                            // P1 #7: prefill manual tab when retrying a sent payment.
                            if (next === "manual" && activePending?.status === "sent_unpublished" && activePending.tx_hash) {
                              setTxHash(activePending.tx_hash);
                              setPublishChain(activePending.chain);
                            }
                          }}
                        >
                          <div className="w-full rounded-xl border border-white/[0.08] bg-black/30 px-4 py-3 flex items-center justify-center gap-3 mb-3">
                            <span className={`text-xs font-display ${sendMode === "manual" ? "text-white/90" : "text-white/45"}`}>
                              Manual
                            </span>
                            <Switch
                              checked={sendMode === "wallet"}
                              onCheckedChange={(checked) => {
                                const next = checked ? "wallet" : "manual";
                                setSendMode(next);
                                analytics.sendTabSwitched(next);
                                if (next === "manual" && activePending?.status === "sent_unpublished" && activePending.tx_hash) {
                                  setTxHash(activePending.tx_hash);
                                  setPublishChain(activePending.chain);
                                }
                              }}
                              aria-label="Toggle send mode"
                            />
                            <span className={`text-xs font-display ${sendMode === "wallet" ? "text-white/90" : "text-white/45"}`}>
                              Send from wallet
                            </span>
                          </div>

                          {/* ─── Manual Tab ─── */}
                          <TabsContent value="manual">
                            <div className="space-y-4">
                              <div>
                                <Label className="text-xs text-muted-foreground">Chain</Label>
                                <Select
                                  value={publishChain}
                                  onValueChange={(v) => {
                                    const next = v as TxChain;
                                    setPublishChain(next);
                                    analytics.sendChainSelected(next);
                                    setVerifyError(null);
                                  }}
                                >
                                  <SelectTrigger className="mt-1 bg-black/35 border-white/10 text-white">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="border-white/10 bg-[#090b16]/95 backdrop-blur-xl text-white">
                                    {availableSendChains.map((c) => (
                                      <SelectItem key={c} value={c}>
                                        <span className="flex items-center gap-2">
                                          {getChainIcon(c)}
                                          {getSendChainConfig(c).label}
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <Label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                                  Stealth address (send {getChainIcon(publishChain)} here)
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button type="button" className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/20 text-[9px] text-white/30 hover:text-white/60 hover:border-white/40 transition-colors leading-none">?</button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs text-xs">
                                      One-time address derived from an ephemeral secret — mathematically unlinkable to the recipient on-chain. Only they can discover it by scanning with their private viewing key.
                                    </TooltipContent>
                                  </Tooltip>
                                </Label>
                                <div className="flex items-center gap-2 mt-1">
                                  <Input
                                    readOnly
                                    value={
                                      publishChain === "sui"
                                        ? stealthResult.stealth_sui_address
                                        : stealthResult.stealth_address
                                    }
                                    className="font-mono text-xs bg-muted/50 cursor-default flex-1"
                                  />
                                  <CopyButton
                                    text={
                                      publishChain === "sui"
                                        ? stealthResult.stealth_sui_address
                                        : stealthResult.stealth_address
                                    }
                                    label="Copy"
                                    variant="outline"
                                    size="sm"
                                    tooltip={`Copy ${publishChainConfig.shortLabel} stealth address`}
                                    tooltipCopied="Copied!"
                                    successMessage={`${publishChainConfig.shortLabel} address copied`}
                                  />
                                </div>
                              </div>

                              <div>
                                <Label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                                  {publishChain === "sui" ? "Transaction digest (base58)" : "Transaction hash"}
                                  {activePending?.status === "sent_unpublished" && (
                                    <span className="text-[10px] uppercase tracking-wider text-amber-400/70 font-display font-bold">prefilled</span>
                                  )}
                                </Label>
                                <Input
                                  placeholder={publishChainConfig.txHashPlaceholder}
                                  value={txHash}
                                  onChange={(e) => {
                                    setTxHash(e.target.value);
                                    setVerifyError(null);
                                    // Editing the hash starts a fresh attempt — clear
                                    // the failed-stage marker (but never the sticky
                                    // sent_unpublished_failure phase itself).
                                    setFailedPhase(null);
                                    setFlowError(null);
                                  }}
                                  className="mt-1 font-mono text-sm"
                                />
                              </div>

                              {verifyError && publishPhase !== "sent_unpublished_failure" && !showFlowLoader && (
                                <div className="flex items-center gap-2 text-sm text-destructive">
                                  <AlertCircle className="h-4 w-4 shrink-0" />
                                  {verifyError}
                                </div>
                              )}

                              <Button
                                variant="quantum"
                                className="w-full"
                                onClick={handleVerifyAndPublish}
                                disabled={isPublishing || !txHash.trim()}
                              >
                                {isPublishing ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {manualButtonLabel}
                                  </>
                                ) : (
                                  manualButtonLabel
                                )}
                              </Button>

                              <p className="text-xs text-muted-foreground text-center">
                                Publishing is required for the recipient to discover this payment.
                              </p>
                            </div>
                          </TabsContent>

                          {/* ─── Wallet Tab ─── */}
                          <TabsContent value="wallet">
                            <div className="space-y-4">
                              <div>
                                <Label className="text-xs text-muted-foreground">Chain</Label>
                                <Select
                                  value={publishChain}
                                  onValueChange={(v) => {
                                    const next = v as TxChain;
                                    setPublishChain(next);
                                    analytics.sendChainSelected(next);
                                    setSendError(null);
                                  }}
                                >
                                  <SelectTrigger className="mt-1 bg-black/35 border-white/10 text-white">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="border-white/10 bg-[#090b16]/95 backdrop-blur-xl text-white">
                                    {availableSendChains.map((c) => (
                                      <SelectItem key={c} value={c}>
                                        <span className="flex items-center gap-2">
                                          {getChainIcon(c)}
                                          {getSendChainConfig(c).label}
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <Label className="text-xs text-muted-foreground inline-flex items-center gap-1">
                                  Amount ({getChainIcon(publishChain)} {publishChainConfig.currencySymbol})
                                </Label>
                                <Input
                                  type="number"
                                  step="any"
                                  min="0"
                                  placeholder={publishChain === "sui" ? "e.g. 1.5" : "e.g. 0.01"}
                                  value={walletAmount}
                                  onChange={(e) => {
                                    setWalletAmount(e.target.value);
                                    setAmount(e.target.value);
                                    setSendError(null);
                                  }}
                                  className="mt-1 font-mono text-sm"
                                />
                                <div className="mt-1.5 text-[11px] text-white/45 flex flex-wrap items-center gap-2">
                                  <span>
                                    {isBalanceLoading
                                      ? "Fetching balance..."
                                      : walletBalance !== null
                                        ? `Balance on ${publishChainConfig.label}: ${formatCryptoAmount(walletBalance)} ${publishChainConfig.currencySymbol}`
                                        : "Connect wallet to view balance"}
                                  </span>
                                  {walletAmountNum > 0 && (
                                    <span className="text-white/60">
                                      You typed: {formatCryptoAmount(walletAmountNum.toString())} {publishChainConfig.currencySymbol}
                                    </span>
                                  )}
                                </div>
                                {balanceError && (
                                  <p className="text-[11px] text-red-300/80 mt-1">{balanceError}</p>
                                )}
                                {insufficientFunds && (
                                  <p className="text-[11px] text-amber-300/90 mt-1">
                                    Insufficient funds on {publishChainConfig.label}.{" "}
                                    <a
                                      href={getFundingUrl(publishChain)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="underline underline-offset-2 hover:text-amber-200"
                                    >
                                      Get test funds
                                    </a>
                                  </p>
                                )}
                              </div>

                              <div>
                                <Label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                                  To (stealth address)
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button type="button" className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/20 text-[9px] text-white/30 hover:text-white/60 hover:border-white/40 transition-colors leading-none">?</button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs text-xs">
                                      One-time address derived from an ephemeral secret — mathematically unlinkable to the recipient on-chain. Only they can discover it by scanning with their private viewing key.
                                    </TooltipContent>
                                  </Tooltip>
                                </Label>
                                <Input
                                  readOnly
                                  value={
                                    publishChain === "sui"
                                      ? stealthResult.stealth_sui_address
                                      : stealthResult.stealth_address
                                  }
                                  className="mt-1 font-mono text-xs bg-muted/50 cursor-default"
                                />
                              </div>

                              {isEvmChain(publishChain) ? (
                                <div className="space-y-3">
                                  {evmConnected ? (
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Wallet className="h-4 w-4 text-primary/70" />
                                        <span className="font-mono text-xs truncate max-w-[240px]">
                                          {primaryWallet?.address}
                                        </span>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs text-muted-foreground hover:text-destructive"
                                        onClick={() => handleLogOut()}
                                      >
                                        Disconnect
                                      </Button>
                                    </div>
                                  ) : (
                                    <Button
                                      variant="outline"
                                      className="w-full"
                                      onClick={() => setShowAuthFlow(true)}
                                    >
                                      <Wallet className="h-4 w-4 mr-2" />
                                      Connect EVM Wallet
                                    </Button>
                                  )}
                                  <Button
                                    variant="quantum"
                                    className="w-full"
                                    onClick={
                                      publishPhase === "sent_unpublished_failure"
                                        ? handleRetryPublish
                                        : handleWalletSend
                                    }
                                    disabled={
                                      (isSending || isPublishing) ||
                                      (!evmConnected && publishPhase !== "sent_unpublished_failure") ||
                                      insufficientFunds
                                    }
                                  >
                                    {isWalletBusy ? (
                                      <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        {walletButtonLabel}
                                      </>
                                    ) : (
                                      walletButtonLabel
                                    )}
                                  </Button>
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  {suiConnected ? (
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Wallet className="h-4 w-4 text-primary/70" />
                                        <span className="font-mono text-xs truncate max-w-[240px]">
                                          {suiAccount?.address}
                                        </span>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs text-muted-foreground hover:text-destructive"
                                        onClick={() => disconnectSui()}
                                      >
                                        Disconnect
                                      </Button>
                                    </div>
                                  ) : (
                                    <ConnectModal
                                      trigger={
                                        <Button
                                          variant="outline"
                                          className="w-full"
                                          onClick={() => setSuiConnectOpen(true)}
                                        >
                                          <Wallet className="h-4 w-4 mr-2" />
                                          Connect Sui Wallet
                                        </Button>
                                      }
                                      open={suiConnectOpen}
                                      onOpenChange={setSuiConnectOpen}
                                    />
                                  )}
                                  <Button
                                    variant="quantum"
                                    className="w-full"
                                    onClick={
                                      publishPhase === "sent_unpublished_failure"
                                        ? handleRetryPublish
                                        : handleWalletSend
                                    }
                                    disabled={
                                      (isSending || isPublishing) ||
                                      (!suiConnected && publishPhase !== "sent_unpublished_failure") ||
                                      insufficientFunds
                                    }
                                  >
                                    {isWalletBusy ? (
                                      <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        {walletButtonLabel}
                                      </>
                                    ) : (
                                      walletButtonLabel
                                    )}
                                  </Button>
                                </div>
                              )}

                              {sendError && !showStickyFailure && (
                                <div className="flex items-center gap-2 text-sm text-destructive">
                                  <AlertCircle className="h-4 w-4 shrink-0" />
                                  {sendError}
                                </div>
                              )}

                              <div className="rounded-lg border border-white/[0.05] bg-black/40 backdrop-blur-sm shadow-[inset_3px_0_0_rgba(124,58,237,0.4)] px-4 py-3">
                                <div className="flex items-start gap-3">
                                  <Lock className="h-4 w-4 text-primary/70 mt-0.5 shrink-0" />
                                  <div>
                                    <p className="font-display text-[10px] font-bold tracking-[0.18em] uppercase text-primary/60 mb-1">Zero-Knowledge Route</p>
                                    <p className="text-xs text-white/40">
                                      Only {resolvedENS.ens_name} can find this payment. Funds are sent on {publishChainConfig.label}.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </TabsContent>
                        </Tabs>
                      ) : (
                        <div className="flex flex-col items-center w-full relative">
                          <ReceiptConfetti />
                          <AnimatedTicket
                            ticketId={String(announcementId)}
                            amount={verifiedTx ? parseFloat(verifiedTx.amountFormatted) : parseFloat(amount) || 0}
                            date={new Date()}
                            cardHolder={resolvedENS?.ens_name ?? "Recipient"}
                            last4Digits={stealthResult.stealth_address.replace(/^0x/, "").slice(-4)}
                            barcodeValue={`${announcementId}${stealthResult.stealth_address.slice(2, 14)}`}
                            currency={getSendChainConfig(verifiedTx?.chain ?? publishChain).currencySymbol}
                          />
                          <div className="w-full max-w-lg mt-4 rounded-lg border border-white/[0.08] bg-black/35 p-4">
                            <p className="font-display text-[10px] font-bold tracking-[0.16em] uppercase text-emerald-400/75 mb-3">
                              Payment published successfully
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                              <div className="flex items-center gap-2 text-white/70">
                                {getChainIcon(verifiedTx?.chain ?? publishChain, 15)}
                                <span>Chain: {getSendChainConfig(verifiedTx?.chain ?? publishChain).label}</span>
                              </div>
                              <div className="text-white/70">
                                Payment ID: <span className="font-mono">{stealthResult.payment_id.slice(0, 10)}...{stealthResult.payment_id.slice(-6)}</span>
                              </div>
                              <div className="text-white/70">
                                Announcement: <span className="font-mono">#{announcementId}</span>
                              </div>
                              <div className="text-white/70">
                                Tx: <span className="font-mono">{(verifiedTx?.txHash ?? pendingTxHash ?? "").slice(0, 10)}...{(verifiedTx?.txHash ?? pendingTxHash ?? "").slice(-6)}</span>
                              </div>
                              {monadTxHash && (
                                <div className="text-white/70 md:col-span-2 flex items-center gap-1.5">
                                  <span>
                                    Monad announce:{" "}
                                    <span className="font-mono">
                                      {monadTxHash.slice(0, 10)}...{monadTxHash.slice(-6)}
                                    </span>
                                  </span>
                                  {getExplorerTxUrl("monad", monadTxHash) && (
                                    <a
                                      href={getExplorerTxUrl("monad", monadTxHash)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-primary/60 hover:text-primary transition-colors"
                                      aria-label="View announce transaction on Monad explorer"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col gap-3 mt-6 w-full max-w-xs mx-auto">
                            <DownloadJsonButton
                              data={{
                                stealth_address: stealthResult.stealth_address,
                                stealth_sui_address: stealthResult.stealth_sui_address,
                                amount_evm: verifiedTx && verifiedTx.chain !== "sui" ? verifiedTx.amountFormatted : amount,
                                amount_sui: verifiedTx?.chain === "sui" ? verifiedTx.amountFormatted : undefined,
                                announcement_id: announcementId,
                                payment_id: stealthResult.payment_id,
                                recipient: resolvedENS?.ens_name,
                                tx_hash: verifiedTx?.txHash ?? pendingTxHash ?? undefined,
                                monad_announce_tx_hash: monadTxHash ?? undefined,
                              }}
                              filename="specter-payment-details.json"
                              label="Download"
                              variant="outline"
                              size="default"
                              className="w-full"
                              tooltip="Save receipt as JSON"
                            />
                            <Button variant="quantum" className="w-full" onClick={handleSendAnother}>
                              Send Another
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* ─── Recent Transactions ─── */}
          {paymentHistory.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="w-full max-w-2xl mt-8"
            >
              <div className="rounded-xl overflow-hidden border border-amber-500/15 bg-black/60 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(251,191,36,0.04)]">
                <button
                  type="button"
                  onClick={() => setHistoryExpanded((p) => !p)}
                  className="w-full flex items-center justify-between px-4 py-3 border-b border-amber-500/10 bg-amber-500/[0.03] hover:bg-amber-500/[0.06] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 border border-amber-500/15">
                      <Clock className="h-3 w-3 text-amber-400/80" />
                    </span>
                    <span className="font-display text-[10px] font-bold tracking-[0.16em] uppercase text-amber-400/70">
                      Recent Transactions
                    </span>
                    <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-amber-500/15 text-[9px] font-bold text-amber-400/80">
                      {paymentHistory.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[9px] font-medium tracking-wide uppercase text-white/20 bg-white/[0.04] border border-white/[0.06]">
                      session only
                    </span>
                    {historyExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5 text-amber-400/50" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-amber-400/50" />
                    )}
                  </div>
                </button>

                <AnimatePresence>
                  {historyExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="divide-y divide-white/[0.04]">
                        {paymentHistory.map((tx, i) => {
                          const txChain = getSendChainConfig(tx.chain);
                          const explorerUrl = getExplorerTxUrl(tx.chain, tx.txHash);
                          const ago = getRelativeTime(tx.timestamp);
                          const isPending = (tx.status ?? "published") === "sent_unpublished";
                          return (
                            <div
                              key={`${tx.txHash}-${i}`}
                              className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${isPending ? "bg-red-500/[0.04] hover:bg-red-500/[0.07]" : "hover:bg-white/[0.02]"}`}
                            >
                              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.06] shrink-0">
                                {getChainIcon(tx.chain)}
                              </span>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-mono text-xs text-white/70 truncate max-w-[120px]">
                                    {tx.recipient}
                                  </span>
                                  <span className="text-[10px] text-white/20">·</span>
                                  <span className="font-mono text-xs font-medium text-amber-400/80 inline-flex items-center gap-1">
                                    {formatCryptoAmount(tx.amount)} {txChain.currencySymbol}
                                    {getChainIcon(tx.chain, 12)}
                                  </span>
                                  <span className="text-[10px] text-white/25">
                                    {txChain.shortLabel}
                                  </span>
                                  {isPending ? (
                                    <span className="inline-flex items-center h-4 px-1.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 text-[9px] font-bold tracking-wider uppercase">
                                      Unpublished
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 h-4 px-1.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 text-[9px] font-bold tracking-wider uppercase">
                                      <Check className="h-2.5 w-2.5" /> Published
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="font-mono text-[10px] text-white/25 truncate max-w-[100px]">
                                    {tx.txHash.slice(0, 10)}…{tx.txHash.slice(-6)}
                                  </span>
                                  {explorerUrl && (
                                    <a
                                      href={explorerUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-amber-400/40 hover:text-amber-400/70 transition-colors"
                                    >
                                      <ExternalLink className="h-2.5 w-2.5" />
                                    </a>
                                  )}
                                  {isPending && tx.payment_id && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const rec = getActivePending().find((r) => r.payment_id === tx.payment_id);
                                        if (rec) resumePending(rec);
                                        else toast.error("Recovery data expired or missing — re-enter the tx hash in the Manual tab.");
                                      }}
                                      className="ml-1 text-[10px] text-red-300/80 hover:text-red-200 underline underline-offset-2"
                                    >
                                      retry publish
                                    </button>
                                  )}
                                </div>
                              </div>

                              <span className="text-[10px] text-white/20 shrink-0 whitespace-nowrap">
                                {ago}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="px-4 py-2 border-t border-white/[0.04] bg-white/[0.01]">
                        <p className="text-[10px] text-white/20 text-center">
                          Stored in session — clears when you close this tab
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </div>
      </main>

      <Footer />

      {/* Global destructive-action confirm dialog */}
      <AlertDialog
        open={!!confirmDialog?.open}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              {confirmDialog?.title ?? "Are you sure?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{confirmDialog?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 hover:bg-amber-500/90 text-black"
              onClick={() => confirmDialog?.onConfirm?.()}
            >
              {confirmDialog?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
