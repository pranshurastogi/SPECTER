import { useEffect, useMemo, useState } from "react";
import { Link2, QrCode as QrIcon, Share2, Download, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/base/card";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import { Badge } from "@/components/ui/base/badge";
import { CopyButton } from "@/components/ui/specialized/copy-button";
import { QrCode, downloadQrPng } from "@/components/ui/specialized/qr-code";
import { RequestPaymentDrawer } from "./RequestPaymentDrawer";
import { getRegisteredName } from "@/lib/setupProgress";
import { buildPayUrl, isValidRecipientName } from "@/lib/payLink";
import { analytics } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function PayLinkCard({ source, className }: { source: "scan" | "setup"; className?: string }) {
  const [name, setName] = useState<string>(() => getRegisteredName() ?? "");
  const [showQr, setShowQr] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const valid = isValidRecipientName(name);
  const url = useMemo(() => (valid ? buildPayUrl(name) : ""), [valid, name]);

  useEffect(() => {
    analytics.payLinkCardViewed(source);
  }, [source]);

  async function handleShare() {
    analytics.payLinkShared("card");
    if (navigator.share) {
      try {
        await navigator.share({ title: "Pay me on SPECTER", url });
        return;
      } catch {
        /* user cancelled or share rejected — fall through to clipboard copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      /* clipboard unavailable — fail silently */
    }
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Your pay link</h3>
          <Badge variant="secondary" className="ml-auto text-[10px]">private by default</Badge>
        </div>

        {!getRegisteredName() && (
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Enter your registered name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.trim())}
              placeholder="alice.eth or bob.sui"
              className="font-mono text-sm"
            />
          </div>
        )}

        {valid ? (
          <>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate font-mono text-xs">{url}</span>
              <CopyButton
                text={url}
                onCopied={() => analytics.payLinkCopied("card")}
                showLabel={false}
                className="ml-auto"
              />
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Share anywhere. Every payer gets a fresh, unlinkable stealth address — your link never
              exposes a reusable address.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowQr((s) => !s)}>
                <QrIcon className="h-4 w-4 mr-1.5" /> {showQr ? "Hide QR" : "Show QR"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-1.5" /> Share
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  analytics.requestBuilderOpened();
                  setDrawerOpen(true);
                }}
              >
                Request an amount
              </Button>
            </div>

            {showQr && (
              <div className="flex flex-col items-center gap-3 pt-1">
                <QrCode value={url} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    analytics.payLinkQrDownloaded("card");
                    downloadQrPng(url, `specter-${name}`);
                  }}
                >
                  <Download className="h-4 w-4 mr-1.5" /> Download QR
                </Button>
              </div>
            )}

            <RequestPaymentDrawer
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
              recipient={name}
            />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Register an ENS or SuiNS name in Setup to get your shareable pay link.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
