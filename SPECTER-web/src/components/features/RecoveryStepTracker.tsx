import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** One step in the trustless-recovery flow. */
export interface RecoveryStep {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Horizontal step tracker for `/i-dont-trust-specter` — steps before
 * `activeIndex` render as done (check), the step at `activeIndex` as active,
 * the rest as pending. Mirrors the done/active/pending color language of
 * `StageFlowLoader` (emerald / primary / dim) so the two feel like one system.
 */
export function RecoveryStepTracker({
  steps,
  activeIndex,
}: {
  steps: RecoveryStep[];
  activeIndex: number;
}) {
  return (
    <ol className="flex items-start mb-8" aria-label="Recovery steps">
      {steps.map((step, i) => {
        const status = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
        const Icon = step.icon;
        return (
          <li key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border transition-colors duration-300",
                  status === "done" && "bg-emerald-500/15 border-emerald-500/40 text-emerald-400",
                  status === "active" &&
                    "bg-primary/15 border-primary/50 text-primary shadow-[0_0_12px_rgba(139,92,246,0.35)]",
                  status === "pending" && "bg-black/20 border-white/[0.08] text-white/25",
                )}
              >
                {status === "done" ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium text-center whitespace-nowrap",
                  status === "pending" ? "text-white/30" : "text-white/70",
                )}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1 mx-2 mt-4 transition-colors duration-500",
                  i < activeIndex ? "bg-emerald-500/40" : "bg-white/[0.08]",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
