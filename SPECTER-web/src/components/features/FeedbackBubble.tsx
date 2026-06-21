import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquarePlus, CalendarClock, X } from "lucide-react";
import {
  FEEDBACK_FORM_URL,
  SCHEDULE_CALL_URL,
  ISSUE_EVENT,
  type IssueDetail,
} from "@/lib/feedback";
import { WalkthroughPromptMascot } from "@/components/features/WalkthroughPromptMascot";

// Auto-dismiss after this long if the user doesn't interact.
const AUTO_DISMISS_MS = 7_000;
// Don't re-nag: once dismissed, stay quiet for this long even if more errors fire.
const SNOOZE_MS = 60_000;

/**
 * A small, friendly bottom-left popup that appears when the app hits an error.
 * Offers two low-pressure ways out: a quick feedback form or a 15-min call.
 * Auto-dismisses after 7s, or immediately when the user taps the cross.
 *
 * Triggered by:
 *  • `toast.error(...)` anywhere (the sonner wrapper dispatches `specter:issue`)
 *  • unhandled promise rejections
 *  • a manual `reportIssue()` call
 */
export function FeedbackBubble() {
  const [visible, setVisible] = useState(false);
  const snoozedUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    if (timer.current) clearTimeout(timer.current);
    snoozedUntil.current = Date.now() + SNOOZE_MS;
    setVisible(false);
  };

  useEffect(() => {
    const open = () => {
      if (Date.now() < snoozedUntil.current) return;
      setVisible(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    };

    const onIssue = (_e: Event) => open();
    const onRejection = () => open();

    window.addEventListener(ISSUE_EVENT, onIssue as EventListener);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener(ISSUE_EVENT, onIssue as EventListener);
      window.removeEventListener("unhandledrejection", onRejection);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          role="dialog"
          aria-labelledby="fb-title"
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-4 left-4 z-[100] w-[min(100vw-2rem,17rem)] pointer-events-auto"
        >
          <div className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-zinc-950/95 shadow-[0_16px_48px_-8px_rgba(0,0,0,0.85),0_0_28px_-6px_rgba(245,158,11,0.18)] backdrop-blur-xl">
            {/* Soft amber rim */}
            <div
              className="pointer-events-none absolute -inset-px rounded-[calc(1rem+1px)] opacity-40 z-0"
              style={{
                background:
                  "linear-gradient(135deg,rgba(245,158,11,0.35) 0%,transparent 45%,transparent 60%,rgba(251,191,36,0.1) 100%)",
              }}
              aria-hidden
            />

            {/* Close */}
            <button
              type="button"
              onClick={dismiss}
              className="absolute top-2 right-2 z-30 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900/80 text-zinc-500 ring-1 ring-zinc-700/60 transition-all hover:text-zinc-200 hover:ring-amber-500/40"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>

            <div className="relative z-10 p-4">
              {/* Mascot + copy */}
              <div className="flex items-start gap-3">
                <div className="-mt-1 shrink-0">
                  <WalkthroughPromptMascot className="scale-90" />
                </div>
                <div className="min-w-0 pt-1">
                  <p
                    id="fb-title"
                    className="text-[13px] font-semibold leading-tight text-zinc-100"
                  >
                    Hit a snag?
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-400">
                    Tell us what happened, or grab 15 min with the team.
                  </p>
                </div>
              </div>

              {/* Uniform action pair */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a
                  href={FEEDBACK_FORM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full bg-amber-500 px-2 text-[11px] font-bold text-zinc-950 shadow-sm shadow-amber-500/30 transition-all hover:bg-amber-400 active:scale-95"
                >
                  <MessageSquarePlus className="h-3 w-3 shrink-0" />
                  Feedback
                </a>
                <a
                  href={SCHEDULE_CALL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full border border-zinc-700/70 px-2 text-[11px] font-semibold text-zinc-300 transition-all hover:border-amber-500/40 hover:text-amber-200 active:scale-95"
                >
                  <CalendarClock className="h-3 w-3 shrink-0" />
                  Book a call
                </a>
              </div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

// Re-exported for convenience so callers can trigger the bubble directly.
export type { IssueDetail };
