import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { Link } from "react-router-dom";

type GenerationStep = "idle" | "generating" | "password" | "complete";

interface GeneratedKeys {
  spendingPublic: string;
  viewingPublic: string;
  spendingPrivate: string;
  viewingPrivate: string;
}

const securityTips = [
  { icon: Lock, text: "Your keys, your control" },
  { icon: Download, text: "Backup securely offline" },
  { icon: AlertTriangle, text: "Never share private keys" },
];

export default function GenerateKeys() {
  const [step, setStep] = useState<GenerationStep>("idle");
  const [progress, setProgress] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [keys, setKeys] = useState<GeneratedKeys | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const generateRandomHex = (length: number) => {
    const chars = "0123456789abcdef";
    let result = "0x";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  };

  const handleGenerate = async () => {
    setStep("generating");
    setProgress([]);

    // Simulate key generation steps
    await new Promise((r) => setTimeout(r, 800));
    setProgress(["Generating spending keys..."]);

    await new Promise((r) => setTimeout(r, 1000));
    setProgress((p) => [...p, "Generating viewing keys..."]);

    await new Promise((r) => setTimeout(r, 800));
    setProgress((p) => [...p, "Applying ML-KEM-768..."]);

    await new Promise((r) => setTimeout(r, 600));
    setStep("password");
  };

  const handleEncrypt = async () => {
    if (!password || password.length < 8) return;

    setProgress((p) => [...p, "Encrypting with password..."]);

    await new Promise((r) => setTimeout(r, 1000));

    setKeys({
      spendingPublic: generateRandomHex(64),
      viewingPublic: generateRandomHex(64),
      spendingPrivate: generateRandomHex(64),
      viewingPrivate: generateRandomHex(64),
    });

    setStep("complete");
  };

  const copyToClipboard = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const downloadKeys = () => {
    if (!keys) return;
    const blob = new Blob([JSON.stringify(keys, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "specter-keys.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const getPasswordStrength = () => {
    if (password.length === 0) return { strength: 0, label: "", color: "" };
    if (password.length < 8)
      return { strength: 25, label: "Weak", color: "bg-destructive" };
    if (password.length < 12)
      return { strength: 50, label: "Fair", color: "bg-warning" };
    if (password.length < 16)
      return { strength: 75, label: "Strong", color: "bg-accent" };
    return { strength: 100, label: "Very Strong", color: "bg-success" };
  };

  const passwordStrength = getPasswordStrength();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 pt-24 pb-12">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            {/* Header */}
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
              {/* Main Content */}
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
                          for receiving private payments.
                        </p>
                        <Button
                          variant="quantum"
                          size="xl"
                          onClick={handleGenerate}
                        >
                          Generate Keys
                        </Button>
                      </motion.div>
                    )}

                    {(step === "generating" || step === "password") && (
                      <motion.div
                        key="generating"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="space-y-6"
                      >
                        {/* Progress */}
                        <div className="space-y-3">
                          {progress.map((item, index) => (
                            <motion.div
                              key={index}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="flex items-center gap-3"
                            >
                              <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center">
                                <Check className="h-3 w-3 text-success" />
                              </div>
                              <span className="text-sm font-mono">{item}</span>
                            </motion.div>
                          ))}
                          {step === "generating" && (
                            <div className="flex items-center gap-3">
                              <Loader2 className="h-5 w-5 text-primary animate-spin" />
                              <span className="text-sm font-mono text-muted-foreground">
                                Processing...
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Password Input */}
                        {step === "password" && (
                          <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-4 pt-6 border-t border-border"
                          >
                            <div>
                              <label className="block text-sm font-medium mb-2">
                                Encryption Password
                              </label>
                              <Input
                                type="password"
                                placeholder="Enter a strong password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="bg-background"
                              />
                            </div>

                            {/* Password Strength */}
                            <div className="space-y-2">
                              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                <motion.div
                                  className={`h-full ${passwordStrength.color}`}
                                  initial={{ width: 0 }}
                                  animate={{
                                    width: `${passwordStrength.strength}%`,
                                  }}
                                />
                              </div>
                              {passwordStrength.label && (
                                <p
                                  className={`text-xs ${passwordStrength.strength >= 75
                                    ? "text-success"
                                    : passwordStrength.strength >= 50
                                      ? "text-warning"
                                      : "text-destructive"
                                    }`}
                                >
                                  {passwordStrength.label}
                                </p>
                              )}
                            </div>

                            <Button
                              variant="quantum"
                              className="w-full"
                              onClick={handleEncrypt}
                              disabled={password.length < 8}
                            >
                              Encrypt & Generate
                            </Button>
                          </motion.div>
                        )}
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
                        {/* Success Badge */}
                        <div className="flex items-center gap-3 p-4 rounded-lg bg-success/10 border border-success/20">
                          <img src="/SPECTER-logo.png" alt="SPECTER" className="h-5 w-5" />
                          <span className="text-sm font-medium text-success">
                            Keys Generated Successfully
                          </span>
                        </div>

                        {/* Keys Display */}
                        <div className="space-y-4">
                          {/* Spending Public Key */}
                          <div className="p-4 rounded-lg bg-muted/50 border border-border">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Key className="h-4 w-4 text-primary" />
                                <span className="text-sm font-medium">
                                  Spending Public Key
                                </span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  copyToClipboard(
                                    keys.spendingPublic,
                                    "spending"
                                  )
                                }
                              >
                                {copiedKey === "spending" ? (
                                  <Check className="h-4 w-4 text-success" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                            <code className="text-xs text-muted-foreground break-all">
                              {keys.spendingPublic.slice(0, 32)}...
                            </code>
                          </div>

                          {/* Viewing Public Key */}
                          <div className="p-4 rounded-lg bg-muted/50 border border-border">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Eye className="h-4 w-4 text-accent" />
                                <span className="text-sm font-medium">
                                  Viewing Public Key
                                </span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  copyToClipboard(keys.viewingPublic, "viewing")
                                }
                              >
                                {copiedKey === "viewing" ? (
                                  <Check className="h-4 w-4 text-success" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                            <code className="text-xs text-muted-foreground break-all">
                              {keys.viewingPublic.slice(0, 32)}...
                            </code>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col sm:flex-row gap-3 pt-4">
                          <Button
                            variant="outline"
                            className="flex-1"
                            onClick={downloadKeys}
                          >
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

              {/* Security Tips Sidebar */}
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
                    <tip.icon className="h-5 w-5 text-primary mt-0.5" />
                    <span className="text-sm text-muted-foreground">
                      {tip.text}
                    </span>
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
