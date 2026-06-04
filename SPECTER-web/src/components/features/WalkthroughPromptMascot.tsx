import { motion } from "framer-motion";

/**
 * Specter ghost mascot — pure SVG caricature.
 * Rounded ghost body, 4 tentacle wisps, glowing amber eyes,
 * quantum circuit etchings, hood shadow.
 */
export function WalkthroughPromptMascot({ className = "" }: { className?: string }) {
  return (
    <motion.div
      className={`relative select-none pointer-events-none ${className}`}
      animate={{ y: [0, -4, 0] }}
      transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
      aria-hidden
    >
      {/* Ambient amber halo */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-16 w-12 rounded-full opacity-35 blur-2xl"
        style={{ background: "radial-gradient(circle, #f59e0b 0%, transparent 70%)" }}
      />

      <svg
        viewBox="0 0 64 80"
        className="relative w-14 h-[4.375rem] drop-shadow-[0_6px_20px_rgba(245,158,11,0.4)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Body gradient — dark zinc top to near-black bottom */}
          <linearGradient id="m-body" x1="32" y1="2" x2="32" y2="62" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3f3f46" />
            <stop offset="0.45" stopColor="#1c1c1f" />
            <stop offset="1" stopColor="#09090b" />
          </linearGradient>
          {/* Hood shadow sweep */}
          <linearGradient id="m-hood" x1="10" y1="2" x2="54" y2="28" gradientUnits="userSpaceOnUse">
            <stop stopColor="#09090b" stopOpacity="0.7" />
            <stop offset="1" stopColor="#09090b" stopOpacity="0" />
          </linearGradient>
          {/* Specular highlight */}
          <linearGradient id="m-sheen" x1="18" y1="4" x2="44" y2="36" gradientUnits="userSpaceOnUse">
            <stop stopColor="#a1a1aa" stopOpacity="0.18" />
            <stop offset="1" stopColor="#a1a1aa" stopOpacity="0" />
          </linearGradient>
          {/* Eye glow filter */}
          <filter id="m-eye-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Tentacle gradient */}
          <linearGradient id="m-wisp" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
            <stop stopColor="#27272a" />
            <stop offset="1" stopColor="#09090b" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {/* ── Tentacle wisps (drawn first, behind body) ── */}
        {/* Far-left wisp */}
        <path d="M14 54 Q6 60 8 70 Q10 78 6 80 Q4 74 10 68 Q8 60 16 56 Z"
          fill="#27272a" opacity="0.85" />
        {/* Left-center wisp */}
        <path d="M24 56 Q18 64 22 73 Q24 80 20 80 Q18 74 22 70 Q20 62 26 58 Z"
          fill="#303034" opacity="0.9" />
        {/* Right-center wisp */}
        <path d="M40 56 Q46 64 42 73 Q40 80 44 80 Q46 74 42 70 Q44 62 38 58 Z"
          fill="#303034" opacity="0.9" />
        {/* Far-right wisp */}
        <path d="M50 54 Q58 60 56 70 Q54 78 58 80 Q60 74 54 68 Q56 60 48 56 Z"
          fill="#27272a" opacity="0.85" />

        {/* ── Main body ── */}
        {/* Outer edge subtle amber glow */}
        <path
          d="M32 4 C45 4 56 14 57 28 C58 42 54 52 32 58 C10 52 6 42 7 28 C8 14 19 4 32 4 Z"
          fill="#f59e0b"
          opacity="0.08"
          transform="scale(1.07) translate(-2 -1)"
        />
        {/* Body fill */}
        <path
          d="M32 4 C45 4 56 14 57 28 C58 42 54 52 32 58 C10 52 6 42 7 28 C8 14 19 4 32 4 Z"
          fill="url(#m-body)"
          stroke="#3f3f46"
          strokeWidth="0.8"
        />
        {/* Specular sheen (top-left highlight) */}
        <path
          d="M32 4 C45 4 56 14 57 28 C58 42 54 52 32 58 C10 52 6 42 7 28 C8 14 19 4 32 4 Z"
          fill="url(#m-sheen)"
        />
        {/* Hood shadow over upper body */}
        <ellipse cx="28" cy="16" rx="20" ry="14" fill="url(#m-hood)" />

        {/* ── Quantum circuit etchings ── */}
        <g stroke="#f59e0b" strokeOpacity="0.22" strokeWidth="0.7" strokeLinecap="round">
          <line x1="22" y1="34" x2="28" y2="34" />
          <line x1="28" y1="34" x2="28" y2="40" />
          <line x1="28" y1="40" x2="34" y2="40" />
          <circle cx="22" cy="34" r="1" fill="#f59e0b" fillOpacity="0.3" />
          <circle cx="34" cy="40" r="1" fill="#f59e0b" fillOpacity="0.3" />
          {/* Second trace */}
          <line x1="36" y1="30" x2="42" y2="30" />
          <line x1="42" y1="30" x2="42" y2="36" />
          <circle cx="36" cy="30" r="1" fill="#f59e0b" fillOpacity="0.25" />
          <circle cx="42" cy="36" r="1" fill="#f59e0b" fillOpacity="0.25" />
        </g>

        {/* ── Face void ── */}
        <ellipse cx="32" cy="26" rx="17" ry="13" fill="#09090b" opacity="0.92" />

        {/* ── Eyes ── */}
        {/* Left eye: outer glow ring */}
        <circle cx="24" cy="26" r="5.5" fill="#f59e0b" opacity="0.18" filter="url(#m-eye-glow)" />
        {/* Left eye: main iris */}
        <circle cx="24" cy="26" r="4" fill="#f59e0b" filter="url(#m-eye-glow)" />
        {/* Left eye: slit pupil */}
        <ellipse cx="24" cy="26" rx="1.2" ry="2.8" fill="#09090b" opacity="0.85" />
        {/* Left eye: highlight spark */}
        <circle cx="25.4" cy="24.4" r="1.1" fill="#fef9c3" opacity="0.9" />

        {/* Right eye: outer glow ring */}
        <circle cx="40" cy="26" r="5.5" fill="#f59e0b" opacity="0.18" filter="url(#m-eye-glow)" />
        {/* Right eye: main iris */}
        <circle cx="40" cy="26" r="4" fill="#f59e0b" filter="url(#m-eye-glow)" />
        {/* Right eye: slit pupil */}
        <ellipse cx="40" cy="26" rx="1.2" ry="2.8" fill="#09090b" opacity="0.85" />
        {/* Right eye: highlight spark */}
        <circle cx="41.4" cy="24.4" r="1.1" fill="#fef9c3" opacity="0.9" />

        {/* ── Smirk ── */}
        <path
          d="M27 33 Q32 37 37 33"
          stroke="#f59e0b"
          strokeOpacity="0.55"
          strokeWidth="1"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </motion.div>
  );
}
