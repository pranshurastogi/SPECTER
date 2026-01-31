import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Check,
  Zap,
  ExternalLink,
  ArrowRight,
  Loader2,
  Lock,
  Target,
} from "lucide-react";

type SendStep = "input" | "resolved" | "generated" | "sent";

interface ResolvedENS {
  name: string;
  registered: string;
  ipfs: string;
  quantumSafe: boolean;
}

interface StealthAddress {
  address: string;
  viewTag: string;
  efficiency: string;
}

export default function SendPayment() {
  const [step, setStep] = useState<SendStep>("input");
  const [ensName, setEnsName] = useState("");
  const [amount, setAmount] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [resolvedENS, setResolvedENS] = useState<ResolvedENS | null>(null);
  const [stealthAddress, setStealthAddress] = useState<StealthAddress | null>(
    null
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [txHash, setTxHash] = useState("");

  const generateRandomHex = (length: number) => {
    const chars = "0123456789ABCDEF";
    let result = "0x";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  };

  const handleResolve = async () => {
    if (!ensName) return;

    setIsResolving(true);
    await new Promise((r) => setTimeout(r, 1500));

    setResolvedENS({
      name: ensName.includes(".eth") ? ensName : `${ensName}.eth`,
      registered: "2026-03-01",
      ipfs: "QmXy8z" + generateRandomHex(8).slice(2),
      quantumSafe: true,
    });

    setIsResolving(false);
    setStep("resolved");
  };

  const handleGenerateStealth = async () => {
    if (!amount) return;

    setIsGenerating(true);
    await new Promise((r) => setTimeout(r, 2000));

    setStealthAddress({
      address: generateRandomHex(40),
      viewTag: "0x" + Math.floor(Math.random() * 255).toString(16).toUpperCase(),
      efficiency: "99.61",
    });

    setIsGenerating(false);
    setStep("generated");
  };

  const handleSend = async () => {
    setIsSending(true);
    await new Promise((r) => setTimeout(r, 2000));

    setTxHash(generateRandomHex(64));
    setIsSending(false);
    setStep("sent");
  };

  const resetForm = () => {
    setStep("input");
    setEnsName("");
    setAmount("");
    setResolvedENS(null);
    setStealthAddress(null);
    setTxHash("");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 pt-24 pb-12">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-12"
            >
              <h1 className="font-display text-3xl md:text-4xl font-bold mb-4">
                Send Private Payment
              </h1>
              <p className="text-muted-foreground">
                Quantum-safe stealth payments to any ENS name
              </p>
            </motion.div>

            <div className="glass-card p-8">
              <AnimatePresence mode="wait">
                {/* Input Step */}
                {step === "input" && (
                  <motion.div
                    key="input"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-6"
                  >
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Recipient ENS
                      </label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="bob.eth"
                          value={ensName}
                          onChange={(e) => setEnsName(e.target.value)}
                          className="bg-background flex-1"
                        />
                        <Button
                          onClick={handleResolve}
                          disabled={!ensName || isResolving}
                        >
                          {isResolving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Search className="h-4 w-4 mr-2" />
                              Resolve
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Resolved Step */}
                {step === "resolved" && resolvedENS && (
                  <motion.div
                    key="resolved"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-6"
                  >
                    {/* Resolved Info */}
                    <div className="p-4 rounded-lg bg-success/10 border border-success/20">
                      <div className="flex items-center gap-2 mb-3">
                        <Check className="h-4 w-4 text-success" />
                        <span className="font-medium text-success">
                          Resolved {resolvedENS.name}
                        </span>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Registered
                          </span>
                          <span>{resolvedENS.registered}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">IPFS</span>
                          <span className="font-mono text-xs">
                            {resolvedENS.ipfs}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">
                            Quantum-safe
                          </span>
                          <div className="flex items-center gap-1 text-success">
                            <img src="/SPECTER-logo.png" alt="SPECTER" className="h-4 w-4" />
                            <Check className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Amount Input */}
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Amount (ETH)
                      </label>
                      <Input
                        type="number"
                        placeholder="0.0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="bg-background text-lg font-mono"
                      />
                    </div>

                    <Button
                      variant="quantum"
                      className="w-full"
                      onClick={handleGenerateStealth}
                      disabled={!amount || isGenerating}
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

                {/* Generated Step */}
                {step === "generated" && stealthAddress && resolvedENS && (
                  <motion.div
                    key="generated"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-6"
                  >
                    {/* Stealth Address Info */}
                    <div className="p-6 rounded-lg bg-muted/50 border border-border">
                      <h3 className="font-display font-semibold mb-4">
                        Stealth Address Generated
                      </h3>

                      <div className="space-y-4">
                        <div className="flex items-start gap-3">
                          <Target className="h-5 w-5 text-primary mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-muted-foreground mb-1">
                              Address
                            </div>
                            <code className="text-sm font-mono break-all">
                              {stealthAddress.address}
                            </code>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                              <span className="font-mono text-xs text-accent">
                                {stealthAddress.viewTag}
                              </span>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">
                                View Tag
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <Zap className="h-5 w-5 text-accent" />
                            <div>
                              <div className="text-xs text-muted-foreground">
                                Scan Efficiency
                              </div>
                              <div className="text-sm font-medium text-accent">
                                {stealthAddress.efficiency}%
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Privacy Guarantee */}
                    <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                      <div className="flex items-start gap-3">
                        <Lock className="h-5 w-5 text-primary mt-0.5" />
                        <div>
                          <h4 className="font-medium text-sm mb-1">
                            Privacy Guarantee
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            Only {resolvedENS.name} can find this payment.
                            On-chain observers cannot link it to{" "}
                            {resolvedENS.name}.
                          </p>
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="quantum"
                      size="lg"
                      className="w-full"
                      onClick={handleSend}
                      disabled={isSending}
                    >
                      {isSending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Sending...
                        </>
                      ) : (
                        <>
                          Send {amount} ETH
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </motion.div>
                )}

                {/* Sent Step */}
                {step === "sent" && (
                  <motion.div
                    key="sent"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center py-8 space-y-6"
                  >
                    <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto">
                      <Check className="h-8 w-8 text-success" />
                    </div>

                    <div>
                      <h2 className="font-display text-2xl font-bold mb-2">
                        Payment Sent!
                      </h2>
                      <p className="text-muted-foreground">
                        Your private payment has been sent successfully
                      </p>
                    </div>

                    <div className="p-4 rounded-lg bg-muted/50 text-left space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                          Transaction
                        </span>
                        <a
                          href="#"
                          className="flex items-center gap-1 text-sm text-primary hover:underline"
                        >
                          {txHash.slice(0, 12)}...
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                          Privacy
                        </span>
                        <span className="text-sm text-success flex items-center gap-1">
                          <Lock className="h-3 w-3" />
                          Recipient hidden
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                          Quantum-proof
                        </span>
                        <span className="text-sm text-primary flex items-center gap-1">
                          <img src="/SPECTER-logo.png" alt="SPECTER" className="h-3 w-3" />
                          2030-safe
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1" asChild>
                        <a href="#">
                          View Transaction
                          <ExternalLink className="ml-2 h-4 w-4" />
                        </a>
                      </Button>
                      <Button
                        variant="quantum"
                        className="flex-1"
                        onClick={resetForm}
                      >
                        Send Another
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
