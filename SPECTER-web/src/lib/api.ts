/** SPECTER API client. Base URL: VITE_API_BASE_URL (default http://localhost:3001). */

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Error code from API response (e.g. ENS_NAME_NOT_FOUND, NO_SPECTER_RECORD). */
  get code(): string | undefined {
    if (this.body && typeof this.body === "object" && "error" in this.body) {
      const err = (this.body as { error?: { code?: string } }).error;
      return err && typeof err === "object" ? err.code : undefined;
    }
    return undefined;
  }
}

function getBaseUrl(): string {
  const url = import.meta.env.VITE_API_BASE_URL;
  if (url && typeof url === "string") {
    return url.replace(/\/$/, "");
  }
  return "http://localhost:3001";
}

function getApiKey(): string | undefined {
  const key = import.meta.env.VITE_API_KEY;
  return key && typeof key === "string" && key.length > 0 ? key : undefined;
}

/**
 * Default request timeout. Publish is slower than everything else because the
 * server relays announce() to Monad and waits for the receipt; scan can churn
 * through thousands of ML-KEM decapsulations.
 */
const DEFAULT_TIMEOUT_MS = 30_000;
const PUBLISH_TIMEOUT_MS = 120_000;
const SCAN_TIMEOUT_MS = 120_000;

async function handleResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    let message = text;
    if (body && typeof body === "object") {
      const obj = body as Record<string, unknown>;
      if (typeof obj.message === "string") {
        message = obj.message;
      } else if (obj.error && typeof obj.error === "object" && typeof (obj.error as Record<string, unknown>).message === "string") {
        message = (obj.error as Record<string, unknown>).message as string;
      } else if (obj.error && typeof obj.error === "string") {
        message = obj.error;
      }
    }
    throw new ApiError(message || `Request failed: ${res.status} ${res.statusText}`, res.status, body);
  }

  return body as T;
}

async function request<T>(
  path: string,
  options: RequestInit & {
    query?: Record<string, string | number | undefined>;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const { query, timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const base = getBaseUrl();
  let url = `${base}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };

  // Production backends gate every mutating endpoint behind X-API-Key.
  const method = (init.method ?? "GET").toUpperCase();
  const apiKey = getApiKey();
  if (apiKey && method !== "GET") {
    headers["X-API-Key"] = apiKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, headers, signal: controller.signal });
    return await handleResponse<T>(res);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(
        `SPECTER API timed out after ${Math.round(timeoutMs / 1000)}s. The request may still complete server-side — retry to check.`
      );
    }
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      throw new ApiError("Cannot reach SPECTER API. Please try again in a moment.");
    }
    throw new ApiError(err instanceof Error ? err.message : "Unknown error");
  } finally {
    clearTimeout(timer);
  }
}

export interface HealthResponse {
  status: string;
  version: string;
  uptime_seconds: number;
  announcements_count: number;
  /** General EVM/Monad testnet flag. */
  use_testnet?: boolean;
  /** When true, backend resolves SuiNS against testnet registry (ENS is always mainnet). */
  use_sui_testnet?: boolean;
}

export interface GenerateKeysResponse {
  /** secp256k1 spending public key (33-byte compressed, hex) — protocol v2. */
  spending_pk: string;
  /** secp256k1 spending secret key (32 bytes, hex). Never leaves the device. */
  spending_sk: string;
  viewing_pk: string;
  viewing_sk: string;
  meta_address: string;
  /** Protocol version of the generated keys (2 for v2). */
  protocol_version?: number;
}

export interface CreateStealthRequest {
  meta_address: string;
  channel_id?: string | null;
}

export interface AnnouncementDto {
  id: number;
  ephemeral_key: string;
  view_tag: number;
  timestamp: number;
  channel_id?: string | null;
  tx_hash?: string | null;
  payment_tx_hash?: string | null;
  amount?: string | null;
  chain?: string | null;
  source_chain_id?: number | null;
  /** AEAD-encrypted metadata blob (hex). Decrypted client-side during scanning. */
  metadata_blob?: string | null;
  /** keccak256(ciphertext) for hash-only chain-indexed rows. */
  ephemeral_key_hash?: string | null;
}

export interface CreateStealthResponse {
  /**
   * Server-held pending-payment identifier. Required when publishing the
   * announcement after the on-chain transaction is confirmed.
   */
  payment_id: string;
  stealth_address: string;
  stealth_sui_address: string;
  ephemeral_ciphertext: string;
  /** Per-payment protocol view tag (informational; bound to payment_id server-side). */
  view_tag: number;
  announcement: AnnouncementDto;
}

/**
 * View-only server scan request. The server endpoint no longer accepts a
 * spending secret key. The app does not use this path — it scans in-browser via
 * `scanAnnouncementsLocal()` so no secret key ever reaches the network.
 */
export interface ScanRequest {
  viewing_sk: string;
  spending_pub: string;
  view_tags?: number[] | null;
  from_timestamp?: number | null;
  to_timestamp?: number | null;
}

export interface DiscoveryDto {
  stealth_address: string;
  stealth_sui_address: string;
  stealth_sk: string;
  eth_private_key: string;
  announcement_id: number;
  timestamp: number;
  channel_id?: string | null;
  /** Monad announce() tx hash from the registry row. */
  tx_hash?: string | null;
  /** Source-chain payment tx hash, decrypted from the metadata blob. */
  payment_tx_hash?: string | null;
  /** Amount in base units (hex uint256 like "0x...de0b6b3a7640000"). May be "" when unavailable. */
  amount: string;
  /** Chain name as stored at publish time (e.g. "monad-testnet", "sui"). May be "". */
  chain: string;
  /** EIP-155 chain ID of the payment's source chain — most reliable chain identifier. */
  source_chain_id?: number | null;
}

export interface ScanStatsDto {
  total_scanned: number;
  view_tag_matches: number;
  discoveries: number;
  duration_ms: number;
  rate: number;
}

export interface ScanResponse {
  discoveries: DiscoveryDto[];
  stats: ScanStatsDto;
}

export interface ResolveEnsResponse {
  ens_name: string;
  meta_address: string;
  /** secp256k1 spending public key (hex) — protocol v2. Display only. */
  spending_pub: string;
  viewing_pk: string;
  ipfs_cid?: string;
  ipfs_url?: string;
}

export interface ResolveSuinsResponse {
  suins_name: string;
  meta_address: string;
  /** secp256k1 spending public key (hex) — protocol v2. Display only. */
  spending_pub: string;
  viewing_pk: string;
  ipfs_cid?: string;
}

export interface UploadIpfsRequest {
  meta_address: string;
  name?: string | null;
}

export interface UploadIpfsResponse {
  cid: string;
  text_record: string;
}

/**
 * Publish a previously-created stealth payment.
 *
 * Preferred path: pass `payment_id` from `CreateStealthResponse` — the server
 * publishes the announcement it built, ensuring the view tag is correct.
 *
 * Fallback path: pass the full `announcement` DTO returned by `/stealth/create`
 * (use only if the server lost the pending entry, e.g. after a restart or
 * 24h TTL expiry). On the fallback path the metadata blob is NOT encrypted.
 *
 * Field semantics (must match `specter-api/src/dto.rs::PublishAnnouncementRequest`):
 *  - `payment_tx_hash`  — the SOURCE-CHAIN payment tx hash. This is what the
 *    server verifies via `CHAIN_RPC_<CHAIN>` and encodes into the encrypted
 *    metadata blob.
 *  - `tx_hash`          — the Monad announce() tx hash. Only required in dev
 *    mode (no relayer); ignored when the server-side relayer is active.
 *  - `amount`           — base units (wei / MIST) as a decimal string, NOT a
 *    human-formatted amount. The server compares it against tx.value.
 *  - `chain`            — backend chain name (e.g. "sepolia", "monad-testnet"),
 *    must match the server's CHAIN_RPC_* map keys.
 *  - `source_chain_id`  — EIP-155 chain ID of the payment's source chain.
 */
export interface PublishAnnouncementRequest {
  payment_id?: string;
  announcement?: AnnouncementDto;
  /** Monad announce tx hash — dev-mode fallback only; ignored when relayer is active. */
  tx_hash?: string | null;
  /** Source-chain payment tx hash — verified server-side when CHAIN_RPC_<CHAIN> is set. */
  payment_tx_hash?: string | null;
  /** EIP-155 chain ID where `payment_tx_hash` was broadcast. */
  source_chain_id?: number | null;
  /** Amount in base units (wei/MIST), decimal string. */
  amount?: string | null;
  /** Backend chain name (e.g. "sepolia", "arbitrum", "monad-testnet", "sui"). */
  chain?: string | null;
  /** Optional ERC-20 token contract for token-payment verification. */
  token?: string | null;
}

export interface PublishAnnouncementResponse {
  id: number;
  success: boolean;
  /** Monad tx hash of the announce() call (present when the relayer broadcast it). */
  monad_tx_hash?: string | null;
}

export interface ListAnnouncementsQuery {
  view_tag?: number;
  offset?: number;
  limit?: number;
  from_timestamp?: number;
  to_timestamp?: number;
}

export interface ListAnnouncementsResponse {
  announcements: AnnouncementDto[];
  total: number;
}

export interface ViewTagCount {
  tag: number;
  count: number;
}

export interface RegistryStatsResponse {
  total_announcements: number;
  view_tag_distribution: ViewTagCount[];
}

// ── sweep records (claim-flow history) ─────────────────────────────────────

/** One swept stealth address inside a claim operation. */
export interface SweepRowDto {
  /** Client-generated UUID for this row (idempotency key). */
  id: string;
  stealth_address: string;
  /** Amount transferred, base units (wei) as a decimal string. */
  amount_base: string;
  /** Network fee deducted, base units (wei) as a decimal string. */
  fee_base: string;
  /** Broadcast tx hash (empty string for skipped rows). */
  tx_hash: string;
  status: "confirmed" | "failed" | "skipped_dust";
}

export interface RecordSweepsRequest {
  receipt_id: string;
  /** SHA-256 of the meta-address bytes, lowercase hex (64 chars). */
  identity_hash: string;
  /** Backend chain name (e.g. "sepolia", "arbitrum", "monad-testnet"). */
  chain: string;
  /** Resolved destination address (0x…). */
  destination: string;
  /** What the user typed (ENS name or the address itself). */
  destination_input: string;
  records: SweepRowDto[];
}

export interface RecordSweepsResponse {
  inserted: number;
}

export interface SweepRecordDto {
  id: string;
  receipt_id: string;
  chain: string;
  stealth_address: string;
  destination: string;
  destination_input: string;
  amount_base: string;
  fee_base: string;
  tx_hash: string;
  status: string;
  created_at: number;
}

export interface ListSweepsResponse {
  sweeps: SweepRecordDto[];
  total: number;
}

export const api = {
  getBaseUrl,

  async health(): Promise<HealthResponse> {
    return request<HealthResponse>("/health");
  },

  /**
   * @deprecated Do NOT use — this generates secret keys on the server. Generate
   * keys in-browser with `generateKeysLocal()` from `@/lib/crypto/specter`.
   * Kept only for reference; no app code should call it.
   */
  async generateKeys(): Promise<GenerateKeysResponse> {
    return request<GenerateKeysResponse>("/api/v1/keys/generate", { method: "POST" });
  },

  async createStealth(body: CreateStealthRequest): Promise<CreateStealthResponse> {
    return request<CreateStealthResponse>("/api/v1/stealth/create", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /**
   * @deprecated View-only server scan. The app scans in-browser via
   * `scanAnnouncementsLocal()` so the viewing/spending secrets never leave the
   * device. Retained only for non-secret/watch-only server-side use cases.
   */
  async scanPayments(body: ScanRequest): Promise<ScanResponse> {
    return request<ScanResponse>("/api/v1/stealth/scan", {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: SCAN_TIMEOUT_MS,
    });
  },

  async resolveEns(name: string): Promise<ResolveEnsResponse> {
    const encoded = encodeURIComponent(name);
    return request<ResolveEnsResponse>(`/api/v1/ens/resolve/${encoded}`);
  },

  async resolveSuins(name: string): Promise<ResolveSuinsResponse> {
    const encoded = encodeURIComponent(name);
    return request<ResolveSuinsResponse>(`/api/v1/suins/resolve/${encoded}`);
  },

  async uploadIpfs(body: UploadIpfsRequest): Promise<UploadIpfsResponse> {
    return request<UploadIpfsResponse>("/api/v1/ipfs/upload", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** URL for viewing IPFS content via backend (no direct gateway) */
  ipfsUrl(cid: string): string {
    const parsed = cid.replace(/^ipfs:\/\//, "").replace(/^\/ipfs\//, "").trim();
    return `${getBaseUrl()}/api/v1/ipfs/${encodeURIComponent(parsed)}`;
  },

  async listAnnouncements(query?: ListAnnouncementsQuery): Promise<ListAnnouncementsResponse> {
    return request<ListAnnouncementsResponse>("/api/v1/registry/announcements", {
      query: query as Record<string, string | number | undefined>,
    });
  },

  async publishAnnouncement(body: PublishAnnouncementRequest): Promise<PublishAnnouncementResponse> {
    return request<PublishAnnouncementResponse>("/api/v1/registry/announcements", {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: PUBLISH_TIMEOUT_MS,
    });
  },

  async getRegistryStats(): Promise<RegistryStatsResponse> {
    return request<RegistryStatsResponse>("/api/v1/registry/stats");
  },

  /** Records the rows of a completed claim (idempotent per row id). */
  async recordSweeps(body: RecordSweepsRequest): Promise<RecordSweepsResponse> {
    return request<RecordSweepsResponse>("/api/v1/sweeps", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** Sweep history for an identity (pre-hashed client-side), newest first. */
  async listSweeps(identityHash: string): Promise<ListSweepsResponse> {
    return request<ListSweepsResponse>(
      `/api/v1/sweeps/${encodeURIComponent(identityHash)}`
    );
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // YELLOW NETWORK API
  // ═══════════════════════════════════════════════════════════════════════════

  yellow: {
    /** Get Yellow Network configuration from backend */
    async getConfig(): Promise<YellowConfigResponse> {
      return request<YellowConfigResponse>("/api/v1/yellow/config");
    },

    /** Create a private channel with SPECTER stealth address */
    async createChannel(body: YellowCreateChannelRequest): Promise<YellowChannelResponse> {
      return request<YellowChannelResponse>("/api/v1/yellow/channel/create", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    /**
     * @deprecated DO NOT USE — this would send `viewing_sk`/`spending_sk` to the
     * server. Channel discovery must be done client-side via the SDK, like
     * `scanAnnouncementsLocal`. Currently unused; kept only to avoid a silent API
     * break. Wiring this up would reintroduce the server-custody security issue.
     */
    async discoverChannels(body: YellowDiscoverRequest): Promise<YellowDiscoverResponse> {
      return request<YellowDiscoverResponse>("/api/v1/yellow/channel/discover", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    /** Fund an existing channel */
    async fundChannel(body: YellowFundRequest): Promise<YellowChannelResponse> {
      return request<YellowChannelResponse>("/api/v1/yellow/channel/fund", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    /** Close a channel and settle on-chain */
    async closeChannel(body: YellowCloseRequest): Promise<YellowCloseResponse> {
      return request<YellowCloseResponse>("/api/v1/yellow/channel/close", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    /** Get status of a specific channel */
    async getChannelStatus(channelId: string): Promise<YellowChannelStatusResponse> {
      return request<YellowChannelStatusResponse>(`/api/v1/yellow/channel/${encodeURIComponent(channelId)}/status`);
    },

    /** Execute an off-chain transfer */
    async transfer(body: YellowTransferRequest): Promise<YellowTransferResponse> {
      return request<YellowTransferResponse>("/api/v1/yellow/transfer", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// YELLOW NETWORK TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface YellowConfigResponse {
  ws_url: string;
  chain_id: number;
  custody_address: string;
  adjudicator_address: string;
}

export interface YellowCreateChannelRequest {
  recipient: string;
  token: string;
  amount: string;
  wallet_address: string;
  wallet_private_key?: string;
}

export interface YellowChannelResponse {
  channel_id: string;
  stealth_address: string;
  tx_hash: string;
  announcement?: {
    ephemeral_key: string;
    view_tag: number;
    channel_id: string;
  };
}

export interface YellowDiscoverRequest {
  viewing_sk: string;
  spending_pk: string;
  spending_sk: string;
}

export interface YellowDiscoverResponse {
  channels: Array<{
    channel_id: string;
    stealth_address: string;
    stealth_private_key: string;
    eth_private_key: string;
    discovered_at: number;
    status?: string;
    amount?: string;
  }>;
}

export interface YellowFundRequest {
  channel_id: string;
  amount: string;
  wallet_address: string;
}

export interface YellowCloseRequest {
  channel_id: string;
  wallet_address: string;
}

export interface YellowCloseResponse {
  channel_id: string;
  close_tx_hash: string;
  final_balances: Array<{
    participant: string;
    amount: string;
  }>;
}

export interface YellowChannelStatusResponse {
  channel_id: string;
  status: "open" | "closed" | "pending" | "resizing";
  amount: string;
  token: string;
  chain_id: number;
  participant: string;
  version: number;
}

export interface YellowTransferRequest {
  channel_id: string;
  destination: string;
  amount: string;
  asset: string;
}

export interface YellowTransferResponse {
  success: boolean;
  new_balance: string;
}
