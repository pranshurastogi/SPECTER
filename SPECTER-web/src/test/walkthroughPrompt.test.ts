import { describe, it, expect, beforeEach } from "vitest";
import {
  hasSeenWalkthroughPrompt,
  isSpecterProductionHost,
  markWalkthroughPromptSeen,
  shouldShowWalkthroughPrompt,
} from "@/lib/walkthroughPrompt";

describe("walkthroughPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
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

  it("does not show again after dismiss", () => {
    markWalkthroughPromptSeen();
    expect(hasSeenWalkthroughPrompt()).toBe(true);
    expect(shouldShowWalkthroughPrompt("specterpq.com")).toBe(false);
  });
});
