import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { X } from "lucide-react";
import { PayLinkCard } from "./PayLinkCard";
import { analytics } from "@/lib/analytics";
import { configureDotLottieWasm } from "@/lib/dotlottieWasm";
import { cn } from "@/lib/utils";

// Use the self-hosted WASM renderer (CDN fallback) before any dotLottie mounts.
configureDotLottieWasm();

/**
 * Floating pay-link launcher. Keeps the Scan page's primary action (scanning)
 * front-and-centre while the receiver's pay link lives in a branded orb that
 * springs open a panel on tap. Rendered through a portal so `position: fixed`
 * is always relative to the viewport regardless of ancestor transforms.
 */
export function PayLinkFab() {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(true);
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const constraintsRef = useRef<HTMLDivElement>(null);
  // Distinguishes a drag from a tap so dragging the orb doesn't open the panel.
  const dragged = useRef(false);

  // One-time "peek" label on mount to aid discovery, then settle.
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 3200);
    return () => clearTimeout(t);
  }, []);

  // Esc to close; focus the panel on open and restore focus to the orb on close.
  useEffect(() => {
    if (!open) return;
    setHint(false);
    analytics.payLinkFabOpened();
    const orb = fabRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
      orb?.focus();
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Drag bounds: a viewport-sized box (with a small margin) so the orb can't leave the screen */}
      <div ref={constraintsRef} className="pointer-events-none fixed inset-3 -z-10" aria-hidden="true" />

      {/* Dimmed, blurred backdrop — click to dismiss */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* The panel springs out of the orb's corner */}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Your pay link"
            className="fixed z-50 bottom-40 right-4 left-4 sm:left-auto sm:w-[23rem] max-h-[calc(100vh-13rem)] overflow-y-auto outline-none"
            style={{ transformOrigin: "bottom right" }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 14 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 14 }}
            transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 30 }}
          >
            <PayLinkCard source="scan" className="border-[#F2C94C]/25 shadow-2xl shadow-black/60" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* The orb — draggable anywhere, defaulted to the right-middle so it never sits on the footer */}
      <motion.div
        className="fixed right-5 top-[calc(50%-2rem)] z-50 touch-none"
        drag={!open}
        dragConstraints={constraintsRef}
        dragMomentum={false}
        dragElastic={0.12}
        whileDrag={{ scale: 1.08 }}
        onPointerDownCapture={() => {
          dragged.current = false;
        }}
        onDragStart={() => {
          dragged.current = true;
        }}
      >
        <motion.button
          ref={fabRef}
          type="button"
          onClick={() => {
            if (dragged.current) {
              dragged.current = false;
              return; // it was a drag, not a tap
            }
            setOpen((o) => !o);
          }}
          aria-label={open ? "Close your pay link" : "Open your pay link"}
          aria-expanded={open}
          whileHover={reduce ? undefined : { scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            "peer relative grid h-16 w-16 cursor-grab place-items-center rounded-full outline-none transition-colors active:cursor-grabbing",
            "focus-visible:ring-2 focus-visible:ring-[#F2C94C] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            // Open = a quiet graphite disc behind the close icon; closed = bare orb, just the lottie.
            open
              ? "bg-[#15181E] text-[#EDEEF0] ring-1 ring-[#2A2E37] shadow-lg shadow-black/50"
              : "bg-transparent"
          )}
        >
          {/* Ambient bat-signal glow (closed only) — a soft gold breath, no box. */}
          {!open && (
            <motion.span
              className="pointer-events-none absolute inset-1 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(242,201,76,0.30), transparent 68%)" }}
              animate={reduce ? undefined : { opacity: [0.45, 0.85, 0.45], scale: [0.92, 1.04, 0.92] }}
              transition={reduce ? undefined : { duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
              aria-hidden="true"
            />
          )}
          <AnimatePresence mode="wait" initial={false}>
            {open ? (
              <motion.span
                key="close"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="relative"
              >
                <X className="h-6 w-6" />
              </motion.span>
            ) : (
              <motion.span
                key="lottie"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.18 }}
                className="relative grid h-16 w-16 place-items-center"
                style={{ filter: "drop-shadow(0 0 9px rgba(242,201,76,0.5))" }}
              >
                <DotLottieReact
                  src="/payment-asset.lottie"
                  autoplay
                  loop
                  className="h-full w-full"
                  aria-hidden
                />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>

        {/* Hover label (peer must follow the button in the DOM) + first-mount peek */}
        <span
          className={cn(
            "pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-full border border-[#23262E] bg-[#0E1014] px-3 py-1.5 text-xs font-medium text-[#C7CBD2] shadow-md transition-all duration-300",
            "peer-hover:opacity-100 peer-hover:translate-x-0",
            !open && hint ? "opacity-100 translate-x-0" : "opacity-0 translate-x-1"
          )}
        >
          Drag me · tap to open
        </span>
      </motion.div>
    </>,
    document.body
  );
}
