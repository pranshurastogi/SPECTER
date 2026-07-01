/**
 * Lazy, idempotent bridge to the local `@specterpq/sdk` WASM module.
 *
 * The recovery page runs ALL cryptography in the browser via this SDK — the
 * same ML-KEM-768 decapsulation + stealth-key derivation SPECTER's backend
 * does, but client-side. `ensureSdk()` initialises the WASM exactly once and
 * is safe to call from multiple components/effects.
 */

import { initSpecterSdk } from "@specterpq/sdk";

export {
  scanAnnouncement,
  decodeAnnouncementMetadata,
  openAnnouncementMetadata,
} from "@specterpq/sdk";
export type {
  AnnouncementInput,
  KyberKeyPair,
  ScanResult,
  StealthKeys,
} from "@specterpq/sdk";

let initPromise: Promise<void> | null = null;

/** Initialise the SPECTER WASM module once; subsequent calls reuse it. */
export function ensureSdk(): Promise<void> {
  if (initPromise === null) {
    initPromise = initSpecterSdk().catch((err) => {
      // Reset so a transient failure can be retried.
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}
