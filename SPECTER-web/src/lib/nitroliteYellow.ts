/**
 * On-chain Yellow channel creation using Nitrolite SDK.
 * Follows Yellow Network Quickstart: session key for RPC, main wallet for EIP-712 auth only.
 */

import {
  createPublicClient,
  http,
  type Address,
  type Hash,
  type Hex,
  type WalletClient,
  type Account,
  type Chain,
  type Transport,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  NitroliteClient,
  WalletStateSigner,
  createCreateChannelMessage,
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createEIP712AuthMessageSigner,
  createECDSAMessageSigner,
  createGetAssetsMessageV2,
  parseCreateChannelResponse,
  parseAuthChallengeResponse,
  parseGetAssetsResponse,
  type CreateChannelParams,
  type Channel,
  type UnsignedState,
  type StateIntent,
  type PartialEIP712AuthMessage,
  type EIP712AuthDomain,
  RPCMethod,
} from "@erc7824/nitrolite";

const SEPOLIA_CHAIN_ID = 11155111;
/** Fallback if ClearNode doesn't return assets for our chain */
const USDC_SEPOLIA: Address = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

export interface NitroliteYellowConfig {
  custodyAddress: Address;
  adjudicatorAddress: Address;
  chainId: number;
  wsUrl: string;
  rpcUrl?: string;
}

export interface CreateOnChainChannelResult {
  channelId: Hex;
  txHash: Hash;
}

/**
 * Build viem public client for Sepolia.
 */
function getPublicClient(rpcUrl: string) {
  return createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
}

/**
 * Convert RPC CreateChannel response params to Nitrolite CreateChannelParams.
 * Uses the token from the server response (supported by ClearNode).
 */
function rpcParamsToCreateChannelParams(
  params: {
    channel: { participants: Address[]; adjudicator: Address; challenge: number; nonce: number };
    state: { intent: number; version: number; stateData: Hex; allocations: { destination: Address; token: Address; amount: bigint }[] };
    serverSignature: Hex;
  },
  _chainId: number,
  depositAmountWei: bigint
): CreateChannelParams {
  const channel: Channel = {
    participants: params.channel.participants,
    adjudicator: params.channel.adjudicator,
    challenge: BigInt(params.channel.challenge),
    nonce: BigInt(params.channel.nonce),
  };

  const token = params.state.allocations[0]?.token ?? USDC_SEPOLIA;
  const allocations = [
    { destination: params.channel.participants[0], token, amount: 0n },
    { destination: params.channel.participants[1], token, amount: depositAmountWei },
  ];

  const unsignedInitialState: UnsignedState = {
    intent: params.state.intent as StateIntent,
    version: BigInt(params.state.version),
    data: params.state.stateData,
    allocations,
  };

  return {
    channel,
    unsignedInitialState,
    serverSignature: params.serverSignature,
  };
}

/**
 * Create an on-chain Yellow channel: request params from ClearNode, then submit createChannel tx.
 */
export async function createOnChainYellowChannel(
  config: NitroliteYellowConfig,
  walletClient: WalletClient<Transport, Chain, Account>,
  amountWei: bigint
): Promise<CreateOnChainChannelResult> {
  const account = walletClient.account;
  if (!account) throw new Error("Wallet has no account");

  const rpcUrl =
    config.rpcUrl ?? "https://ethereum-sepolia-rpc.publicnode.com";
  const publicClient = getPublicClient(rpcUrl);
  const wc = walletClient;

  // Per Yellow Quickstart: generate temporary session key for RPC signing
  const sessionPrivateKey = generatePrivateKey();
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);
  const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);

  // Auth request params (must match EIP-712 message). Domain name must match application.
  const applicationName = "SPECTER";
  const expiresAtUnix = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour per Yellow docs
  const isSandbox = config.wsUrl.includes("sandbox");
  const authRequestParams = {
    address: account.address,
    session_key: sessionAccount.address, // Session key address, NOT main wallet
    application: applicationName,
    expires_at: expiresAtUnix,
    scope: "test.app", // Per Yellow Quickstart
    allowances: isSandbox
      ? [{ asset: "ytest.usd", amount: "1000000000" }]
      : [],
  };

  // EIP-712 signer for auth_verify only (main wallet). Domain name must match application.
  const partialAuthMessage: PartialEIP712AuthMessage = {
    scope: authRequestParams.scope,
    session_key: authRequestParams.session_key,
    expires_at: authRequestParams.expires_at,
    allowances: authRequestParams.allowances,
  };
  const authDomain: EIP712AuthDomain = { name: applicationName };
  const eip712AuthSigner = createEIP712AuthMessageSigner(
    wc,
    partialAuthMessage,
    authDomain
  );

  // 1) Connect to ClearNode and get CreateChannel params
  const ws = new WebSocket(config.wsUrl);

  const sendCreateChannel = (token: Address) => {
    createCreateChannelMessage(sessionSigner, {
      chain_id: config.chainId,
      token,
    }).then((msg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
  };

  const createChannelParams = await new Promise<CreateChannelParams>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Yellow CreateChannel RPC timeout (30s)"));
      }, 30000);

      let createChannelSent = false;
      let authRequestSent = false;

      ws.onmessage = async (event: MessageEvent) => {
        try {
          const raw = event.data as string;
          if (typeof raw === "string" && raw.trim() === "authentication required") {
            clearTimeout(timeout);
            ws.close();
            reject(
              new Error(
                "ClearNode requires wallet authentication. Please ensure your wallet is connected."
              )
            );
            return;
          }
          
          const parsed = JSON.parse(raw);
          const method = parsed?.res?.[1];

          // Handle auth_challenge: sign with MAIN wallet (EIP-712), per Yellow Quickstart
          if (method === RPCMethod.AuthChallenge) {
            const challengeRes = parseAuthChallengeResponse(raw);
            const challengeMessage = challengeRes.params.challengeMessage;
            console.log("[Yellow] Auth challenge received, signing with EIP-712 (main wallet)...");
            try {
              const verifyMsg = await createAuthVerifyMessageFromChallenge(
                eip712AuthSigner,
                challengeMessage
              );
              ws.send(verifyMsg);
            } catch (signErr) {
              console.error("[Yellow] Auth signing failed:", signErr);
              clearTimeout(timeout);
              ws.close();
              reject(new Error(`Failed to sign auth challenge. Please approve the signature in your wallet.`));
            }
            return;
          }

          // Handle auth_verify response (auth success/failure)
          if (method === RPCMethod.AuthVerify) {
            const params = parsed?.res?.[2];
            if (params && typeof params === "object" && "success" in params) {
              if (params.success) {
                console.log("[Yellow] Auth successful. Fetching supported tokens for chain", config.chainId, "...");
                const getAssetsMsg = createGetAssetsMessageV2(config.chainId);
                ws.send(getAssetsMsg);
              } else {
                console.error("[Yellow] Authentication failed:", params);
                clearTimeout(timeout);
                ws.close();
                reject(
                  new Error(
                    `ClearNode authentication failed. Please try again and ensure you sign the auth message.`
                  )
                );
              }
            }
            return;
          }

          // Handle get_assets or assets response: pick supported token for our chain, then send CreateChannel
          if (method === RPCMethod.GetAssets || method === RPCMethod.Assets) {
            try {
              let assets: { token: Address; chainId: number; symbol: string }[];
              if (method === RPCMethod.GetAssets) {
                const assetsRes = parseGetAssetsResponse(raw);
                assets = assetsRes.params?.assets ?? [];
              } else {
                const params = parsed?.res?.[2];
                const rawList = Array.isArray(params?.assets) ? params.assets : [];
                assets = rawList.map((a: { token: Address; chain_id?: number; chainId?: number; symbol: string }) => ({
                  token: a.token,
                  chainId: a.chainId ?? a.chain_id ?? 0,
                  symbol: a.symbol ?? "",
                }));
              }
              const forChain = assets.filter((a) => a.chainId === config.chainId);
              const preferred = forChain.find((a) => /usdc|ytest|usd/i.test(a.symbol));
              const token = (preferred ?? forChain[0])?.token ?? USDC_SEPOLIA;
              console.log(
                "[Yellow] Using supported token:",
                (preferred ?? forChain[0])?.symbol ?? "fallback",
                token
              );
              if (createChannelSent) return;
              createChannelSent = true;
              sendCreateChannel(token);
            } catch (e) {
              console.warn("[Yellow] Failed to parse assets, using fallback token:", e);
              if (createChannelSent) return;
              createChannelSent = true;
              sendCreateChannel(USDC_SEPOLIA);
            }
            return;
          }

          // Handle CreateChannel response
          if (method === RPCMethod.CreateChannel) {
            console.log("[Yellow] Received CreateChannel response");
            clearTimeout(timeout);
            const createRes = parseCreateChannelResponse(raw);
            const pr = createRes.params as {
              channel: {
                participants: Address[];
                adjudicator: Address;
                challenge: number;
                nonce: number;
              };
              state: {
                intent: number;
                version: number;
                stateData: Hex;
                allocations: {
                  destination: Address;
                  token: Address;
                  amount: bigint;
                }[];
              };
              serverSignature: Hex;
            };
            const params = rpcParamsToCreateChannelParams(
              pr,
              config.chainId,
              amountWei
            );
            ws.close();
            resolve(params);
            return;
          }

          // Handle error responses
          if (method === RPCMethod.Error) {
            clearTimeout(timeout);
            ws.close();
            const params = parsed?.res?.[2];
            const errMsg =
              (typeof params === "object" && params !== null && "error" in params
                ? (params as { error: string }).error
                : typeof params === "string"
                  ? params
                  : undefined) ?? "Yellow RPC error";
            console.error("[Yellow] Error from ClearNode:", errMsg);
            reject(new Error(`ClearNode error: ${errMsg}`));
          }
        } catch (e) {
          console.error("[Yellow] Error handling message:", e);
          clearTimeout(timeout);
          ws.close();
          reject(e);
        }
      };

      ws.onerror = (error) => {
        console.error("[Yellow] WebSocket error:", error);
        clearTimeout(timeout);
        reject(new Error("Yellow WebSocket connection error"));
      };

      // Per Yellow Quickstart: send auth_request on connect (session key + main wallet address)
      ws.onopen = async () => {
        try {
          if (authRequestSent) return;
          authRequestSent = true;
          console.log("[Yellow] WebSocket connected, sending auth_request (session key + main wallet)...");
          const authRequest = await createAuthRequestMessage(authRequestParams);
          ws.send(authRequest);
        } catch (err) {
          console.error("[Yellow] Failed to create auth_request:", err);
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`Yellow auth setup failed: ${err}`));
        }
      };
    }
  );

  // 2) Submit on-chain createChannel via Nitrolite
  const addresses = {
    custody: config.custodyAddress,
    adjudicator: config.adjudicatorAddress,
  };

  const nitroliteClient = new NitroliteClient({
    publicClient,
    walletClient: wc,
    stateSigner: new WalletStateSigner(wc),
    addresses,
    chainId: config.chainId,
    challengeDuration: 3600n,
  } as ConstructorParameters<typeof NitroliteClient>[0]);

  const channelToken =
    createChannelParams.unsignedInitialState.allocations[0]?.token ?? USDC_SEPOLIA;
  const result = await nitroliteClient.depositAndCreateChannel(
    channelToken,
    amountWei,
    createChannelParams
  );

  return {
    channelId: result.channelId,
    txHash: result.txHash,
  };
}

export { USDC_SEPOLIA, SEPOLIA_CHAIN_ID };
