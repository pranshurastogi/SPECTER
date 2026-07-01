import { motion } from "framer-motion";
import { BookOpen, CalendarDays } from "lucide-react";
import { SpiralAnimation } from "@/components/ui/spiral-animation";
import { AnimatedGridPattern } from "@/components/ui/animations/animated-grid-pattern";
import { LiquidMetalButton } from "@/components/ui/liquid-metal-button";
import { SCHEDULE_CALL_URL } from "@/lib/feedback";

const DOCS_URL = "https://docs.specterpq.com/";

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
            className="text-white/70 text-lg md:text-xl lg:text-2xl mb-16 sm:mb-24 max-w-2xl mx-auto"
            style={{ textShadow: "0 0 30px rgba(0,0,0,0.8)" }}
          >
            Send to anyone. Know no one.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="flex flex-wrap items-center justify-center gap-4"
          >
            <LiquidMetalButton
              href={DOCS_URL}
              label="Read the Docs"
              icon={<BookOpen className="h-4 w-4" />}
            />
            <LiquidMetalButton
              href={SCHEDULE_CALL_URL}
              label="Talk to Us"
              icon={<CalendarDays className="h-4 w-4" />}
            />
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
