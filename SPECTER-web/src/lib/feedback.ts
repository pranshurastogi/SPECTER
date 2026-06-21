// Lightweight feedback / support hooks shared across the app.
//
// Two ways for users to reach us:
//  • a short form (async, low-friction)
//  • a 15-min call (high-bandwidth, for the gnarly stuff)
//
// `reportIssue()` lets any part of the app surface the help bubble when
// something goes wrong. The sonner wrapper calls it on every `toast.error`,
// so existing error paths get this for free.

export const FEEDBACK_FORM_URL = "https://forms.gle/bDC4Sa5GqFedrf688";
export const SCHEDULE_CALL_URL = "https://calendly.com/pranshurastogi/15min";

/** Window event the FeedbackBubble listens for. */
export const ISSUE_EVENT = "specter:issue";

export interface IssueDetail {
  /** Optional short context, e.g. the error message that triggered this. */
  message?: string;
}

/** Surface the help bubble. Safe to call from anywhere (no-op during SSR). */
export function reportIssue(detail?: IssueDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<IssueDetail>(ISSUE_EVENT, { detail }));
}
