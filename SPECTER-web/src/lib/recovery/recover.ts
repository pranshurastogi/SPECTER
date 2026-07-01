/**
 * Trustless recovery orchestrator.
 *
 * Given a recipient's keys, this:
 *   1. inits the SPECTER WASM (browser-local crypto),
 *   2. reads every announcement (newest-first) from the chosen source,
 *   3. runs ML-KEM-768 trial-decapsulation + stealth-key derivation for each,
 *   4. for matches, resolves amount + source chain and returns a spendable
 *      secp256k1 private key.
 *
 * Two sources, both keeping the crypto 100% in the browser: `"registry"` (fast,
 * reads SPECTER's public read-only registry) and `"rpc"` (fully trustless —
 * zero SPECTER calls, reads the announcer's logs straight from the chain). The
 * user's keys never leave this page in either mode.
 */

import { formatUnits, type Hex } from "viem";
import {
  getChainDecimals,
  getChainStandard,
  getTxChainFromSourceChainId,
  type TxChain,
} from "@/lib/blockchain/chainRegistry";
import {
  fetchAnnouncements,
  isScanAborted,
  type ChainAnnouncement,
  type ScanProgress,
} from "./announcer";
import { fetchAnnouncementsFromRegistry } from "./registry";
import { SPECTER_API_BASE_URL } from "./config";
import {
  decodeAnnouncementMetadata,
  ensureSdk,
  scanAnnouncement,
} from "./sdk";

/** The keys the recovery scan needs (a subset of a full specter-keys.json). */
export interface RecoveryKeys {
  /** Viewing public key (1184B hex). */
  readonly viewing_pk: string;
  /** Viewing secret key (2400B hex) — decapsulates announcements. */
  readonly viewing_sk: string;
  /** Spending public key (1184B hex) — mixed into stealth derivation. */
  readonly spending_pk: string;
}

/**
 * A lightweight record of one announcement the sweep looked at, streamed to the
 * UI so the (slow) Direct-RPC scan can show live activity — the announced
 * stealth address the scanner is checking, and whether it matched these keys.
 */
export interface ScannedAnnouncement {
  /** Announced stealth address from the on-chain log / registry row, if known. */
  readonly stealthAddress?: string;
  /** Announcement transaction on Monad (for the explorer link). */
  readonly txHash: string;
  /** Block scanned (RPC path) or row-id recency key (registry path). */
  readonly blockNumber: bigint;
  /** True when this announcement belongs to the user — also shown as a full card. */
  readonly matched: boolean;
}

/** A single recovered payment the user can sweep. */
export interface RecoveredPayment {
  /** Stealth EVM address that holds the funds. */
  readonly stealthAddress: string;
  /** 32-byte secp256k1 private key controlling `stealthAddress`. */
  readonly ethPrivateKey: string;
  /** Source chain resolved from the on-chain metadata, if known. */
  readonly chain: TxChain | null;
  /** EIP-155 id from the metadata, if present. */
  readonly sourceChainId?: number;
  /** Payment amount in base units, if present. */
  readonly amount?: bigint;
  /** Human-readable amount (native decimals), if present. */
  readonly amountDisplay?: string;
  /** Native currency symbol for `chain`, if known. */
  readonly currencySymbol?: string;
  /** Source-chain payment tx hash from the metadata, if present. */
  readonly paymentTxHash?: string;
  /** Announcement transaction on Monad. */
  readonly announcementTxHash: Hex;
  readonly blockNumber: bigint;
}

export interface RecoverOptions {
  readonly onProgress?: (p: ScanProgress) => void;
  readonly fromBlock?: bigint;
  /**
   * Announcement source. `"registry"` (default) is the fast SPECTER backend
   * registry with automatic fallback to the trustless RPC sweep on any failure;
   * `"rpc"` forces the zero-SPECTER direct-chain sweep.
   */
  readonly source?: "registry" | "rpc";
  /** Override the registry API base URL (defaults to `SPECTER_API_BASE_URL`). */
  readonly registryUrl?: string;
  /**
   * Direct-RPC sweep direction: `"newest"` (default) walks tip → deploy block so
   * recent payments surface first, `"oldest"` walks deploy block → tip. Ignored
   * by the registry source, which is always fetched newest-first.
   */
  readonly direction?: "newest" | "oldest";
  /** Cancels the scan; propagated to whichever source is fetching. */
  readonly signal?: AbortSignal;
  /**
   * Called the moment a payment is matched, so the UI can reveal recovered
   * stealth addresses + keys live instead of only when the scan finishes.
   */
  readonly onMatch?: (payment: RecoveredPayment) => void;
  /**
   * Called for every announcement the sweep inspects (matched or not), so the
   * UI can show a live feed of what the slow Direct-RPC scan is checking.
   */
  readonly onScanned?: (scanned: ScannedAnnouncement) => void;
}

/** Viewing key pair shape the SDK's `scanAnnouncement` expects. */
type ViewingKeys = Parameters<typeof scanAnnouncement>[1];

/**
 * Trial-decapsulate one announcement against these keys. Returns a spendable
 * `RecoveredPayment` on a match, or `null` (no match / malformed — must never
 * abort the wider scan). The view tag short-circuits ~255/256 non-matches
 * before the expensive ML-KEM work.
 */
function matchAnnouncement(
  ann: ChainAnnouncement,
  viewingKeys: ViewingKeys,
  spendingPk: `0x${string}`,
): RecoveredPayment | null {
  let result: ReturnType<typeof scanAnnouncement>;
  try {
    result = scanAnnouncement(
      { ephemeralCiphertext: ann.ephemeralCiphertext, viewTag: ann.viewTag },
      viewingKeys,
      spendingPk,
    );
  } catch {
    // A malformed announcement should never abort the whole scan.
    return null;
  }
  if (!result.isMatch) return null;

  const { ethAddress, ethPrivateKey } = result.stealthKeys;

  // Amount + source chain: the registry source supplies these already-decoded
  // (on-chain metadata is now an AEAD blob and can't be read here). Otherwise
  // — the direct-RPC path — try decoding them from the raw metadata block.
  let sourceChainId = ann.sourceChainId;
  let amount = ann.amount;
  let paymentTxHash = ann.paymentTxHash;
  if (
    sourceChainId === undefined &&
    amount === undefined &&
    paymentTxHash === undefined &&
    ann.metadata
  ) {
    try {
      const meta = decodeAnnouncementMetadata(ann.metadata);
      sourceChainId = meta.sourceChainId;
      amount = meta.amount ? BigInt(meta.amount) : undefined;
      paymentTxHash = meta.txHash;
    } catch {
      /* metadata absent, encrypted, or too short — reveal the keys anyway */
    }
  }

  const chain = getTxChainFromSourceChainId(sourceChainId);
  const currencySymbol = chain ? getChainStandard(chain).currencySymbol : undefined;
  const amountDisplay =
    amount !== undefined && amount > 0n
      ? formatUnits(amount, getChainDecimals(chain ?? "ethereum"))
      : undefined;

  return {
    stealthAddress: ethAddress,
    ethPrivateKey,
    chain,
    sourceChainId,
    amount,
    amountDisplay,
    currencySymbol,
    paymentTxHash,
    announcementTxHash: ann.txHash,
    blockNumber: ann.blockNumber,
  };
}

/** Normalise a hex key to the `0x`-prefixed form the SDK validators expect. */
function ensure0x(hex: string): `0x${string}` {
  const trimmed = hex.trim();
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

/**
 * Run the full client-side recovery. Returns one entry per announcement that
 * belongs to these keys, newest block first.
 */
export async function recoverPayments(
  keys: RecoveryKeys,
  rpcUrl: string,
  opts: RecoverOptions = {},
): Promise<RecoveredPayment[]> {
  await ensureSdk();

  const viewingKeys = {
    publicKey: ensure0x(keys.viewing_pk),
    secretKey: ensure0x(keys.viewing_sk),
  } as ViewingKeys;
  const spendingPk = ensure0x(keys.spending_pk);

  const source = opts.source ?? "registry";
  const registryUrl = opts.registryUrl ?? SPECTER_API_BASE_URL;

  const recovered: RecoveredPayment[] = [];

  // Match each announcement the instant it's fetched and stream hits to the UI.
  // `scanAnnouncement` is synchronous WASM and JS is single-threaded, so even
  // with the RPC sweep's concurrent fetch workers these run atomically — the
  // crypto simply fills the gaps between network round-trips.
  const fetchOpts = {
    onProgress: opts.onProgress,
    fromBlock: opts.fromBlock,
    signal: opts.signal,
    direction: opts.direction,
    onAnnouncement: (ann: ChainAnnouncement) => {
      const payment = matchAnnouncement(ann, viewingKeys, spendingPk);
      if (payment) {
        recovered.push(payment);
        opts.onMatch?.(payment);
      }
      opts.onScanned?.({
        stealthAddress: ann.stealthAddress,
        txHash: ann.txHash,
        blockNumber: ann.blockNumber,
        matched: payment !== null,
      });
    },
  };

  if (source === "registry") {
    try {
      await fetchAnnouncementsFromRegistry(registryUrl, fetchOpts);
    } catch (err) {
      if (isScanAborted(err)) throw err;
      // The registry is the SPECTER service this page distrusts: if it's unset,
      // down, or errors, recover anyway via the zero-SPECTER chain sweep.
      opts.onProgress?.({
        kind: "status",
        message:
          "SPECTER's registry is unreachable — scanning the chain directly (fully trustless, but slower).",
      });
      await fetchAnnouncements(rpcUrl, fetchOpts);
    }
  } else {
    await fetchAnnouncements(rpcUrl, fetchOpts);
  }

  recovered.sort((a, b) => Number(b.blockNumber - a.blockNumber));
  return recovered;
}
