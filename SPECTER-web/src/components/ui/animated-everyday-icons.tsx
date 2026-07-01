"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface IconProps {
  size?: number;
  className?: string;
}

/* ─── 1. COFFEE ─── cup with 3 steam wisps drifting up and fading */
export function CoffeeIcon({ size = 48, className }: IconProps) {
  const wisps = [
    { x: 18, delay: 0, drift: -3 },
    { x: 24, delay: 0.6, drift: 2 },
    { x: 30, delay: 1.2, drift: -2 },
  ];
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      {/* cup */}
      <rect x="10" y="22" width="24" height="16" rx="2" stroke="currentColor" strokeWidth={2} />
      <path d="M34 26h4a3 3 0 010 6h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <line x1="12" y1="42" x2="36" y2="42" stroke="currentColor" strokeWidth={2} strokeLinecap="round" opacity={0.3} />
      {/* liquid */}
      <rect x="12" y="28" width="20" height="8" rx="1" fill="currentColor" opacity={0.08} />
      {/* steam */}
      {wisps.map((w, i) => (
        <motion.g key={i}>
          <motion.circle cx={w.x} cy={18} r={1.5} fill="currentColor"
            animate={{
              y: [0, -14],
              x: [0, w.drift],
              opacity: [0.5, 0],
              scale: [0.8, 1.5],
            }}
            transition={{ duration: 2, repeat: Infinity, delay: w.delay, ease: "easeOut" }}
          />
          <motion.circle cx={w.x} cy={18} r={1} fill="currentColor"
            animate={{
              y: [2, -10],
              x: [0, w.drift * -0.5],
              opacity: [0.3, 0],
              scale: [0.6, 1.2],
            }}
            transition={{ duration: 1.8, repeat: Infinity, delay: w.delay + 0.3, ease: "easeOut" }}
          />
        </motion.g>
      ))}
    </svg>
  );
}

/* ─── 2. CANDLE ─── flickering flame with random intensity */
export function CandleIcon({ size = 48, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      {/* holder */}
      <rect x="18" y="38" width="12" height="4" rx="1" stroke="currentColor" strokeWidth={2} />
      {/* body */}
      <rect x="20" y="22" width="8" height="16" rx="1" stroke="currentColor" strokeWidth={2} />
      <rect x="22" y="24" width="4" height="12" rx="0.5" fill="currentColor" opacity={0.06} />
      {/* wick */}
      <line x1="24" y1="22" x2="24" y2="18" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      {/* flame outer */}
      <motion.ellipse cx="24" cy="14" rx="4" ry="6" fill="#FBBF24" opacity={0.15}
        animate={{
          ry: [6, 5, 7, 5.5, 6],
          rx: [4, 3.5, 4.5, 3, 4],
          opacity: [0.15, 0.1, 0.2, 0.12, 0.15],
        }}
        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* flame middle */}
      <motion.ellipse cx="24" cy="15" rx="2.5" ry="4" fill="#FBBF24" opacity={0.3}
        animate={{
          ry: [4, 3, 4.5, 3.5, 4],
          rx: [2.5, 2, 3, 2.2, 2.5],
          rotate: [0, 3, -2, 4, 0],
        }}
        transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "24px 18px" }}
      />
      {/* flame core */}
      <motion.ellipse cx="24" cy="16" rx="1.2" ry="2.5" fill="#FDE68A"
        animate={{
          ry: [2.5, 2, 3, 2.2, 2.5],
          opacity: [0.9, 0.6, 1, 0.7, 0.9],
        }}
        transition={{ duration: 0.5, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* glow */}
      <motion.circle cx="24" cy="14" r="8" fill="#FBBF24" opacity={0}
        animate={{ opacity: [0.03, 0.06, 0.03] }}
        transition={{ duration: 1.2, repeat: Infinity }}
      />
    </svg>
  );
}

/* ─── 3. HOURGLASS ─── flips and sand streams through */
export function HourglassIcon({ size = 48, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      {/* frame top & bottom bars */}
      <line x1="12" y1="8" x2="36" y2="8" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      <line x1="12" y1="40" x2="36" y2="40" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
      {/* glass body — two triangles meeting at center */}
      <path d="M15 8l9 16-9 16" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      <path d="M33 8l-9 16 9 16" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      {/* top sand — shrinks down */}
      <motion.polygon fill="currentColor" opacity={0.15}
        animate={{
          points: [
            "18,12 30,12 24,22",
            "22,18 26,18 24,22",
          ],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      />
      {/* bottom sand — grows up */}
      <motion.polygon fill="currentColor" opacity={0.15}
        animate={{
          points: [
            "23,36 25,36 24,35",
            "16,36 32,36 24,26",
          ],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      />
      {/* falling stream in center */}
      <motion.line x1="24" y1="22" x2="24" y2="26" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"
        animate={{ opacity: [0.5, 0.15, 0.5] }}
        transition={{ duration: 0.5, repeat: Infinity }}
      />
    </svg>
  );
}

/* ─── 4. COMPASS ─── needle wobbles then settles, repeats */
export function CompassIcon({ size = 48, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth={2} />
      <circle cx="24" cy="24" r="15" stroke="currentColor" strokeWidth={0.5} opacity={0.15} />
      {/* cardinal marks */}
      {[0, 90, 180, 270].map((deg) => (
        <line key={deg} x1="24" y1="8" x2="24" y2="11" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"
          opacity={0.3} style={{ transformOrigin: "24px 24px", transform: `rotate(${deg}deg)` }} />
      ))}
      {/* needle */}
      <motion.g
        animate={{ rotate: [30, -20, 12, -8, 3, 0, 0, 0, 30] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "24px 24px" }}>
        {/* north — red */}
        <polygon points="24,10 21.5,24 26.5,24" fill="#EF4444" opacity={0.7} />
        {/* south */}
        <polygon points="24,38 21.5,24 26.5,24" fill="currentColor" opacity={0.2} />
      </motion.g>
      <circle cx="24" cy="24" r="2" fill="currentColor" opacity={0.3} />
    </svg>
  );
}

/* ─── 5. PENCIL ─── draws a small squiggle then resets */
export function PencilIcon({ size = 48, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      {/* pencil drawn already at angle — tip bottom-left, eraser top-right */}
      <motion.g
        animate={{ x: [0, 3, 6, 10, 14, 10, 6, 3, 0], y: [0, 1, -1, 1, 0, -1, 1, 0, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
        {/* body */}
        <line x1="14" y1="34" x2="34" y2="14" stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
        {/* tip */}
        <line x1="11" y1="37" x2="14" y2="34" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        {/* eraser band */}
        <line x1="31" y1="17" x2="34" y2="14" stroke="currentColor" strokeWidth={5} strokeLinecap="round" opacity={0.4} />
      </motion.g>
      {/* drawn squiggle on paper */}
      <motion.path d="M8 42c3-1 5 1 8 0s4 1 7 0" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"
        opacity={0.2}
        animate={{ pathLength: [0, 1, 1, 0] }}
        transition={{ duration: 3, repeat: Infinity, times: [0, 0.6, 0.85, 1] }}
      />
    </svg>
  );
}

/* ─── 6. LIGHTBULB ─── flickers then glows steady with rays */
export function LightbulbIcon({ size = 48, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      {/* glow */}
      <motion.circle cx="24" cy="20" r="14" fill="#FBBF24" opacity={0}
        animate={{ opacity: [0, 0, 0.05, 0, 0.08, 0.06, 0.08, 0.08, 0] }}
        transition={{ duration: 4, repeat: Infinity }}
      />
      {/* bulb */}
      <path d="M18 22a8 8 0 1112 0c0 3-2 5-2 8H20c0-3-2-5-2-8z" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      {/* filament */}
      <motion.path d="M21 22c1-2 2 0 3-2s2 0 3-2" stroke="#FBBF24" strokeWidth={1.5} strokeLinecap="round"
        animate={{ opacity: [0, 0, 0.3, 0, 0.8, 0.6, 0.8, 0.8, 0] }}
        transition={{ duration: 4, repeat: Infinity }}
      />
      {/* base */}
      <line x1="20" y1="32" x2="28" y2="32" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <line x1="20" y1="35" x2="28" y2="35" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <line x1="22" y1="38" x2="26" y2="38" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      {/* rays — only visible when on */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <motion.line key={deg} x1="24" y1="4" x2="24" y2="7" stroke="#FBBF24" strokeWidth={1.5} strokeLinecap="round"
          style={{ transformOrigin: "24px 20px", rotate: deg }}
          animate={{ opacity: [0, 0, 0, 0, 0.5, 0.4, 0.5, 0.5, 0] }}
          transition={{ duration: 4, repeat: Infinity }}
        />
      ))}
    </svg>
  );
}

/* ─── 7. MUSIC ─── notes float up from a note symbol */
export function MusicIcon({ size = 48, className }: IconProps) {
  const notes = [
    { x: 20, delay: 0, drift: -6 },
    { x: 26, delay: 1, drift: 5 },
    { x: 22, delay: 2, drift: -3 },
  ];
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      {/* base note */}
      <circle cx="18" cy="32" r="4" stroke="currentColor" strokeWidth={2} />
      <line x1="22" y1="32" x2="22" y2="14" stroke="currentColor" strokeWidth={2} />
      <path d="M22 14c4-2 8-1 10 1" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      {/* floating notes */}
      {notes.map((n, i) => (
        <motion.g key={i}
          animate={{
            y: [0, -20],
            x: [0, n.drift],
            opacity: [0.6, 0],
            scale: [0.8, 1.1],
          }}
          transition={{ duration: 2.5, repeat: Infinity, delay: n.delay, ease: "easeOut" }}>
          <circle cx={n.x} cy={18} r={2} fill="currentColor" opacity={0.5} />
          <line x1={n.x + 2} y1={18} x2={n.x + 2} y2={12} stroke="currentColor" strokeWidth={1} opacity={0.5} />
        </motion.g>
      ))}
    </svg>
  );
}

/* ─── 8. MAGNET ─── particles pulled inward from both sides */
export function MagnetIcon({ size = 48, className }: IconProps) {
  const leftParticles = [
    { startX: 2, y: 30, delay: 0 },
    { startX: 0, y: 34, delay: 0.4 },
    { startX: 3, y: 38, delay: 0.8 },
  ];
  const rightParticles = [
    { startX: 46, y: 30, delay: 0.2 },
    { startX: 48, y: 34, delay: 0.6 },
    { startX: 45, y: 38, delay: 1.0 },
  ];
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      {/* magnet body */}
      <path d="M14 14v16a10 10 0 0020 0V14" stroke="currentColor" strokeWidth={2} />
      <rect x="12" y="8" width="8" height="8" rx="1" stroke="#EF4444" strokeWidth={2} />
      <rect x="28" y="8" width="8" height="8" rx="1" stroke="#3B82F6" strokeWidth={2} />
      <rect x="14" y="10" width="4" height="4" rx="0.5" fill="#EF4444" opacity={0.15} />
      <rect x="30" y="10" width="4" height="4" rx="0.5" fill="#3B82F6" opacity={0.15} />
      {/* left particles */}
      {leftParticles.map((p, i) => (
        <motion.circle key={`l${i}`} cy={p.y} r={1.2} fill="currentColor"
          animate={{ cx: [p.startX, 16], opacity: [0.6, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: p.delay, ease: "easeIn" }}
        />
      ))}
      {/* right particles */}
      {rightParticles.map((p, i) => (
        <motion.circle key={`r${i}`} cy={p.y} r={1.2} fill="currentColor"
          animate={{ cx: [p.startX, 32], opacity: [0.6, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: p.delay, ease: "easeIn" }}
        />
      ))}
    </svg>
  );
}

/* ─── 9. PLANT ─── grows from seed, leaves unfurl, resets */
export function PlantIcon({ size = 48, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      {/* pot */}
      <path d="M16 34h16l-2 8H18l-2-8z" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      <line x1="15" y1="34" x2="33" y2="34" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      {/* stem */}
      <motion.line x1="24" y1="34" x2="24" y2="16" stroke="#22C55E" strokeWidth={2} strokeLinecap="round"
        animate={{ y2: [34, 16, 16, 34] }}
        transition={{ duration: 5, repeat: Infinity, times: [0, 0.3, 0.8, 1], ease: "easeOut" }}
      />
      {/* left leaf */}
      <motion.path d="M24 26c-4-1-8-4-8-8 4 1 8 4 8 8z" fill="#22C55E" opacity={0.2}
        animate={{
          scale: [0, 1, 1, 0],
          opacity: [0, 0.2, 0.2, 0],
        }}
        transition={{ duration: 5, repeat: Infinity, times: [0.25, 0.45, 0.8, 1], ease: "easeOut" }}
        style={{ transformOrigin: "24px 26px" }}
      />
      <motion.path d="M24 26c-4-1-8-4-8-8 4 1 8 4 8 8z" stroke="#22C55E" strokeWidth={1.5}
        animate={{
          scale: [0, 1, 1, 0],
          opacity: [0, 0.6, 0.6, 0],
        }}
        transition={{ duration: 5, repeat: Infinity, times: [0.25, 0.45, 0.8, 1], ease: "easeOut" }}
        style={{ transformOrigin: "24px 26px" }}
      />
      {/* right leaf */}
      <motion.path d="M24 22c4-1 8-4 8-8-4 1-8 4-8 8z" fill="#22C55E" opacity={0.2}
        animate={{
          scale: [0, 1, 1, 0],
          opacity: [0, 0.2, 0.2, 0],
        }}
        transition={{ duration: 5, repeat: Infinity, times: [0.35, 0.55, 0.8, 1], ease: "easeOut" }}
        style={{ transformOrigin: "24px 22px" }}
      />
      <motion.path d="M24 22c4-1 8-4 8-8-4 1-8 4-8 8z" stroke="#22C55E" strokeWidth={1.5}
        animate={{
          scale: [0, 1, 1, 0],
          opacity: [0, 0.6, 0.6, 0],
        }}
        transition={{ duration: 5, repeat: Infinity, times: [0.35, 0.55, 0.8, 1], ease: "easeOut" }}
        style={{ transformOrigin: "24px 22px" }}
      />
      {/* top bud */}
      <motion.circle cx="24" cy="14" r="3" fill="#22C55E" opacity={0}
        animate={{
          scale: [0, 1, 1, 0],
          opacity: [0, 0.3, 0.3, 0],
        }}
        transition={{ duration: 5, repeat: Infinity, times: [0.4, 0.6, 0.8, 1], ease: "easeOut" }}
      />
    </svg>
  );
}

/* ─── 10. POTION ─── flask with bubbles rising inside */
export function PotionIcon({ size = 48, className }: IconProps) {
  const bubbles = [
    { cx: 20, delay: 0, size: 1.5 },
    { cx: 26, delay: 0.6, size: 2 },
    { cx: 23, delay: 1.2, size: 1.2 },
    { cx: 28, delay: 1.8, size: 1.8 },
    { cx: 19, delay: 0.9, size: 1 },
  ];
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      {/* neck */}
      <rect x="20" y="6" width="8" height="10" rx="1" stroke="currentColor" strokeWidth={2} />
      <line x1="18" y1="6" x2="30" y2="6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      {/* body */}
      <path d="M20 16l-6 10v10a4 4 0 004 4h12a4 4 0 004-4V26l-6-10" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      {/* liquid */}
      <path d="M14 28h20v8a4 4 0 01-4 4H18a4 4 0 01-4-4v-8z" fill="#8B5CF6" opacity={0.12} />
      {/* bubbles */}
      {bubbles.map((b, i) => (
        <motion.circle key={i} cx={b.cx} cy={36} r={b.size} fill="#8B5CF6" opacity={0.3}
          animate={{
            cy: [36, 26],
            opacity: [0.4, 0],
            scale: [1, 1.5],
          }}
          transition={{ duration: 1.5, repeat: Infinity, delay: b.delay, ease: "easeOut" }}
        />
      ))}
    </svg>
  );
}

/* ─── 11. METRONOME ─── arm swings back and forth with tick marks */
export function MetronomeIcon({ size = 48, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      {/* wider trapezoid body */}
      <path d="M10 42l6-28h16l6 28H10z" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      {/* face plate */}
      <rect x="18" y="18" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth={1} opacity={0.15} />
      {/* scale marks */}
      <line x1="21" y1="22" x2="21" y2="24" stroke="currentColor" strokeWidth={1} opacity={0.2} />
      <line x1="24" y1="22" x2="24" y2="24" stroke="currentColor" strokeWidth={1} opacity={0.2} />
      <line x1="27" y1="22" x2="27" y2="24" stroke="currentColor" strokeWidth={1} opacity={0.2} />
      {/* swinging arm — pivots from near the bottom of the face */}
      <motion.g
        animate={{ rotate: [-20, 20, -20] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "24px 32px" }}>
        <line x1="24" y1="32" x2="24" y2="10" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        <circle cx="24" cy="11" r="2.5" fill="currentColor" opacity={0.6} />
      </motion.g>
      {/* pivot dot */}
      <circle cx="24" cy="32" r="1.5" fill="currentColor" opacity={0.4} />
    </svg>
  );
}

/* ─── 12. TELESCOPE ─── searching the sky, lens flare twinkles */
export function TelescopeIcon({ size = 48, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      {/* tripod */}
      <line x1="24" y1="28" x2="16" y2="42" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <line x1="24" y1="28" x2="32" y2="42" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <line x1="24" y1="28" x2="24" y2="42" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" opacity={0.4} />
      {/* tube */}
      <motion.g
        animate={{ rotate: [-5, 5, -5] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "24px 28px" }}>
        <rect x="10" y="18" width="28" height="8" rx="4" stroke="currentColor" strokeWidth={2} />
        <circle cx="10" cy="22" r="5" stroke="currentColor" strokeWidth={2} />
        <circle cx="10" cy="22" r="3" fill="currentColor" opacity={0.06} />
        {/* lens flare */}
        <motion.circle cx="7" cy="19" r="1.5" fill="#38BDF8"
          animate={{ opacity: [0, 0.6, 0, 0.4, 0], scale: [0.5, 1.2, 0.5, 1, 0.5] }}
          transition={{ duration: 3, repeat: Infinity }}
        />
      </motion.g>
      {/* stars in sky */}
      {[
        { cx: 6, cy: 8, d: 0 }, { cx: 14, cy: 4, d: 0.8 },
        { cx: 36, cy: 6, d: 1.6 }, { cx: 42, cy: 12, d: 0.4 },
      ].map((s, i) => (
        <motion.circle key={i} cx={s.cx} cy={s.cy} r="0.8" fill="currentColor"
          animate={{ opacity: [0.15, 0.6, 0.15] }}
          transition={{ duration: 2, repeat: Infinity, delay: s.d }}
        />
      ))}
    </svg>
  );
}

/* ─── Demo Component ─── */

const ALL_ICONS = [
  { name: "Coffee", Icon: CoffeeIcon },
  { name: "Candle", Icon: CandleIcon },
  { name: "Hourglass", Icon: HourglassIcon },
  { name: "Compass", Icon: CompassIcon },
  { name: "Pencil", Icon: PencilIcon },
  { name: "Lightbulb", Icon: LightbulbIcon },
  { name: "Music", Icon: MusicIcon },
  { name: "Magnet", Icon: MagnetIcon },
  { name: "Plant", Icon: PlantIcon },
  { name: "Potion", Icon: PotionIcon },
  { name: "Metronome", Icon: MetronomeIcon },
  { name: "Telescope", Icon: TelescopeIcon },
];

export function Component() {
  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-16">
      <div className="text-center mb-14">
        <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">
          Animated Everyday Icons
        </h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          12 mundane objects brought to life — steam drifts, flames flicker, sand flows, needles wobble, plants grow. Each icon is a tiny living scene.
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-8 justify-items-center">
        {ALL_ICONS.map(({ name, Icon }) => (
          <div key={name} className="flex flex-col items-center gap-3">
            <div className="flex items-center justify-center size-20 rounded-2xl border border-border bg-card">
              <Icon size={48} />
            </div>
            <span className="text-[11px] font-medium text-muted-foreground tracking-wide text-center leading-tight">
              {name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
