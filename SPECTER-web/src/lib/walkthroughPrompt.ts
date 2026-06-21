const VIEWS_KEY = "specter_walkthrough_prompt_views";
const SESSION_FLAG = "specter_walkthrough_prompt_session";

/** How many times (across sessions) the walkthrough prompt may auto-appear. */
export const WALKTHROUGH_PROMPT_MAX_VIEWS = 5;

const WALKTHROUGH_PROMPT_HOSTS = new Set([
  "specterpq.com",
  "www.specterpq.com",
  "localhost",
  "127.0.0.1",
]);

export function isSpecterProductionHost(hostname?: string): boolean {
  const host = (hostname ?? (typeof window !== "undefined" ? window.location.hostname : ""))
    .toLowerCase()
    .trim();
  return WALKTHROUGH_PROMPT_HOSTS.has(host);
}

/** Lifetime number of times the prompt has been shown to this visitor. */
export function getWalkthroughPromptViews(): number {
  try {
    return Number.parseInt(localStorage.getItem(VIEWS_KEY) ?? "0", 10) || 0;
  } catch {
    // localStorage unavailable — treat as exhausted so we never nag.
    return WALKTHROUGH_PROMPT_MAX_VIEWS;
  }
}

/** True once the prompt has been shown its full allotment of times. */
export function hasSeenWalkthroughPrompt(): boolean {
  return getWalkthroughPromptViews() >= WALKTHROUGH_PROMPT_MAX_VIEWS;
}

/** Whether the prompt has already been counted/shown in this browser session. */
export function shownThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_FLAG) === "1";
  } catch {
    return false;
  }
}

/**
 * Record that the prompt was shown. Counts at most once per session toward the
 * lifetime cap, so the visitor sees it across up to {@link WALKTHROUGH_PROMPT_MAX_VIEWS}
 * sessions rather than repeatedly within one.
 */
export function recordWalkthroughPromptView(): void {
  if (shownThisSession()) return;
  try {
    sessionStorage.setItem(SESSION_FLAG, "1");
    localStorage.setItem(VIEWS_KEY, String(getWalkthroughPromptViews() + 1));
  } catch {
    // storage unavailable — silently skip
  }
}

/**
 * User dismissed the prompt — hide it for the rest of this session. The view was
 * already counted when it appeared, so we only need to mute it until next visit.
 */
export function markWalkthroughPromptSeen(): void {
  try {
    sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    // storage unavailable — silently skip
  }
}

export function shouldShowWalkthroughPrompt(hostname?: string): boolean {
  return (
    isSpecterProductionHost(hostname) &&
    !hasSeenWalkthroughPrompt() &&
    !shownThisSession()
  );
}
