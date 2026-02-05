import { Download } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface DownloadJsonButtonProps {
  data: Record<string, unknown>;
  filename: string;
  label?: string;
  variant?: "outline" | "default" | "ghost" | "link" | "destructive" | "secondary" | "quantum";
  size?: "default" | "sm" | "lg" | "icon" | "xl";
  className?: string;
  tooltip?: string;
}

export function DownloadJsonButton({
  data,
  filename,
  label = "Download",
  variant = "outline",
  size = "default",
  className = "",
  tooltip = "Save as JSON file",
}: DownloadJsonButtonProps) {
  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Saved as ${a.download}`);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
            variant={variant}
            size={size}
            className={className}
            onClick={handleDownload}
            type="button"
          >
            <Download className="h-4 w-4 mr-2" />
            {label}
          </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-normal">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
