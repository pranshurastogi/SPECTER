/**
 * ScanRadar — decorative radar-sweep animation shown while a stealth-payment
 * scan is running. Pure presentation: concentric rings, a rotating conic
 * sweep, an expanding pulse, and a few "blip" dots that fade in and out as
 * if announcements were being picked up.
 */

import { motion } from "framer-motion";

interface Blip {
  left: string;
  top: string;
  delay: number;
}

const BLIPS: Blip[] = [
  { left: "68%", top: "26%", delay: 0.2 },
  { left: "30%", top: "38%", delay: 0.9 },
  { left: "58%", top: "66%", delay: 1.5 },
  { left: "38%", top: "72%", delay: 2.1 },
];

export function ScanRadar({ caption }: { caption?: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 py-1" aria-hidden="true">
      <div className="relative h-28 w-28">
        {/* concentric rings */}
        {[100, 70, 40].map((pct) => (
          <div
            key={pct}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/[0.14]"
            style={{ width: `${pct}%`, height: `${pct}%` }}
          />
        ))}

        {/* crosshair */}
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-primary/[0.08]" />
        <div className="absolute top-1/2 left-0 w-full h-px -translate-y-1/2 bg-primary/[0.08]" />

        {/* rotating sweep */}
        <motion.div
          className="absolute inset-0 rounded-full overflow-hidden"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, ease: "linear", duration: 2.6 }}
          style={{
            background:
              "conic-gradient(from 0deg, rgba(139,92,246,0.4), rgba(139,92,246,0.12) 16%, transparent 32%)",
          }}
        />

        {/* expanding pulse */}
        <motion.div
          className="absolute left-1/2 top-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/40"
          initial={{ scale: 0.18, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 0 }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeOut" }}
        />

        {/* blips */}
        {BLIPS.map((b) => (
          <motion.span
            key={`${b.left}-${b.top}`}
            className="absolute h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]"
            style={{ left: b.left, top: b.top }}
            animate={{ opacity: [0, 1, 0], scale: [0.4, 1, 0.4] }}
            transition={{ repeat: Infinity, duration: 2.6, delay: b.delay, ease: "easeInOut" }}
          />
        ))}

        {/* center dot */}
        <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_10px_rgba(139,92,246,0.9)]" />
      </div>

      {caption && (
        <p className="font-mono text-[11px] text-white/40 tabular-nums">{caption}</p>
      )}
    </div>
  );
}
