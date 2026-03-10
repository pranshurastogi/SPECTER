import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface ShutterTextProps {
  text: string;
  className?: string;
  trigger?: number;
}

/**
 * Inline shutter-reveal text — GPU-optimised.
 * Uses only transform + opacity (compositor-only, zero layout/paint).
 * No filter:blur — avoids per-frame rasterisation that causes jitter.
 */
export function ShutterText({ text, className = "", trigger = 0 }: ShutterTextProps) {
  const chars = text.split("");

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={trigger}
        className={cn("inline-flex flex-wrap justify-center items-baseline", className)}
      >
        {chars.map((char, i) => {
          const isSpace = char === " ";
          const delay = i * 0.038;

          return (
            <span
              key={i}
              className="relative overflow-hidden"
              style={{
                paddingInline: isSpace ? "0.14em" : "0.012em",
                // promote each char wrapper to its own compositor layer
                transform: "translateZ(0)",
                willChange: "transform",
              }}
            >
              {/* ── Main char: slides up + fades in (pure transform+opacity) ── */}
              <motion.span
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: delay + 0.14,
                  duration: 0.46,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="relative z-0 font-inherit quantum-char"
                style={
                  !isSpace
                    ? ({
                        display: "inline-block",
                        "--char-i": i,
                        willChange: "transform, opacity",
                      } as React.CSSProperties)
                    : { display: "inline-block" }
                }
              >
                {isSpace ? "\u00A0" : char}
              </motion.span>

              {/* ── Top slice (0–33 %) sweeps left → right ── */}
              <motion.span
                aria-hidden
                initial={{ x: "-106%", opacity: 0 }}
                animate={{ x: "106%", opacity: [0, 1, 1, 0] }}
                transition={{
                  delay,
                  duration: 0.46,
                  ease: "easeInOut",
                }}
                className="pointer-events-none absolute inset-0 z-10 font-inherit"
                style={{
                  clipPath: "polygon(0 0, 100% 0, 100% 33%, 0 33%)",
                  color: "hsl(263 70% 72%)",
                  willChange: "transform, opacity",
                }}
              >
                {isSpace ? "\u00A0" : char}
              </motion.span>

              {/* ── Middle slice (33–66 %) sweeps right → left ── */}
              <motion.span
                aria-hidden
                initial={{ x: "106%", opacity: 0 }}
                animate={{ x: "-106%", opacity: [0, 1, 1, 0] }}
                transition={{
                  delay: delay + 0.07,
                  duration: 0.46,
                  ease: "easeInOut",
                }}
                className="pointer-events-none absolute inset-0 z-10 font-inherit"
                style={{
                  clipPath: "polygon(0 33%, 100% 33%, 100% 66%, 0 66%)",
                  color: "hsl(188 80% 62%)",
                  willChange: "transform, opacity",
                }}
              >
                {isSpace ? "\u00A0" : char}
              </motion.span>

              {/* ── Bottom slice (66–100 %) sweeps left → right ── */}
              <motion.span
                aria-hidden
                initial={{ x: "-106%", opacity: 0 }}
                animate={{ x: "106%", opacity: [0, 1, 1, 0] }}
                transition={{
                  delay: delay + 0.14,
                  duration: 0.46,
                  ease: "easeInOut",
                }}
                className="pointer-events-none absolute inset-0 z-10 font-inherit"
                style={{
                  clipPath: "polygon(0 66%, 100% 66%, 100% 100%, 0 100%)",
                  color: "hsl(263 70% 72%)",
                  willChange: "transform, opacity",
                }}
              >
                {isSpace ? "\u00A0" : char}
              </motion.span>
            </span>
          );
        })}
      </motion.span>
    </AnimatePresence>
  );
}
