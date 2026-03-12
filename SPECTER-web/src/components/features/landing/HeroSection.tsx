import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { SpiralAnimation } from "@/components/ui/spiral-animation";
import { AnimatedGridPattern } from "@/components/ui/animations/animated-grid-pattern";

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Spiral canvas background */}
      <div className="absolute inset-0 z-0">
        <SpiralAnimation />
      </div>

      {/* Subtle grid pattern overlay — ties into the rest of the page */}
      <AnimatedGridPattern
        numSquares={80}
        maxOpacity={0.06}
        duration={12}
        className="absolute inset-0 z-[1] [mask-image:radial-gradient(ellipse_70%_70%_at_50%_80%,white,transparent)]"
      />      {/* Content overlay */}
      <div className="relative z-10 container mx-auto max-w-5xl px-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center py-8"
        >
          <h1
            className="font-display text-white leading-[1.05] tracking-tight text-5xl md:text-7xl lg:text-8xl font-bold"
            style={{ textShadow: "0 0 40px rgba(0,0,0,0.8), 0 2px 8px rgba(0,0,0,0.6)" }}
          >
            <span className="block">Privacy that</span>
            <span className="block">survives</span>
            <span className="block text-white/40">Quantum Computers</span>
          </h1>

          <div className="mb-12" />

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="text-white/70 text-lg md:text-xl lg:text-2xl mb-10 max-w-2xl mx-auto"
            style={{ textShadow: "0 0 30px rgba(0,0,0,0.8)" }}
          >
            Send to anyone. Know no one.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
          >
            <Link
              to="/setup"
              className="group relative inline-flex items-center gap-3 px-8 py-4 rounded-full border border-white/20 bg-white/5 backdrop-blur-sm text-white text-lg font-display font-medium tracking-wide transition-all duration-500 hover:border-white/40 hover:bg-white/10 hover:shadow-[0_0_30px_rgba(255,255,255,0.1)] hover:scale-105"
            >
              Enter the Void
              <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </motion.div>
        </motion.div>
      </div>
      {/* Bottom gradient blend into page background */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[5] h-48 pointer-events-none"
        style={{ background: "linear-gradient(to bottom, transparent, hsl(var(--background)))" }}
      />
    </section>
  );
}
