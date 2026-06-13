/**
 * StageFlowLoader — multi-stage progress indicator for long-running flows
 * (wallet send → verify → publish, scan, …).
 *
 * Renders every stage of the pipeline with a live status per stage:
 *   pending  → dim placeholder dot
 *   active   → spinner ring + elapsed-seconds ticker + animated shimmer
 *   done     → green check (pop-in)
 *   error    → red X + sticky error message under the failed stage
 *
 * The caller drives it with a single `activeIndex`:
 *   - stages before `activeIndex` are done
 *   - the stage at `activeIndex` is active (or failed when `error` is set)
 *   - stages after are pending
 *   - `activeIndex >= stages.length` marks everything done.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type StageStatus = "pending" | "active" | "done" | "error";

export interface FlowStage {
  id: string;
  label: string;
  /** Secondary line shown while the stage is active. */
  description?: string;
}

export interface StageFlowLoaderProps {
  stages: FlowStage[];
  /**
   * Index of the currently running stage. Everything before it is rendered
   * as done. Pass `stages.length` to render the whole flow as complete.
   */
  activeIndex: number;
  /** When set, the active stage is rendered as failed with this message. */
  error?: string | null;
  className?: string;
  /** Small caption under the stages (e.g. "Do not close this tab"). */
  hint?: string;
}

function stageStatus(index: number, activeIndex: number, hasError: boolean): StageStatus {
  if (index < activeIndex) return "done";
  if (index === activeIndex) return hasError ? "error" : "active";
  return "pending";
}

/** Live elapsed-seconds ticker, reset whenever `resetKey` changes. */
function ElapsedSeconds({ resetKey }: { resetKey: string | number }) {
  const [seconds, setSeconds] = useState(0);
  const started = useRef(Date.now());

  useEffect(() => {
    started.current = Date.now();
    setSeconds(0);
    const t = setInterval(() => {
      setSeconds(Math.floor((Date.now() - started.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [resetKey]);

  if (seconds < 1) return null;
  return (
    <span className="font-mono text-[10px] text-white/30 tabular-nums shrink-0">
      {seconds}s
    </span>
  );
}

function StageIcon({ status }: { status: StageStatus }) {
  return (
    <span className="relative flex h-6 w-6 items-center justify-center shrink-0">
      <AnimatePresence mode="wait" initial={false}>
        {status === "done" && (
          <motion.span
            key="done"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 26 }}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/40"
          >
            <Check className="h-3 w-3 text-emerald-400" strokeWidth={3} />
          </motion.span>
        )}
        {status === "active" && (
          <motion.span
            key="active"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 border border-primary/40 shadow-[0_0_12px_rgba(139,92,246,0.35)]"
          >
            <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
          </motion.span>
        )}
        {status === "error" && (
          <motion.span
            key="error"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/15 border border-red-500/50 shadow-[0_0_12px_rgba(248,113,113,0.3)]"
          >
            <X className="h-3 w-3 text-red-400" strokeWidth={3} />
          </motion.span>
        )}
        {status === "pending" && (
          <motion.span
            key="pending"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex h-6 w-6 items-center justify-center"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export function StageFlowLoader({
  stages,
  activeIndex,
  error,
  className,
  hint,
}: StageFlowLoaderProps) {
  const hasError = Boolean(error);
  const allDone = activeIndex >= stages.length && !hasError;
  const progress = allDone
    ? 1
    : Math.max(0, Math.min(1, (activeIndex + (hasError ? 0 : 0.5)) / stages.length));

  return (
    <div
      className={cn(
        "rounded-xl border bg-black/55 backdrop-blur-md overflow-hidden",
        hasError ? "border-red-500/30" : "border-white/[0.08]",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {/* progress strip */}
      <div className="h-0.5 w-full bg-white/[0.05]">
        <motion.div
          className={cn(
            "h-full",
            hasError
              ? "bg-red-500/80"
              : allDone
                ? "bg-emerald-400/80"
                : "bg-gradient-to-r from-primary/60 to-primary",
          )}
          initial={false}
          animate={{ width: `${progress * 100}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      <div className="px-4 py-3.5 space-y-0.5">
        {stages.map((stage, i) => {
          const status = stageStatus(i, activeIndex, hasError);
          const isLast = i === stages.length - 1;
          return (
            <div key={stage.id} className="relative">
              <div className="flex items-center gap-3 py-1">
                <StageIcon status={status} />
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "font-display text-xs font-semibold tracking-wide transition-colors duration-300 truncate",
                      status === "done" && "text-white/45",
                      status === "active" && "text-white/95",
                      status === "error" && "text-red-300",
                      status === "pending" && "text-white/25",
                    )}
                  >
                    {stage.label}
                  </p>
                  <AnimatePresence initial={false}>
                    {status === "active" && stage.description && (
                      <motion.p
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="text-[11px] text-white/40 overflow-hidden"
                      >
                        {stage.description}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
                {status === "active" && <ElapsedSeconds resetKey={stage.id} />}
              </div>

              {/* connector */}
              {!isLast && (
                <div className="ml-3 h-2.5 w-px -translate-x-px">
                  <div
                    className={cn(
                      "h-full w-px transition-colors duration-500",
                      i < activeIndex ? "bg-emerald-500/40" : "bg-white/[0.08]",
                    )}
                  />
                </div>
              )}

              {/* sticky per-stage error */}
              <AnimatePresence initial={false}>
                {status === "error" && error && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <p className="ml-9 mt-1 mb-1.5 rounded-md border border-red-500/25 bg-red-500/[0.07] px-2.5 py-1.5 text-[11px] leading-relaxed text-red-300/90 break-words">
                      {error}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {hint && !hasError && (
          <p className="pt-2 text-center text-[10px] text-white/30">{hint}</p>
        )}
      </div>
    </div>
  );
}
