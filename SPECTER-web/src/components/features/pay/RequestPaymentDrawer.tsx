import { useMemo, useState } from "react";
import { Download, Save, Share2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/base/sheet";
import { Input } from "@/components/ui/base/input";
import { Label } from "@/components/ui/base/label";
import { Button } from "@/components/ui/base/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base/select";
import { CopyButton } from "@/components/ui/specialized/copy-button";
import { QrCode, downloadQrPng } from "@/components/ui/specialized/qr-code";
import { buildPayUrl, type PayLinkParams } from "@/lib/payLink";
import { addSavedRequest } from "@/lib/savedRequests";
import {
  getAvailableSendChains,
  getSendChainConfig,
  type TxChain,
} from "@/lib/blockchain/sendChains";
import { analytics, type AnalyticsChain } from "@/lib/analytics";
import { toast } from "sonner";

function toAnalyticsChain(chain: TxChain): AnalyticsChain {
  if (chain === "sui") return "sui";
  if (chain === "monad") return "monad";
  if (chain === "arbitrum") return "arbitrum";
  if (chain === "ethereum") return "ethereum";
  return "unknown";
}

export function RequestPaymentDrawer({
  open,
  onOpenChange,
  recipient,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  recipient: string;
}) {
  const chains = useMemo(() => getAvailableSendChains(true), []);
  const [amount, setAmount] = useState("");
  const [chain, setChain] = useState<TxChain>(chains[0]);
  const [label, setLabel] = useState("");
  const [memo, setMemo] = useState("");

  const symbol = getSendChainConfig(chain).currencySymbol;
  const params: PayLinkParams = useMemo(
    () => ({
      amount: amount || undefined,
      chain,
      label: label || undefined,
      memo: memo || undefined,
    }),
    [amount, chain, label, memo]
  );
  const url = buildPayUrl(recipient, params);

  function handleSave() {
    addSavedRequest({
      recipient,
      amount: amount || undefined,
      chain,
      label: label || undefined,
      memo: memo || undefined,
    });
    analytics.requestSaved();
    toast.success("Request saved");
  }

  async function handleCreateAndCopy() {
    try {
      await navigator.clipboard.writeText(url);
      analytics.requestCreated({ has_amount: Boolean(amount), chain: toAnalyticsChain(chain) });
      analytics.payLinkCopied("drawer");
      toast.success("Request link copied");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Request a payment</SheetTitle>
          <SheetDescription className="sr-only">
            Create a shareable payment request link and QR.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="req-amount">Amount ({symbol})</Label>
            <Input
              id="req-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Chain</Label>
            <Select value={chain} onValueChange={(v) => setChain(v as TxChain)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {chains.map((c) => (
                  <SelectItem key={c} value={c}>
                    {getSendChainConfig(c).label} ({getSendChainConfig(c).currencySymbol})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="req-label">Label (optional)</Label>
            <Input
              id="req-label"
              value={label}
              maxLength={80}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Invoice #204"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="req-memo">Note to payer (optional)</Label>
            <Input
              id="req-memo"
              value={memo}
              maxLength={140}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Design work, March"
            />
          </div>

          {/* Live shareable card */}
          <div
            className="rounded-xl border border-border bg-card p-5 flex flex-col items-center gap-3"
          >
            <p className="text-xs text-muted-foreground">Pay request</p>
            <p className="text-lg font-semibold">
              {amount ? `${amount} ${symbol}` : "Any amount"}{" "}
              <span className="text-muted-foreground font-normal">to {recipient}</span>
            </p>
            {label && <p className="text-sm">{label}</p>}
            <QrCode value={url} size={160} />
            <p className="font-mono text-[10px] text-muted-foreground break-all text-center">
              {url}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleCreateAndCopy} className="flex-1 min-w-[8rem]">
              Copy request link
            </Button>
            <CopyButton
              text={url}
              onCopied={() => analytics.payLinkCopied("drawer")}
              showLabel={false}
            />
            <Button
              variant="outline"
              onClick={() => {
                analytics.payLinkQrDownloaded("drawer");
                downloadQrPng(url, `specter-request-${recipient}`);
              }}
            >
              <Download className="h-4 w-4 mr-1.5" /> QR
            </Button>
            <Button variant="outline" onClick={handleSave}>
              <Save className="h-4 w-4 mr-1.5" /> Save
            </Button>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <Button
                variant="ghost"
                onClick={() => {
                  analytics.payLinkShared("drawer");
                  navigator.share?.({ title: "Pay request", url });
                }}
              >
                <Share2 className="h-4 w-4 mr-1.5" /> Share
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
