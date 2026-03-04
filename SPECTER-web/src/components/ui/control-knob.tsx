"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  useSpring,
  useMotionValueEvent,
  type MotionValue,
} from "framer-motion";
import { cn } from "@/lib/utils";

interface ReactorKnobProps {
  className?: string;
  initialValue?: number;
  onValueChange?: (value: number) => void;
}

export default function ReactorKnob({
  className,
  initialValue = 37,
  onValueChange,
}: ReactorKnobProps) {
  const MIN_DEG = -135;
  const MAX_DEG = 135;
  const TOTAL_TICKS = 40;
  const DEGREES_PER_TICK = (MAX_DEG - MIN_DEG) / TOTAL_TICKS;

  const normalizedInitial = Math.max(0, Math.min(100, initialValue));
  const initialDeg = MIN_DEG + ((MAX_DEG - MIN_DEG) * normalizedInitial) / 100;

  const [isDragging, setIsDragging] = useState(false);

  const rawRotation = useMotionValue(initialDeg);
  const snappedRotation = useMotionValue(initialDeg);

  const smoothRotation = useSpring(snappedRotation, {
    stiffness: 400,
    damping: 35,
    mass: 0.8,
  });

  const displayValue = useTransform(smoothRotation, [MIN_DEG, MAX_DEG], [0, 100]);
  const lightOpacity = useTransform(rawRotation, [MIN_DEG, MAX_DEG], [0.08, 0.45]);

  const knobRef = useRef<HTMLDivElement>(null);

  useMotionValueEvent(displayValue, "change", (latest) => {
    onValueChange?.(Math.round(latest));
  });

  useEffect(() => {
    const clamped = Math.max(0, Math.min(100, initialValue));
    const deg = MIN_DEG + ((MAX_DEG - MIN_DEG) * clamped) / 100;
    rawRotation.set(deg);
    snappedRotation.set(deg);
  }, [initialValue, rawRotation, snappedRotation, MIN_DEG, MAX_DEG]);

  const handlePointerDown = useCallback(() => {
    setIsDragging(true);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (!knobRef.current) return;

      const rect = knobRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const x = e.clientX - centerX;
      const y = e.clientY - centerY;

      let rads = Math.atan2(y, x);
      let degs = rads * (180 / Math.PI) + 90;

      if (degs > 180) degs -= 360;

      if (degs < MIN_DEG && degs > -180) degs = MIN_DEG;
      if (degs > MAX_DEG) degs = MAX_DEG;

      rawRotation.set(degs);

      const snap = Math.round(degs / DEGREES_PER_TICK) * DEGREES_PER_TICK;
      snappedRotation.set(snap);
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [
    isDragging,
    rawRotation,
    snappedRotation,
    DEGREES_PER_TICK,
    MAX_DEG,
    MIN_DEG,
  ]);

  const ticks = Array.from({ length: TOTAL_TICKS + 1 });

  return (
    <div
      className={cn(
        "relative w-full rounded-2xl border border-zinc-800 bg-neutral-950/90 px-4 pt-4 pb-3 overflow-hidden",
        className
      )}
    >
      <div
        className="absolute inset-0 opacity-25 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(#333 1px, transparent 1px), linear-gradient(90deg, #333 1px, transparent 1px)",
          backgroundSize: "36px 36px",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_10%,rgba(0,0,0,0.8)_100%)] pointer-events-none" />

      <div className="relative z-10 mx-auto w-52 h-[15.5rem] sm:w-56 sm:h-[16.5rem] select-none">
        <motion.div
          className="absolute inset-0 bg-orange-500 rounded-full blur-3xl"
          style={{ opacity: lightOpacity }}
        />

        <div className="absolute inset-0 pointer-events-none">
          {ticks.map((_, i) => {
            const angle = (i / TOTAL_TICKS) * (MAX_DEG - MIN_DEG) + MIN_DEG;
            return (
              <div
                key={i}
                className="absolute top-0 left-1/2 w-1 h-full -translate-x-1/2"
                style={{ transform: `rotate(${angle}deg)` }}
              >
                <TickMark currentRotation={smoothRotation} angle={angle} />
              </div>
            );
          })}
        </div>

        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-36 h-36">
          <motion.div
            ref={knobRef}
            className={cn(
              "relative w-full h-full rounded-full touch-none z-20",
              isDragging ? "cursor-grabbing" : "cursor-grab"
            )}
            style={{ rotate: smoothRotation }}
            onPointerDown={handlePointerDown}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="w-full h-full rounded-full bg-neutral-900 shadow-[0_10px_30px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.1)] border border-neutral-800 flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.1),transparent_50%),conic-gradient(from_0deg,transparent_0deg,#000_360deg)]" />

              <div className="relative w-20 h-20 rounded-full bg-neutral-950 shadow-[inset_0_2px_5px_rgba(0,0,0,1)] border border-neutral-800/50 flex items-center justify-center">
                <motion.div
                  className="absolute top-2.5 w-1.5 h-5 bg-orange-500 rounded-full"
                  style={{
                    boxShadow: useTransform(
                      rawRotation,
                      (r) => `0 0 ${Math.max(5, (r + 135) / 10)}px orange`
                    ),
                  }}
                />
                <span className="mt-4 font-mono text-[10px] text-neutral-500 tracking-[0.2em]">
                  LEVEL
                </span>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none">
          <span className="text-[10px] text-neutral-600 font-mono tracking-[0.2em] mb-1">OUTPUT</span>
          <DisplayValue value={displayValue} />
        </div>
      </div>
    </div>
  );
}

function TickMark({
  currentRotation,
  angle,
}: {
  currentRotation: MotionValue<number>;
  angle: number;
}) {
  const opacity = useTransform(currentRotation, (r) => (r >= angle ? 1 : 0.2));
  const color = useTransform(currentRotation, (r) => (r >= angle ? "#f97316" : "#404040"));
  const boxShadow = useTransform(currentRotation, (r) =>
    r >= angle ? "0 0 8px rgba(249, 115, 22, 0.6)" : "none"
  );

  return (
    <motion.div
      style={{ backgroundColor: color, opacity, boxShadow }}
      className="w-1 h-2.5 rounded-full"
    />
  );
}

function DisplayValue({ value }: { value: MotionValue<number> }) {
  const [display, setDisplay] = useState(37);
  useMotionValueEvent(value, "change", (latest) => setDisplay(Math.round(latest)));

  const formatted = display.toString().padStart(3, "0");

  return (
    <div className="relative">
      <span className="absolute inset-0 blur-sm text-orange-500/50 font-mono text-3xl font-black tabular-nums tracking-widest">
        {formatted}
      </span>
      <span className="relative font-mono text-3xl text-orange-500 font-black tabular-nums tracking-widest">
        {formatted}
        <span className="text-sm text-neutral-600 ml-1">%</span>
      </span>
    </div>
  );
}
