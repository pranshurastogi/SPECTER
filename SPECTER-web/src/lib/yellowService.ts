/**
 * Yellow Network (ClearNode) integration for SPECTER.
 * Uses Sepolia sandbox: wss://clearnet-sandbox.yellow.com/ws
 * Based on Yellow Quick Start: createAppSessionMessage, parseRPCResponse, sendPayment.
 */

const YELLOW_WS_SANDBOX = "wss://clearnet-sandbox.yellow.com/ws";

export type MessageSigner = (message: string) => Promise<string>;

export interface YellowAppDefinition {
  protocol: string;
  participants: string[];
  weights: number[];
  quorum: number;
  challenge: number;
  nonce: number;
}

export interface YellowAllocation {
  participant: string;
  asset: string;
  amount: string;
}

export interface CreateSessionParams {
  messageSigner: MessageSigner;
  userAddress: string;
  partnerAddress: string;
  asset?: string;
  amountUser: string;
  amountPartner: string;
}

export interface SendPaymentParams {
  messageSigner: MessageSigner;
  senderAddress: string;
  amount: string;
  recipient: string;
}

export interface YellowRPCResponse {
  type?: string;
  sessionId?: string;
  error?: string;
  amount?: string;
  sender?: string;
  data?: unknown;
}

function parseRPCResponse(data: string): YellowRPCResponse {
  try {
    const parsed = JSON.parse(data) as YellowRPCResponse & { method?: string; params?: unknown };
    if (parsed.type) return parsed;
    if (parsed.method) return { type: "rpc", data: parsed };
    return parsed as YellowRPCResponse;
  } catch {
    return { type: "unknown", data: data as unknown };
  }
}

/**
 * Build and sign a session message in the format expected by Yellow ClearNode.
 * Compatible with createAppSessionMessage( messageSigner, [{ definition, allocations }] ).
 */
async function createAppSessionMessage(
  messageSigner: MessageSigner,
  definition: YellowAppDefinition,
  allocations: YellowAllocation[]
): Promise<string> {
  const payload = JSON.stringify({
    definition: {
      protocol: definition.protocol,
      participants: definition.participants,
      weights: definition.weights,
      quorum: definition.quorum,
      challenge: definition.challenge,
      nonce: definition.nonce,
    },
    allocations,
  });
  const signature = await messageSigner(payload);
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "session/create",
    params: {
      definition: {
        protocol: definition.protocol,
        participants: definition.participants,
        weights: definition.weights,
        quorum: definition.quorum,
        challenge: definition.challenge,
        nonce: definition.nonce,
      },
      allocations,
      signature,
    },
    id: Date.now(),
  });
}

export class YellowClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private resolveReady: (() => void) | null = null;
  private readyPromise: Promise<void>;

  constructor(wsUrl: string = YELLOW_WS_SANDBOX) {
    this.wsUrl = wsUrl;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      try {
        this.ws = new WebSocket(this.wsUrl);
        this.ws.onopen = () => {
          this.resolveReady?.();
          resolve();
        };
        this.ws.onerror = (ev) => reject(ev);
        this.ws.onclose = () => {
          this.ws = null;
          this.readyPromise = new Promise((r) => {
            this.resolveReady = r;
          });
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    await this.connect();
  }

  /**
   * Create a payment session with Yellow ClearNode.
   * participants: [userAddress, partnerAddress] (e.g. creator EOA and stealth address).
   * allocations: initial balances (e.g. user 0, partner amount for "fund to stealth").
   */
  async createSession(params: CreateSessionParams): Promise<{ sessionId?: string }> {
    await this.ensureConnected();
    const {
      messageSigner,
      userAddress,
      partnerAddress,
      asset = "usdc",
      amountUser,
      amountPartner,
    } = params;

    const definition: YellowAppDefinition = {
      protocol: "payment-app-v1",
      participants: [userAddress, partnerAddress],
      weights: [50, 50],
      quorum: 100,
      challenge: 0,
      nonce: Date.now(),
    };

    const allocations: YellowAllocation[] = [
      { participant: userAddress, asset, amount: amountUser },
      { participant: partnerAddress, asset, amount: amountPartner },
    ];

    const sessionMessage = await createAppSessionMessage(
      messageSigner,
      definition,
      allocations
    );

    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const handler = (event: MessageEvent) => {
        const msg = parseRPCResponse(event.data as string);
        if (msg.type === "session_created" && msg.sessionId) {
          this.ws?.removeEventListener("message", handler);
          resolve({ sessionId: msg.sessionId });
        } else if (msg.type === "error" && msg.error) {
          this.ws?.removeEventListener("message", handler);
          reject(new Error(msg.error));
        }
      };
      this.ws.addEventListener("message", handler);
      this.ws.send(sessionMessage);
      // Timeout in case ClearNode doesn't respond with session_created
      setTimeout(() => {
        this.ws?.removeEventListener("message", handler);
        resolve({});
      }, 15000);
    });
  }

  /**
   * Send an off-chain payment inside the session.
   */
  async sendPayment(params: SendPaymentParams): Promise<void> {
    await this.ensureConnected();
    const { messageSigner, senderAddress, amount, recipient } = params;
    const paymentData = {
      type: "payment",
      amount,
      recipient,
      timestamp: Date.now(),
    };
    const signature = await messageSigner(JSON.stringify(paymentData));
    const signedPayment = JSON.stringify({
      ...paymentData,
      signature,
      sender: senderAddress,
    });
    if (!this.ws) throw new Error("WebSocket not connected");
    this.ws.send(signedPayment);
  }

  /**
   * Parse incoming ClearNode message (for use in onmessage).
   */
  static parseMessage(data: string): YellowRPCResponse {
    return parseRPCResponse(data);
  }

  /**
   * Request cooperative close of the session (Yellow Network).
   * Sends a close message to ClearNode; settlement may complete on-chain via adjudicator.
   */
  async closeSession(params: { messageSigner: MessageSigner; senderAddress: string; channelId?: string }): Promise<void> {
    await this.ensureConnected();
    const { messageSigner, senderAddress, channelId } = params;
    const closeData = {
      type: "close",
      channelId: channelId ?? "",
      timestamp: Date.now(),
    };
    const signature = await messageSigner(JSON.stringify(closeData));
    const payload = JSON.stringify({
      ...closeData,
      signature,
      sender: senderAddress,
    });
    if (!this.ws) throw new Error("WebSocket not connected");
    this.ws.send(payload);
  }

  /**
   * Subscribe to incoming messages (e.g. session_created, payment).
   */
  onMessage(callback: (msg: YellowRPCResponse) => void): () => void {
    if (!this.ws) {
      return () => {};
    }
    const handler = (event: MessageEvent) => {
      callback(parseRPCResponse(event.data as string));
    };
    this.ws.addEventListener("message", handler);
    return () => this.ws?.removeEventListener("message", handler);
  }
}

/** Default Yellow client instance (Sepolia sandbox). */
let defaultClient: YellowClient | null = null;

export function getYellowClient(wsUrl?: string): YellowClient {
  if (!defaultClient) {
    defaultClient = new YellowClient(wsUrl);
  }
  return defaultClient;
}
