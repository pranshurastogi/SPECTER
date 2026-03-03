/**
 * Unified Yellow Network client using @erc7824/nitrolite SDK directly over WebSocket.
 * Manages the entire lifecycle: config, auth, channels, transfers, close, withdraw.
 */

import {
  type Address,
  type Hash,
  type Hex,
  type WalletClient,
  type Account,
  type Chain,
  type Transport,
  type ParseAccount,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  NitroliteClient,
  WalletStateSigner,
  createAuthVerifyMessageFromChallenge,
  createEIP712AuthMessageSigner,
  createECDSAMessageSigner,
  createAuthRequestMessage,
  createCreateChannelMessage,
  createResizeChannelMessage,
  createCloseChannelMessage,
  createGetConfigMessage,
  createGetLedgerBalancesMessage,
  createGetChannelsMessage,
  createTransferMessage,
  createPingMessage,
  parseCreateChannelResponse,
  parseResizeChannelResponse,
  parseCloseChannelResponse,
  parseGetConfigResponse,
  parseGetLedgerBalancesResponse,
  parseGetChannelsResponse,
  parseAuthChallengeResponse,
  RPCMethod,
  type CreateChannelParams,
  type CloseChannelParams,
  type ResizeChannelParams,
  type FinalState,
  type UnsignedState,
  type Channel,
  type PartialEIP712AuthMessage,
  type EIP712AuthDomain,
  type MessageSigner,
  type RPCNetworkInfo,
  type RPCBalance,
  type RPCChannelUpdateWithWallet,
  type RPCAsset,
  type StateIntent,
  type AuthRequestParams,
} from "@erc7824/nitrolite";
import { publicClient } from "./viemClient";
import { chain } from "./chainConfig";

// ── Constants ────────────────────────────────────────────────────────────────

const _isTestnet =
  import.meta.env.VITE_USE_TESTNET === "true" ||
  import.meta.env.VITE_USE_TESTNET === "1";

const WS_URL: string =
  import.meta.env.VITE_YELLOW_WS_URL ||
  (_isTestnet
    ? "wss://clearnet-sandbox.yellow.com/ws"
    : "wss://clearnet.yellow.com/ws");
const CUSTODY_ADDRESS: Address = "0x019B65A265EB3363822f2752141b3dF16131b262";
const ADJUDICATOR_ADDRESS: Address = "0x7c7ccbc98469190849BCC6c926307794fDfB11F2";
const APPLICATION_NAME = "yellow_demo";
const AUTH_SCOPE = "console";

// ── Types ────────────────────────────────────────────────────────────────────

export interface YellowConfig {
  brokerAddress: Address;
  networks: RPCNetworkInfo[];
  assets: RPCAsset[];
}

export interface ChannelInfo {
  channelId: Hex;
  participant: Address;
  status: string;
  token: Address;
  amount: string;
  chainId: number;
  version: number;
  wallet?: Address;
}

export interface LedgerBalance {
  asset: string;
  amount: string;
}

export type YellowEventType =
  | "status"
  | "log"
  | "channels"
  | "balances"
  | "config"
  | "error";

export type LogLevel = "info" | "warn" | "error";

export interface YellowEvent {
  type: YellowEventType;
  timestamp: number;
  /** For log events */
  level?: LogLevel;
  message?: string;
  /** For status events */
  connectionStatus?: YellowConnectionStatus;
  /** For channels events */
  channels?: ChannelInfo[];
  /** For balances events */
  balances?: LedgerBalance[];
  /** For config events */
  config?: YellowConfig;
}

export enum YellowConnectionStatus {
  Disconnected = "disconnected",
  Connecting = "connecting",
  Authenticating = "authenticating",
  WaitingForSignature = "waiting_for_signature",
  Connected = "connected",
  Error = "error",
}

type EventCallback = (event: YellowEvent) => void;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Map a raw server channel object to ChannelInfo.
 * The server sends snake_case; the SDK parser converts to camelCase.
 * We handle both to be safe.
 */
function mapChannel(ch: any): ChannelInfo {
  return {
    channelId: (ch.channelId ?? ch.channel_id) as Hex,
    participant: ch.participant as Address,
    status: ch.status,
    token: ch.token as Address,
    amount: String(ch.amount ?? 0),
    chainId: ch.chainId ?? ch.chain_id,
    version: ch.version,
    wallet: ch.wallet as Address | undefined,
  };
}

// ── YellowClient ─────────────────────────────────────────────────────────────

export class YellowClient {
  private ws: WebSocket | null = null;
  private sessionSigner: MessageSigner | null = null;
  private sessionAddress: Address | null = null;
  private nitroliteClient: NitroliteClient | null = null;
  private walletClient: WalletClient<Transport, Chain, ParseAccount<Account>> | null = null;
  private connectedAddress: Address | null = null;
  private listeners: EventCallback[] = [];
  private status: YellowConnectionStatus = YellowConnectionStatus.Disconnected;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private config: YellowConfig | null = null;
  private assets: RPCAsset[] = [];

  // ── Event system ─────────────────────────────────────────────────────────

  onEvent(callback: EventCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  private emit(event: YellowEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // ignore listener errors
      }
    }
  }

  private log(level: LogLevel, message: string): void {
    this.emit({
      type: "log",
      timestamp: Date.now(),
      level,
      message,
    });
  }

  private setStatus(status: YellowConnectionStatus): void {
    this.status = status;
    this.emit({
      type: "status",
      timestamp: Date.now(),
      connectionStatus: status,
    });
  }

  getStatus(): YellowConnectionStatus {
    return this.status;
  }

  getConfig(): YellowConfig | null {
    return this.config;
  }

  getAssets(): RPCAsset[] {
    return this.assets;
  }

  /** Returns the main wallet address that authenticated with Yellow. */
  getConnectedAddress(): Address | null {
    return this.connectedAddress;
  }

  /** Find the supported token address for a given chain ID (e.g. Sepolia). */
  getTokenForChain(chainId: number): Address | null {
    const asset = this.assets.find((a) => a.chainId === chainId);
    return asset?.token ?? null;
  }

  /**
   * Filter channels so only those belonging to the connected wallet are returned.
   * The clearnode sandbox returns ALL channels from ALL wallets; we must filter client-side.
   */
  private filterChannelsByWallet(channels: ChannelInfo[]): ChannelInfo[] {
    if (!this.connectedAddress) return channels;
    const addr = this.connectedAddress.toLowerCase();
    return channels.filter((ch) => {
      const wallet = ch.wallet?.toLowerCase();
      const participant = ch.participant?.toLowerCase();
      if (wallet) return wallet === addr;
      if (participant) return participant === addr;
      return true;
    });
  }

  // ── Config fetch (one-shot WS) ──────────────────────────────────────────

  async fetchConfig(): Promise<YellowConfig> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Config fetch timeout (10s)"));
      }, 10000);

      ws.onopen = async () => {
        try {
          const dummyKey = generatePrivateKey();
          const dummySigner = createECDSAMessageSigner(dummyKey);
          const msg = await createGetConfigMessage(dummySigner);
          ws.send(msg);
        } catch (err) {
          clearTimeout(timeout);
          ws.close();
          reject(err);
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const raw = event.data as string;
          const parsed = JSON.parse(raw);
          const method = parsed?.res?.[1];

          if (method === RPCMethod.GetConfig) {
            clearTimeout(timeout);
            const configRes = parseGetConfigResponse(raw);
            const config: YellowConfig = {
              brokerAddress: configRes.params.brokerAddress,
              networks: configRes.params.networks ?? [],
              assets: [],
            };
            ws.close();
            this.config = config;
            this.emit({ type: "config", timestamp: Date.now(), config });
            resolve(config);
          } else if (method === RPCMethod.Error) {
            clearTimeout(timeout);
            ws.close();
            reject(new Error("Config fetch error from server"));
          }
        } catch (err) {
          clearTimeout(timeout);
          ws.close();
          reject(err);
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket connection error during config fetch"));
      };
    });
  }

  // ── Full auth connect ────────────────────────────────────────────────────

  async connect(
    walletClient: WalletClient<Transport, Chain, ParseAccount<Account>>
  ): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.log("warn", "Already connected — disconnecting first");
      this.disconnect();
    }

    this.walletClient = walletClient;
    const account = walletClient.account;
    if (!account) throw new Error("Wallet has no account — ensure wallet is connected");

    this.connectedAddress = account.address;
    this.setStatus(YellowConnectionStatus.Connecting);
    this.log("info", `Connecting for wallet: ${account.address}`);
    this.log("info", "Generating session key...");

    // Generate ephemeral session key
    const sessionPrivateKey = generatePrivateKey();
    const sessionAccount = privateKeyToAccount(sessionPrivateKey);
    this.sessionSigner = createECDSAMessageSigner(sessionPrivateKey);
    this.sessionAddress = sessionAccount.address;

    this.log("info", `Session key: ${sessionAccount.address}`);
    this.log("info", `Wallet: ${account.address}`);

    // EIP-712 auth params
    const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;
    const authAllowances = [{ asset: "ytest.usd", amount: "1000000000" }];

    this.log("info", `Auth params: app=${APPLICATION_NAME} scope=${AUTH_SCOPE} expires=${expiresAtSec}`);

    const partialAuthMessage: PartialEIP712AuthMessage = {
      scope: AUTH_SCOPE,
      session_key: sessionAccount.address,
      expires_at: BigInt(expiresAtSec),
      allowances: authAllowances,
    };
    const authDomain: EIP712AuthDomain = { name: APPLICATION_NAME };
    const eip712AuthSigner = createEIP712AuthMessageSigner(
      walletClient,
      partialAuthMessage,
      authDomain
    );

    // Init NitroliteClient for on-chain operations
    const network = this.config?.networks?.find((n) => n.chainId === chain.id);
    const custodyAddr = network?.custodyAddress ?? CUSTODY_ADDRESS;
    const adjudicatorAddr = network?.adjudicatorAddress ?? ADJUDICATOR_ADDRESS;

    this.nitroliteClient = new NitroliteClient({
      publicClient,
      walletClient,
      stateSigner: new WalletStateSigner(walletClient),
      addresses: {
        custody: custodyAddr,
        adjudicator: adjudicatorAddr,
      },
      chainId: chain.id,
      challengeDuration: 3600n,
    } as ConstructorParameters<typeof NitroliteClient>[0]);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;

      const timeout = setTimeout(() => {
        this.setStatus(YellowConnectionStatus.Error);
        this.log("error", "Connection timeout (30s) — check network and try again");
        ws.close();
        reject(new Error("Yellow connection timeout after 30s"));
      }, 30000);

      ws.onopen = async () => {
        try {
          this.setStatus(YellowConnectionStatus.Authenticating);
          this.log("info", "WebSocket connected — sending auth_request...");

          // Build auth_request using SDK (correct serialisation, BigInt→Number)
          const authReqParams: AuthRequestParams = {
            address: account.address,
            application: APPLICATION_NAME,
            session_key: sessionAccount.address,
            allowances: authAllowances,
            expires_at: BigInt(expiresAtSec),
            scope: AUTH_SCOPE,
          };
          const authMsg = await createAuthRequestMessage(authReqParams);

          // Log the FULL message for debugging
          this.log("info", `auth_request: ${authMsg}`);
          ws.send(authMsg);
        } catch (err) {
          clearTimeout(timeout);
          this.setStatus(YellowConnectionStatus.Error);
          this.log("error", `Failed to build/send auth_request: ${err}`);
          ws.close();
          reject(err);
        }
      };

      ws.onmessage = async (event: MessageEvent) => {
        const raw = event.data as string;
        try {
          const parsed = JSON.parse(raw);
          const method = parsed?.res?.[1];

          this.log("info", `WS ← method=${method}`);

          // Assets broadcast (welcome message from server)
          if (method === RPCMethod.Assets) {
            try {
              const rawAssets = parsed?.res?.[2]?.assets;
              if (Array.isArray(rawAssets)) {
                this.assets = rawAssets.map((a: any) => ({
                  token: a.token,
                  chainId: a.chain_id ?? a.chainId,
                  symbol: a.symbol,
                  decimals: a.decimals,
                }));
                const assetList = this.assets.map(a => `${a.symbol}@${a.chainId}=${a.token}`).join(", ");
                this.log("info", `Assets: ${this.assets.length} — ${assetList}`);
                if (!this.config) {
                  this.config = { brokerAddress: "0x" as Address, networks: [], assets: this.assets };
                } else {
                  this.config.assets = this.assets;
                }
                this.emit({ type: "config", timestamp: Date.now(), config: this.config });
              }
            } catch {
              this.log("warn", "Failed to parse assets broadcast");
            }
            return;
          }

          // Ignore keepalive and push broadcasts during auth
          if (
            method === RPCMethod.Pong ||
            method === RPCMethod.ChannelsUpdate ||
            method === RPCMethod.BalanceUpdate
          ) {
            return;
          }

          // Auth challenge → sign with main wallet (EIP-712)
          if (method === RPCMethod.AuthChallenge) {
            this.setStatus(YellowConnectionStatus.WaitingForSignature);
            this.log("info", "✋ Auth challenge received — please sign in your wallet...");
            try {
              const challengeRes = parseAuthChallengeResponse(raw);
              const challenge = challengeRes.params.challengeMessage;
              this.log("info", `Challenge: ${challenge}`);
              const verifyMsg = await createAuthVerifyMessageFromChallenge(
                eip712AuthSigner,
                challenge
              );
              ws.send(verifyMsg);
              this.log("info", "Signature sent — waiting for server confirmation...");
            } catch (signErr) {
              clearTimeout(timeout);
              this.setStatus(YellowConnectionStatus.Error);
              const msg = String(signErr);
              if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("denied")) {
                this.log("error", "Wallet signature rejected by user");
                reject(new Error("User rejected the signature request"));
              } else {
                this.log("error", `Failed to sign auth challenge: ${signErr}`);
                reject(new Error("Auth signature failed — see log for details"));
              }
              ws.close();
              return;
            }
            return;
          }

          // Auth verify response
          if (method === RPCMethod.AuthVerify) {
            const params = parsed?.res?.[2];
            if (params?.success) {
              clearTimeout(timeout);
              this.setStatus(YellowConnectionStatus.Connected);
              this.log("info", `✓ Authenticated! session_key=${params.session_key ?? this.sessionAddress}`);
              this.startPing();
              this.setupMessageHandler();
              resolve();
            } else {
              clearTimeout(timeout);
              this.setStatus(YellowConnectionStatus.Error);
              const reason = params?.message ?? params?.error ?? "unknown reason";
              this.log("error", `Authentication rejected: ${reason}`);
              ws.close();
              reject(new Error(`Authentication failed: ${reason}`));
            }
            return;
          }

          // Server error during auth
          if (method === RPCMethod.Error) {
            const errParams = parsed?.res?.[2];
            const errMsg = errParams?.error ?? errParams?.message ?? "Unknown server error";
            clearTimeout(timeout);
            this.setStatus(YellowConnectionStatus.Error);
            this.log("error", `Server error during auth: ${errMsg} | full=${JSON.stringify(errParams)}`);
            ws.close();
            // Give user a helpful message
            if (errMsg.toLowerCase().includes("parse")) {
              reject(new Error(
                `Server rejected auth parameters ("${errMsg}"). ` +
                "Try disconnecting and reconnecting — there may be an existing active session."
              ));
            } else {
              reject(new Error(errMsg));
            }
            return;
          }
        } catch (err) {
          this.log("warn", `Unexpected message during auth: ${raw.slice(0, 100)} — ${err}`);
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        this.setStatus(YellowConnectionStatus.Error);
        this.log("error", "WebSocket connection error — check network");
        reject(new Error("WebSocket connection failed"));
      };

      ws.onclose = () => {
        if (this.status === YellowConnectionStatus.Connected) {
          this.setStatus(YellowConnectionStatus.Disconnected);
          this.log("warn", "Connection closed");
        }
        this.stopPing();
      };
    });
  }

  // ── Post-auth message handler ────────────────────────────────────────────

  private setupMessageHandler(): void {
    if (!this.ws) return;

    this.ws.onmessage = (event: MessageEvent) => {
      const raw = event.data as string;
      try {
        const parsed = JSON.parse(raw);
        const method = parsed?.res?.[1];

        switch (method) {
          case RPCMethod.GetLedgerBalances: {
            try {
              const res = parseGetLedgerBalancesResponse(raw);
              const balances: LedgerBalance[] = (res.params.ledgerBalances ?? []).map(
                (b: RPCBalance) => ({
                  asset: b.asset,
                  amount: b.amount,
                })
              );
              this.emit({ type: "balances", timestamp: Date.now(), balances });
              this.log("info", `Ledger balances: ${balances.map((b) => `${b.asset}=${b.amount}`).join(", ") || "none"}`);
            } catch (e) {
              this.log("warn", `Failed to parse ledger balances: ${e}`);
            }
            break;
          }

          case RPCMethod.GetChannels: {
            try {
              // Try SDK parser first (handles snake_case → camelCase via Zod transforms)
              let allChannels: ChannelInfo[];
              try {
                const res = parseGetChannelsResponse(raw);
                allChannels = (res.params.channels ?? []).map(mapChannel);
              } catch {
                // Fallback: parse raw JSON directly with snake_case support
                const rawChannels = parsed?.res?.[2]?.channels ?? [];
                allChannels = rawChannels.map(mapChannel);
              }
              const channels = this.filterChannelsByWallet(allChannels);
              this.emit({ type: "channels", timestamp: Date.now(), channels });
              this.log("info", `Channels: ${channels.length} yours / ${allChannels.length} total on server`);
            } catch (e) {
              this.log("warn", `Failed to parse channels response: ${e}`);
            }
            break;
          }

          case RPCMethod.ChannelsUpdate: {
            // Server push (method = 'channels')
            const rawChans = parsed?.res?.[2]?.channels;
            if (Array.isArray(rawChans)) {
              const allChannels: ChannelInfo[] = rawChans.map(mapChannel);
              const channels = this.filterChannelsByWallet(allChannels);
              this.emit({ type: "channels", timestamp: Date.now(), channels });
              this.log("info", `Channel push: ${channels.length} yours / ${allChannels.length} total`);
            }
            break;
          }

          case RPCMethod.BalanceUpdate: {
            const updates = parsed?.res?.[2]?.balanceUpdates;
            if (Array.isArray(updates)) {
              const balances: LedgerBalance[] = updates.map((b: RPCBalance) => ({
                asset: b.asset,
                amount: b.amount,
              }));
              this.emit({ type: "balances", timestamp: Date.now(), balances });
              this.log("info", `Balance update: ${balances.map((b) => `${b.asset}=${b.amount}`).join(", ")}`);
            }
            break;
          }

          case RPCMethod.CreateChannel:
          case RPCMethod.ResizeChannel:
          case RPCMethod.CloseChannel:
          case RPCMethod.Transfer: {
            // Handled by waitForResponse in each operation method
            this.log("info", `${method} response received`);
            break;
          }

          case RPCMethod.TransferNotification: {
            const txs = parsed?.res?.[2]?.transactions;
            if (Array.isArray(txs) && txs.length > 0) {
              this.log("info", `Transfer notification: ${txs.length} tx(s)`);
            }
            break;
          }

          case RPCMethod.Pong: {
            break;
          }

          case RPCMethod.Error: {
            const errMsg = parsed?.res?.[2]?.error ?? "Unknown server error";
            this.log("error", `Server error: ${errMsg}`);
            this.emit({ type: "error", timestamp: Date.now(), message: errMsg });
            break;
          }

          default: {
            if (method) this.log("info", `Unhandled message: ${method}`);
            break;
          }
        }
      } catch {
        this.log("warn", `Unparseable message: ${raw.slice(0, 80)}`);
      }
    };
  }

  // ── Keepalive ────────────────────────────────────────────────────────────

  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(async () => {
      if (this.ws?.readyState === WebSocket.OPEN && this.sessionSigner) {
        try {
          const msg = await createPingMessage(this.sessionSigner);
          this.ws.send(msg);
        } catch {
          // ignore ping errors
        }
      }
    }, 25000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ── Send WS message helper ──────────────────────────────────────────────

  private sendWS(message: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to Yellow Network — please reconnect");
    }
    this.ws.send(message);
  }

  private waitForResponse(method: RPCMethod, timeoutMs = 15000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("Not connected"));
        return;
      }
      const timeout = setTimeout(() => {
        this.ws?.removeEventListener("message", handler);
        reject(new Error(`Timeout waiting for ${method} response after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      const handler = (event: MessageEvent) => {
        try {
          const raw = event.data as string;
          const parsed = JSON.parse(raw);
          const resMethod = parsed?.res?.[1];
          if (resMethod === method) {
            clearTimeout(timeout);
            this.ws?.removeEventListener("message", handler);
            resolve(raw);
          } else if (resMethod === RPCMethod.Error) {
            clearTimeout(timeout);
            this.ws?.removeEventListener("message", handler);
            const errMsg = parsed?.res?.[2]?.error ?? parsed?.res?.[2]?.message ?? "Server error";
            reject(new Error(errMsg));
          }
        } catch {
          // ignore non-JSON
        }
      };
      this.ws.addEventListener("message", handler);
    });
  }

  // ── Ledger balances ──────────────────────────────────────────────────────

  async getLedgerBalances(): Promise<LedgerBalance[]> {
    if (!this.sessionSigner) throw new Error("Not authenticated");
    this.log("info", "Fetching ledger balances...");
    const msg = await createGetLedgerBalancesMessage(this.sessionSigner);
    const responsePromise = this.waitForResponse(RPCMethod.GetLedgerBalances);
    this.sendWS(msg);
    const raw = await responsePromise;
    try {
      const res = parseGetLedgerBalancesResponse(raw);
      return (res.params.ledgerBalances ?? []).map((b: RPCBalance) => ({
        asset: b.asset,
        amount: b.amount,
      }));
    } catch {
      // fallback parse
      const parsed = JSON.parse(raw);
      return (parsed?.res?.[2]?.balances ?? parsed?.res?.[2]?.ledger_balances ?? []).map(
        (b: any) => ({ asset: b.asset, amount: String(b.amount) })
      );
    }
  }

  // ── Get channels ─────────────────────────────────────────────────────────

  async getChannels(): Promise<ChannelInfo[]> {
    if (!this.sessionSigner) throw new Error("Not authenticated");
    this.log("info", "Fetching channels...");
    const msg = await createGetChannelsMessage(this.sessionSigner);
    const responsePromise = this.waitForResponse(RPCMethod.GetChannels);
    this.sendWS(msg);
    const raw = await responsePromise;

    let allChannels: ChannelInfo[];
    try {
      const res = parseGetChannelsResponse(raw);
      allChannels = (res.params.channels ?? []).map(mapChannel);
    } catch {
      // SDK parser failed → parse raw JSON with snake_case support
      const parsed = JSON.parse(raw);
      allChannels = (parsed?.res?.[2]?.channels ?? []).map(mapChannel);
    }

    const filtered = this.filterChannelsByWallet(allChannels);
    this.log("info", `getChannels: ${filtered.length} yours / ${allChannels.length} total`);
    return filtered;
  }

  // ── Create channel ───────────────────────────────────────────────────────

  async createChannel(
    token: Address,
    _depositAmount: bigint
  ): Promise<{ channelId: Hex; txHash: Hash }> {
    if (!this.sessionSigner || !this.nitroliteClient || !this.walletClient) {
      throw new Error("Not authenticated");
    }

    this.log("info", `Requesting channel creation for token ${token}...`);

    // 1. Request channel params from ClearNode
    const createMsg = await createCreateChannelMessage(this.sessionSigner, {
      chain_id: chain.id,
      token,
    });
    const responsePromise = this.waitForResponse(RPCMethod.CreateChannel, 30000);
    this.sendWS(createMsg);
    this.log("info", "Waiting for server channel params...");
    const raw = await responsePromise;

    // 2. Parse response — support both camelCase (SDK) and snake_case (server raw)
    const parsedRaw = JSON.parse(raw);
    const resParams = parsedRaw?.res?.[2];

    const channelId_: Hex = (resParams?.channelId ?? resParams?.channel_id) as Hex;
    const serverSig: Hex = (resParams?.serverSignature ?? resParams?.server_signature) as Hex;
    const channelData = resParams?.channel;
    const stateData = resParams?.state;

    this.log("info", `Channel params from server: id=${channelId_?.slice(0, 10)}..., allocations=${JSON.stringify(stateData?.allocations)}`);

    if (!channelData || !stateData || !serverSig) {
      // Fallback: use SDK parser
      this.log("warn", "Using SDK parser for createChannel response");
      const createRes = parseCreateChannelResponse(raw);
      const pr = createRes.params as any;
      const fallbackToken = pr.state?.allocations?.[0]?.token ?? token;
      const channelObj: Channel = {
        participants: pr.channel.participants,
        adjudicator: pr.channel.adjudicator,
        challenge: BigInt(pr.channel.challenge),
        nonce: BigInt(pr.channel.nonce),
      };
      const allocations = (pr.state?.allocations ?? []).map((a: any) => ({
        destination: a.destination as Address,
        token: (a.token ?? fallbackToken) as Address,
        amount: BigInt(a.amount ?? 0),
      }));
      const unsignedInitialState: UnsignedState = {
        intent: pr.state.intent as StateIntent,
        version: BigInt(pr.state.version),
        data: pr.state.stateData ?? pr.state.state_data,
        allocations,
      };
      this.log("info", "Submitting createChannel on-chain (SDK path)...");
      const result = await this.nitroliteClient.createChannel({
        channel: channelObj,
        unsignedInitialState,
        serverSignature: pr.serverSignature,
      } as CreateChannelParams);
      const txHash: Hash = typeof result === "string" ? result : (result as any).txHash ?? result;
      this.log("info", `✓ Channel created on-chain | TX: ${txHash}`);
      return { channelId: pr.channelId ?? pr.channel_id, txHash };
    }

    // 3. Build Channel object
    const tokenAddr: Address = stateData?.allocations?.[0]?.token ?? token;
    const channelObj: Channel = {
      participants: channelData.participants as Address[],
      adjudicator: channelData.adjudicator as Address,
      challenge: BigInt(channelData.challenge ?? channelData.challenge_duration ?? 3600),
      nonce: BigInt(channelData.nonce),
    };

    // 4. Use server-provided allocations (typically 0-amount; funding happens via resize from Unified Balance)
    const stateDataHex: Hex = (stateData.stateData ?? stateData.state_data ?? "0x") as Hex;
    const allocations = (stateData.allocations ?? []).map((a: any) => ({
      destination: a.destination as Address,
      token: (a.token ?? tokenAddr) as Address,
      amount: BigInt(a.amount ?? 0),
    }));

    const unsignedInitialState: UnsignedState = {
      intent: stateData.intent as StateIntent,
      version: BigInt(stateData.version),
      data: stateDataHex,
      allocations,
    };

    const createChannelParams: CreateChannelParams = {
      channel: channelObj,
      unsignedInitialState,
      serverSignature: serverSig,
    };

    // 5. Submit on-chain (no ERC-20 deposit needed — Unified Balance funds via resize later)
    this.log("info", "Submitting createChannel on-chain...");
    const result = await this.nitroliteClient.createChannel(createChannelParams);
    const channelIdResult: Hex = ((result as any)?.channelId ?? channelId_) as Hex;
    const txHash: Hash = typeof result === "string" ? result : (result as any).txHash ?? result;

    this.log("info", `✓ Channel created on-chain! ID: ${channelIdResult?.slice(0, 10)}... | TX: ${txHash}`);

    return { channelId: channelIdResult, txHash };
  }

  // ── Resize channel ───────────────────────────────────────────────────────

  async resizeChannel(
    channelId: Hex,
    allocateAmount: bigint
  ): Promise<{ txHash: Hash }> {
    if (!this.sessionSigner || !this.nitroliteClient || !this.walletClient) {
      throw new Error("Not authenticated");
    }

    this.log("info", `Resizing channel ${channelId.slice(0, 10)}... allocate=${allocateAmount}`);

    const resizeMsg = await createResizeChannelMessage(this.sessionSigner, {
      channel_id: channelId,
      allocate_amount: allocateAmount,
      funds_destination: this.walletClient.account.address,
    });
    const responsePromise = this.waitForResponse(RPCMethod.ResizeChannel, 30000);
    this.sendWS(resizeMsg);
    this.log("info", "Waiting for resize params from server...");
    const raw = await responsePromise;

    // Parse resize response with snake_case fallbacks
    let resizeState: FinalState;
    try {
      const resizeRes = parseResizeChannelResponse(raw);
      const pr = resizeRes.params;
      resizeState = {
        channelId: pr.channelId,
        intent: pr.state.intent as StateIntent,
        version: BigInt(pr.state.version),
        data: pr.state.stateData,
        allocations: pr.state.allocations.map((a) => ({
          destination: a.destination,
          token: a.token,
          amount: BigInt(a.amount),
        })),
        serverSignature: pr.serverSignature,
      };
    } catch {
      // Manual parse with snake_case support
      const p = JSON.parse(raw)?.res?.[2];
      const st = p?.state;
      resizeState = {
        channelId: (p?.channelId ?? p?.channel_id ?? channelId) as Hex,
        intent: st?.intent as StateIntent,
        version: BigInt(st?.version ?? 1),
        data: (st?.stateData ?? st?.state_data ?? "0x") as Hex,
        allocations: (st?.allocations ?? []).map((a: any) => ({
          destination: a.destination as Address,
          token: a.token as Address,
          amount: BigInt(a.amount ?? 0),
        })),
        serverSignature: (p?.serverSignature ?? p?.server_signature) as Hex,
      };
    }

    this.log("info", `Resize allocations: ${JSON.stringify(resizeState.allocations.map(a => ({ token: a.token?.slice(0, 8) + "...", amount: a.amount.toString() })))}`);
    this.log("info", "Submitting resizeChannel on-chain...");

    const resizeParams: ResizeChannelParams = { resizeState, proofStates: [] };
    const result = await this.nitroliteClient.resizeChannel(resizeParams);
    const txHash: Hash = typeof result === "string" ? result : (result as any).txHash ?? result;
    this.log("info", `✓ Channel resized on-chain! | TX: ${txHash}`);

    return { txHash };
  }

  // ── Transfer (off-chain) ─────────────────────────────────────────────────

  async transfer(
    destination: Address,
    allocations: { asset: string; amount: string }[]
  ): Promise<void> {
    if (!this.sessionSigner) throw new Error("Not authenticated");

    this.log("info", `Transferring to ${destination.slice(0, 10)}... allocations=${JSON.stringify(allocations)}`);

    const msg = await createTransferMessage(this.sessionSigner, {
      destination,
      allocations,
    });
    const responsePromise = this.waitForResponse(RPCMethod.Transfer);
    this.sendWS(msg);
    await responsePromise;
    this.log("info", "✓ Transfer complete!");
  }

  // ── Close channel ────────────────────────────────────────────────────────

  async closeChannel(channelId: Hex): Promise<{ txHash: Hash }> {
    if (!this.sessionSigner || !this.nitroliteClient || !this.walletClient) {
      throw new Error("Not authenticated");
    }

    this.log("info", `Closing channel ${channelId.slice(0, 10)}...`);

    const closeMsg = await createCloseChannelMessage(
      this.sessionSigner,
      channelId,
      this.walletClient.account.address
    );
    const responsePromise = this.waitForResponse(RPCMethod.CloseChannel, 30000);
    this.sendWS(closeMsg);
    this.log("info", "Waiting for close params from server...");
    const raw = await responsePromise;

    // Parse close response — support both camelCase and snake_case
    const parsed = JSON.parse(raw);
    const resParams = parsed?.res?.[2];

    const closedChannelId: Hex = (resParams?.channelId ?? resParams?.channel_id ?? channelId) as Hex;
    const serverSig: Hex = (resParams?.serverSignature ?? resParams?.server_signature) as Hex;
    const stateObj = resParams?.state;

    if (!stateObj || !serverSig) {
      this.log("warn", "Falling back to SDK parser for close response");
      const closeRes = parseCloseChannelResponse(raw);
      const pr = closeRes.params;
      const finalState: FinalState = {
        channelId: pr.channelId,
        intent: pr.state.intent as StateIntent,
        version: BigInt(pr.state.version),
        data: pr.state.stateData,
        allocations: pr.state.allocations.map((a) => ({
          destination: a.destination,
          token: a.token,
          amount: BigInt(a.amount),
        })),
        serverSignature: pr.serverSignature,
      };
      this.log("info", "Submitting closeChannel on-chain (SDK path)...");
      const result = await this.nitroliteClient.closeChannel({ finalState, stateData: finalState.data } as any);
      const txHash: Hash = typeof result === "string" ? result : (result as any).txHash ?? result;
      this.log("info", `✓ Channel closed on-chain! | TX: ${txHash}`);
      return { txHash };
    }

    const stateDataHex: Hex = (stateObj.stateData ?? stateObj.state_data ?? "0x") as Hex;
    const finalState: FinalState = {
      channelId: closedChannelId,
      intent: stateObj.intent as StateIntent,
      version: BigInt(stateObj.version),
      data: stateDataHex,
      allocations: (stateObj.allocations ?? []).map((a: any) => ({
        destination: a.destination as Address,
        token: a.token as Address,
        amount: BigInt(a.amount ?? 0),
      })),
      serverSignature: serverSig,
    };

    this.log("info", `Close final allocations: ${JSON.stringify(finalState.allocations.map(a => ({ amount: a.amount.toString() })))}`);
    this.log("info", "Submitting closeChannel on-chain...");

    const result = await this.nitroliteClient.closeChannel({ finalState, stateData: stateDataHex } as any);
    const txHash: Hash = typeof result === "string" ? result : (result as any).txHash ?? result;
    this.log("info", `✓ Channel ${closedChannelId.slice(0, 10)}... closed on-chain! | TX: ${txHash}`);

    return { txHash };
  }

  // ── Withdraw from custody ────────────────────────────────────────────────

  async withdraw(token: Address, amount: bigint): Promise<{ txHash: Hash }> {
    if (!this.nitroliteClient) throw new Error("Not authenticated");

    this.log("info", `Withdrawing ${amount} of ${token.slice(0, 10)}... from custody`);

    const result = await this.nitroliteClient.withdrawal(token, amount);
    const txHash: Hash = typeof result === "string" ? result : (result as any).txHash ?? result;
    this.log("info", `✓ Withdrawal complete! | TX: ${txHash}`);

    return { txHash };
  }

  // ── Disconnect ───────────────────────────────────────────────────────────

  disconnect(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionSigner = null;
    this.sessionAddress = null;
    this.nitroliteClient = null;
    this.walletClient = null;
    this.connectedAddress = null;
    this.setStatus(YellowConnectionStatus.Disconnected);
    this.log("info", "Disconnected from Yellow Network");
  }
}
