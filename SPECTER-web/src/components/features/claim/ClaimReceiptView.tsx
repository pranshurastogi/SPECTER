/**
 * Step 5 of the claim flow: the receipt — the user's proof of what moved
 * where. Renders in-theme, downloads as JSON, and prints to PDF via a
 * clean dedicated print document.
 */
import { motion } from "framer-motion";
import { formatUnits } from "viem";
import { CheckCircle2, Download, ExternalLink, Printer } from "lucide-react";
import { Button } from "@/components/ui/base/button";
import { formatCryptoAmount } from "@/lib/utils";
import {
  getChainDecimals,
  getExplorerTxUrl,
  getSendChainConfig,
} from "@/lib/blockchain/sendChains";
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

  return (
    <div className="space-y-4">
      <motion.div
        className="specter-confirm"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span className="specter-confirm-text">
          {receipt.confirmed} of {receipt.rows.length} claimed —{" "}
          {fmt(receipt.totalAmountBase)} {cfg.currencySymbol} sent
        </span>
      </motion.div>

      <div className="relative overflow-hidden rounded-lg border border-white/[0.07] bg-black/30 px-3 py-2.5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-2">
            <span className="text-white/35">Receipt</span>
            <span className="font-mono text-white/70">{receipt.receiptId.slice(0, 8)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-white/35">Chain</span>
            <span className="text-white/70">{cfg.label}</span>
          </div>
          <div className="flex justify-between gap-2 min-w-0">
            <span className="text-white/35 shrink-0">Destination</span>
            <span className="font-mono text-white/70 truncate" title={receipt.destination}>
              {receipt.destinationInput !== receipt.destination
                ? receipt.destinationInput
                : `${receipt.destination.slice(0, 10)}…${receipt.destination.slice(-6)}`}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-white/35">Network fees</span>
            <span className="font-mono text-white/70">
              {fmt(receipt.totalFeeBase)} {cfg.currencySymbol}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1 [scrollbar-width:thin]">
        {receipt.rows.map((r) => {
          const explorer = r.txHash ? getExplorerTxUrl(receipt.chain, r.txHash) : "";
          return (
            <div
              key={r.id}
              className="p-2.5 rounded-lg bg-black/35 border border-white/[0.08] flex items-center gap-2.5 text-xs"
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                  r.status === "confirmed"
                    ? "bg-emerald-400"
                    : r.status === "skipped_dust"
                      ? "bg-white/25"
                      : "bg-destructive"
                }`}
              />
              <span className="font-mono truncate flex-1" title={r.stealthAddress}>
                {r.stealthAddress.slice(0, 10)}…{r.stealthAddress.slice(-6)}
              </span>
              {r.status === "confirmed" && (
                <span className="font-mono text-white/70 tabular-nums shrink-0">
                  {fmt(r.amountBase)}
                </span>
              )}
              {explorer && (
                <a
                  href={explorer}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline shrink-0 inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          );
        })}
      </div>

      {recordedToServer === false && (
        <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Claim succeeded, but saving it to your history failed.
          </p>
          <Button variant="outline" size="sm" onClick={onRetryRecord}>
            Retry
          </Button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 min-w-[120px]"
          onClick={() => downloadReceiptJson(receipt)}
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download JSON
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 min-w-[120px]"
          onClick={() => printReceipt(receipt, cfg.label, cfg.currencySymbol, decimals)}
        >
          <Printer className="h-3.5 w-3.5 mr-1.5" />
          Save PDF
        </Button>
        <Button variant="quantum" size="sm" className="flex-1 min-w-[120px]" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
