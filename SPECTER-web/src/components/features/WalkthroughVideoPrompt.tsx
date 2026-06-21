import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Play, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import {
  isSpecterProductionHost,
  markWalkthroughPromptSeen,
  recordWalkthroughPromptView,
  shouldShowWalkthroughPrompt,
} from "@/lib/walkthroughPrompt";
import {
  SPECTER_WALKTHROUGH_THUMBNAIL_URL,
  SPECTER_WALKTHROUGH_VIDEO_URL,
} from "@/lib/walkthroughVideo";
import { WalkthroughPromptMascot } from "@/components/features/WalkthroughPromptMascot";

const ALLOWED_PATHS = new Set(["/", "/insights"]);

export function WalkthroughVideoPrompt() {
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(() => !shouldShowWalkthroughPrompt());

  const dismiss = () => {
    markWalkthroughPromptSeen();
    setDismissed(true);
  };

  const watch = () => {
    dismiss();
    window.open(SPECTER_WALKTHROUGH_VIDEO_URL, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    if (!ALLOWED_PATHS.has(pathname)) dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const visible = !dismissed && ALLOWED_PATHS.has(pathname) && isSpecterProductionHost();

  // Count this appearance toward the lifetime cap (once per session).
  useEffect(() => {
    if (visible) recordWalkthroughPromptView();
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          role="dialog"
          aria-labelledby="wt-title"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-4 right-4 z-[100] w-[min(100vw-2rem,16rem)] pointer-events-auto"
        >
          <div className="group relative overflow-hidden rounded-2xl border border-amber-500/25 bg-zinc-950 shadow-[0_16px_48px_-8px_rgba(0,0,0,0.85),0_0_28px_-6px_rgba(245,158,11,0.22)] backdrop-blur-xl">

            {/* Amber rim glow */}
            <div
              className="pointer-events-none absolute -inset-px rounded-[calc(1rem+1px)] opacity-50 z-0"
              style={{
                background:
                  "linear-gradient(135deg,rgba(245,158,11,0.4) 0%,transparent 40%,transparent 60%,rgba(251,191,36,0.12) 100%)",
              }}
              aria-hidden
            />

            {/* ── Mascot header strip ── */}
            <div className="relative overflow-hidden" style={{ height: "4.5rem" }}>
              {/* Circuit / noise background */}
              <svg
                className="absolute inset-0 w-full h-full opacity-[0.12]"
                viewBox="0 0 256 72"
                preserveAspectRatio="xMidYMid slice"
                aria-hidden
              >
                <line x1="0" y1="20" x2="80" y2="20" stroke="#f59e0b" strokeWidth="0.7" />
                <line x1="80" y1="20" x2="80" y2="52" stroke="#f59e0b" strokeWidth="0.7" />
                <line x1="80" y1="52" x2="160" y2="52" stroke="#f59e0b" strokeWidth="0.7" />
                <line x1="160" y1="52" x2="160" y2="20" stroke="#f59e0b" strokeWidth="0.7" />
                <line x1="160" y1="20" x2="256" y2="20" stroke="#f59e0b" strokeWidth="0.7" />
                <circle cx="80" cy="20" r="2.5" fill="#f59e0b" />
                <circle cx="80" cy="52" r="2.5" fill="#f59e0b" />
                <circle cx="160" cy="52" r="2.5" fill="#f59e0b" />
                <circle cx="160" cy="20" r="2.5" fill="#f59e0b" />
                <line x1="20" y1="0" x2="20" y2="72" stroke="#f59e0b" strokeWidth="0.4" strokeDasharray="3 4" />
                <line x1="120" y1="0" x2="120" y2="72" stroke="#f59e0b" strokeWidth="0.4" strokeDasharray="3 4" />
                <line x1="220" y1="0" x2="220" y2="72" stroke="#f59e0b" strokeWidth="0.4" strokeDasharray="3 4" />
              </svg>

              {/* Amber center bloom */}
              <div
                className="pointer-events-none absolute inset-0 opacity-20"
                style={{ background: "radial-gradient(ellipse 70% 100% at 30% 50%, #f59e0b 0%, transparent 70%)" }}
                aria-hidden
              />

              {/* Mascot — flush left inside the strip */}
              <div className="absolute left-2 bottom-0 z-10">
                <WalkthroughPromptMascot />
              </div>

              {/* Tag line — right of mascot */}
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-right z-10">
                <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-amber-400/70 mb-0.5">
                  Quick start
                </span>
                <span
                  className="block font-black leading-none tracking-tight text-zinc-200"
                  style={{ fontSize: "1.1rem" }}
                >
                  New here?
                </span>
              </div>

              {/* Bottom separator line with amber fade */}
              <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-amber-500/50 via-amber-400/20 to-transparent" aria-hidden />
            </div>

            {/* ── Video thumbnail ── */}
            <button
              type="button"
              onClick={watch}
              className="relative block w-full overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400"
              aria-label="Watch SPECTER walkthrough on YouTube"
            >
              <div className="relative aspect-video w-full bg-zinc-900">
                <img
                  src={SPECTER_WALKTHROUGH_THUMBNAIL_URL}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover brightness-70 transition duration-500 group-hover:brightness-90 group-hover:scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/75 via-transparent to-transparent" />

                {/* Play button */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="relative flex h-10 w-10 items-center justify-center">
                    <span className="absolute inset-0 rounded-full bg-amber-500/25 animate-ping opacity-50" aria-hidden />
                    <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-zinc-950 shadow-[0_0_18px_rgba(245,158,11,0.65)] ring-2 ring-amber-300/40 transition-transform duration-300 group-hover:scale-110">
                      <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                    </span>
                  </span>
                </div>

                {/* Duration */}
                <span className="absolute bottom-1.5 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200/90">
                  5 min
                </span>
              </div>
            </button>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <p id="wt-title" className="text-[10px] text-zinc-500 truncate">
                5-min tour of SPECTER
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={watch}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-zinc-950 hover:bg-amber-400 active:scale-95 transition-all shadow-sm shadow-amber-500/30"
                >
                  <Play className="h-2.5 w-2.5 fill-current" />
                  Watch
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  Skip
                </button>
              </div>
            </div>

            {/* Close — top-right of the header strip */}
            <button
              type="button"
              onClick={dismiss}
              className="absolute top-2 right-2 z-30 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900/80 text-zinc-500 ring-1 ring-zinc-700/60 hover:text-zinc-200 hover:ring-amber-500/40 transition-all"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>

          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
