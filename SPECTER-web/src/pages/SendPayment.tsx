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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/base/tabs";
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
import { EthereumIcon, SuiIcon } from "@/components/ui/specialized/chain-icons";
import { formatCryptoAmount } from "@/lib/utils";
import { Link } from "react-router-dom";
import { CoreSpinLoader } from "@/components/ui/core-spin-loader";
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
import { useTestnet } from "@/lib/blockchain/chainConfig";
import { analytics } from "@/lib/analytics";

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
import { publicClient } from "@/lib/blockchain/viemClient";
import { chain } from "@/lib/blockchain/chainConfig";
import { parseEther } from "viem";

type SendStep = "input" | "generated" | "published";

/**
 * Fine-grained lifecycle of a single send attempt.
 *
 *  - idle: nothing in flight
 *  - signing: wallet popup open, awaiting user signature
 *  - broadcasting: tx submitted, waiting for confirmation
 *  - publishing: tx confirmed, calling /registry/announcements
 *  - sent_unpublished_failure: ON-CHAIN OK, REGISTRY FAILED — sticky
 *  - published: success
 */
type PublishPhase =
  | "idle"
  | "signing"
  | "broadcasting"
  | "publishing"
  | "sent_unpublished_failure"
  | "published";

interface ConfirmDialogState {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
}

const RECOVERY_FILENAME_PREFIX = "specter-recovery";

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

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const refreshIncompletePending = useCallback(() => {
    try {
      setIncompletePending(getActivePending());
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

  // Wallet hooks
  const { primaryWallet, setShowAuthFlow, handleLogOut } = useDynamicContext();
  const suiAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: disconnectSui } = useDisconnectWallet();
  const { mutateAsync: signAndExecuteSui } = useSignAndExecuteTransaction();

  const evmConnected = !!primaryWallet;
  const suiConnected = !!suiAccount;

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
    [],
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
    }): Promise<boolean> => {
      const { stealth, txHashValue, chainValue, origin } = args;
      const expectedRecipient =
        chainValue === "sui" ? stealth.stealth_sui_address : stealth.stealth_address;
      if (!expectedRecipient) {
        toast.error(`${chainValue === "sui" ? "Sui" : "Ethereum"} stealth address not available`);
        return false;
      }

      setPublishPhase("publishing");
      setVerifyError(null);

      try {
        const verified = args.verified ?? (await verifyTx(txHashValue, chainValue, expectedRecipient));
        setVerifiedTx(verified);
        setPendingVerifiedTx(verified);
        setPendingTxHash(verified.txHash);

        // ── critical section ──────────────────────────────────────────
        // Record that on-chain submission succeeded BEFORE we attempt the
        // publish API. If publish fails, the pending record still has
        // tx_hash so the retry path is trivially correct.
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

        const res = await api.publishAnnouncement({
          payment_id: stealth.payment_id,
          // Fallback if server-side pending entry expired (e.g. restart).
          announcement: stealth.announcement,
          tx_hash: verified.txHash,
          amount: verified.amountFormatted,
          chain: chainValue,
        });

        setAnnouncementId(res.id);
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
        toast.success(
          `${origin === "wallet" ? "Sent" : "Verified"} ${formatCryptoAmount(verified.amountFormatted)} ${chainValue === "sui" ? "SUI" : "ETH"} – announcement published (#${res.id})`,
        );
        refreshIncompletePending();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to verify or publish";
        setVerifyError(message);
        setSendError(message);
        // We only enter the sticky failure state if the tx was confirmed on-chain.
        // If verifyTx itself failed, there are no orphan funds yet.
        if (pendingTxHash || args.verified) {
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
    },
    [
      activePending,
      logPayment,
      pendingTxHash,
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

    setIsPublishing(true);
    try {
      await attemptPublish({
        stealth: stealthResult,
        txHashValue: hash,
        chainValue: publishChain,
        origin: publishPhase === "sent_unpublished_failure" ? "retry" : "manual",
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

    analytics.sendWalletSendClicked(publishChain);
    setIsSending(true);
    setSendError(null);
    setVerifyError(null);
    setPublishPhase("signing");

    try {
      let txHashResult: string;

      if (publishChain === "ethereum") {
        if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
          toast.error("Connect an Ethereum wallet first");
          setIsSending(false);
          setPublishPhase("idle");
          return;
        }
        const walletClient = await primaryWallet.getWalletClient(chain.id.toString());
        if (!walletClient?.account) {
          toast.error("Could not get wallet");
          setIsSending(false);
          setPublishPhase("idle");
          return;
        }
        txHashResult = await walletClient.sendTransaction({
          to: stealthResult.stealth_address as `0x${string}`,
          value: parseEther(amt),
          account: walletClient.account,
          chain,
        } as unknown as Parameters<typeof walletClient.sendTransaction>[0]);
        analytics.sendTxSubmitted("ethereum");
        setPublishPhase("broadcasting");
        setPendingTxHash(txHashResult);
        await publicClient.waitForTransactionReceipt({ hash: txHashResult as `0x${string}` });
      } else {
        if (!suiAccount) {
          toast.error("Connect a Sui wallet first");
          setIsSending(false);
          setPublishPhase("idle");
          return;
        }
        const tx = new Transaction();
        const amountMist = BigInt(Math.floor(Number(amt) * 1e9));
        const [coin] = tx.splitCoins(tx.gas, [amountMist]);
        tx.transferObjects([coin], stealthResult.stealth_sui_address);
        const result = await signAndExecuteSui({ transaction: tx });
        txHashResult = result.digest;
        analytics.sendTxSubmitted("sui");
        setPublishPhase("broadcasting");
        setPendingTxHash(txHashResult);
        await suiClient.waitForTransaction({ digest: result.digest });
      }

      // Tx confirmed → publish leg.
      await attemptPublish({
        stealth: stealthResult,
        txHashValue: txHashResult,
        chainValue: publishChain,
        origin: "wallet",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transaction failed";
      setSendError(message);
      // If we never broadcast (signing rejected) → idle again.
      if (publishPhase === "signing") {
        setPublishPhase("idle");
      } else {
        // Broadcast happened, on-chain confirmation failed → conservatively
        // mark sticky failure so user can retry publish with the tx hash.
        setPublishPhase("sent_unpublished_failure");
      }
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  }, [
    attemptPublish,
    primaryWallet,
    publishChain,
    publishPhase,
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
        verified: pendingVerifiedTx ?? undefined,
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
        return publishChain === "sui" ? "Waiting for Sui confirmation…" : "Waiting for confirmation…";
      case "publishing":
        return "Publishing announcement…";
      case "sent_unpublished_failure":
        return "Retry Publish";
      default:
        return "Send & Publish";
    }
  }, [publishChain, publishPhase]);

  const manualButtonLabel = useMemo(() => {
    if (publishPhase === "publishing") return "Publishing announcement…";
    if (publishPhase === "sent_unpublished_failure") return "Retry Publish";
    return "Publish Payment";
  }, [publishPhase]);

  const showStickyFailure = publishPhase === "sent_unpublished_failure";

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
              ENS · SuiNS · stealth · private
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
                        onClick={() => setBannerDismissed(true)}
                        className="text-[11px] text-white/40 hover:text-white/70 transition-colors"
                      >
                        Dismiss
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
                        <div className="flex flex-col items-center gap-2">
                          <CoreSpinLoader />
                          {resolveStatus && (
                            <p className="text-xs text-white/50">{resolveStatus}</p>
                          )}
                        </div>
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
                              {sendError && (
                                <p className="text-[11px] text-red-300/80 mt-1.5">
                                  {sendError}
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
                          <TabsList className="w-full">
                            <TabsTrigger value="wallet" className="flex-1">Send from Wallet</TabsTrigger>
                            <TabsTrigger value="manual" className="flex-1">Manual</TabsTrigger>
                          </TabsList>

                          {/* ─── Manual Tab ─── */}
                          <TabsContent value="manual">
                            <div className="space-y-4">
                              <div>
                                <Label className="text-xs text-muted-foreground">Chain</Label>
                                <Select
                                  value={publishChain}
                                  onValueChange={(v) => {
                                    setPublishChain(v as TxChain);
                                    setVerifyError(null);
                                  }}
                                >
                                  <SelectTrigger className="mt-1">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="ethereum">
                                      <span className="flex items-center gap-2">
                                        <EthereumIcon size={14} />
                                        Ethereum
                                      </span>
                                    </SelectItem>
                                    {stealthResult.stealth_sui_address && (
                                      <SelectItem value="sui">
                                        <span className="flex items-center gap-2">
                                          <SuiIcon size={14} className="text-[#4DA2FF]" />
                                          Sui
                                        </span>
                                      </SelectItem>
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <Label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                                  Stealth address (send {publishChain === "sui" ? <SuiIcon size={14} /> : <EthereumIcon size={14} />} here)
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
                                    tooltip={`Copy ${publishChain === "sui" ? "Sui" : "EVM"} stealth address`}
                                    tooltipCopied="Copied!"
                                    successMessage={`${publishChain === "sui" ? "Sui" : "EVM"} address copied`}
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
                                  placeholder={publishChain === "sui" ? "e.g. DFBxP4qNbDPYyXdwwDxUu3MSVXV13g51PwHkWv34VMCv" : "0x..."}
                                  value={txHash}
                                  onChange={(e) => {
                                    setTxHash(e.target.value);
                                    setVerifyError(null);
                                  }}
                                  className="mt-1 font-mono text-sm"
                                />
                              </div>

                              {verifyError && publishPhase !== "sent_unpublished_failure" && (
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
                                    {publishPhase === "publishing" ? "Publishing announcement…" : "Routing in stealth..."}
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
                                    setPublishChain(v as TxChain);
                                    setSendError(null);
                                  }}
                                >
                                  <SelectTrigger className="mt-1">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="ethereum">
                                      <span className="flex items-center gap-2">
                                        <EthereumIcon size={14} />
                                        Ethereum
                                      </span>
                                    </SelectItem>
                                    {stealthResult.stealth_sui_address && (
                                      <SelectItem value="sui">
                                        <span className="flex items-center gap-2">
                                          <SuiIcon size={14} className="text-[#4DA2FF]" />
                                          Sui
                                        </span>
                                      </SelectItem>
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <Label className="text-xs text-muted-foreground inline-flex items-center gap-1">
                                  Amount ({publishChain === "sui" ? <SuiIcon size={14} /> : <EthereumIcon size={14} />})
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

                              {publishChain === "ethereum" ? (
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
                                      (isSending || isPublishing) || (!evmConnected && publishPhase !== "sent_unpublished_failure")
                                    }
                                  >
                                    {isSending || isPublishing || publishPhase === "publishing" || publishPhase === "broadcasting" || publishPhase === "signing" ? (
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
                                      (isSending || isPublishing) || (!suiConnected && publishPhase !== "sent_unpublished_failure")
                                    }
                                  >
                                    {isSending || isPublishing || publishPhase === "publishing" || publishPhase === "broadcasting" || publishPhase === "signing" ? (
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
                                      Only {resolvedENS.ens_name} can find this payment. Onchain observers see nothing.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </TabsContent>
                        </Tabs>
                      ) : (
                        <div className="flex flex-col items-center w-full">
                          <AnimatedTicket
                            ticketId={String(announcementId)}
                            amount={verifiedTx ? parseFloat(verifiedTx.amountFormatted) : parseFloat(amount) || 0}
                            date={new Date()}
                            cardHolder={resolvedENS?.ens_name ?? "Recipient"}
                            last4Digits={stealthResult.stealth_address.replace(/^0x/, "").slice(-4)}
                            barcodeValue={`${announcementId}${stealthResult.stealth_address.slice(2, 14)}`}
                            currency={verifiedTx?.chain === "sui" ? "SUI" : "ETH"}
                          />
                          <div className="flex flex-col gap-3 mt-6 w-full max-w-xs mx-auto">
                            <DownloadJsonButton
                              data={{
                                stealth_address: stealthResult.stealth_address,
                                stealth_sui_address: stealthResult.stealth_sui_address,
                                amount_eth: verifiedTx?.chain === "ethereum" ? verifiedTx.amountFormatted : amount,
                                amount_sui: verifiedTx?.chain === "sui" ? verifiedTx.amountFormatted : undefined,
                                announcement_id: announcementId,
                                payment_id: stealthResult.payment_id,
                                recipient: resolvedENS?.ens_name,
                                tx_hash: verifiedTx?.txHash ?? pendingTxHash ?? undefined,
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
                          const isEth = tx.chain === "ethereum";
                          const explorerBase = isEth
                            ? useTestnet
                              ? "https://sepolia.etherscan.io/tx/"
                              : "https://etherscan.io/tx/"
                            : useTestnet
                              ? "https://suiscan.xyz/testnet/tx/"
                              : "https://suiscan.xyz/mainnet/tx/";
                          const ago = getRelativeTime(tx.timestamp);
                          const isPending = (tx.status ?? "published") === "sent_unpublished";
                          return (
                            <div
                              key={`${tx.txHash}-${i}`}
                              className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${isPending ? "bg-red-500/[0.04] hover:bg-red-500/[0.07]" : "hover:bg-white/[0.02]"}`}
                            >
                              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.06] shrink-0">
                                {isEth ? (
                                  <EthereumIcon size={14} />
                                ) : (
                                  <SuiIcon size={14} className="text-[#4DA2FF]" />
                                )}
                              </span>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-mono text-xs text-white/70 truncate max-w-[120px]">
                                    {tx.recipient}
                                  </span>
                                  <span className="text-[10px] text-white/20">·</span>
                                  <span className="font-mono text-xs font-medium text-amber-400/80">
                                    {formatCryptoAmount(tx.amount)} {isEth ? "ETH" : "SUI"}
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
                                  <a
                                    href={`${explorerBase}${tx.txHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-amber-400/40 hover:text-amber-400/70 transition-colors"
                                  >
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
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
