const STORAGE_KEY = "specter_walkthrough_prompt_seen";

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

export function hasSeenWalkthroughPrompt(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markWalkthroughPromptSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // localStorage unavailable — silently skip
  }
}

export function shouldShowWalkthroughPrompt(hostname?: string): boolean {
  return isSpecterProductionHost(hostname) && !hasSeenWalkthroughPrompt();
}
