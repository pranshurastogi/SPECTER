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

/** Build auth_request JSON manually for full control over serialization. */
function buildAuthRequestJSON(params: {
  address: string;
  session_key: string;
  application: string;
  expires_at: number;
  scope: string;
  allowances: { asset: string; amount: string }[];
}): string {
  const requestId = Math.floor(Date.now() + Math.random() * 10000);
  const timestamp = Date.now();
  return JSON.stringify({
    req: [
      requestId,
      "auth_request",
      {
        address: params.address,
        session_key: params.session_key,
        application: params.application,
        expires_at: params.expires_at,
        scope: params.scope,
        allowances: params.allowances,
      },
      timestamp,
    ],
    sig: [],
  });
}

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

// ── YellowClient ─────────────────────────────────────────────────────────────

export class YellowClient {
  private ws: WebSocket | null = null;
  private sessionSigner: MessageSigner | null = null;
  private sessionAddress: Address | null = null;
  private nitroliteClient: NitroliteClient | null = null;
  private walletClient: WalletClient<Transport, Chain, ParseAccount<Account>> | null = null;
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

  /** Find the supported token address for a given chain ID (e.g. Sepolia). */
  getTokenForChain(chainId: number): Address | null {
    const asset = this.assets.find((a) => a.chainId === chainId);
    return asset?.token ?? null;
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
          // Use a dummy signer for get_config (no auth needed)
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
      this.log("warn", "Already connected");
      return;
    }

    this.walletClient = walletClient;
    const account = walletClient.account;
    if (!account) throw new Error("Wallet has no account");

    this.setStatus(YellowConnectionStatus.Connecting);
    this.log("info", "Generating session key...");

    // Generate ephemeral session key
    const sessionPrivateKey = generatePrivateKey();
    const sessionAccount = privateKeyToAccount(sessionPrivateKey);
    this.sessionSigner = createECDSAMessageSigner(sessionPrivateKey);
    this.sessionAddress = sessionAccount.address;

    this.log("info", `Session key: ${sessionAccount.address}`);

    // EIP-712 auth params
    const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;
    const authAllowances = [{ asset: "ytest.usd", amount: "1000000000" }];

    this.log("info", `Auth: addr=${account.address}, session=${sessionAccount.address}, app=${APPLICATION_NAME}, scope=${AUTH_SCOPE}`);

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
        this.log("error", "Connection timeout (30s)");
        ws.close();
        reject(new Error("Yellow connection timeout"));
      }, 30000);

      ws.onopen = async () => {
        try {
          this.setStatus(YellowConnectionStatus.Authenticating);
          this.log("info", "WebSocket connected, sending auth request...");

          // Build auth request manually for full control over serialization
          const authMsg = buildAuthRequestJSON({
            address: account.address,
            session_key: sessionAccount.address,
            application: APPLICATION_NAME,
            expires_at: expiresAtSec,
            scope: AUTH_SCOPE,
            allowances: authAllowances,
          });

          this.log("info", `Auth msg: ${authMsg.slice(0, 250)}`);
          ws.send(authMsg);
        } catch (err) {
          clearTimeout(timeout);
          this.setStatus(YellowConnectionStatus.Error);
          this.log("error", `Auth request failed: ${err}`);
          ws.close();
          reject(err);
        }
      };

      ws.onmessage = async (event: MessageEvent) => {
        const raw = event.data as string;
        try {
          const parsed = JSON.parse(raw);
          const method = parsed?.res?.[1];

          this.log("info", `WS recv method=${method}`);

          // Capture assets broadcast (server sends supported tokens on connect)
          if (method === RPCMethod.Assets) {
            try {
              // Parse manually: parseAssetsResponse crashes on broadcasts (missing sig/4th element)
              const rawAssets = parsed?.res?.[2]?.assets;
              if (Array.isArray(rawAssets)) {
                // Server uses snake_case (chain_id), normalize to camelCase
                this.assets = rawAssets.map((a: any) => ({
                  token: a.token,
                  chainId: a.chain_id ?? a.chainId,
                  symbol: a.symbol,
                  decimals: a.decimals,
                }));
                this.log("info", `Received ${this.assets.length} supported assets: ${this.assets.map(a => `${a.symbol}@${a.chainId}=${a.token}`).join(", ")}`);
                // Emit config event with assets (create config if needed)
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

          // Ignore other server broadcasts during auth
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
            this.log("info", "Auth challenge received, please sign in wallet...");
            try {
              const challengeRes = parseAuthChallengeResponse(raw);
              const verifyMsg = await createAuthVerifyMessageFromChallenge(
                eip712AuthSigner,
                challengeRes.params.challengeMessage
              );
              ws.send(verifyMsg);
              this.log("info", "Auth signature sent, verifying...");
            } catch (signErr) {
              clearTimeout(timeout);
              this.setStatus(YellowConnectionStatus.Error);
              this.log("error", `Failed to sign auth challenge: ${signErr}`);
              ws.close();
              reject(new Error("Auth signature rejected"));
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
              this.log("info", "Authenticated successfully!");
              this.startPing();
              this.setupMessageHandler();
              resolve();
            } else {
              clearTimeout(timeout);
              this.setStatus(YellowConnectionStatus.Error);
              this.log("error", "Authentication rejected by server");
              ws.close();
              reject(new Error("Authentication failed"));
            }
            return;
          }

          // Error during auth
          if (method === RPCMethod.Error) {
            const errParams = parsed?.res?.[2];
            const errMsg = errParams?.error ?? errParams?.message ?? "Unknown error";
            clearTimeout(timeout);
            this.setStatus(YellowConnectionStatus.Error);
            this.log("error", `Server error: ${errMsg} | full: ${JSON.stringify(errParams).slice(0, 200)}`);
            ws.close();
            reject(new Error(errMsg));
            return;
          }
        } catch (err) {
          this.log("warn", `Unexpected message during auth: ${raw.slice(0, 100)}`);
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        this.setStatus(YellowConnectionStatus.Error);
        this.log("error", "WebSocket connection error");
        reject(new Error("WebSocket error"));
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
            const res = parseGetLedgerBalancesResponse(raw);
            const balances: LedgerBalance[] = (res.params.ledgerBalances ?? []).map(
              (b: RPCBalance) => ({
                asset: b.asset,
                amount: b.amount,
              })
            );
            this.emit({ type: "balances", timestamp: Date.now(), balances });
            this.log("info", `Ledger balances: ${balances.map((b) => `${b.asset}: ${b.amount}`).join(", ") || "none"}`);
            break;
          }

          case RPCMethod.GetChannels: {
            const res = parseGetChannelsResponse(raw);
            const channels: ChannelInfo[] = (res.params.channels ?? []).map(
              (ch: RPCChannelUpdateWithWallet) => ({
                channelId: ch.channelId,
                participant: ch.participant,
                status: ch.status,
                token: ch.token,
                amount: String(ch.amount),
                chainId: ch.chainId,
                version: ch.version,
                wallet: ch.wallet,
              })
            );
            this.emit({ type: "channels", timestamp: Date.now(), channels });
            this.log("info", `Channels: ${channels.length} found`);
            break;
          }

          case RPCMethod.ChannelsUpdate: {
            // Server push of channel updates
            const chans = parsed?.res?.[2]?.channels;
            if (Array.isArray(chans)) {
              const channels: ChannelInfo[] = chans.map((ch: RPCChannelUpdateWithWallet) => ({
                channelId: ch.channelId,
                participant: ch.participant,
                status: ch.status,
                token: ch.token,
                amount: String(ch.amount),
                chainId: ch.chainId,
                version: ch.version,
                wallet: ch.wallet,
              }));
              this.emit({ type: "channels", timestamp: Date.now(), channels });
              this.log("info", `Channel update: ${channels.length} channels`);
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
              this.log("info", `Balance update: ${balances.map((b) => `${b.asset}: ${b.amount}`).join(", ")}`);
            }
            break;
          }

          case RPCMethod.CreateChannel: {
            this.log("info", "CreateChannel response received");
            break;
          }

          case RPCMethod.ResizeChannel: {
            this.log("info", "ResizeChannel response received");
            break;
          }

          case RPCMethod.CloseChannel: {
            this.log("info", "CloseChannel response received");
            break;
          }

          case RPCMethod.Transfer: {
            this.log("info", "Transfer response received");
            break;
          }

          case RPCMethod.TransferNotification: {
            const txs = parsed?.res?.[2]?.transactions;
            if (Array.isArray(txs) && txs.length > 0) {
              this.log("info", `Transfer notification: ${txs.length} transaction(s)`);
            }
            break;
          }

          case RPCMethod.Pong: {
            // Expected keepalive response
            break;
          }

          case RPCMethod.Error: {
            const errMsg = parsed?.res?.[2]?.error ?? "Unknown server error";
            this.log("error", `Server error: ${errMsg}`);
            this.emit({ type: "error", timestamp: Date.now(), message: errMsg });
            break;
          }

          default: {
            this.log("info", `Message: ${method ?? "unknown"}`);
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
      throw new Error("Not connected to Yellow Network");
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
        reject(new Error(`Timeout waiting for ${method} response`));
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
            const errMsg = parsed?.res?.[2]?.error ?? "Server error";
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
    const res = parseGetLedgerBalancesResponse(raw);
    const balances: LedgerBalance[] = (res.params.ledgerBalances ?? []).map(
      (b: RPCBalance) => ({
        asset: b.asset,
        amount: b.amount,
      })
    );
    return balances;
  }

  // ── Get channels ─────────────────────────────────────────────────────────

  async getChannels(): Promise<ChannelInfo[]> {
    if (!this.sessionSigner) throw new Error("Not authenticated");
    this.log("info", "Fetching channels...");
    const msg = await createGetChannelsMessage(this.sessionSigner);
    const responsePromise = this.waitForResponse(RPCMethod.GetChannels);
    this.sendWS(msg);
    const raw = await responsePromise;
    const res = parseGetChannelsResponse(raw);
    return (res.params.channels ?? []).map(
      (ch: RPCChannelUpdateWithWallet) => ({
        channelId: ch.channelId,
        participant: ch.participant,
        status: ch.status,
        token: ch.token,
        amount: String(ch.amount),
        chainId: ch.chainId,
        version: ch.version,
        wallet: ch.wallet,
      })
    );
  }

  // ── Create channel ───────────────────────────────────────────────────────

  async createChannel(
    token: Address,
    depositAmount: bigint
  ): Promise<{ channelId: Hex; txHash: Hash }> {
    if (!this.sessionSigner || !this.nitroliteClient || !this.walletClient) {
      throw new Error("Not authenticated");
    }

    this.log("info", `Creating channel for token ${token}...`);

    // 1. Request channel params from ClearNode
    const createMsg = await createCreateChannelMessage(this.sessionSigner, {
      chain_id: chain.id,
      token,
    });
    const responsePromise = this.waitForResponse(RPCMethod.CreateChannel, 30000);
    this.sendWS(createMsg);
    const raw = await responsePromise;

    this.log("info", "Received channel params from server, submitting on-chain...");

    // 2. Parse response into CreateChannelParams
    const createRes = parseCreateChannelResponse(raw);
    const pr = createRes.params as {
      channelId: Hex;
      channel: { participants: Address[]; adjudicator: Address; challenge: number; nonce: number };
      state: { intent: number; version: number; stateData: Hex; allocations: { destination: Address; token: Address; amount: bigint }[] };
      serverSignature: Hex;
    };

    const channelObj: Channel = {
      participants: pr.channel.participants,
      adjudicator: pr.channel.adjudicator,
      challenge: BigInt(pr.channel.challenge),
      nonce: BigInt(pr.channel.nonce),
    };

    const tokenAddr = pr.state.allocations[0]?.token ?? token;
    const allocations = [
      { destination: pr.channel.participants[0], token: tokenAddr, amount: 0n },
      { destination: pr.channel.participants[1], token: tokenAddr, amount: depositAmount },
    ];

    const unsignedInitialState: UnsignedState = {
      intent: pr.state.intent as StateIntent,
      version: BigInt(pr.state.version),
      data: pr.state.stateData,
      allocations,
    };

    const createChannelParams: CreateChannelParams = {
      channel: channelObj,
      unsignedInitialState,
      serverSignature: pr.serverSignature,
    };

    // 3. On-chain deposit + create
    const result = await this.nitroliteClient.depositAndCreateChannel(
      tokenAddr,
      depositAmount,
      createChannelParams
    );

    this.log("info", `Channel created! ID: ${result.channelId}, tx: ${result.txHash}`);

    return {
      channelId: result.channelId,
      txHash: result.txHash,
    };
  }

  // ── Resize channel ───────────────────────────────────────────────────────

  async resizeChannel(
    channelId: Hex,
    allocateAmount: bigint
  ): Promise<{ txHash: Hash }> {
    if (!this.sessionSigner || !this.nitroliteClient || !this.walletClient) {
      throw new Error("Not authenticated");
    }

    this.log("info", `Resizing channel ${channelId.slice(0, 10)}... with amount ${allocateAmount}`);

    const resizeMsg = await createResizeChannelMessage(this.sessionSigner, {
      channel_id: channelId,
      allocate_amount: allocateAmount,
      funds_destination: this.walletClient.account.address,
    });
    const responsePromise = this.waitForResponse(RPCMethod.ResizeChannel, 30000);
    this.sendWS(resizeMsg);
    const raw = await responsePromise;

    this.log("info", "Received resize params, submitting on-chain...");

    const resizeRes = parseResizeChannelResponse(raw);
    const pr = resizeRes.params;

    const resizeState: FinalState = {
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

    const resizeParams: ResizeChannelParams = {
      resizeState,
      proofStates: [],
    };

    const result = await this.nitroliteClient.resizeChannel(resizeParams);
    this.log("info", `Channel resized! tx: ${result.txHash}`);

    return { txHash: result.txHash };
  }

  // ── Transfer (off-chain) ─────────────────────────────────────────────────

  async transfer(
    destination: Address,
    allocations: { asset: string; amount: string }[]
  ): Promise<void> {
    if (!this.sessionSigner) throw new Error("Not authenticated");

    this.log("info", `Transferring to ${destination.slice(0, 10)}...`);

    const msg = await createTransferMessage(this.sessionSigner, {
      destination,
      allocations,
    });
    const responsePromise = this.waitForResponse(RPCMethod.Transfer);
    this.sendWS(msg);
    await responsePromise;
    this.log("info", "Transfer complete!");
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
    const raw = await responsePromise;

    this.log("info", "Received close params, submitting on-chain...");

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

    const closeParams: CloseChannelParams = {
      finalState,
    };

    const txHash = await this.nitroliteClient.closeChannel(closeParams);
    this.log("info", `Channel closed! tx: ${txHash}`);

    return { txHash };
  }

  // ── Withdraw from custody ────────────────────────────────────────────────

  async withdraw(token: Address, amount: bigint): Promise<{ txHash: Hash }> {
    if (!this.nitroliteClient) throw new Error("Not authenticated");

    this.log("info", `Withdrawing ${amount} of ${token.slice(0, 10)}... from custody`);

    const txHash = await this.nitroliteClient.withdrawal(token, amount);
    this.log("info", `Withdrawal complete! tx: ${txHash}`);

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
    this.setStatus(YellowConnectionStatus.Disconnected);
    this.log("info", "Disconnected");
  }
}
