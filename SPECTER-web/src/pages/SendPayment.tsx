import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/ui/search-bar";
import {
  Check,
  Zap,
  ArrowRight,
  Loader2,
  Lock,
  AlertCircle,
  User,
  Wallet,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { CopyButton } from "@/components/ui/copy-button";
import { DownloadJsonButton } from "@/components/ui/download-json-button";
import { TooltipLabel } from "@/components/ui/tooltip-label";
import { HeadingScramble } from "@/components/ui/heading-scramble";
import { PixelCanvas } from "@/components/ui/pixel-canvas";
import { AnimatedTicket } from "@/components/ui/ticket-confirmation-card";
import { api, ApiError, type ResolveEnsResponse, type CreateStealthResponse } from "@/lib/api";
import { verifyTx, type TxChain, type VerifiedTx } from "@/lib/verifyTx";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const CARD_PIXEL_COLORS = ["#8b5cf618", "#a78bfa14", "#7c3aed12", "#c4b5fd10"];
import { validateEnsName, EnsResolverError } from "@/lib/ensResolver";
import { validateSuinsName, SuinsResolverError } from "@/lib/suinsResolver";
import { EthereumIcon, SuiIcon } from "@/components/ui/chain-icons";
import { Link } from "react-router-dom";

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
import { publicClient } from "@/lib/viemClient";
import { chain } from "@/lib/chainConfig";
import { parseEther } from "viem";

type SendStep = "input" | "generated" | "published";

export default function SendPayment() {
  const [step, setStep] = useState<SendStep>("input");
  const [ensName, setEnsName] = useState("");
  const [amount, setAmount] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [resolveStatus, setResolveStatus] = useState<string>("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedENS, setResolvedENS] = useState<ResolveEnsResponse | null>(null);
  const [stealthResult, setStealthResult] = useState<CreateStealthResponse | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [announcementId, setAnnouncementId] = useState<number | null>(null);
  const [txHash, setTxHash] = useState("");
  const [publishChain, setPublishChain] = useState<TxChain>("ethereum");
  const [verifiedTx, setVerifiedTx] = useState<VerifiedTx | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Wallet send state
  const [, setSendMode] = useState<"manual" | "wallet">("wallet");
  const [walletAmount, setWalletAmount] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [suiConnectOpen, setSuiConnectOpen] = useState(false);

  // Wallet hooks
  const { primaryWallet, setShowAuthFlow, handleLogOut } = useDynamicContext();
  const suiAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: disconnectSui } = useDisconnectWallet();
  const { mutateAsync: signAndExecuteSui } = useSignAndExecuteTransaction();

  const evmConnected = !!primaryWallet;
  const suiConnected = !!suiAccount;

  const handleResolve = async (overrideName?: string) => {
    const name = (overrideName || ensName).trim();
    if (!name) {
      toast.error("Enter a name (e.g. bob.eth or alice.sui) or paste meta-address (hex)");
      return;
    }

    // Check if it's a hex meta-address
    const looksLikeHex =
      /^[0-9a-fA-F]+$/.test(name.replace(/^0x/, "")) && name.length > 100;
    if (looksLikeHex) {
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

      // Auto-generate stealth address
      setIsResolving(true);
      setResolveStatus("Generating stealth address…");
      try {
        const stealth = await api.createStealth({ meta_address: metaHex });
        setStealthResult(stealth);
        setStep("generated");
        toast.success("Stealth address generated");
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Failed to create stealth payment";
        toast.error(message);
      } finally {
        setIsResolving(false);
        setResolveStatus("");
      }
      return;
    }

    const isSuiName = name.endsWith(".sui");
    const normalized = name.includes(".") ? name : `${name}.eth`;

    setIsResolving(true);
    setResolveStatus("Resolving…");
    setResolveError(null);
    setResolvedENS(null);
    setStealthResult(null);

    // Validate name format
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
      toast.error(msg);
      setIsResolving(false);
      setResolveStatus("");
      return;
    }

    // Resolve via backend
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
      toast.success(`Resolved ${resolved.ens_name}`);

      // Auto-generate stealth address
      setResolveStatus("Generating stealth address…");
      const stealth = await api.createStealth({ meta_address: resolved.meta_address });
      setStealthResult(stealth);
      setStep("generated");
      toast.success("Stealth address generated");
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      const message = apiErr?.message ?? `Failed to resolve ${isSuiName ? "SuiNS" : "ENS"}`;
      const code = apiErr?.code;
      if (code === "NO_SPECTER_RECORD" || code === "NO_SUINS_SPECTER_RECORD") {
        setResolveError("no-specter-setup");
      } else if (code === "IPFS_ERROR") {
        setResolveError(`${message} Try again later.`);
      } else {
        setResolveError(message);
      }
      toast.error(message);
    } finally {
      setIsResolving(false);
      setResolveStatus("");
    }
  };

  const handleVerifyAndPublish = async () => {
    if (!stealthResult) return;
    const hash = txHash.trim();
    if (!hash) {
      toast.error("Enter transaction hash");
      return;
    }
    const expectedRecipient =
      publishChain === "sui"
        ? stealthResult.stealth_sui_address
        : stealthResult.stealth_address;
    if (!expectedRecipient) {
      toast.error(`${publishChain === "sui" ? "Sui" : "Ethereum"} stealth address not available`);
      return;
    }

    setIsPublishing(true);
    setVerifyError(null);
    setVerifiedTx(null);
    try {
      const verified = await verifyTx(hash, publishChain, expectedRecipient);
      setVerifiedTx(verified);

      const res = await api.publishAnnouncement({
        ephemeral_key: stealthResult.announcement.ephemeral_key,
        view_tag: stealthResult.view_tag,
        tx_hash: verified.txHash,
        amount: verified.amountFormatted,
        chain: publishChain,
      });
      setAnnouncementId(res.id);
      toast.success(`Verified ${verified.amountFormatted} ${publishChain === "sui" ? "SUI" : "ETH"} – announcement published (#${res.id})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to verify or publish";
      setVerifyError(message);
      toast.error(message);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleWalletSend = async () => {
    if (!stealthResult) return;
    const amt = walletAmount.trim();
    if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    setIsSending(true);
    setSendError(null);

    try {
      let txHashResult: string;

      if (publishChain === "ethereum") {
        if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
          toast.error("Connect an Ethereum wallet first");
          setIsSending(false);
          return;
        }
        const walletClient = await primaryWallet.getWalletClient(chain.id.toString());
        if (!walletClient?.account) {
          toast.error("Could not get wallet");
          setIsSending(false);
          return;
        }
        txHashResult = await walletClient.sendTransaction({
          to: stealthResult.stealth_address as `0x${string}`,
          value: parseEther(amt),
          account: walletClient.account,
          chain,
        } as unknown as Parameters<typeof walletClient.sendTransaction>[0]);
        await publicClient.waitForTransactionReceipt({ hash: txHashResult as `0x${string}` });
      } else {
        if (!suiAccount) {
          toast.error("Connect a Sui wallet first");
          setIsSending(false);
          return;
        }
        const tx = new Transaction();
        const amountMist = BigInt(Math.floor(Number(amt) * 1e9));
        const [coin] = tx.splitCoins(tx.gas, [amountMist]);
        tx.transferObjects([coin], stealthResult.stealth_sui_address);
        const result = await signAndExecuteSui({ transaction: tx });
        txHashResult = result.digest;
        await suiClient.waitForTransaction({ digest: result.digest });
      }

      // Verify + publish
      const expectedAddr = publishChain === "sui"
        ? stealthResult.stealth_sui_address
        : stealthResult.stealth_address;
      const verified = await verifyTx(txHashResult, publishChain, expectedAddr);
      setVerifiedTx(verified);

      const res = await api.publishAnnouncement({
        ephemeral_key: stealthResult.announcement.ephemeral_key,
        view_tag: stealthResult.view_tag,
        tx_hash: verified.txHash,
        amount: verified.amountFormatted,
        chain: publishChain,
      });
      setAnnouncementId(res.id);
      toast.success(`Sent ${verified.amountFormatted} ${publishChain === "sui" ? "SUI" : "ETH"} – announcement published (#${res.id})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transaction failed";
      setSendError(message);
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  };

  const resetForm = () => {
    setStep("input");
    setEnsName("");
    setAmount("");
    setResolvedENS(null);
    setStealthResult(null);
    setAnnouncementId(null);
    setResolveError(null);
    setResolveStatus("");
    setTxHash("");
    setPublishChain("ethereum");
    setVerifiedTx(null);
    setVerifyError(null);
    setSendMode("manual");
    setWalletAmount("");
    setIsSending(false);
    setSendError(null);
  };

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
                      if (step !== "input") {
                        setStep("input");
                        setResolvedENS(null);
                        setStealthResult(null);
                        setAnnouncementId(null);
                        setResolveError(null);
                      }
                    }}
                    onSearch={(val) => {
                      setEnsName(val);
                      if (step !== "input") {
                        setStep("input");
                        setResolvedENS(null);
                        setStealthResult(null);
                        setAnnouncementId(null);
                        setResolveError(null);
                      }
                      handleResolve(val);
                    }}
                    variant="minimal"
                  />
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
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {resolveStatus || "Resolving…"}
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
                      {/* SPECTER Enabled info card */}
                      <div className="p-4 rounded-lg bg-success/10 border border-success/20">
                        <div className="flex items-center gap-2 mb-3">
                          <Check className="h-4 w-4 text-success" />
                          <span className="font-medium text-success">
                            {resolvedENS.ens_name}
                          </span>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">SPECTER</span>
                            <span className="text-xs font-medium text-success">Enabled</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Security</span>
                            <span className="text-xs font-medium text-success">Post-Quantum Safe</span>
                          </div>
                          {resolvedENS.spending_pk && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Spending PK</span>
                              <span className="font-mono text-xs truncate max-w-[180px]">
                                {resolvedENS.spending_pk.slice(0, 16)}...
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {announcementId === null ? (
                        <Tabs defaultValue="wallet" onValueChange={(v) => setSendMode(v as "manual" | "wallet")}>
                          <TabsList className="w-full">
                            <TabsTrigger value="wallet" className="flex-1">Send from Wallet</TabsTrigger>
                            <TabsTrigger value="manual" className="flex-1">Manual</TabsTrigger>
                          </TabsList>

                          {/* ─── Manual Tab ─── */}
                          <TabsContent value="manual">
                            <div className="space-y-4">
                              {/* Chain selector */}
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

                              {/* Stealth address (read-only + copy) */}
                              <div>
                                <Label className="text-xs text-muted-foreground">
                                  Stealth address (send {publishChain === "sui" ? "SUI" : "ETH"} here)
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

                              {/* Tx hash input */}
                              <div>
                                <Label className="text-xs text-muted-foreground">
                                  {publishChain === "sui" ? "Transaction digest (base58)" : "Transaction hash"}
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

                              {verifyError && (
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
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Verifying & publishing...
                                  </>
                                ) : (
                                  "Publish Payment"
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
                              {/* Chain selector */}
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

                              {/* Amount input */}
                              <div>
                                <Label className="text-xs text-muted-foreground">
                                  Amount ({publishChain === "sui" ? "SUI" : "ETH"})
                                </Label>
                                <Input
                                  type="number"
                                  step="any"
                                  min="0"
                                  placeholder={publishChain === "sui" ? "e.g. 1.5" : "e.g. 0.01"}
                                  value={walletAmount}
                                  onChange={(e) => {
                                    setWalletAmount(e.target.value);
                                    setSendError(null);
                                  }}
                                  className="mt-1 font-mono text-sm"
                                />
                              </div>

                              {/* To (read-only stealth address) */}
                              <div>
                                <Label className="text-xs text-muted-foreground">To (stealth address)</Label>
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

                              {/* Wallet connection + send */}
                              {publishChain === "ethereum" ? (
                                <div className="space-y-3">
                                  {evmConnected ? (
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Wallet className="h-4 w-4 text-success" />
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
                                    onClick={handleWalletSend}
                                    disabled={isSending || !evmConnected}
                                  >
                                    {isSending ? (
                                      <>
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        Sending & publishing...
                                      </>
                                    ) : (
                                      "Send & Publish"
                                    )}
                                  </Button>
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  {suiConnected ? (
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Wallet className="h-4 w-4 text-success" />
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
                                    onClick={handleWalletSend}
                                    disabled={isSending || !suiConnected}
                                  >
                                    {isSending ? (
                                      <>
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        Sending & publishing...
                                      </>
                                    ) : (
                                      "Send & Publish"
                                    )}
                                  </Button>
                                </div>
                              )}

                              {sendError && (
                                <div className="flex items-center gap-2 text-sm text-destructive">
                                  <AlertCircle className="h-4 w-4 shrink-0" />
                                  {sendError}
                                </div>
                              )}

                              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                                <div className="flex items-start gap-3">
                                  <Lock className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                                  <div>
                                    <h4 className="font-medium text-sm mb-1">Privacy</h4>
                                    <p className="text-xs text-muted-foreground">
                                      Only {resolvedENS.ens_name} can find this payment. On-chain observers
                                      cannot link it to the recipient.
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
                                view_tag: stealthResult.view_tag,
                                recipient: resolvedENS?.ens_name,
                              }}
                              filename="specter-payment-details.json"
                              label="Download"
                              variant="outline"
                              size="default"
                              className="w-full"
                              tooltip="Save receipt as JSON"
                            />
                            <Button variant="quantum" className="w-full" onClick={resetForm}>
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
        </div>
      </main>

      <Footer />
    </div>
  );
}
