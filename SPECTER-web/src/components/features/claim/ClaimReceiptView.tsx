/**
 * Step 5 of the claim flow: the receipt — the user's proof of what moved
 * where. Renders in-theme, downloads as JSON, and prints to PDF via a
 * clean dedicated print document.
 */
import { formatUnits } from "viem";
import { Download, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/base/button";
import { formatCryptoAmount } from "@/lib/utils";
import {
  getChainDecimals,
  getExplorerTxUrl,
  getSendChainConfig,
} from "@/lib/blockchain/sendChains";
import { AnimatedTicket } from "@/components/ui/specialized/ticket-confirmation-card";
import { downloadReceiptJson, type ClaimReceipt } from "@/lib/claim/receipt";

interface ClaimReceiptViewProps {
  receipt: ClaimReceipt;
  /** null = recording skipped (no meta-address); false = failed (retryable). */
  recordedToServer: boolean | null;
  onRetryRecord: () => void;
  onClose: () => void;
}

/** Opens a minimal print document for the receipt and triggers print-to-PDF. */
function printReceipt(receipt: ClaimReceipt, chainLabel: string, symbol: string, decimals: number) {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmt = (wei: string) => {
    try {
      return `${formatUnits(BigInt(wei), decimals)} ${symbol}`;
    } catch {
      return `${wei} wei`;
    }
  };
  const rows = receipt.rows
    .map(
      (r) => `<tr>
        <td class="mono">${esc(r.stealthAddress)}</td>
        <td>${esc(fmt(r.amountBase))}</td>
        <td>${esc(fmt(r.feeBase))}</td>
        <td class="mono">${esc(r.txHash || "—")}</td>
        <td>${esc(r.status)}</td>
      </tr>`,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>SPECTER claim receipt ${esc(receipt.receiptId)}</title>
    <style>
      body { font-family: -apple-system, "Segoe UI", sans-serif; color: #111; margin: 40px; }
      h1 { font-size: 18px; } h2 { font-size: 13px; color: #555; font-weight: normal; }
      table { border-collapse: collapse; width: 100%; margin-top: 16px; font-size: 11px; }
      th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; word-break: break-all; }
      th { background: #f5f5f5; }
      .mono { font-family: ui-monospace, monospace; }
      .meta { font-size: 12px; margin-top: 12px; line-height: 1.7; }
    </style></head><body>
    <h1>SPECTER — Claim receipt</h1>
    <h2>Receipt ${esc(receipt.receiptId)} · ${new Date(receipt.createdAt * 1000).toLocaleString()}</h2>
    <div class="meta">
      <div><strong>Chain:</strong> ${esc(chainLabel)}</div>
      <div><strong>Destination:</strong> <span class="mono">${esc(receipt.destination)}</span>${
        receipt.destinationInput !== receipt.destination
          ? ` (${esc(receipt.destinationInput)})`
          : ""
      }</div>
      <div><strong>Total claimed:</strong> ${esc(fmt(receipt.totalAmountBase))} · <strong>Network fees:</strong> ${esc(fmt(receipt.totalFeeBase))}</div>
      <div><strong>Result:</strong> ${receipt.confirmed} confirmed · ${receipt.failed} failed · ${receipt.skipped} skipped</div>
    </div>
    <table><thead><tr><th>Stealth address</th><th>Amount</th><th>Fee</th><th>Transaction</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody></table>
    </body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return; // popup blocked — the JSON download still works
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

export function ClaimReceiptView({
  receipt,
  recordedToServer,
  onRetryRecord,
  onClose,
}: ClaimReceiptViewProps) {
  const cfg = getSendChainConfig(receipt.chain);
  const decimals = getChainDecimals(receipt.chain);
  const fmt = (wei: string) => {
    try {
      return formatCryptoAmount(formatUnits(BigInt(wei), decimals));
    } catch {
      return wei;
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
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="default" className="w-full" onClick={() => downloadReceiptJson(receipt)}>
            <Download className="h-4 w-4 mr-2" />
            JSON
          </Button>
          <Button
            variant="outline"
            size="default"
            className="w-full"
            onClick={() => printReceipt(receipt, cfg.label, cfg.currencySymbol, decimals)}
          >
            <Printer className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
        <Button variant="quantum" size="default" className="w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
