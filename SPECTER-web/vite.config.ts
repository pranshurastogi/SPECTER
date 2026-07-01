import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Repo root, two levels above SPECTER-web — the local `@specterpq/sdk` `file:`
// dep is symlinked into node_modules but its real files live here.
const REPO_ROOT = path.resolve(__dirname, "../..");

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    fs: {
      // The SDK symlink resolves outside the web-app root, so the dev server
      // must be allowed to serve `specter_wasm.js` / `.wasm` from the repo root
      // (used by the trustless /i-dont-trust-specter recovery page).
      allow: [REPO_ROOT],
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // Pre-bundle heavy deps for faster dev startup.
    // Exclude the local WASM SDK so its `new URL('...', import.meta.url)`
    // resolution of `specter_wasm_bg.wasm` survives esbuild pre-bundling
    // (used by the trustless /i-dont-trust-specter recovery page).
    exclude: ["@specterpq/sdk"],
  },
  build: {
    // The WASM-backed SDK pushes the main chunk past Vite's 500 kB warning;
    // raise the threshold and skip the per-chunk gzip pass, which spikes peak
    // memory at the final flush (the source of the build-time OOM).
    chunkSizeWarningLimit: 2000,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // Split heavy vendors into their own chunks so no single chunk has to
        // hold the SDK, viem, and the React tree in memory at once.
        manualChunks(id) {
          if (id.includes("@specterpq/sdk") || id.includes("specter-sdk")) {
            return "specter-sdk";
          }
          if (id.includes("node_modules/viem") || id.includes("node_modules/@noble")) {
            return "viem";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "react-vendor";
          }
        },
      },
    },
  },
});
