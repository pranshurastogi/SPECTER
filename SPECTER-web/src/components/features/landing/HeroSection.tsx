import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/base/button";
import { Link } from "react-router-dom";
import { HeadingScramble } from "@/components/ui/animations/heading-scramble";
import { ShutterText } from "@/components/ui/animations/hero-shutter-text";

const HEADLINE_PREFIX = "Privacy that survives ";
const HEADLINE_LINES = ["Quantum", "Computers"];

export function HeroSection() {
  const [hoverTrigger, setHoverTrigger] = useState(0);

  return (
    <section className="relative min-h-screen flex items-center justify-center pt-24 pb-20 px-4">
      <div className="container mx-auto max-w-5xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="py-8"
        >
          {/*
            Outer wrapper is a div — HeadingScramble renders the real <h1> tag.
            Nesting <h1> inside <h1> is invalid HTML; the browser would auto-close
            the outer one early, breaking the layout entirely.
          */}
          <div className="font-display font-bold tracking-tight mb-8 leading-[1.12]">
            {/* Line 1 – scramble on hover; HeadingScramble owns the <h1> tag */}
            <div
              className="cursor-default"
              onMouseEnter={() => setHoverTrigger((t) => t + 1)}
            >
              <HeadingScramble
                as="h1"
                trigger={hoverTrigger}
                className="block text-5xl md:text-7xl lg:text-8xl font-semibold text-foreground"
              >
                {HEADLINE_PREFIX}
              </HeadingScramble>
            </div>

            {/* Lines 2 & 3 – shutter plays once on mount, never re-triggered by hover */}
            <div className="relative">
              {/* ambient glow */}
              <span
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[200%] w-[110%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[80px]"
                style={{
                  background:
                    "radial-gradient(ellipse 65% 65% at 25% 50%, hsl(263 70% 52% / 0.5), transparent 65%), radial-gradient(ellipse 65% 65% at 75% 50%, hsl(188 80% 44% / 0.4), transparent 65%)",
                }}
              />
              {HEADLINE_LINES.map((word, lineIdx) => (
                <div key={word}>
                  <ShutterText
                    text={word}
                    trigger={lineIdx}
                    className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight"
                  />
                </div>
              ))}
            </div>
          </div>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="text-muted-foreground text-2xl md:text-3xl lg:text-4xl mb-12 max-w-2xl mx-auto"
          >
            Send to any name. Recipient stays hidden.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <Button variant="quantum" size="xl" asChild>
              <Link to="/setup">
                Get Started
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
