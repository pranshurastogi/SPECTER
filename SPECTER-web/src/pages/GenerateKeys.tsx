import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import {
  Key,
  Eye,
  Lock,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Upload,
  ExternalLink,
  Info,
  Clipboard,
  Download,
  CheckCircle2,
  Circle,
  ChevronRight,
  Globe,
  Database,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import { CopyButton } from "@/components/ui/copy-button";
import { DownloadJsonButton } from "@/components/ui/download-json-button";
import { TooltipLabel } from "@/components/ui/tooltip-label";
import { HeadingScramble } from "@/components/ui/heading-scramble";
import { PixelCanvas } from "@/components/ui/pixel-canvas";
import { api, ApiError, type GenerateKeysResponse } from "@/lib/api";

const CARD_PIXEL_COLORS = ["#8b5cf618", "#a78bfa14", "#7c3aed12", "#c4b5fd10"];

type GenerationStep = "idle" | "generating" | "complete";

const securityTips = [
  { icon: Lock, text: "Your keys, your control" },
  { icon: Download, text: "Backup securely offline" },
  { icon: AlertTriangle, text: "Never share private keys" },
];

export default function GenerateKeys() {
  const [step, setStep] = useState<GenerationStep>("idle");
  const [keys, setKeys] = useState<GenerateKeysResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ cid: string; text_record: string } | null>(null);
  const [ensName, setEnsName] = useState("");

  const handleGenerate = async () => {
    setStep("generating");
    setKeys(null);
    setUploadResult(null);
    try {
      const response = await api.generateKeys();
      setKeys(response);
      setStep("complete");
      toast.success("Keys generated successfully");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to generate keys";
      toast.error(message);
      setStep("idle");
    }
  };

  const handleUploadToIpfs = async () => {
    if (!keys?.meta_address) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const res = await api.uploadIpfs({
        meta_address: keys.meta_address,
        name: ensName.trim() ? `${ensName.replace(/\.eth$/i, "")}.eth-specter-profile` : undefined,
      });
      setUploadResult({ cid: res.cid, text_record: res.text_record });
      toast.success("Meta-address uploaded to IPFS");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Upload failed";
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const keysJson = keys
    ? {
        spending_pk: keys.spending_pk,
        spending_sk: keys.spending_sk,
        viewing_pk: keys.viewing_pk,
        viewing_sk: keys.viewing_sk,
        meta_address: keys.meta_address,
        view_tag: keys.view_tag,
      }
    : null;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 pt-24 pb-12">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-12"
            >
              <HeadingScramble
                as="h1"
                className="font-display text-3xl md:text-4xl font-bold mb-4 block"
              >
                Generate Your Keys
              </HeadingScramble>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Create quantum-safe SPECTER identity for private payments
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              <div className="md:col-span-2">
                <div className="relative overflow-hidden rounded-xl glass-card">
                  <div className="absolute inset-0 overflow-hidden opacity-60 blur-[5px] pointer-events-none">
                    <PixelCanvas
                      gap={10}
                      speed={25}
                      colors={CARD_PIXEL_COLORS}
                      variant="default"
                    />
                  </div>
                  <div className="relative z-10 p-8">
                  <AnimatePresence mode="wait">
                    {step === "idle" && (
                      <motion.div
                        key="idle"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-center py-12"
                      >
                        <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-6">
                          <Key className="h-10 w-10 text-primary" />
                        </div>
                        <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                          Generate a new set of quantum-safe cryptographic keys
                          for receiving private payments via the SPECTER API.
                        </p>
                        <Button variant="quantum" size="xl" onClick={handleGenerate}>
                          Generate Keys
                        </Button>
                      </motion.div>
                    )}

                    {step === "generating" && (
                      <motion.div
                        key="generating"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-center py-12"
                      >
                        <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-4" />
                        <p className="text-muted-foreground">Generating keys...</p>
                      </motion.div>
                    )}

                    {step === "complete" && keys && (
                      <motion.div
                        key="complete"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="space-y-6"
                      >
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-center gap-3 p-4 rounded-lg bg-success/10 border border-success/20"
                        >
                          <img src="/SPECTER-logo.png" alt="SPECTER" className="h-5 w-5" />
                          <span className="text-sm font-medium text-success">
                            Keys Generated Successfully
                          </span>
                        </motion.div>

                        <div className="space-y-4">
                          {[
                            {
                              icon: Key,
                              label: "Spending Public Key",
                              tooltip: "Used to derive stealth addresses. Safe to share with senders.",
                              value: keys.spending_pk,
                              preview: keys.spending_pk.slice(0, 32) + "...",
                            },
                            {
                              icon: Eye,
                              label: "Viewing Public Key",
                              tooltip: "Used for scanning announcements. Safe to share with auditors.",
                              value: keys.viewing_pk,
                              preview: keys.viewing_pk.slice(0, 32) + "...",
                            },
                            {
                              icon: null,
                              label: "Meta-address (for ENS)",
                              tooltip: "Publish this to ENS so others can send you private payments.",
                              value: keys.meta_address,
                              preview: keys.meta_address.slice(0, 40) + "...",
                            },
                          ].map((item, index) => (
                            <motion.div
                              key={item.label}
                              initial={{ opacity: 0, y: 12 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: index * 0.06 }}
                              className="p-4 rounded-lg bg-muted/50 border border-border"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  {item.icon && <item.icon className="h-4 w-4 text-primary" />}
                                  <TooltipLabel
                                    label={item.label}
                                    tooltip={item.tooltip}
                                    className="text-sm font-medium"
                                  />
                                </div>
                                <CopyButton
                                  text={item.value}
                                  variant="ghost"
                                  size="sm"
                                  showLabel={false}
                                  tooltip="Copy to clipboard"
                                  tooltipCopied="Copied!"
                                  successMessage="Copied to clipboard"
                                />
                              </div>
                              <code className="text-xs text-muted-foreground break-all">
                                {item.preview}
                              </code>
                            </motion.div>
                          ))}

                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="flex items-center gap-2 text-sm text-muted-foreground"
                          >
                            <TooltipLabel
                              label="View tag"
                              tooltip="First byte of shared secret; used to filter announcements when scanning."
                            />
                            <span className="font-mono font-medium text-foreground">{keys.view_tag}</span>
                          </motion.div>
                        </div>

                        {/* ENS Setup Flow - Step by Step */}
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.2 }}
                          className="pt-6 border-t border-border space-y-6"
                        >
                          {/* Section Header with Flow Diagram */}
                          <div className="space-y-4">
                            <div className="flex items-center gap-3">
                              <Sparkles className="h-5 w-5 text-primary animate-pulse" />
                              <h3 className="font-display text-lg font-bold bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                                Enable ENS Payments (Optional)
                              </h3>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Let others send you private payments to your ENS name (e.g. alice.eth) by following these steps:
                            </p>
                            
                            {/* Visual Flow Diagram */}
                            <div className="relative">
                              <div className="flex items-center justify-between gap-2 p-4 rounded-lg bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border border-primary/20">
                                <div className="flex flex-col items-center flex-1 text-center">
                                  <div className="w-10 h-10 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center mb-2">
                                    <Database className="h-5 w-5 text-primary" />
                                  </div>
                                  <p className="text-xs font-medium">Upload to<br/>IPFS</p>
                                </div>
                                <ChevronRight className="h-5 w-5 text-primary/50 shrink-0" />
                                <div className="flex flex-col items-center flex-1 text-center">
                                  <div className="w-10 h-10 rounded-full bg-accent/10 border-2 border-accent/30 flex items-center justify-center mb-2">
                                    <Clipboard className="h-5 w-5 text-accent" />
                                  </div>
                                  <p className="text-xs font-medium">Copy IPFS<br/>Hash</p>
                                </div>
                                <ChevronRight className="h-5 w-5 text-primary/50 shrink-0" />
                                <div className="flex flex-col items-center flex-1 text-center">
                                  <div className="w-10 h-10 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center mb-2">
                                    <Globe className="h-5 w-5 text-primary" />
                                  </div>
                                  <p className="text-xs font-medium">Set in<br/>ENS</p>
                                </div>
                                <ChevronRight className="h-5 w-5 text-primary/50 shrink-0" />
                                <div className="flex flex-col items-center flex-1 text-center">
                                  <div className="w-10 h-10 rounded-full bg-success/10 border-2 border-success/30 flex items-center justify-center mb-2">
                                    <CheckCircle2 className="h-5 w-5 text-success" />
                                  </div>
                                  <p className="text-xs font-medium">Receive<br/>Payments</p>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Step 1: Upload to IPFS */}
                          <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.3 }}
                            className="relative"
                          >
                            <div className="absolute -left-3 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/50 to-transparent" />
                            <div className={`p-5 rounded-xl border-2 transition-all duration-300 ${
                              uploadResult 
                                ? "bg-success/5 border-success/30" 
                                : "bg-gradient-to-br from-primary/10 to-accent/10 border-primary/30"
                            }`}>
                              <div className="flex items-start gap-4">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 ${
                                  uploadResult 
                                    ? "bg-success/20 border-success text-success" 
                                    : "bg-primary/20 border-primary text-primary"
                                }`}>
                                  {uploadResult ? (
                                    <CheckCircle2 className="h-5 w-5" />
                                  ) : (
                                    <span className="font-bold">1</span>
                                  )}
                                </div>
                                <div className="flex-1 space-y-3">
                                  <div>
                                    <h4 className="font-display font-semibold text-base mb-1 flex items-center gap-2">
                                      Upload Your Meta-Address to IPFS
                                      {uploadResult && <CheckCircle2 className="h-4 w-4 text-success" />}
                                    </h4>
                                    <p className="text-sm text-muted-foreground">
                                      Store your SPECTER keys on IPFS so they can be resolved via ENS
                                    </p>
                                  </div>
                                  
                                  {!uploadResult && (
                                    <div className="space-y-2">
                                      <div className="flex gap-2">
                                        <input
                                          type="text"
                                          placeholder="Your ENS name (e.g. alice.eth)"
                                          value={ensName}
                                          onChange={(e) => setEnsName(e.target.value)}
                                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        />
                                        <Button
                                          variant="quantum"
                                          onClick={handleUploadToIpfs}
                                          disabled={uploading}
                                          className="shrink-0"
                                        >
                                          {uploading ? (
                                            <>
                                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                              Uploading...
                                            </>
                                          ) : (
                                            <>
                                              <Upload className="h-4 w-4 mr-2" />
                                              Upload
                                            </>
                                          )}
                                        </Button>
                                      </div>
                                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                                        <Info className="h-3 w-3" />
                                        ENS name is optional but helps with metadata on IPFS
                                      </p>
                                    </div>
                                  )}
                                  
                                  {uploadResult && (
                                    <div className="p-3 rounded-lg bg-success/10 border border-success/20">
                                      <p className="text-sm font-medium text-success mb-1 flex items-center gap-2">
                                        <CheckCircle2 className="h-4 w-4" />
                                        Successfully uploaded to IPFS
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        CID: <code className="font-mono">{uploadResult.cid.slice(0, 20)}...</code>
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </motion.div>

                          {/* Step 2: Copy IPFS Hash */}
                          <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: uploadResult ? 1 : 0.4, x: 0 }}
                            transition={{ delay: 0.4 }}
                            className="relative"
                          >
                            <div className="absolute -left-3 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/50 to-transparent" />
                            <div className={`p-5 rounded-xl border-2 transition-all duration-300 ${
                              uploadResult 
                                ? "bg-gradient-to-br from-primary/10 to-accent/10 border-primary/30" 
                                : "bg-muted/20 border-border"
                            }`}>
                              <div className="flex items-start gap-4">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 ${
                                  uploadResult 
                                    ? "bg-primary/20 border-primary text-primary" 
                                    : "bg-muted border-muted-foreground/30 text-muted-foreground"
                                }`}>
                                  <span className="font-bold">2</span>
                                </div>
                                <div className="flex-1 space-y-3">
                                  <div>
                                    <h4 className="font-display font-semibold text-base mb-1">
                                      Copy the IPFS Hash
                                    </h4>
                                    <p className="text-sm text-muted-foreground">
                                      This is the exact value you'll add to your ENS name
                                    </p>
                                  </div>
                                  
                                  {uploadResult ? (
                                    <div className="space-y-3">
                                      <div className="p-4 rounded-lg bg-background border-2 border-primary/30 shadow-lg shadow-primary/10">
                                        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                                          📋 Value to Add in ENS
                                        </p>
                                        <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border border-border">
                                          <code className="flex-1 text-sm font-mono break-all select-all text-foreground">
                                            {uploadResult.text_record}
                                          </code>
                                          <CopyButton
                                            text={uploadResult.text_record}
                                            variant="default"
                                            size="sm"
                                            showLabel={true}
                                            label="Copy"
                                            successMessage="✓ Copied! Now paste this in ENS"
                                          />
                                        </div>
                                      </div>
                                      <div className="flex items-start gap-2 p-3 rounded-lg bg-accent/10 border border-accent/20">
                                        <Info className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                                        <p className="text-xs text-muted-foreground">
                                          <strong className="text-foreground">Important:</strong> Copy this exact value including the <code className="bg-muted px-1 rounded">ipfs://</code> prefix
                                        </p>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="p-4 rounded-lg bg-muted/30 border border-dashed border-muted-foreground/30">
                                      <p className="text-sm text-muted-foreground text-center">
                                        Complete Step 1 to get your IPFS hash
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </motion.div>

                          {/* Step 3: Set in ENS */}
                          <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: uploadResult ? 1 : 0.4, x: 0 }}
                            transition={{ delay: 0.5 }}
                            className="relative"
                          >
                            <div className="absolute -left-3 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/50 to-transparent" />
                            <div className={`p-5 rounded-xl border-2 transition-all duration-300 ${
                              uploadResult 
                                ? "bg-gradient-to-br from-accent/10 to-primary/10 border-accent/30" 
                                : "bg-muted/20 border-border"
                            }`}>
                              <div className="flex items-start gap-4">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 ${
                                  uploadResult 
                                    ? "bg-accent/20 border-accent text-accent" 
                                    : "bg-muted border-muted-foreground/30 text-muted-foreground"
                                }`}>
                                  <span className="font-bold">3</span>
                                </div>
                                <div className="flex-1 space-y-4">
                                  <div>
                                    <h4 className="font-display font-semibold text-base mb-1">
                                      Set the Value in Your ENS Name
                                    </h4>
                                    <p className="text-sm text-muted-foreground">
                                      Add the IPFS hash to your ENS records so others can resolve your SPECTER keys
                                    </p>
                                  </div>
                                  
                                  {uploadResult ? (
                                    <div className="space-y-4">
                                      {/* Sub-step 3.1 */}
                                      <div className="pl-4 border-l-2 border-accent/30 space-y-2">
                                        <div className="flex items-center gap-2">
                                          <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-xs font-bold">
                                            a
                                          </div>
                                          <p className="text-sm font-medium">Open the ENS Manager</p>
                                        </div>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          asChild
                                          className="w-full sm:w-auto"
                                        >
                                          <a
                                            href={ensName.trim() ? `https://app.ens.domains/${ensName.replace(/\.eth$/i, "")}.eth` : "https://app.ens.domains"}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2"
                                          >
                                            <Globe className="h-4 w-4" />
                                            Open app.ens.domains
                                            <ExternalLink className="h-3 w-3" />
                                          </a>
                                        </Button>
                                        {ensName.trim() && (
                                          <p className="text-xs text-muted-foreground pl-8">
                                            Opens directly to: <code className="bg-muted px-1 rounded">{ensName.replace(/\.eth$/i, "")}.eth</code>
                                          </p>
                                        )}
                                      </div>

                                      {/* Sub-step 3.2 */}
                                      <div className="pl-4 border-l-2 border-accent/30 space-y-2">
                                        <div className="flex items-center gap-2">
                                          <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-xs font-bold">
                                            b
                                          </div>
                                          <p className="text-sm font-medium">Connect your wallet</p>
                                        </div>
                                        <p className="text-xs text-muted-foreground pl-8">
                                          Use the wallet that controls your ENS name (owner or manager)
                                        </p>
                                      </div>

                                      {/* Sub-step 3.3 */}
                                      <div className="pl-4 border-l-2 border-accent/30 space-y-3">
                                        <div className="flex items-center gap-2">
                                          <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-xs font-bold">
                                            c
                                          </div>
                                          <p className="text-sm font-medium">Choose ONE of these options:</p>
                                        </div>
                                        
                                        <div className="pl-8 space-y-3">
                                          {/* Option A */}
                                          <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
                                            <p className="text-sm font-medium mb-2 flex items-center gap-2">
                                              <span className="px-2 py-0.5 rounded bg-primary/20 text-primary text-xs font-bold">RECOMMENDED</span>
                                              Option A: Content Hash
                                            </p>
                                            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                                              <li>Navigate to <strong>Records</strong> tab</li>
                                              <li>Find the <strong>Content Hash</strong> field</li>
                                              <li>Click Edit and paste the IPFS hash (from Step 2)</li>
                                              <li>Save changes</li>
                                            </ol>
                                          </div>

                                          {/* Option B */}
                                          <div className="p-3 rounded-lg bg-muted/30 border border-border">
                                            <p className="text-sm font-medium mb-2">
                                              Option B: Text Record "specter"
                                            </p>
                                            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                                              <li>Navigate to <strong>Records</strong> tab</li>
                                              <li>Add a new <strong>Text Record</strong></li>
                                              <li>Set key to: <code className="bg-muted px-1 rounded">specter</code></li>
                                              <li>Set value to: the IPFS hash (from Step 2)</li>
                                              <li>Save changes</li>
                                            </ol>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Sub-step 3.4 */}
                                      <div className="pl-4 border-l-2 border-accent/30 space-y-2">
                                        <div className="flex items-center gap-2">
                                          <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-xs font-bold">
                                            d
                                          </div>
                                          <p className="text-sm font-medium">Sign the transaction</p>
                                        </div>
                                        <p className="text-xs text-muted-foreground pl-8">
                                          Confirm the transaction in your wallet. Gas fees typically range from $5-20 depending on network conditions.
                                        </p>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="p-4 rounded-lg bg-muted/30 border border-dashed border-muted-foreground/30">
                                      <p className="text-sm text-muted-foreground text-center">
                                        Complete Steps 1 & 2 first
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </motion.div>

                          {/* Step 4: Success */}
                          <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: uploadResult ? 1 : 0.4, x: 0 }}
                            transition={{ delay: 0.6 }}
                            className="relative"
                          >
                            <div className={`p-5 rounded-xl border-2 transition-all duration-300 ${
                              uploadResult 
                                ? "bg-gradient-to-br from-success/10 to-primary/10 border-success/30" 
                                : "bg-muted/20 border-border"
                            }`}>
                              <div className="flex items-start gap-4">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 ${
                                  uploadResult 
                                    ? "bg-success/20 border-success text-success" 
                                    : "bg-muted border-muted-foreground/30 text-muted-foreground"
                                }`}>
                                  <CheckCircle2 className="h-5 w-5" />
                                </div>
                                <div className="flex-1 space-y-3">
                                  <div>
                                    <h4 className="font-display font-semibold text-base mb-1">
                                      You're All Set!
                                    </h4>
                                    <p className="text-sm text-muted-foreground">
                                      Once the ENS transaction confirms, others can send you private payments to your ENS name
                                    </p>
                                  </div>
                                  
                                  {uploadResult && (
                                    <div className="space-y-3">
                                      <div className="p-4 rounded-lg bg-gradient-to-r from-success/10 to-primary/10 border border-success/20">
                                        <p className="text-sm font-medium mb-2 flex items-center gap-2">
                                          <Sparkles className="h-4 w-4 text-success" />
                                          What happens next:
                                        </p>
                                        <ul className="text-xs text-muted-foreground space-y-1.5">
                                          <li className="flex items-start gap-2">
                                            <ChevronRight className="h-3 w-3 text-success shrink-0 mt-0.5" />
                                            <span>Anyone can resolve your ENS name to get your SPECTER keys</span>
                                          </li>
                                          <li className="flex items-start gap-2">
                                            <ChevronRight className="h-3 w-3 text-success shrink-0 mt-0.5" />
                                            <span>Senders generate unique stealth addresses for each payment</span>
                                          </li>
                                          <li className="flex items-start gap-2">
                                            <ChevronRight className="h-3 w-3 text-success shrink-0 mt-0.5" />
                                            <span>Only you can discover and spend from those addresses</span>
                                          </li>
                                        </ul>
                                      </div>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        asChild
                                        className="w-full sm:w-auto"
                                      >
                                        <Link to="/ens" className="inline-flex items-center gap-2">
                                          <Globe className="h-4 w-4" />
                                          Verify in ENS Manager
                                          <ArrowRight className="h-3 w-3" />
                                        </Link>
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        </motion.div>

                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.25 }}
                          className="flex flex-col sm:flex-row gap-3 pt-4"
                        >
                          {keysJson && (
                            <DownloadJsonButton
                              data={keysJson}
                              filename="specter-keys.json"
                              label="Download Keys"
                              className="flex-1"
                              tooltip="Save keys as specter-keys.json (backup securely)"
                            />
                          )}
                          <Button variant="quantum" className="flex-1" asChild>
                            <Link to="/send">
                              Continue
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Link>
                          </Button>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="font-display text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Security Tips
                </h3>
                {securityTips.map((tip, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-border/50"
                  >
                    <tip.icon className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-sm text-muted-foreground">{tip.text}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
