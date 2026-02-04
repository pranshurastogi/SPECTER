import { motion } from "framer-motion";
import { Copy, ExternalLink, Check, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useState } from "react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface InfoItem {
    label: string;
    value: string | null | undefined;
    icon?: string;
    copyable?: boolean;
    link?: string;
    truncate?: boolean;
}

interface EnsInfoCardProps {
    title: string;
    icon: React.ReactNode;
    items: InfoItem[];
    loading?: boolean;
    error?: string | null;
    tooltip?: string;
    expandable?: boolean;
}

export function EnsInfoCard({
    title,
    icon,
    items,
    loading = false,
    error = null,
    tooltip,
    expandable = false,
}: EnsInfoCardProps) {
    const [expanded, setExpanded] = useState(!expandable);
    const [copiedItem, setCopiedItem] = useState<string | null>(null);

    const handleCopy = (value: string, label: string) => {
        navigator.clipboard.writeText(value);
        setCopiedItem(label);
        toast.success(`${label} copied to clipboard`);
        setTimeout(() => setCopiedItem(null), 2000);
    };

    const visibleItems = items.filter(item => item.value);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <Card className="glass-card overflow-hidden">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                {icon}
                            </div>
                            <div>
                                <CardTitle className="text-lg font-display">{title}</CardTitle>
                                {tooltip && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <p className="text-xs text-muted-foreground mt-0.5 cursor-help">
                                                    {tooltip}
                                                </p>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom" className="max-w-xs">
                                                <p className="text-sm">{tooltip}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>
                        </div>
                        {expandable && visibleItems.length > 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setExpanded(!expanded)}
                            >
                                {expanded ? "Collapse" : "Expand"}
                            </Button>
                        )}
                    </div>
                </CardHeader>

                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                            <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
                        </div>
                    ) : error ? (
                        <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                            <p className="text-sm text-destructive">{error}</p>
                        </div>
                    ) : visibleItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                            No data available
                        </p>
                    ) : (
                        <div className={`space-y-3 ${!expanded && 'hidden'}`}>
                            {visibleItems.map((item, index) => (
                                <motion.div
                                    key={item.label}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                    className="flex items-start justify-between gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            {item.icon && <span className="text-sm">{item.icon}</span>}
                                            <span className="text-xs font-medium text-muted-foreground">
                                                {item.label}
                                            </span>
                                        </div>
                                        <div className="text-sm font-mono break-all">
                                            {item.truncate && item.value && item.value.length > 42 ? (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span className="cursor-help">
                                                                {item.value.slice(0, 10)}...{item.value.slice(-8)}
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" className="max-w-md">
                                                            <p className="text-xs font-mono break-all">{item.value}</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            ) : (
                                                <span>{item.value}</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                        {item.link && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 w-8 p-0"
                                                asChild
                                            >
                                                <a
                                                    href={item.link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="Open in new tab"
                                                >
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                </a>
                                            </Button>
                                        )}
                                        {item.copyable && item.value && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 w-8 p-0"
                                                onClick={() => handleCopy(item.value!, item.label)}
                                                title="Copy to clipboard"
                                            >
                                                {copiedItem === item.label ? (
                                                    <Check className="h-3.5 w-3.5 text-success" />
                                                ) : (
                                                    <Copy className="h-3.5 w-3.5" />
                                                )}
                                            </Button>
                                        )}
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </motion.div>
    );
}
