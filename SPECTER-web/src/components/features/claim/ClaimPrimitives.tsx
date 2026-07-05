/**
 * Shared building blocks for the claim flow, so every step aligns to the same
 * grid and reads as one uniform surface instead of scattered rows.
 */
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/base/tooltip";

/** A label/value line: label left (muted), value right (emphasised). */
export function SummaryRow({
  label,
  value,
  emphasis = false,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-white/40 shrink-0">{label}</span>
      <span
        className={[
          "min-w-0 truncate text-right text-xs",
          mono ? "font-mono tabular-nums" : "",
          emphasis ? "text-foreground font-medium" : "text-white/75",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

/** Small info affordance — an (i) that reveals a short explanation on hover/tap. */
export function InfoDot({ children, label = "More info" }: { children: ReactNode; label?: string }) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-white/35 hover:text-white/70 transition-colors"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Wizard progress: named dots that fill as the user advances. */
export function StepDots({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${current + 1} of ${steps.length}`}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={s} className="flex items-center gap-1.5">
            <span
              className={[
                "h-1.5 rounded-full transition-all duration-300",
                active ? "w-5 bg-primary" : done ? "w-1.5 bg-primary/60" : "w-1.5 bg-white/15",
              ].join(" ")}
            />
          </div>
        );
      })}
    </div>
  );
}
