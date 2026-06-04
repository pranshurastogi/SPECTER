/**
 * Network prompt card for guiding users to switch networks.
 * Themed, minimal, and actionable.
 */

import { AlertCircle, ArrowRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/base/button";

interface NetworkPromptProps {
  title: string;
  description: string;
  networkName: string;
  networkIcon?: string | null;
  onSwitchNetwork?: () => void;
  canAutoSwitch?: boolean;
}

export function NetworkPrompt({
  title,
  description,
  networkName,
  networkIcon = null,
  onSwitchNetwork,
  canAutoSwitch = true,
}: NetworkPromptProps) {
  return (
    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background overflow-hidden">
      <div className="px-4 py-3 border-b border-primary/10 bg-primary/5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
            <Zap className="h-3 w-3 text-primary" />
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            {title}
          </span>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-sm text-foreground/80 leading-relaxed">
          {description}
        </p>
        
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border">
          {networkIcon && (
            <img src={networkIcon} alt={networkName} className="w-5 h-5 rounded-full" />
          )}
          <span className="text-sm font-medium text-foreground">{networkName}</span>
        </div>

        {canAutoSwitch && onSwitchNetwork ? (
          <Button
            onClick={onSwitchNetwork}
            variant="default"
            size="sm"
            className="w-full group"
          >
            <span>Switch Network</span>
            <ArrowRight className="ml-2 h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
          </Button>
        ) : (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Please switch to <span className="font-medium">{networkName}</span> in your wallet to continue.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface ErrorCardProps {
  title?: string;
  message: string;
  variant?: "error" | "warning" | "info";
}

export function ErrorCard({ title = "Error", message, variant = "error" }: ErrorCardProps) {
  const styles = {
    error: {
      border: "border-red-500/20",
      bg: "bg-red-500/5",
      headerBg: "bg-red-500/10",
      iconBg: "bg-red-500/10 border-red-500/20",
      iconColor: "text-red-500",
      titleColor: "text-red-500",
      textColor: "text-red-600 dark:text-red-400",
    },
    warning: {
      border: "border-amber-500/20",
      bg: "bg-amber-500/5",
      headerBg: "bg-amber-500/10",
      iconBg: "bg-amber-500/10 border-amber-500/20",
      iconColor: "text-amber-500",
      titleColor: "text-amber-600 dark:text-amber-400",
      textColor: "text-amber-700 dark:text-amber-300",
    },
    info: {
      border: "border-blue-500/20",
      bg: "bg-blue-500/5",
      headerBg: "bg-blue-500/10",
      iconBg: "bg-blue-500/10 border-blue-500/20",
      iconColor: "text-blue-500",
      titleColor: "text-blue-600 dark:text-blue-400",
      textColor: "text-blue-700 dark:text-blue-300",
    },
  };

  const style = styles[variant];

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} overflow-hidden`}>
      <div className={`px-4 py-2.5 border-b ${style.border} ${style.headerBg}`}>
        <div className="flex items-center gap-2">
          <span className={`flex h-5 w-5 items-center justify-center rounded-md ${style.iconBg}`}>
            <AlertCircle className={`h-3 w-3 ${style.iconColor}`} />
          </span>
          <span className={`text-xs font-semibold uppercase tracking-wider ${style.titleColor}`}>
            {title}
          </span>
        </div>
      </div>
      <div className="px-4 py-3">
        <p className={`text-sm leading-relaxed ${style.textColor}`}>{message}</p>
      </div>
    </div>
  );
}
