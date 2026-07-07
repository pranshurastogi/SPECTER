/**
 * Client-side SPECTER crypto, backed by `@specterpq/sdk` (Rust → WebAssembly).
 *
 * This module is the ONLY place the app touches secret keys. Everything here
 * runs in the browser: key generation, payment scanning, and stealth spend-key
 * derivation. No secret key (`spending_sk`, `viewing_sk`) is ever sent to the
 * server — that is the whole point of moving off the old `/keys/generate` and
 * `/stealth/scan` endpoints.
 *
 * The server is used only for public data: the announcement registry, ENS/SuiNS
 * resolution, IPFS pinning, and gas-sponsored relaying of the (public)
 * announcement transaction.
 */
import {
  initSpecterSdk,
  generateSpecterKeys,
  metaAddressFromPublicKeys,
  decapsulate,
  computeViewTag,
  deriveStealthKeys,
  deriveStealthPublic,
  openAnnouncementMetadata,
  type Hex,
} from "@specterpq/sdk";
import type { AnnouncementDto, DiscoveryDto, GenerateKeysResponse, ScanStatsDto } from "@/lib/api";

/** Idempotent WASM init. Safe to call before every operation. */
let initPromise: Promise<void> | null = null;
export function ensureSpecterSdk(): Promise<void> {
  if (!initPromise) {
    initPromise = initSpecterSdk().catch((err) => {
      // Reset so a transient load failure can be retried on the next call.
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

const strip0x = (s: string) => (s.startsWith("0x") ? s.slice(2) : s);
const with0x = (s: string): Hex => (s.startsWith("0x") ? (s as Hex) : (`0x${s}` as Hex));

/**
 * Generate a fresh SPECTER identity entirely in the browser.
 *
 * Returns the same shape the app already uses (`GenerateKeysResponse`), so the
 * rest of the UI, key-file backup, and vault storage are unchanged. `spending_pk`
 * now holds the 33-byte compressed secp256k1 spending public key (protocol v2).
 */
export async function generateKeysLocal(): Promise<GenerateKeysResponse> {
  await ensureSpecterSdk();
  const keys = generateSpecterKeys();
  const meta = metaAddressFromPublicKeys(keys.spending.publicKey, keys.viewing.publicKey);
  // The SDK returns `0x`-prefixed hex; the rest of the app (key files, ENS/IPFS
  // upload, and the server's `MetaAddress::from_hex`/`hex::decode`) expects bare
  // hex with no prefix. Strip it so this is a drop-in for the old server keys.
  return {
    spending_pk: strip0x(keys.spending.publicKey),
    spending_sk: strip0x(keys.spending.secretKey),
    viewing_pk: strip0x(keys.viewing.publicKey),
    viewing_sk: strip0x(keys.viewing.secretKey),
    meta_address: strip0x(meta.hex),
    protocol_version: meta.address.version,
  };
}

/** User-facing guidance shown when protocol-v1 keys are detected. */
export const V1_KEYS_MESSAGE =
  "These are old (v1) keys and are no longer supported. Generate a new key set, " +
  "re-publish your ENS/SuiNS name, and withdraw any funds still sitting on your " +
  "old stealth addresses — v1 stealth keys are not secure.";

/**
 * Detects protocol-v1 key material by size. v2 spending keys are secp256k1
 * (32-byte secret / 33-byte compressed public); v1 used ML-KEM for spending
 * (2400-byte secret / 1184-byte public). Anything that isn't the v2 size is
 * treated as v1/unsupported so the user is told to regenerate rather than
 * silently getting zero scan results.
 */
export function looksLikeV1Keys(k: { spending_sk?: string; spending_pk?: string }): boolean {
  const sk = k.spending_sk ? strip0x(k.spending_sk) : "";
  const pk = k.spending_pk ? strip0x(k.spending_pk) : "";
  if (sk && sk.length !== 64) return true; // v2 secret = 32 bytes
  if (pk && pk.length !== 66) return true; // v2 compressed public = 33 bytes
  return false;
}

/** Keys needed to scan. `spending_sk` is optional: without it the scan is watch-only. */
export interface LocalScanKeys {
  viewing_sk: string;
  spending_pk: string;
  spending_sk?: string;
}

/** Discoveries plus the same stats shape the old server endpoint returned. */
export interface LocalScanResult {
  discoveries: DiscoveryDto[];
  stats: ScanStatsDto;
}

/**
 * Scan a batch of announcements locally. Decapsulation, view-tag filtering,
 * stealth-address derivation, and (when `spending_sk` is supplied) spend-key
 * derivation all happen in-browser. The encrypted `metadata_blob` is decrypted
 * locally to recover the amount / source tx / chain id.
 */
export async function scanAnnouncementsLocal(
  announcements: AnnouncementDto[],
  keys: LocalScanKeys,
): Promise<LocalScanResult> {
  await ensureSpecterSdk();

  const viewingSk = with0x(strip0x(keys.viewing_sk));
  const spendingPk = with0x(strip0x(keys.spending_pk));
  const spendingSk = keys.spending_sk ? with0x(strip0x(keys.spending_sk)) : undefined;

  const started = performance.now();
  const discoveries: DiscoveryDto[] = [];
  let viewTagMatches = 0;
  let scanned = 0;

  for (const ann of announcements) {
    // Only full-ciphertext rows are scannable client-side; hash-only rows
    // (chain-indexed, ciphertext not yet resolved) are skipped, exactly as the
    // previous server scan did.
    const ekHex = ann.ephemeral_key ? strip0x(ann.ephemeral_key) : "";
    if (ekHex.length !== 1088 * 2) continue;
    scanned += 1;

    let sharedSecret: Hex;
    try {
      // ML-KEM decapsulation never "fails" (implicit rejection) — a wrong key
      // yields a pseudo-random secret whose view tag won't match.
      sharedSecret = decapsulate(with0x(ekHex), viewingSk);
    } catch {
      continue; // malformed ciphertext/key size
    }

    if (computeViewTag(sharedSecret) !== ann.view_tag) continue;
    viewTagMatches += 1;

    // Always derive the destination address from the *public* spending key —
    // that is the address the sender actually funded (they only had the public
    // key). When a spending secret is present, derive the private key too and
    // verify it controls that exact address; a mismatch means the loaded
    // spending_pk / spending_sk are not a pair (corrupt/edited key file), so we
    // skip rather than surface a private key for the wrong (empty) address.
    let stealthAddress: string;
    let stealthSui: string;
    let ethPrivateKey = "";
    try {
      const det = deriveStealthPublic(spendingPk, sharedSecret);
      stealthAddress = det.ethAddress;
      stealthSui = det.suiAddress;
      if (spendingSk) {
        const sk = deriveStealthKeys(spendingSk, sharedSecret);
        if (sk.ethAddress.toLowerCase() !== det.ethAddress.toLowerCase()) {
          continue; // spending_pk and spending_sk do not match — not our key
        }
        ethPrivateKey = sk.ethPrivateKey;
      }
    } catch {
      continue; // derivation shouldn't fail for a matched tag; skip defensively
    }

    // Payment amount / source tx / source chain are taken ONLY from the
    // AEAD-authenticated metadata blob — never from the server-supplied
    // plaintext DTO fields, which are unauthenticated and could be forged by a
    // malicious registry. If the blob is absent (e.g. a not-yet-migrated
    // backend) or fails to decrypt, these are simply left empty; discovery of
    // the address + private key still succeeds.
    let paymentTxHash: string | null = null;
    let amount = "";
    let sourceChainId: number | null = null;
    if (ann.metadata_blob) {
      try {
        const meta = openAnnouncementMetadata(with0x(strip0x(ann.metadata_blob)), sharedSecret);
        paymentTxHash = meta.txHash ?? null;
        amount = meta.amount ?? "";
        sourceChainId = typeof meta.sourceChainId === "number" ? meta.sourceChainId : null;
      } catch {
        /* wrong recipient / tampered / not our blob — leave empty */
      }
    }

    discoveries.push({
      stealth_address: stealthAddress,
      stealth_sui_address: stealthSui,
      stealth_sk: ethPrivateKey,
      eth_private_key: ethPrivateKey,
      announcement_id: ann.id,
      timestamp: ann.timestamp,
      channel_id: ann.channel_id ?? null,
      // `tx_hash` is the public on-chain announce() tx (a link target, not a
      // value claim), so the DTO value is fine to surface.
      tx_hash: ann.tx_hash ?? null,
      payment_tx_hash: paymentTxHash,
      amount,
      // Chain is resolved from the authenticated `source_chain_id`; the
      // unauthenticated server chain-name is intentionally not trusted.
      chain: "",
      source_chain_id: sourceChainId,
    });
  }

  return {
    discoveries,
    stats: {
      total_scanned: scanned,
      view_tag_matches: viewTagMatches,
      discoveries: discoveries.length,
      duration_ms: Math.round(performance.now() - started),
      rate: 0,
    },
  };
}
