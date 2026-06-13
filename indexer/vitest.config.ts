import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**"],
      reporter: ["text", "lcov"],
    },
    // Isolate each test file in its own worker so module-level singleton state
    // (e.g. the libsql client singleton in turso.ts) resets between files.
    pool: "forks",
  },
});
