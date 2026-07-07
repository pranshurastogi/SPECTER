/**
 * Shared ticket-card capture: renders a receipt DOM node to a canvas and
 * saves it as a PNG or a single-page PDF. Used by both the send flow and the
 * claim flow so every SPECTER receipt looks identical on disk.
 */
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

async function captureTicketCanvas(el: HTMLElement): Promise<HTMLCanvasElement> {
  // Resolve the actual background colour so we never get a transparent canvas.
  // html2canvas flattens CSS variables on its cloned document, but the card's
  // bg-card class uses a CSS variable that resolves to a dark hsl value.
  // Reading the computed style from the live element is the most reliable way.
  const computedBg = window.getComputedStyle(el).backgroundColor;
  const isTransparent =
    !computedBg || computedBg === "transparent" || computedBg === "rgba(0, 0, 0, 0)";
  const backgroundColor = isTransparent ? "#0f0f0f" : computedBg;

  return html2canvas(el, {
    backgroundColor,
    scale: 3, // 3× for crisp text on retina and in PDF
    useCORS: true,
    allowTaint: true,
    logging: false,
    // Explicitly set canvas dimensions to the element's full scroll size
    // so nothing gets clipped if the ticket overflows its container.
    width: el.scrollWidth,
    height: el.scrollHeight,
    windowWidth: el.scrollWidth,
    windowHeight: el.scrollHeight,
    onclone: (_doc, clonedEl) => {
      // CSS variables (--card, --card-foreground, etc.) may not resolve
      // inside the cloned iframe. Force the background and text colours
      // explicitly so the capture always renders on a dark surface.
      clonedEl.style.backgroundColor = backgroundColor;
      clonedEl.style.color = window.getComputedStyle(el).color || "#ffffff";
    },
  });
}

/** Downloads the ticket as `<filename>.png`. Throws on capture failure. */
export async function saveTicketPng(el: HTMLElement, filename: string): Promise<void> {
  const canvas = await captureTicketCanvas(el);
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.png`;
  a.click();
}

/** Downloads the ticket as a snug single-page `<filename>.pdf`. */
export async function saveTicketPdf(el: HTMLElement, filename: string): Promise<void> {
  const canvas = await captureTicketCanvas(el);
  const imgData = canvas.toDataURL("image/png");

  // Canvas is 3× the CSS pixel size. Convert to mm at 96 DPI.
  // 1 CSS px = 25.4 / 96 mm ≈ 0.2646 mm
  const PX_TO_MM = 25.4 / 96;
  const ticketWmm = (canvas.width / 3) * PX_TO_MM;
  const ticketHmm = (canvas.height / 3) * PX_TO_MM;

  // Page = ticket size + 12 mm margin on each side
  const marginMm = 12;
  const pageW = ticketWmm + marginMm * 2;
  const pageH = ticketHmm + marginMm * 2;

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [pageW, pageH] });
  pdf.addImage(imgData, "PNG", marginMm, marginMm, ticketWmm, ticketHmm);
  pdf.save(`${filename}.pdf`);
}
