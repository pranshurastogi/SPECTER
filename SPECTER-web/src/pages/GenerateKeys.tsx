import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Download,
  CheckCircle2,
  ChevronRight,
  Globe,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import { CopyButton } from "@/components/ui/copy-button";
import { DownloadJsonButton } from "@/components/ui/download-json-button";
import { TooltipLabel } from "@/components/ui/tooltip-label";
import { api, ApiError, type GenerateKeysResponse } from "@/lib/api";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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
  const [ensOpen, setEnsOpen] = useState(false);

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

      <main className="flex-1 pt-20 pb-12 flex flex-col items-center">
        <div className="w-full max-w-lg mx-auto px-4 flex flex-col items-center">
          {/* Title — centered, minimal */}
          <div className="text-center mb-8">
            <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground">
              Generate Keys
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Quantum-safe SPECTER identity for private payments
            </p>
          </div>

          {/* Main card — single centered block */}
          <Card className="w-full border-border bg-card/50 shadow-lg rounded-xl overflow-hidden">
            <CardContent className="p-6 md:p-8">
              <AnimatePresence mode="wait">
                {step === "idle" && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center text-center"
                  >
                    <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
                      <Key className="h-7 w-7 text-primary" />
                    </div>
                    <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                      Generate a new set of cryptographic keys for receiving private payments.
                    </p>
                    <Button variant="quantum" size="lg" onClick={handleGenerate}>
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
                    className="flex flex-col items-center py-8"
                  >
                    <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
                    <p className="text-sm text-muted-foreground">Generating keys…</p>
                  </motion.div>
                )}

                {step === "complete" && keys && (
                  <motion.div
                    key="complete"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-5"
                  >
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/20">
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                      <span className="text-sm font-medium text-success">Keys generated</span>
                    </div>

                    <div className="space-y-3">
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
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="flex items-start justify-between gap-3 p-3 rounded-lg bg-muted/40 border border-border"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              {item.icon && (
                                <item.icon className="h-3.5 w-3.5 text-primary shrink-0" />
                              )}
                              <TooltipLabel
                                label={item.label}
                                tooltip={item.tooltip}
                                className="text-xs font-medium"
                              />
                            </div>
                            <code className="text-xs text-muted-foreground break-all">
                              {item.preview}
                            </code>
                          </div>
                          <CopyButton
                            text={item.value}
                            variant="ghost"
                            size="sm"
                            showLabel={false}
                            tooltip="Copy"
                            tooltipCopied="Copied!"
                            successMessage="Copied"
                          />
                        </div>
                      ))}

                      <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                        <TooltipLabel
                          label="View tag"
                          tooltip="First byte of shared secret; used to filter announcements when scanning."
                        />
                        <span className="font-mono font-medium text-foreground">
                          {keys.view_tag}
                        </span>
                      </div>
                    </div>

                    {/* ENS (optional) — collapsible */}
                    <Collapsible open={ensOpen} onOpenChange={setEnsOpen}>
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary" />
                            Enable ENS payments (optional)
                          </span>
                          <ChevronRight
                            className={`h-4 w-4 text-muted-foreground transition-transform ${ensOpen ? "rotate-90" : ""}`}
                          />
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="pt-4 space-y-4 border-t border-border mt-4">
                          <p className="text-xs text-muted-foreground">
                            Upload meta-address to IPFS, then set the hash in your ENS name.
                          </p>
                          {!uploadResult ? (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="e.g. alice.eth"
                                value={ensName}
                                onChange={(e) => setEnsName(e.target.value)}
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                              />
                              <Button
                                variant="quantum"
                                size="default"
                                onClick={handleUploadToIpfs}
                                disabled={uploading}
                              >
                                {uploading ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Upload className="h-4 w-4 mr-1.5" />
                                    Upload
                                  </>
                                )}
                              </Button>
                            </div>
                          ) : (
                            <div className="p-3 rounded-lg bg-success/10 border border-success/20">
                              <p className="text-xs font-medium text-success mb-1 flex items-center gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Uploaded to IPFS
                              </p>
                              <div className="flex items-center gap-2 mt-2">
                                <code className="flex-1 text-xs font-mono truncate text-muted-foreground">
                                  {uploadResult.text_record}
                                </code>
                                <CopyButton
                                  text={uploadResult.text_record}
                                  variant="outline"
                                  size="sm"
                                  showLabel={true}
                                  label="Copy"
                                  successMessage="Copied"
                                />
                              </div>
                              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                                <Info className="h-3 w-3" />
                                Set this as Content Hash or text record <code>specter</code> in ENS.
                              </p>
                              <Button variant="outline" size="sm" className="mt-3" asChild>
                                <a
                                  href={ensName.trim() ? `https://app.ens.domains/${ensName.replace(/\.eth$/i, "")}.eth` : "https://app.ens.domains"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5"
                                >
                                  <Globe className="h-3.5 w-3.5" />
                                  Open ENS
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </Button>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    <div className="flex flex-col sm:flex-row gap-3 pt-2">
                      {keysJson && (
                        <DownloadJsonButton
                          data={keysJson}
                          filename="specter-keys.json"
                          label="Download keys"
                          className="flex-1"
                          tooltip="Save keys (backup securely)"
                        />
                      )}
                      <Button variant="quantum" className="flex-1" asChild>
                        <Link to="/send">
                          Continue
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          {/* Security tips — minimal row */}
          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {securityTips.map((tip, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <tip.icon className="h-3.5 w-3.5 text-primary" />
                {tip.text}
              </span>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
