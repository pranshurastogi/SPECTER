import { describe, it, expect, beforeEach } from "vitest";
import {
  WALKTHROUGH_PROMPT_MAX_VIEWS,
  getWalkthroughPromptViews,
  hasSeenWalkthroughPrompt,
  isSpecterProductionHost,
  markWalkthroughPromptSeen,
  recordWalkthroughPromptView,
  shouldShowWalkthroughPrompt,
} from "@/lib/walkthroughPrompt";

describe("walkthroughPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("recognizes allowed hosts", () => {
    expect(isSpecterProductionHost("specterpq.com")).toBe(true);
    expect(isSpecterProductionHost("www.specterpq.com")).toBe(true);
    expect(isSpecterProductionHost("localhost")).toBe(true);
    expect(isSpecterProductionHost("127.0.0.1")).toBe(true);
    expect(isSpecterProductionHost("play.specterpq.com")).toBe(false);
  });

  it("shows prompt on first visit for allowed hosts", () => {
    expect(hasSeenWalkthroughPrompt()).toBe(false);
    expect(shouldShowWalkthroughPrompt("specterpq.com")).toBe(true);
    expect(shouldShowWalkthroughPrompt("localhost")).toBe(true);
  });

  it("counts at most one view per session", () => {
    recordWalkthroughPromptView();
    recordWalkthroughPromptView();
    expect(getWalkthroughPromptViews()).toBe(1);
  });

  it("hides for the rest of the session once dismissed", () => {
    recordWalkthroughPromptView();
    markWalkthroughPromptSeen();
    expect(shouldShowWalkthroughPrompt("specterpq.com")).toBe(false);
    // ...but it isn't permanently retired until the cap is reached.
    expect(hasSeenWalkthroughPrompt()).toBe(false);
  });

  it("reappears across sessions until the view cap is reached", () => {
    for (let i = 0; i < WALKTHROUGH_PROMPT_MAX_VIEWS; i++) {
      // each iteration simulates a fresh session
      sessionStorage.clear();
      expect(shouldShowWalkthroughPrompt("specterpq.com")).toBe(true);
      recordWalkthroughPromptView();
    }
    expect(getWalkthroughPromptViews()).toBe(WALKTHROUGH_PROMPT_MAX_VIEWS);
    expect(hasSeenWalkthroughPrompt()).toBe(true);

    // A brand-new session no longer shows it.
    sessionStorage.clear();
    expect(shouldShowWalkthroughPrompt("specterpq.com")).toBe(false);
  });
});
