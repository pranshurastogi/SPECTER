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
    // The SPECTER SDK loads its crypto from WebAssembly via a dynamic import.
    // esbuild's dep pre-bundling mangles that dynamic import + the `.wasm`
    // asset URL, so exclude it and let Vite serve the wasm as a real asset.
    exclude: ["@specterpq/sdk"],
  },
});
