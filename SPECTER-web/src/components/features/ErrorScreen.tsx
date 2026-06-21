import type { ReactNode } from "react";
import { MessageSquarePlus, CalendarClock } from "lucide-react";
import { RetroTvError } from "@/components/ui/404-error-page";
import { FEEDBACK_FORM_URL, SCHEDULE_CALL_URL } from "@/lib/feedback";

interface ErrorScreenProps {
  errorCode?: string;
  /** Short text shown on the TV screen, e.g. "NOT FOUND". */
  screenMessage?: string;
  title: string;
  description: string;
  /** Primary action(s) — e.g. a "Go home" link or "Reload" button. */
  actions?: ReactNode;
}

/**
 * Full-page error layout: a retro-TV display up top, a short explanation, the
 * caller's primary action, and a quiet "talk to us" feedback strip at the
 * bottom (share feedback / book a call). Used by the 404 page and the global
 * ErrorBoundary alike.
 */
export function ErrorScreen({
  errorCode = "404",
  screenMessage = "NOT FOUND",
  title,
  description,
  actions,
}: ErrorScreenProps) {
  return (
    <div className="flex w-full flex-col items-center px-4 text-center">
      <div className="w-full max-w-2xl">
        <RetroTvError errorCode={errorCode} errorMessage={screenMessage} />
      </div>

      <h1 className="font-dm-sans mt-2 select-none text-2xl font-bold text-foreground md:text-4xl">
        {title}
      </h1>
      <p className="font-dm-sans mt-3 max-w-md select-none text-base text-muted-foreground md:text-lg">
        {description}
      </p>

      {actions && <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{actions}</div>}

      {/* ── Quiet feedback strip ── */}
      <div className="mt-12 w-full max-w-md rounded-2xl border border-border/50 bg-card/40 px-5 py-4 backdrop-blur-sm">
        <p className="text-sm font-medium text-foreground/80">
          Something not working as expected?
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Tell us what happened or grab 15 minutes with the team — we read every note.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <a
            href={FEEDBACK_FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 shadow-sm shadow-amber-500/30 transition-all hover:bg-amber-400 active:scale-95"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Share feedback
          </a>
          <a
            href={SCHEDULE_CALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground/80 transition-all hover:border-amber-500/40 hover:text-amber-300 active:scale-95"
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Book a 15-min call
          </a>
        </div>
      </div>
    </div>
  );
}
