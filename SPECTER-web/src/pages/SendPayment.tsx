import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/ui/search-bar";
import { Input } from "@/components/ui/input";
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
  Coins,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { CopyButton } from "@/components/ui/copy-button";
import { DownloadJsonButton } from "@/components/ui/download-json-button";
import { TooltipLabel } from "@/components/ui/tooltip-label";
import { HeadingScramble } from "@/components/ui/heading-scramble";
import { PixelCanvas } from "@/components/ui/pixel-canvas";
import { AnimatedTicket } from "@/components/ui/ticket-confirmation-card";
import { api, ApiError, type ResolveEnsResponse, type CreateStealthResponse } from "@/lib/api";

const CARD_PIXEL_COLORS = ["#8b5cf618", "#a78bfa14", "#7c3aed12", "#c4b5fd10"];
import { resolveEns, validateEnsName, EnsResolverError, EnsErrorCode } from "@/lib/ensResolver";
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

  const handleResolve = async (overrideName?: string) => {
    const name = (overrideName || ensName).trim();
    if (!name) {
      toast.error("Enter an ENS name (e.g. bob.eth) or paste meta-address (hex)");
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

    // Ensure .eth extension
    const normalized = name.includes(".") ? name : `${name}.eth`;

    setIsResolving(true);
    setResolveError(null);
    setResolvedENS(null);
    setIpfsHash(null);
    setIpfsUrl(null);

    try {
      // Validate ENS name format first
      try {
        validateEnsName(normalized);
      } catch (validationError) {
        if (validationError instanceof EnsResolverError) {
          throw validationError;
        }
        throw new EnsResolverError(
          "Invalid ENS name format",
          EnsErrorCode.INVALID_NAME,
          validationError
        );
      }

      // ENS lives on mainnet; resolve there regardless of wallet chain (send tx uses wallet chain later)
      const ensChainId = 1;
      let clientResolved = false;
      try {
        const clientResult = await resolveEns(normalized, ensChainId);

        // Store IPFS info from client resolution (if available)
        setIpfsHash(clientResult.ipfsHash || null);
        setIpfsUrl(clientResult.ipfsUrl || null);

        // Try to get meta-address from backend for the resolved address
        // (SPECTER meta-address is stored in backend)
        try {
          const backendRes = await api.resolveEns(normalized);
          setResolvedENS({
            ...backendRes,
            ipfs_cid: clientResult.ipfsHash || backendRes.ipfs_cid,
            ipfs_url: clientResult.ipfsUrl || backendRes.ipfs_url,
          });
          // Keep the IPFS info we already set from client
        } catch (backendErr) {
          // Backend failed but we have client resolution: ENS exists but no SPECTER record
          // Keep the IPFS info from client resolution, just don't have meta_address
          setResolveError("no-specter-setup");
          setResolvedENS(null);
          toast.error("No SPECTER keys found for this ENS name");
          setIsResolving(false);
          return;
        }

        clientResolved = true;
        setStep("resolved");
        toast.success(`Resolved ${normalized} (client-side)`);
      } catch (clientError) {
        // Client-side resolution failed, try backend as fallback
        console.warn("Client-side ENS resolution failed, trying backend:", clientError);

        try {
          const backendRes = await api.resolveEns(normalized);
          setResolvedENS(backendRes);
          setIpfsHash(backendRes.ipfs_cid || null);
          setIpfsUrl(backendRes.ipfs_url || null);
          setStep("resolved");
          toast.success(`Resolved ${backendRes.ens_name} (backend)`);
        } catch (backendErr) {
          // Both client and backend failed
          let errorMessage = "Failed to resolve ENS name";

          if (clientError instanceof EnsResolverError) {
            switch (clientError.code) {
              case EnsErrorCode.INVALID_NAME:
                errorMessage = `Invalid ENS name: ${clientError.message}`;
                break;
              case EnsErrorCode.NAME_NOT_FOUND:
                errorMessage = `ENS name "${normalized}" not found or not registered`;
                break;
              case EnsErrorCode.NETWORK_ERROR:
                errorMessage = "Network error. Please check your connection and try again.";
                break;
              case EnsErrorCode.TIMEOUT:
                errorMessage = "ENS resolution timed out. Please try again.";
                break;
              default:
                errorMessage = clientError.message;
            }
          } else if (backendErr instanceof ApiError) {
            errorMessage = backendErr.message;
          }

          setResolveError(errorMessage);
          toast.error(errorMessage);
        }
      }
    } catch (err) {
      const message = err instanceof EnsResolverError
        ? err.message
        : err instanceof ApiError
          ? err.message
          : "Failed to resolve ENS";
      setResolveError(message);
      toast.error(message);
    } finally {
      setIsResolving(false);
    }
  };

  const handleGenerateStealth = async () => {
    if (!resolvedENS?.meta_address) return;
    if (!amount || Number(amount) <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
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

  const handlePublishAnnouncement = async () => {
    if (!stealthResult) return;
    setIsPublishing(true);
    try {
      const res = await api.publishAnnouncement({
        ephemeral_key: stealthResult.announcement.ephemeral_key,
        view_tag: stealthResult.view_tag,
      });
      setAnnouncementId(res.id);
      toast.success(`Announcement published (#${res.id})`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to publish announcement";
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
              ENS · stealth · private
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
                <AnimatePresence mode="wait">
                  {step === "input" && (
                    <motion.div
                      key="input"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-6"
                    >
                      <div className="w-full space-y-3">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <User className="h-4 w-4 shrink-0" />
                          <TooltipLabel
                            label="Recipient"
                            tooltip="ENS (e.g. bob.eth) or paste meta-address hex from Setup."
                          />
                        </div>
                        <SearchBar
                          placeholder="bob.eth or meta-address"
                          onSearch={(val) => {
                            setEnsName(val);
                            handleResolve(val);
                          }}
                          variant="minimal"
                        />
                        {resolveError && (
                          <div className="mt-2 space-y-2">
                            {resolveError === "no-specter-setup" ? (
                              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                                <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                  <div>
                                    <p className="font-medium">ENS name found, but no SPECTER meta-address configured.</p>
                                    {ipfsHash && (
                                      <div className="mt-2 p-2 rounded bg-muted/50 text-xs">
                                        <p className="font-medium text-foreground">IPFS Content Hash Found:</p>
                                        <code className="break-all">{ipfsHash.slice(0, 20)}...{ipfsHash.slice(-10)}</code>
                                        {ipfsUrl && (
                                          <a
                                            href={ipfsUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block mt-1 text-primary hover:underline flex items-center gap-1"
                                          >
                                            View on IPFS
                                            <ExternalLink className="h-3 w-3" />
                                          </a>
                                        )}
                                        <p className="mt-1 text-muted-foreground">
                                          However, this IPFS content doesn't contain a valid SPECTER meta-address or the backend can't parse it.
                                        </p>
                                      </div>
                                    )}
                                    <p className="mt-2 text-muted-foreground">
                                      To receive private payments at this name, the owner must:
                                    </p>
                                    <ol className="mt-2 list-decimal list-inside space-y-1 text-muted-foreground">
                                      <li>Generate SPECTER keys on the <Link to="/setup" className="text-primary hover:underline">Setup</Link> page</li>
                                      <li>Upload the meta-address to IPFS (same page)</li>
                                      <li>Set the IPFS hash in ENS: either add a text record <code className="bg-muted px-1 rounded">specter</code> with value <code className="bg-muted px-1 rounded">ipfs://YOUR_CID</code>, or set <strong>Content Hash</strong> to <code className="bg-muted px-1 rounded">ipfs://YOUR_CID</code> in the ENS app</li>
                                    </ol>
                                    <p className="mt-2 text-muted-foreground">
                                      See the <Link to="/ens" className="text-primary hover:underline">ENS Manager</Link> for step-by-step instructions on setting the IPFS content hash.
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

                      <div>
                        <div className="flex items-center gap-2 text-muted-foreground mb-2">
                          <Coins className="h-4 w-4 shrink-0" />
                          <span className="text-sm font-medium">Amount (ETH)</span>
                        </div>
                        <Input
                          type="number"
                          placeholder="0.0"
                          min="0"
                          step="any"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="bg-background text-lg font-mono"
                        />
                      </div>

                      <Button
                        variant="quantum"
                        className="w-full"
                        onClick={handleGenerateStealth}
                        disabled={!amount || Number(amount) <= 0 || isGenerating}
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
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-muted-foreground mb-1">
                                <TooltipLabel
                                  label="Address (send ETH here)"
                                  tooltip="Paste this address in your wallet (e.g. MetaMask) to send the payment. Only the recipient can discover it."
                                />
                              </div>
                              <code className="text-sm font-mono break-all block">
                                {stealthResult.stealth_address}
                              </code>
                              <CopyButton
                                text={stealthResult.stealth_address}
                                label="Copy address"
                                variant="ghost"
                                size="sm"
                                className="mt-2"
                                tooltip="Copy stealth address to paste in your wallet"
                                tooltipCopied="Copied!"
                                successMessage="Stealth address copied"
                              />
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
                        <Button
                          variant="quantum"
                          className="w-full"
                          onClick={handlePublishAnnouncement}
                          disabled={isPublishing}
                        >
                          {isPublishing ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Publishing announcement...
                            </>
                          ) : (
                            "Publish announcement (required for recipient to discover)"
                          )}
                        </Button>
                      ) : (
                        <div className="flex flex-col items-center w-full">
                          <AnimatedTicket
                            ticketId={String(announcementId)}
                            amount={parseFloat(amount) || 0}
                            date={new Date()}
                            cardHolder={resolvedENS?.ens_name ?? "Recipient"}
                            last4Digits={stealthResult.stealth_address.replace(/^0x/, "").slice(-4)}
                            barcodeValue={`${announcementId}${stealthResult.stealth_address.slice(2, 14)}`}
                            currency="ETH"
                          />
                          <p className="text-xs text-muted-foreground mt-4 text-center">
                            Send {amount} ETH to the stealth address in your wallet.
                          </p>
                          <div className="flex flex-wrap gap-3 justify-center mt-6 w-full">
                            <CopyButton
                              text={stealthResult.stealth_address}
                              label="Copy address"
                              variant="outline"
                              className="flex-1 min-w-[120px]"
                              tooltip="Copy address for your wallet"
                              successMessage="Stealth address copied"
                            />
                            <DownloadJsonButton
                              data={{
                                stealth_address: stealthResult.stealth_address,
                                amount_eth: amount,
                                announcement_id: announcementId,
                                view_tag: stealthResult.view_tag,
                                recipient: resolvedENS?.ens_name,
                              }}
                              filename="specter-payment-details.json"
                              label="Download"
                              variant="outline"
                              size="default"
                              className="min-w-[120px]"
                              tooltip="Save receipt as JSON"
                            />
                            <Button variant="quantum" className="flex-1 min-w-[120px]" onClick={resetForm}>
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
