import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { cn } from "@/lib/utils";

/**
 * Branded QR for a pay link. Modules use a violet→cyan gradient (both stops dark
 * enough to keep contrast high so it still scans), wrapped in a gradient ring with
 * a SPECTER logo excavated into the centre. Error-correction level H tolerates the
 * centre logo.
 */
const GRADIENT_ID = "specter-qr-gradient";
const GRADIENT_FROM = "#4c1d95"; // deep violet
const GRADIENT_TO = "#0e5066"; // deep cyan — both dark on white for scannability
const DOWNLOAD_FG = "#4c1d95"; // canvas can't do gradients; solid brand violet

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
  /** Show the SPECTER logo in the centre. Default true. */
  logo?: boolean;
}

export function QrCode({ value, size = 188, className, logo = true }: QrCodeProps) {
  return (
    <div
      className={cn(
        "inline-block rounded-[20px] bg-gradient-to-br from-primary via-primary to-accent p-[3px] shadow-xl shadow-primary/20",
        className
      )}
    >
      <div className="rounded-[17px] bg-white p-4">
        {/* Document-wide gradient def the QR modules reference via url(#id). */}
        <svg width="0" height="0" className="absolute" aria-hidden="true">
          <defs>
            <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={GRADIENT_FROM} />
              <stop offset="100%" stopColor={GRADIENT_TO} />
            </linearGradient>
          </defs>
        </svg>
        <QRCodeSVG
          value={value}
          size={size}
          level="H"
          bgColor="transparent"
          fgColor={`url(#${GRADIENT_ID})`}
          imageSettings={
            logo
              ? {
                  src: "/Specterpq-logo-whitebg.png",
                  height: Math.round(size * 0.2),
                  width: Math.round(size * 0.2),
                  excavate: true,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

/**
 * Render a QR off-screen as a canvas and trigger a PNG download. Uses a solid
 * brand violet (canvas has no gradient support via qrcode.react) on white.
 * Fails silently in non-DOM contexts.
 */
export function downloadQrPng(value: string, fileName: string, size = 640): void {
  try {
    const canvas = document.createElement("canvas");
    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-9999px";
    document.body.appendChild(host);

    import("react-dom/client")
      .then(({ createRoot }) => {
        let root: ReturnType<typeof createRoot> | undefined;
        try {
          root = createRoot(host);
          root.render(
            <QRCodeCanvas value={value} size={size} level="H" fgColor={DOWNLOAD_FG} bgColor="#ffffff" marginSize={4} />
          );
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
              /* fail silently if canvas ops fail */
            } finally {
              root?.unmount();
              host.remove();
            }
          });
        } catch {
          try {
            root?.unmount();
          } catch {
            /* ignore */
          }
          host.remove();
        }
      })
      .catch(() => {
        host.remove();
      });
  } catch {
    /* fail silently if called in a non-DOM context */
  }
}
