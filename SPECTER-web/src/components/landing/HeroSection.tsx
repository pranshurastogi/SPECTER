import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { HeadingScramble } from "@/components/ui/heading-scramble";

const HEADLINE_PREFIX = "Privacy that survives ";
const HEADLINE_HIGHLIGHT = "quantum computers";

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
          <div
            className="min-h-[6rem] flex flex-wrap items-baseline justify-center gap-x-2 mb-8 cursor-default"
            onMouseEnter={() => setHoverTrigger((t) => t + 1)}
          >
            <HeadingScramble
              as="h1"
              trigger={hoverTrigger}
              className="font-display text-6xl md:text-8xl lg:text-9xl font-bold tracking-tight text-foreground"
            >
              {HEADLINE_PREFIX}
            </HeadingScramble>
            <span className="font-display text-6xl md:text-8xl lg:text-9xl font-bold tracking-tight gradient-text">
              {HEADLINE_HIGHLIGHT}
            </span>
          </div>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="text-muted-foreground text-2xl md:text-3xl lg:text-4xl mb-12 max-w-2xl mx-auto"
          >
            Send to any ENS name; recipient stays hidden.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <Button variant="quantum" size="xl" asChild>
              <Link to="/generate">
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
