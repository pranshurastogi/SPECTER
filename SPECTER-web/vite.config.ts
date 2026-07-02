import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
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
