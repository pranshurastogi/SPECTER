import { setWasmUrl } from "@lottiefiles/dotlottie-react";

/**
 * Point the dotLottie renderer at our self-hosted WASM instead of the default
 * CDN. The file lives at `public/dotlottie-player.wasm` and must match the
 * installed `@lottiefiles/dotlottie-web` version — re-copy it from
 * `node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm` after any
 * dependency bump. If the local copy is missing (e.g. a partial deploy) we fall
 * back to the CDN so the animation still renders.
 */
const LOCAL_WASM = "/dotlottie-player.wasm";
const CDN_WASM = "https://unpkg.com/@lottiefiles/dotlottie-web@0.75.0/dist/dotlottie-player.wasm";

let configured = false;

export function configureDotLottieWasm(): void {
  if (configured) return;
  configured = true;

  // Prefer the local copy.
  setWasmUrl(LOCAL_WASM);

  // Verify it's actually served; fall back to the CDN if not.
  if (typeof fetch === "function") {
    fetch(LOCAL_WASM, { method: "HEAD" })
      .then((res) => {
        if (!res.ok) setWasmUrl(CDN_WASM);
      })
      .catch(() => setWasmUrl(CDN_WASM));
  }
}
