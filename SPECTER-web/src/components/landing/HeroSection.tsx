import { motion } from "framer-motion";
import { ArrowRight, Play, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 grid-pattern opacity-30" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px]" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-accent/10 rounded-full blur-[100px]" />

      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-8"
          >
            <img src="/SPECTER-logo.png" alt="SPECTER" className="h-4 w-4" />
            <span className="text-sm font-medium text-primary">
              Post-Quantum Cryptography
            </span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight"
          >
            Privacy that survives{" "}
            <span className="gradient-text">quantum computers</span>
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto"
          >
            Private ENS payments using post-quantum cryptography. Send funds to
            anyone with an ENS name while keeping the recipient completely
            hidden.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16"
          >
            <Button variant="quantum" size="xl" asChild>
              <Link to="/generate">
                Get Started
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button variant="outline" size="xl">
              <Play className="mr-2 h-5 w-5" />
              Watch Demo
            </Button>
          </motion.div>

          {/* Hero Visual - Flow Diagram */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="relative max-w-3xl mx-auto"
          >
            <div className="glass-card p-8 md:p-12">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                {/* Alice */}
                <motion.div
                  className="flex flex-col items-center gap-3"
                  animate={{ y: [0, -5, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center">
                    <span className="font-display font-bold text-lg">A</span>
                  </div>
                  <span className="font-display text-sm">alice.eth</span>
                </motion.div>

                {/* Arrow & SPECTER */}
                <div className="flex-1 flex items-center justify-center relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full h-[2px] bg-gradient-to-r from-primary/50 via-accent to-primary/50 relative overflow-hidden">
                      <motion.div
                        className="absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-accent to-transparent"
                        animate={{ x: ["-100%", "400%"] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      />
                    </div>
                  </div>
                  <div className="relative z-10 px-4 py-2 rounded-lg bg-background border border-primary/30 quantum-glow">
                    <span className="font-display font-bold text-primary">SPECTER</span>
                  </div>
                </div>

                {/* Bob */}
                <motion.div
                  className="flex flex-col items-center gap-3"
                  animate={{ y: [0, -5, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                >
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-accent to-success flex items-center justify-center">
                    <span className="font-display font-bold text-lg text-background">B</span>
                  </div>
                  <span className="font-display text-sm">bob.eth</span>
                </motion.div>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap items-center justify-center gap-4 mt-8 pt-6 border-t border-border/50">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/20">
                  <img src="/SPECTER-logo.png" alt="SPECTER" className="h-4 w-4" />
                  <span className="text-xs font-medium text-success">Quantum-Safe</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20">
                  <Zap className="h-4 w-4 text-accent" />
                  <span className="text-xs font-medium text-accent">1.5s Scan</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
                  <span className="text-xs font-medium text-primary">99.6% Efficiency</span>
                </div>
              </div>
            </div>

            {/* Glow effect behind card */}
            <div className="absolute -inset-4 bg-gradient-to-r from-primary/10 via-accent/5 to-primary/10 rounded-3xl blur-2xl -z-10" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
