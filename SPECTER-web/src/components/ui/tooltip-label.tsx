import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface TooltipLabelProps {
  label: string;
  tooltip: string;
  className?: string;
}

export function TooltipLabel({ label, tooltip, className = "" }: TooltipLabelProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
            className={`inline-flex items-center gap-1.5 cursor-help ${className}`}
            tabIndex={0}
          >
            <span>{label}</span>
            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs font-normal text-center">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
