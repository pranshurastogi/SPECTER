import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, X, Key } from "lucide-react";
import { getSetupProgress, isSetupInProgress } from "@/lib/setupProgress";

export function ResumeBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !isSetupInProgress()) return null;

  const progress = getSetupProgress()!;

  // Determine where they left off
  const statusLabel = progress.suinsAttached
    ? "Attach to SuiNS done — finish setup"
    : progress.ensAttached
      ? "ENS attached — one step left"
      : "Keys generated — attach to ENS or finish";

  const stepNum = progress.suinsAttached ? 4 : progress.ensAttached ? 3 : 2;

  return (
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-lg">
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.08] bg-black/75 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.05)]">
        {/* Icon */}
        <div className="shrink-0 w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Key className="h-4 w-4 text-primary" />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="font-display text-[11px] font-bold tracking-[0.14em] uppercase text-white/30 leading-none mb-0.5">
            Setup in progress
          </p>
          <p className="text-sm text-white/80 font-medium truncate">
            {statusLabel}
          </p>
        </div>

        {/* Step indicators */}
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                s < stepNum
                  ? "bg-emerald-400"
                  : s === stepNum
                    ? "bg-primary animate-pulse"
                    : "bg-white/15"
              }`}
            />
          ))}
        </div>

        {/* CTA */}
        <Link
          to="/setup"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-xs font-semibold font-display tracking-wide transition-colors"
        >
          Resume
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>

        {/* Dismiss */}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
