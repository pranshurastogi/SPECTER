import { useMemo, useState } from "react";
import { Copy, Download, Save, Share2 } from "lucide-react";
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
import { QrCode, downloadQrPng } from "@/components/ui/specialized/qr-code";
import { buildPayUrl, sanitizeAmountInput, type PayLinkParams } from "@/lib/payLink";
import { addSavedRequest } from "@/lib/savedRequests";
import {
  getAvailableSendChains,
  getSendChainConfig,
  type TxChain,
} from "@/lib/blockchain/sendChains";
import { analytics, type AnalyticsChain } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* Dark Knight palette — kept in sync with PayLinkCard so the request flow
 * feels like the same sealed object. */
const goldBtn =
  "bg-[#F2C94C] text-[#0B0D10] hover:bg-[#E5BE43] focus-visible:ring-[#F2C94C] border-0";
const ghostBtn =
  "border border-[#2A2E37] bg-transparent text-[#C7CBD2] hover:bg-[#15181E] hover:text-white";
const fieldCls =
  "border-[#23262E] bg-[#111317] text-[#EDEEF0] placeholder:text-[#5B616B] focus-visible:ring-[#F2C94C]/60";

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

  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto border-[#1E222A] bg-[#0B0D10] text-[#EDEEF0]"
      >
        {/* Bat-signal beam — the single gold note carried over from the pay card. */}
        <div className="-mx-6 -mt-6 mb-6 h-px bg-gradient-to-r from-transparent via-[#F2C94C]/70 to-transparent" />
        <SheetHeader>
          <SheetTitle className="text-[#F4F5F7]">Request a payment</SheetTitle>
          <SheetDescription className="text-[#878C96]">
            Set an amount and chain, then share the link or QR.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="req-amount" className="text-[#878C96]">Amount ({symbol})</Label>
            <Input
              id="req-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))}
              placeholder="0.00"
              className={fieldCls}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#878C96]">Chain</Label>
            <Select value={chain} onValueChange={(v) => setChain(v as TxChain)}>
              <SelectTrigger className={fieldCls}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-[#23262E] bg-[#0E1014] text-[#EDEEF0]">
                {chains.map((c) => (
                  <SelectItem key={c} value={c} className="focus:bg-[#15181E] focus:text-white">
                    {getSendChainConfig(c).label} ({getSendChainConfig(c).currencySymbol})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="req-label" className="text-[#878C96]">Label (optional)</Label>
            <Input
              id="req-label"
              value={label}
              maxLength={80}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Invoice #204"
              className={fieldCls}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="req-memo" className="text-[#878C96]">Note to payer (optional)</Label>
            <Input
              id="req-memo"
              value={memo}
              maxLength={140}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Design work, March"
              className={fieldCls}
            />
          </div>

          {/* Live shareable card */}
          <div className="overflow-hidden rounded-xl border border-[#1E222A] bg-[#0E1014]">
            <div className="h-px w-full bg-gradient-to-r from-transparent via-[#F2C94C]/60 to-transparent" />
            <div className="flex flex-col items-center gap-3 p-5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#878C96]">Pay request</p>
              <p className="text-center text-lg font-semibold text-[#F4F5F7]">
                {amount ? (
                  <>
                    {amount} <span className="text-[#F2C94C]">{symbol}</span>
                  </>
                ) : (
                  "Any amount"
                )}{" "}
                <span className="font-normal text-[#878C96]">to {recipient}</span>
              </p>
              {label && <p className="text-sm text-[#C7CBD2]">{label}</p>}
              <div className="rounded-lg bg-white p-2.5">
                <QrCode value={url} size={148} />
              </div>
              <p className="break-all text-center font-mono text-[10px] text-[#5B616B]">{url}</p>
            </div>
          </div>

          {/* Primary: one unambiguous copy action (the standalone copy icon was a
              duplicate of this button, so it's gone). */}
          <Button onClick={handleCreateAndCopy} className={cn("w-full", goldBtn)}>
            <Copy className="h-4 w-4 mr-1.5" /> Copy request link
          </Button>

          {/* Secondary: equal-width row so QR / Save / Share never wrap unevenly. */}
          <div className={cn("grid gap-2", canShare ? "grid-cols-3" : "grid-cols-2")}>
            <Button
              size="sm"
              className={ghostBtn}
              onClick={() => {
                analytics.payLinkQrDownloaded("drawer");
                downloadQrPng(url, `specter-request-${recipient}`);
              }}
            >
              <Download className="h-4 w-4 mr-1.5" /> QR
            </Button>
            <Button size="sm" className={ghostBtn} onClick={handleSave}>
              <Save className="h-4 w-4 mr-1.5" /> Save
            </Button>
            {canShare && (
              <Button
                size="sm"
                className={ghostBtn}
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
