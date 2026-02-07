import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/ui/search-bar";
import {
  Check,
  Zap,
  ExternalLink,
  ArrowRight,
  Loader2,
  Lock,
  Target,
  AlertCircle,
  FileText,
  User,
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

const CARD_PIXEL_COLORS = ["#8b5cf618", "#a78bfa14", "#7c3aed12", "#c4b5fd10"];
import { validateEnsName, EnsResolverError } from "@/lib/ensResolver";
import { validateSuinsName, SuinsResolverError } from "@/lib/suinsResolver";
import { EthereumIcon, SuiIcon } from "@/components/ui/chain-icons";
import { Link } from "react-router-dom";

type SendStep = "input" | "resolved" | "generated" | "published";

export default function SendPayment() {
  const [step, setStep] = useState<SendStep>("input");
  const [ensName, setEnsName] = useState("");
  const [amount, setAmount] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedENS, setResolvedENS] = useState<ResolveEnsResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stealthResult, setStealthResult] = useState<CreateStealthResponse | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [announcementId, setAnnouncementId] = useState<number | null>(null);
  const [ipfsHash, setIpfsHash] = useState<string | null>(null);
  const [ipfsUrl, setIpfsUrl] = useState<string | null>(null);
  const [txHash, setTxHash] = useState("");
  const [publishChain, setPublishChain] = useState<TxChain>("ethereum");
  const [verifiedTx, setVerifiedTx] = useState<VerifiedTx | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

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
      setResolvedENS({
        ens_name: "meta-address",
        meta_address: metaHex,
        spending_pk: "",
        viewing_pk: "",
      });
      setResolveError(null);
      setIpfsHash(null);
      setIpfsUrl(null);
      setStep("resolved");
      toast.success("Using meta-address");
      return;
    }

    const isSuiName = name.endsWith(".sui");
    // Ensure extension: default to .eth if no dot
    const normalized = name.includes(".") ? name : `${name}.eth`;

    setIsResolving(true);
    setResolveError(null);
    setResolvedENS(null);
    setIpfsHash(null);
    setIpfsUrl(null);

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
      return;
    }

    // Resolve via backend
    try {
      if (isSuiName) {
        const res = await api.resolveSuins(normalized);
        setResolvedENS({
          ens_name: res.suins_name,
          meta_address: res.meta_address,
          spending_pk: res.spending_pk,
          viewing_pk: res.viewing_pk,
          ipfs_cid: res.ipfs_cid,
        });
        const cid = res.ipfs_cid ?? null;
        setIpfsHash(cid);
        setIpfsUrl(cid ? api.ipfsUrl(cid) : null);
        setResolveError(null);
        setStep("resolved");
        toast.success(`Resolved ${res.suins_name}`);
      } else {
        const res = await api.resolveEns(normalized);
        setResolvedENS(res);
        const cid = res.ipfs_cid ?? null;
        setIpfsHash(cid);
        setIpfsUrl(cid ? api.ipfsUrl(cid) : null);
        setResolveError(null);
        setStep("resolved");
        toast.success(`Resolved ${res.ens_name}`);
      }
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      const message = apiErr?.message ?? `Failed to resolve ${isSuiName ? "SuiNS" : "ENS"}`;
      const code = apiErr?.code;
      // Use code for specific UI; otherwise show message
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
    }
  };

  const handleGenerateStealth = async () => {
    if (!resolvedENS?.meta_address) return;
    setIsGenerating(true);
    setStealthResult(null);
    setAnnouncementId(null);
    try {
      const res = await api.createStealth({ meta_address: resolvedENS.meta_address });
      setStealthResult(res);
      setStep("generated");
      toast.success("Stealth address generated");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to create stealth payment";
      toast.error(message);
    } finally {
      setIsGenerating(false);
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

  const resetForm = () => {
    setStep("input");
    setEnsName("");
    setAmount("");
    setResolvedENS(null);
    setStealthResult(null);
    setAnnouncementId(null);
    setResolveError(null);
    setIpfsHash(null);
    setIpfsUrl(null);
    setTxHash("");
    setPublishChain("ethereum");
    setVerifiedTx(null);
    setVerifyError(null);
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
                    value={step !== "input" ? (resolvedENS?.ens_name ?? ensName) : ensName}
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
                              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                                <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                  <div>
                                    <p className="font-medium">
                                      Name found, but no SPECTER meta-address configured for this recipient.
                                    </p>
                                    <p className="mt-2 text-muted-foreground">
                                      To receive private payments at this name, the owner must:
                                    </p>
                                    <ol className="mt-2 list-decimal list-inside space-y-1 text-muted-foreground">
                                      <li>Generate SPECTER keys on the <Link to="/setup" className="text-primary hover:underline">Setup</Link> page</li>
                                      <li>
                                        For ENS: set text record <code className="bg-muted px-1 rounded">specter</code> to <code className="bg-muted px-1 rounded">ipfs://YOUR_CID</code> in the ENS app.
                                        For SuiNS: set the content hash in the SuiNS app.
                                      </li>
                                    </ol>
                                    <p className="mt-2 text-muted-foreground">
                                      See the <Link to="/setup" className="text-primary hover:underline">Setup</Link> page for step-by-step instructions.
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
                          Resolving…
                        </div>
                      )}
                    </motion.div>
                  )}
                  {step === "resolved" && resolvedENS && (
                    <motion.div
                      key="resolved"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-6"
                    >
                      <div className="p-4 rounded-lg bg-success/10 border border-success/20">
                        <div className="flex items-center gap-2 mb-3">
                          <Check className="h-4 w-4 text-success" />
                          <span className="font-medium text-success">
                            Resolved {resolvedENS.ens_name}
                          </span>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Spending PK</span>
                            <span className="font-mono text-xs truncate max-w-[180px]">
                              {resolvedENS.spending_pk.slice(0, 16)}...
                            </span>
                          </div>
                          {ipfsHash && (
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">IPFS Content</span>
                              <div className="flex items-center gap-2">
                                <FileText className="h-3 w-3 text-accent" />
                                {ipfsUrl ? (
                                  <a
                                    href={ipfsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-accent hover:underline flex items-center gap-1"
                                  >
                                    View on IPFS
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <span className="text-xs font-mono">
                                    {ipfsHash.slice(0, 12)}...
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Quantum-safe</span>
                            <div className="flex items-center gap-1 text-success">
                              <img src="/SPECTER-logo.png" alt="SPECTER" className="h-4 w-4" />
                              <Check className="h-3 w-3" />
                            </div>
                          </div>
                        </div>
                      </div>

                      <Button
                        variant="quantum"
                        className="w-full"
                        onClick={handleGenerateStealth}
                        disabled={isGenerating}
                      >
                        {isGenerating ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Generating Stealth Address...
                          </>
                        ) : (
                          "Generate Stealth Address"
                        )}
                      </Button>
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
                      <div className="p-6 rounded-lg bg-muted/50 border border-border">
                        <h3 className="font-display font-semibold mb-4">
                          Stealth Address Generated
                        </h3>
                        <div className="space-y-4">
                          <div className="flex items-start gap-3">
                            <Target className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0 space-y-3">
                              <div>
                                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                                  <EthereumIcon size={14} className="text-foreground/80" />
                                  <TooltipLabel
                                    label="Ethereum address (send ETH here)"
                                    tooltip="Paste this address in your wallet (e.g. MetaMask) to send the payment. Only the recipient can discover it."
                                  />
                                </div>
                                <code className="text-sm font-mono break-all block">
                                  {stealthResult.stealth_address}
                                </code>
                                <CopyButton
                                  text={stealthResult.stealth_address}
                                  label="Copy"
                                  variant="ghost"
                                  size="sm"
                                  className="mt-1"
                                  tooltip="Copy EVM address"
                                  tooltipCopied="Copied!"
                                  successMessage="EVM address copied"
                                />
                              </div>
                              {stealthResult.stealth_sui_address && (
                                <div>
                                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                                    <SuiIcon size={14} className="text-[#4DA2FF]" />
                                    <TooltipLabel
                                      label="Sui address (send SUI here)"
                                      tooltip="Paste this address in your Sui wallet to send the payment. Only the recipient can discover it."
                                    />
                                  </div>
                                  <code className="text-sm font-mono break-all block">
                                    {stealthResult.stealth_sui_address}
                                  </code>
                                  <CopyButton
                                    text={stealthResult.stealth_sui_address}
                                    label="Copy"
                                    variant="ghost"
                                    size="sm"
                                    className="mt-1"
                                    tooltip="Copy Sui address"
                                    tooltipCopied="Copied!"
                                    successMessage="Sui address copied"
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                                <span className="font-mono text-xs text-accent">
                                  {stealthResult.view_tag}
                                </span>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">View Tag</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <Zap className="h-5 w-5 text-accent" />
                              <div>
                                <div className="text-xs text-muted-foreground">Scan Efficiency</div>
                                <div className="text-sm font-medium text-accent">99.6%</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

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

                      {announcementId === null ? (
                        <div className="space-y-4">
                          <div className="p-4 rounded-lg bg-muted/50 border border-border">
                            <p className="text-sm text-muted-foreground mb-4">
                              Send to the stealth address above in your wallet (Ethereum or Sui), then paste your transaction hash to verify and publish.
                            </p>
                            <div className="space-y-3">
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
                                <Label className="text-xs text-muted-foreground">Transaction hash</Label>
                                <Input
                                  placeholder={publishChain === "sui" ? "0x..." : "0x..."}
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
                            </div>
                          </div>
                          <Button
                            variant="quantum"
                            className="w-full"
                            onClick={handleVerifyAndPublish}
                            disabled={isPublishing}
                          >
                            {isPublishing ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Verifying & publishing...
                              </>
                            ) : (
                              "Verify & Publish (required for recipient to discover)"
                            )}
                          </Button>
                        </div>
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
                          <p className="text-xs text-muted-foreground mt-4 text-center">
                            Send to the stealth address in your wallet.
                          </p>
                          <div className="flex flex-col gap-3 mt-6 w-full max-w-xs mx-auto">
                            <div className="flex gap-2">
                              <CopyButton
                                text={stealthResult.stealth_address}
                                label={
                                  <>
                                    <EthereumIcon size={14} className="mr-1.5" />
                                    Copy Ethereum
                                  </>
                                }
                                variant="outline"
                                className="flex-1"
                                tooltip="Copy Ethereum address"
                                successMessage="Ethereum address copied"
                              />
                              {stealthResult.stealth_sui_address && (
                                <CopyButton
                                  text={stealthResult.stealth_sui_address}
                                  label={
                                    <>
                                      <SuiIcon size={14} className="mr-1.5 text-[#4DA2FF]" />
                                      Copy Sui
                                    </>
                                  }
                                  variant="outline"
                                  className="flex-1"
                                  tooltip="Copy Sui address"
                                  successMessage="Sui address copied"
                                />
                              )}
                            </div>
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
