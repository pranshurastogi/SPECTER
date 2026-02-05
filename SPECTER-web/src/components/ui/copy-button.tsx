import { useState } from "react";
import { motion } from "framer-motion";
import { Copy, Check } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CopyButtonProps {
  text: string;
  label?: string;
  successMessage?: string;
  variant?: "ghost" | "outline" | "link" | "default" | "destructive" | "secondary" | "quantum";
  size?: "default" | "sm" | "lg" | "icon" | "xl";
  className?: string;
  showLabel?: boolean;
  /** Optional: custom tooltip when not copied */
  tooltip?: string;
  /** Optional: tooltip when copied */
  tooltipCopied?: string;
}

export function CopyButton({
  text,
  label = "Copy",
  successMessage = "Copied to clipboard",
  variant = "ghost",
  size = "sm",
  className = "",
  showLabel = true,
  tooltip = "Copy to clipboard",
  tooltipCopied = "Copied!",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(successMessage);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={variant}
            size={size}
            className={className}
            onClick={handleCopy}
            type="button"
          >
            <motion.span
              key={copied ? "check" : "copy"}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-2"
            >
              {copied ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {showLabel && (copied ? "Copied" : label)}
            </motion.span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="font-normal">
          {copied ? tooltipCopied : tooltip}
        </TooltipContent>
      </Tooltip>
  );
}
