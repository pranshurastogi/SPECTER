import React from "react";
import { cn } from "@/lib/utils";

// --- Reusable UI Element Components ---

export const DataReadout = ({ value, className }: { value: string | number; className?: string }) => (
  <div
    className={cn(
      "font-display text-yellow-400 text-3xl sm:text-4xl tracking-tight",
      "drop-shadow-[0_0_8px_rgba(234,179,8,0.4)]",
      className
    )}
  >
    {value}
  </div>
);

export const HoloButton = ({ text, className }: { text: string; className?: string }) => (
  <span
    className={cn(
      "inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-semibold",
      "border border-yellow-400/50 bg-yellow-400/10 text-yellow-300",
      "shadow-lg shadow-yellow-500/10 backdrop-blur-sm",
      "holo-button",
      className
    )}
  >
    {text}
  </span>
);

export const ProgressBar = ({ progress, className }: { progress: number; className?: string }) => (
  <div className={cn("progress-bar w-full h-2 rounded-full bg-muted overflow-hidden", className)}>
    <div
      className="progress-bar-inner h-full rounded-full bg-yellow-500 transition-all duration-500"
      style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
    />
  </div>
);

export const DataViz = ({ bars = 5, className }: { bars?: number; className?: string }) => (
  <div className={cn("flex gap-1 items-end h-12", className)}>
    {Array.from({ length: bars }).map((_, i) => (
      <div
        key={i}
        className="data-viz-bar w-2 rounded-t bg-yellow-500/70 min-h-[5px]"
        style={{ animationDelay: `${i * 0.2}s` }}
      />
    ))}
  </div>
);

export const GlowingOrb = ({
  color,
  className,
}: {
  color?: string;
  className?: string;
}) => (
  <div
    className={cn("glowing-orb w-4 h-4 rounded-full flex-shrink-0", className)}
    style={
      {
        "--orb-color": color || "rgb(234, 179, 8)",
        "--orb-glow": color || "rgba(234, 179, 8, 0.5)",
      } as React.CSSProperties
    }
  />
);

// --- Card type info for the feed ---

export interface HoloCardTypeInfo {
  id: string;
  component: React.ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
}

export const HoloCard = ({ typeInfo }: { typeInfo: HoloCardTypeInfo }) => {
  const Component = typeInfo.component;
  return (
    <article className="holo-card flex-shrink-0 w-[280px] sm:w-[320px]">
      <div className="card-content h-full rounded-2xl border border-yellow-500/20 bg-card/80 backdrop-blur-sm p-4 shadow-lg">
        <div className="card-preview-content flex items-center justify-center min-h-[100px]">
          <Component {...typeInfo.props} />
        </div>
      </div>
    </article>
  );
};

export const ScrollingRow = ({
  cards,
  duration,
  direction = "left",
  className,
}: {
  cards: HoloCardTypeInfo[];
  duration: string;
  direction?: "left" | "right";
  className?: string;
}) => {
  const rowContent = [...cards, ...cards];

  return (
    <div className={cn("grid-container overflow-hidden w-full", className)}>
      <div
        className="scrolling-grid flex gap-6 w-max py-4"
        style={
          {
            "--scroll-duration": duration,
            animation: `${direction === "left" ? "scroll-left" : "scroll-right"} ${duration} linear infinite`,
          } as React.CSSProperties
        }
      >
        {rowContent.map((card, index) => (
          <HoloCard key={`${card.id}-${index}`} typeInfo={card} />
        ))}
      </div>
    </div>
  );
};

export const Starfield = ({ className }: { className?: string }) => (
  <div className={cn("starfield pointer-events-none fixed inset-0 z-0", className)} />
);
