import { ArrowUpRight, KeyRound, ScanLine, Send } from "lucide-react";
import {
  SPECTER_WALKTHROUGH_EMBED_URL,
  SPECTER_WALKTHROUGH_VIDEO_URL,
} from "@/lib/walkthroughVideo";

const STEPS = [
  {
    icon: <KeyRound className="w-3.5 h-3.5" />,
    label: "Generate keys",
    detail: "Stealth address + passkey vault",
  },
  {
    icon: <Send className="w-3.5 h-3.5" />,
    label: "Send privately",
    detail: "On-chain, no trace to you",
  },
  {
    icon: <ScanLine className="w-3.5 h-3.5" />,
    label: "Scan & collect",
    detail: "Claim incoming funds silently",
  },
];

export function WalkthroughVideoCard() {
  return (
    <div className="relative rounded-2xl overflow-hidden border border-amber-500/15 bg-zinc-950">
      {/* Ambient top glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-64 h-40 opacity-10 blur-3xl"
        style={{ background: "radial-gradient(circle, #f59e0b 0%, transparent 65%)" }}
        aria-hidden
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-0">
        {/* ── Video ── */}
        <div className="relative aspect-video lg:aspect-auto lg:min-h-[18rem] bg-zinc-900 overflow-hidden">
          <iframe
            src={SPECTER_WALKTHROUGH_EMBED_URL}
            title="SPECTER product walkthrough"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
            loading="lazy"
          />
        </div>

        {/* ── Info panel ── */}
        <div className="relative flex flex-col justify-between gap-6 p-6 lg:w-64 border-t lg:border-t-0 lg:border-l border-zinc-800/60">

          {/* Background circuit pattern */}
          <svg
            className="pointer-events-none absolute inset-0 w-full h-full opacity-[0.06]"
            viewBox="0 0 256 320"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
          >
            <line x1="40" y1="0" x2="40" y2="320" stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="4 6" />
            <line x1="140" y1="0" x2="140" y2="320" stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="4 6" />
            <line x1="0" y1="80" x2="256" y2="80" stroke="#f59e0b" strokeWidth="0.6" />
            <line x1="0" y1="200" x2="256" y2="200" stroke="#f59e0b" strokeWidth="0.6" />
            <circle cx="40" cy="80" r="3" fill="#f59e0b" />
            <circle cx="140" cy="200" r="3" fill="#f59e0b" />
          </svg>

          <div className="relative">
            {/* Label */}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Watch first
            </span>

            <h3 className="text-xl font-black tracking-tight text-zinc-100 leading-snug mb-2">
              Zero to private<br />
              <span
                style={{
                  background: "linear-gradient(90deg, #f59e0b, #fcd34d)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                in 5 minutes.
              </span>
            </h3>

            <p className="text-xs text-zinc-500 leading-relaxed">
              No fluff. Just setup → send → scan. Built for people who don't want to leave a trace.
            </p>
          </div>

          {/* Step list */}
          <div className="relative flex flex-col gap-2">
            {STEPS.map((step, i) => (
              <div key={step.label} className="flex items-start gap-2.5">
                <div className="flex shrink-0 items-center justify-center w-6 h-6 rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20 text-amber-400 mt-0.5">
                  {step.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-xs font-semibold text-zinc-200">{step.label}</span>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-0.5 leading-tight">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <a
            href={SPECTER_WALKTHROUGH_VIDEO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="relative inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/20"
          >
            Open on YouTube
            <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
