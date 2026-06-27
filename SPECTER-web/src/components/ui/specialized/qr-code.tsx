import { QRCodeCanvas } from "qrcode.react";
import { cn } from "@/lib/utils";

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
}

/**
 * QR for a pay link. White quiet-zone padding so it scans reliably even on the
 * dark theme. Render inside a light container.
 */
export function QrCode({ value, size = 184, className }: QrCodeProps) {
  return (
    <div className={cn("inline-flex rounded-lg bg-white p-3", className)}>
      <QRCodeCanvas value={value} size={size} level="M" includeMargin={false} />
    </div>
  );
}

/** Render a QR off-screen and trigger a PNG download. */
export function downloadQrPng(value: string, fileName: string, size = 512): void {
  try {
    const canvas = document.createElement("canvas");
    // qrcode.react has no imperative API; use the canvas-drawing fallback via a temp React-free encoder.
    // Simplest reliable path: reuse a mounted QRCodeCanvas. Here we draw from an in-DOM hidden canvas.
    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-9999px";
    document.body.appendChild(host);

    import("react-dom/client").then(({ createRoot }) => {
      let root: ReturnType<typeof createRoot> | undefined;
      try {
        root = createRoot(host);
        root.render(<QRCodeCanvas value={value} size={size} level="M" includeMargin />);
        // Allow a tick for the canvas to paint.
        requestAnimationFrame(() => {
          try {
            const rendered = host.querySelector("canvas");
            if (rendered) {
              canvas.width = rendered.width;
              canvas.height = rendered.height;
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(rendered, 0, 0);
                const url = canvas.toDataURL("image/png");
                const a = document.createElement("a");
                a.href = url;
                a.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
                a.click();
              }
            }
          } catch {
            // fail silently if canvas ops fail
          } finally {
            root?.unmount();
            host.remove();
          }
        });
      } catch {
        try { root?.unmount(); } catch { /* ignore */ }
        host.remove();
      }
    }).catch(() => {
      host.remove();
    });
  } catch {
    // fail silently if called in a non-DOM context
  }
}
