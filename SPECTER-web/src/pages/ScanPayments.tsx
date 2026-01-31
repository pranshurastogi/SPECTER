import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import {
  Scan,
  Loader2,
  Wallet,
  Clock,
  ArrowDownToLine,
  AlertTriangle,
  Check,
  Zap,
} from "lucide-react";

type ScanState = "idle" | "scanning" | "complete";

interface Payment {
  id: string;
  address: string;
  amount: string;
  receivedAgo: string;
}

interface ScanStats {
  total: number;
  filtered: number;
  efficiency: string;
  timeElapsed: string;
}

export default function ScanPayments() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);

  const viewTag = "0x42";

  const generateRandomHex = (length: number) => {
    const chars = "0123456789ABCDEF";
    let result = "0x";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  };

  const handleScan = async () => {
    setScanState("scanning");
    setProgress(0);
    setStats(null);
    setPayments([]);

    // Simulate scanning progress
    for (let i = 0; i <= 100; i += 5) {
      await new Promise((r) => setTimeout(r, 100));
      setProgress(i);

      if (i === 50) {
        setStats({
          total: 100000,
          filtered: 195,
          efficiency: "99.61",
          timeElapsed: "0.6s",
        });
      }

      if (i === 100) {
        setStats((prev) =>
          prev ? { ...prev, timeElapsed: "1.2s" } : null
        );
      }
    }

    // Generate mock payments
    setPayments([
      {
        id: "1",
        address: generateRandomHex(40),
        amount: "10",
        receivedAgo: "2 hours ago",
      },
      {
        id: "2",
        address: generateRandomHex(40),
        amount: "5",
        receivedAgo: "1 day ago",
      },
    ]);

    setScanState("complete");
  };

  const handleWithdraw = async (payment: Payment) => {
    setSelectedPayment(payment);
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
                Scan for Payments
              </h1>
              <p className="text-muted-foreground">
                Find your stealth funds with quantum-safe scanning
              </p>
            </motion.div>

            {/* View Tag Info */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card p-6 mb-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <span className="font-mono font-bold text-primary">
                      {viewTag}
                    </span>
                  </div>
                  <div>
                    <div className="font-medium">Your View Tag</div>
                    <div className="text-sm text-muted-foreground">
                      Filters 99.6% of announcements instantly
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-accent">
                  <Zap className="h-4 w-4" />
                  <span className="text-sm font-medium">99.61% Efficiency</span>
                </div>
              </div>
            </motion.div>

            {/* Main Card */}
            <div className="glass-card p-8">
              <AnimatePresence mode="wait">
                {/* Idle State */}
                {scanState === "idle" && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center py-8"
                  >
                    <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-6">
                      <Scan className="h-10 w-10 text-primary" />
                    </div>
                    <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                      Scan the blockchain to find payments sent to your stealth
                      addresses.
                    </p>
                    <Button variant="quantum" size="xl" onClick={handleScan}>
                      Start Scan
                    </Button>
                  </motion.div>
                )}

                {/* Scanning State */}
                {scanState === "scanning" && (
                  <motion.div
                    key="scanning"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-6"
                  >
                    {/* Progress Bar */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Scanning...</span>
                        <span className="font-mono">{progress}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-primary to-accent"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.1 }}
                        />
                      </div>
                    </div>

                    {/* Live Stats */}
                    {stats && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="grid grid-cols-2 gap-4"
                      >
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-display font-bold">
                            {stats.total.toLocaleString()}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Total announcements
                          </div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-display font-bold text-accent">
                            {stats.filtered}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Filtered by tag
                          </div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-display font-bold text-success">
                            {stats.efficiency}%
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Efficiency
                          </div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-display font-bold">
                            {stats.timeElapsed}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Time elapsed
                          </div>
                        </div>
                      </motion.div>
                    )}

                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Processing...</span>
                    </div>
                  </motion.div>
                )}

                {/* Complete State */}
                {scanState === "complete" && (
                  <motion.div
                    key="complete"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-6"
                  >
                    {/* Summary */}
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-success/10 border border-success/20">
                      <Check className="h-5 w-5 text-success" />
                      <span className="font-medium text-success">
                        Scan Complete - Found {payments.length} payment(s)
                      </span>
                    </div>

                    {/* Payments List */}
                    <div className="space-y-3">
                      {payments.map((payment, index) => (
                        <motion.div
                          key={payment.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.1 }}
                          className="p-4 rounded-lg bg-muted/50 border border-border hover:border-primary/30 transition-colors"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <Wallet className="h-5 w-5 text-primary" />
                              </div>
                              <div>
                                <div className="font-mono text-sm">
                                  {payment.address.slice(0, 10)}...
                                  {payment.address.slice(-8)}
                                </div>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  {payment.receivedAgo}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-display font-bold text-lg">
                                {payment.amount} ETH
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => handleWithdraw(payment)}
                          >
                            <ArrowDownToLine className="h-4 w-4 mr-2" />
                            Withdraw
                          </Button>
                        </motion.div>
                      ))}
                    </div>

                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleScan}
                    >
                      <Scan className="h-4 w-4 mr-2" />
                      Scan Again
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Withdraw Modal */}
            <AnimatePresence>
              {selectedPayment && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                  onClick={() => setSelectedPayment(null)}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="glass-card p-6 max-w-md w-full"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 className="font-display text-xl font-bold mb-4">
                      Withdraw {selectedPayment.amount} ETH
                    </h3>

                    <div className="space-y-4">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">
                          From (stealth)
                        </div>
                        <code className="text-sm font-mono break-all">
                          {selectedPayment.address}
                        </code>
                      </div>

                      {/* Privacy Warning */}
                      <div className="p-4 rounded-lg bg-warning/10 border border-warning/20">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
                          <div>
                            <h4 className="font-medium text-sm text-warning mb-1">
                              Privacy Warning
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              Direct withdrawal to your main wallet creates an
                              on-chain link. Consider using time delays or
                              splitting into multiple transactions for better
                              privacy.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => setSelectedPayment(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="quantum"
                          className="flex-1"
                          onClick={() => setSelectedPayment(null)}
                        >
                          I Understand - Withdraw
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
