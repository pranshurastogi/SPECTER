/**
 * Step 5 of the claim flow: the receipt — the user's proof of what moved
 * where. Renders as the same ticket card as the send flow and saves as
 * PNG / PDF (a capture of the ticket itself) or raw JSON.
 */
import { useRef } from "react";
import { formatUnits } from "viem";
import { Download, FileDown, ImageDown, X } from "lucide-react";
import { Button } from "@/components/ui/base/button";
import { toast } from "@/components/ui/base/sonner";
import { formatCryptoAmount } from "@/lib/utils";
import {
  getChainDecimals,
  getExplorerTxUrl,
  getSendChainConfig,
} from "@/lib/blockchain/sendChains";
import { AnimatedTicket } from "@/components/ui/specialized/ticket-confirmation-card";
import { saveTicketPdf, saveTicketPng } from "@/lib/receiptCapture";
import { downloadReceiptJson, type ClaimReceipt } from "@/lib/claim/receipt";

interface ClaimReceiptViewProps {
  receipt: ClaimReceipt;
  /** null = recording skipped (no meta-address); false = failed (retryable). */
  recordedToServer: boolean | null;
  onRetryRecord: () => void;
  onClose: () => void;
}

export function ClaimReceiptView({
  receipt,
  recordedToServer,
  onRetryRecord,
  onClose,
}: ClaimReceiptViewProps) {
  const ticketRef = useRef<HTMLDivElement>(null);
  const cfg = getSendChainConfig(receipt.chain);
  const decimals = getChainDecimals(receipt.chain);
  const fmt = (wei: string) => {
    try {
      return formatCryptoAmount(formatUnits(BigInt(wei), decimals));
    } catch {
      return wei;
    }
  };

  const filename = `specter-claim-${receipt.receiptId.slice(0, 8)}`;

  const handleSaveImage = async () => {
    if (!ticketRef.current) return;
    try {
      await saveTicketPng(ticketRef.current, filename);
      toast.success("Receipt saved as PNG");
    } catch {
      toast.error("Could not save image. Try again.");
    }
  };

  const handleSavePdf = async () => {
    if (!ticketRef.current) return;
    try {
      await saveTicketPdf(ticketRef.current, filename);
      toast.success("Receipt saved as PDF");
    } catch {
      toast.error("Could not save PDF. Try again.");
    }
  };

  const totalReceived = (() => {
    try {
      return Number(formatUnits(BigInt(receipt.totalAmountBase), decimals));
    } catch {
      return 0;
    }
  })();

  // Only confirmed rows go on the ticket breakdown.
  const ticketAddresses = receipt.rows
    .filter((r) => r.status === "confirmed")
    .map((r) => ({
      address: r.stealthAddress,
      amount: fmt(r.amountBase),
      url: r.txHash ? getExplorerTxUrl(receipt.chain, r.txHash) || undefined : undefined,
    }));

  const destShort =
    receipt.destinationInput !== receipt.destination
      ? receipt.destinationInput
      : `${receipt.destination.slice(0, 10)}…${receipt.destination.slice(-6)}`;

  const subtitle =
    receipt.failed > 0
      ? `${receipt.confirmed} of ${receipt.rows.length} claimed · ${receipt.failed} failed`
      : `${receipt.confirmed} stealth address${receipt.confirmed !== 1 ? "es" : ""} swept to your wallet`;

  return (
    <div className="flex flex-col items-center">
      {/* Close (the modal's own header is hidden on this step) */}
      <button
        type="button"
        onClick={onClose}
        className="self-end -mt-1 -mr-1 mb-1 text-white/40 hover:text-white/80 transition-colors"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>

      <AnimatedTicket
        ref={ticketRef}
        title="Funds claimed"
        subtitle={subtitle}
        ticketId={receipt.receiptId.slice(0, 8)}
        ticketIdLabel="Receipt"
        amount={totalReceived}
        amountLabel="Claimed"
        currency={cfg.currencySymbol}
        date={new Date(receipt.createdAt * 1000)}
        holderLabel="Sent to"
        cardHolder={destShort}
        last4Digits={receipt.destination.replace(/^0x/, "").slice(-4)}
        barcodeValue={receipt.receiptId.replace(/-/g, "").slice(0, 12).toUpperCase()}
        chainLabel={cfg.label}
        addresses={ticketAddresses}
      />

      <div className="w-full max-w-sm mt-6 space-y-2">
        {recordedToServer === false && (
          <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Claimed on-chain, but saving to your history failed.
            </p>
            <Button variant="outline" size="sm" onClick={onRetryRecord}>
              Retry
            </Button>
          </div>
        )}

        <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-muted-foreground text-center">
          Save receipt
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="default" className="w-full" onClick={handleSaveImage}>
            <ImageDown className="h-4 w-4 mr-2" />
            PNG
          </Button>
          <Button variant="outline" size="default" className="w-full" onClick={handleSavePdf}>
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
          <Button
            variant="outline"
            size="default"
            className="w-full"
            onClick={() => downloadReceiptJson(receipt)}
          >
            <Download className="h-4 w-4 mr-2" />
            JSON
          </Button>
        </div>
        <Button variant="quantum" size="default" className="w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
