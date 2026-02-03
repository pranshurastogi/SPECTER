import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import {
  Key,
  Eye,
  Copy,
  Download,
  Check,
  Lock,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Upload,
  ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import { api, ApiError, type GenerateKeysResponse } from "@/lib/api";

type GenerationStep = "idle" | "generating" | "complete";

const securityTips = [
  { icon: Lock, text: "Your keys, your control" },
  { icon: Download, text: "Backup securely offline" },
  { icon: AlertTriangle, text: "Never share private keys" },
];

export default function GenerateKeys() {
  const [step, setStep] = useState<GenerationStep>("idle");
  const [keys, setKeys] = useState<GenerateKeysResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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

  const copyToClipboard = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const downloadKeys = () => {
    if (!keys) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            spending_pk: keys.spending_pk,
            spending_sk: keys.spending_sk,
            viewing_pk: keys.viewing_pk,
            viewing_sk: keys.viewing_sk,
            meta_address: keys.meta_address,
            view_tag: keys.view_tag,
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "specter-keys.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Keys saved to specter-keys.json");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 pt-24 pb-12">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-12"
            >
              <h1 className="font-display text-3xl md:text-4xl font-bold mb-4">
                Generate Your Keys
              </h1>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Create quantum-safe SPECTER identity for private payments
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              <div className="md:col-span-2">
                <div className="glass-card p-8">
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
                        <div className="flex items-center gap-3 p-4 rounded-lg bg-success/10 border border-success/20">
                          <img src="/SPECTER-logo.png" alt="SPECTER" className="h-5 w-5" />
                          <span className="text-sm font-medium text-success">
                            Keys Generated Successfully
                          </span>
                        </div>

                        <div className="space-y-4">
                          <div className="p-4 rounded-lg bg-muted/50 border border-border">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Key className="h-4 w-4 text-primary" />
                                <span className="text-sm font-medium">Spending Public Key</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyToClipboard(keys.spending_pk, "spending_pk")}
                              >
                                {copiedKey === "spending_pk" ? (
                                  <Check className="h-4 w-4 text-success" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                            <code className="text-xs text-muted-foreground break-all">
                              {keys.spending_pk.slice(0, 32)}...
                            </code>
                          </div>

                          <div className="p-4 rounded-lg bg-muted/50 border border-border">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Eye className="h-4 w-4 text-accent" />
                                <span className="text-sm font-medium">Viewing Public Key</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyToClipboard(keys.viewing_pk, "viewing_pk")}
                              >
                                {copiedKey === "viewing_pk" ? (
                                  <Check className="h-4 w-4 text-success" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                            <code className="text-xs text-muted-foreground break-all">
                              {keys.viewing_pk.slice(0, 32)}...
                            </code>
                          </div>

                          <div className="p-4 rounded-lg bg-muted/50 border border-border">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium">Meta-address (for ENS)</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyToClipboard(keys.meta_address, "meta_address")}
                              >
                                {copiedKey === "meta_address" ? (
                                  <Check className="h-4 w-4 text-success" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                            <code className="text-xs text-muted-foreground break-all">
                              {keys.meta_address.slice(0, 40)}...
                            </code>
                          </div>

                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="font-mono font-medium text-foreground">View tag:</span>
                            <span className="font-mono">{keys.view_tag}</span>
                          </div>
                        </div>

                        {/* Upload to IPFS */}
                        <div className="space-y-3 pt-2 border-t border-border">
                          <label className="block text-sm font-medium">Upload to IPFS (optional)</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="e.g. alice.eth (for Pinata metadata)"
                              value={ensName}
                              onChange={(e) => setEnsName(e.target.value)}
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <Button
                              variant="outline"
                              onClick={handleUploadToIpfs}
                              disabled={uploading}
                            >
                              {uploading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Upload className="h-4 w-4 mr-2" />
                                  Upload
                                </>
                              )}
                            </Button>
                          </div>
                          {uploadResult && (
                            <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
                              <p className="font-medium">ENS text record value:</p>
                              <code className="break-all text-xs">{uploadResult.text_record}</code>
                              <p className="text-xs text-muted-foreground mt-2">
                                Set this in ENS app (e.g. ENS Domains) for your .eth name, key &quot;specter&quot;.
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3 pt-4">
                          <Button variant="outline" className="flex-1" onClick={downloadKeys}>
                            <Download className="mr-2 h-4 w-4" />
                            Download Keys
                          </Button>
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
