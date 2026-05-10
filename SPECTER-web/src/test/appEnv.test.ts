import { describe, it, expect } from "vitest";
import { normalizeAppDeployment } from "@/lib/appEnv";

describe("normalizeAppDeployment", () => {
  it("treats staging (any case/whitespace) as staging", () => {
    expect(normalizeAppDeployment("staging")).toBe("staging");
    expect(normalizeAppDeployment("  STAGING  ")).toBe("staging");
  });

  it("defaults to main when unset or any other value", () => {
    expect(normalizeAppDeployment(undefined)).toBe("main");
    expect(normalizeAppDeployment("")).toBe("main");
    expect(normalizeAppDeployment("production")).toBe("main");
    expect(normalizeAppDeployment("main")).toBe("main");
  });
});
