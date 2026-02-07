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
  options: RequestInit & { query?: Record<string, string | number | undefined> } = {}
): Promise<T> {
  const { query, ...init } = options;
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

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };

  try {
    const res = await fetch(url, { ...init, headers });
    return handleResponse<T>(res);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      throw new ApiError("Cannot reach SPECTER API. Is the backend running? Start with: cargo run --bin specter -- serve --port 3001");
    }
    throw new ApiError(err instanceof Error ? err.message : "Unknown error");
  }
}

export interface HealthResponse {
  status: string;
  version: string;
  uptime_seconds: number;
  announcements_count: number;
  /** When true, backend uses Sepolia ENS */
  use_testnet?: boolean;
}

export interface GenerateKeysResponse {
  spending_pk: string;
  spending_sk: string;
  viewing_pk: string;
  viewing_sk: string;
  meta_address: string;
  view_tag: number;
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
}

export interface CreateStealthResponse {
  stealth_address: string;
  stealth_sui_address: string;
  ephemeral_ciphertext: string;
  view_tag: number;
  announcement: AnnouncementDto;
}

export interface ScanRequest {
  viewing_sk: string;
  spending_pk: string;
  spending_sk: string;
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
  spending_pk: string;
  viewing_pk: string;
  ipfs_cid?: string;
  ipfs_url?: string;
}

export interface ResolveSuinsResponse {
  suins_name: string;
  meta_address: string;
  spending_pk: string;
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

export interface PublishAnnouncementRequest {
  ephemeral_key: string;
  view_tag: number;
  channel_id?: string | null;
  tx_hash: string;
}

export interface PublishAnnouncementResponse {
  id: number;
  success: boolean;
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

export const api = {
  getBaseUrl,

  async health(): Promise<HealthResponse> {
    return request<HealthResponse>("/health");
  },

  async generateKeys(): Promise<GenerateKeysResponse> {
    return request<GenerateKeysResponse>("/api/v1/keys/generate", { method: "POST" });
  },

  async createStealth(body: CreateStealthRequest): Promise<CreateStealthResponse> {
    return request<CreateStealthResponse>("/api/v1/stealth/create", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  async scanPayments(body: ScanRequest): Promise<ScanResponse> {
    return request<ScanResponse>("/api/v1/stealth/scan", {
      method: "POST",
      body: JSON.stringify(body),
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
    });
  },

  async getRegistryStats(): Promise<RegistryStatsResponse> {
    return request<RegistryStatsResponse>("/api/v1/registry/stats");
  },
};
