/**
 * React hooks for Yellow Network integration.
 * Provides state management for Yellow balance, faucet, and deposits.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { Address } from "viem";
import {
  YellowClient,
  YellowConnectionStatus,
  type YellowEvent,
  type ChannelInfo,
  type LedgerBalance,
  type YellowConfig,
} from "@/lib/yellowClient";
import {
  fetchTokenBalance,
  type TokenBalance,
} from "@/lib/yellowBalances";

// ── Types ───────────────────────────────────────────────────────────────────

export interface UseYellowClientResult {
  client: YellowClient | null;
  status: YellowConnectionStatus;
  isConnected: boolean;
  isConnecting: boolean;
  connect: (walletClient: any) => Promise<void>;
  disconnect: () => void;
  error: string | null;
}

export interface UseYellowBalancesResult {
  ledgerBalances: LedgerBalance[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export interface UseYellowChannelsResult {
  channels: ChannelInfo[];
  openChannels: ChannelInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export interface UseYellowFaucetResult {
  request: () => Promise<boolean>;
  loading: boolean;
  success: boolean | null;
  error: string | null;
}

export interface UseWalletTokensResult {
  ethBalance: TokenBalance | null;
  ytestBalance: TokenBalance | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const DEFAULT_YTEST_TOKEN = "0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb" as Address;
const FAUCET_URL = "https://clearnet-sandbox.yellow.com/faucet/requestTokens";

// ── useYellowClient ─────────────────────────────────────────────────────────

export function useYellowClient(
  onEvent?: (event: YellowEvent) => void
): UseYellowClientResult {
  const clientRef = useRef<YellowClient | null>(null);
  const [status, setStatus] = useState<YellowConnectionStatus>(
    YellowConnectionStatus.Disconnected
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEvent = useCallback(
    (event: YellowEvent) => {
      if (event.type === "status" && event.connectionStatus) {
        setStatus(event.connectionStatus);
      }
      onEvent?.(event);
    },
    [onEvent]
  );

  const connect = useCallback(
    async (walletClient: any) => {
      setIsConnecting(true);
      setError(null);

      // Clean up existing client
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }

      try {
        const client = new YellowClient();
        clientRef.current = client;
        client.onEvent(handleEvent);
        await client.connect(walletClient);
      } catch (err: any) {
        const msg = err?.message ?? "Connection failed";
        setError(msg);
        clientRef.current?.disconnect();
        clientRef.current = null;
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [handleEvent]
  );

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setStatus(YellowConnectionStatus.Disconnected);
    setError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
    };
  }, []);

  return {
    client: clientRef.current,
    status,
    isConnected: status === YellowConnectionStatus.Connected,
    isConnecting,
    connect,
    disconnect,
    error,
  };
}

// ── useYellowBalances ───────────────────────────────────────────────────────

export function useYellowBalances(
  client: YellowClient | null
): UseYellowBalancesResult {
  const [ledgerBalances, setLedgerBalances] = useState<LedgerBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const balances = await client.getLedgerBalances();
      setLedgerBalances(balances);
    } catch (err: any) {
      setError(err?.message ?? "Failed to fetch balances");
    } finally {
      setLoading(false);
    }
  }, [client]);

  // Auto-refresh when client connects
  useEffect(() => {
    if (client && client.getStatus() === YellowConnectionStatus.Connected) {
      refresh();
    }
  }, [client, refresh]);

  return { ledgerBalances, loading, error, refresh };
}

// ── useYellowChannels ───────────────────────────────────────────────────────

export function useYellowChannels(
  client: YellowClient | null
): UseYellowChannelsResult {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const chans = await client.getChannels();
      setChannels(chans);
    } catch (err: any) {
      setError(err?.message ?? "Failed to fetch channels");
    } finally {
      setLoading(false);
    }
  }, [client]);

  // Auto-refresh when client connects
  useEffect(() => {
    if (client && client.getStatus() === YellowConnectionStatus.Connected) {
      refresh();
    }
  }, [client, refresh]);

  const openChannels = channels.filter(
    (c) => c.channelId && c.status.toLowerCase() !== "closed"
  );

  return { channels, openChannels, loading, error, refresh };
}

// ── useYellowFaucet ─────────────────────────────────────────────────────────

export function useYellowFaucet(userAddress: string | null): UseYellowFaucetResult {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (): Promise<boolean> => {
    if (!userAddress) {
      setError("No wallet address");
      return false;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(FAUCET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Faucet request failed: ${response.status}`);
      }

      const data = await response.json();
      const ok = data.success === true;
      setSuccess(ok);
      return ok;
    } catch (err: any) {
      const msg = err?.message ?? "Faucet request failed";
      setError(msg);
      setSuccess(false);
      return false;
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  return { request, loading, success, error };
}

// ── useWalletTokens ─────────────────────────────────────────────────────────

export function useWalletTokens(
  userAddress: string | null,
  ytestTokenAddress: Address = DEFAULT_YTEST_TOKEN
): UseWalletTokensResult {
  const [ethBalance, setEthBalance] = useState<TokenBalance | null>(null);
  const [ytestBalance, setYtestBalance] = useState<TokenBalance | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userAddress) return;
    setLoading(true);

    const addr = userAddress as Address;

    try {
      const eth = await fetchTokenBalance(ZERO_ADDRESS, addr, 18, "ETH");
      setEthBalance(eth);
    } catch {
      setEthBalance(null);
    }

    try {
      const ytest = await fetchTokenBalance(ytestTokenAddress, addr, 6, "ytest.usd");
      setYtestBalance(ytest);
    } catch {
      setYtestBalance(null);
    }

    setLoading(false);
  }, [userAddress, ytestTokenAddress]);

  // Auto-refresh on mount and address change
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { ethBalance, ytestBalance, loading, refresh };
}

// ── useYellowConfig ─────────────────────────────────────────────────────────

export function useYellowConfig(client: YellowClient | null) {
  const [config, setConfig] = useState<YellowConfig | null>(null);

  useEffect(() => {
    if (client) {
      const cfg = client.getConfig();
      if (cfg) setConfig(cfg);
    }
  }, [client]);

  return config;
}

// ── Conversion Utils ────────────────────────────────────────────────────────

const ETH_TO_YTEST_RATE = 100; // 1 ETH = 100 ytest.usd

/**
 * Convert ytest.usd amount to ETH wei.
 * @param ytestAmount Human-readable ytest.usd amount (e.g., 1 = 1 ytest.usd)
 * @returns ETH amount in wei as bigint
 */
export function ytestToEthWei(ytestAmount: number): bigint {
  // ytest.usd has 6 decimals, ETH has 18 decimals
  // rate: 1 ETH = 100 ytest.usd
  // So 1 ytest.usd = 0.01 ETH = 10^16 wei
  const ytestUnits = BigInt(Math.floor(ytestAmount * 1e6));
  const weiPerYtest = BigInt(10) ** BigInt(18) / BigInt(ETH_TO_YTEST_RATE * 1e6);
  return ytestUnits * weiPerYtest;
}

/**
 * Convert ETH wei to human-readable ytest.usd amount.
 * @param wei ETH amount in wei
 * @returns Human-readable ytest.usd amount
 */
export function ethWeiToYtest(wei: bigint): number {
  // rate: 1 ETH = 100 ytest.usd
  // So 10^18 wei = 100 ytest.usd
  const ytestUnits = (wei * BigInt(ETH_TO_YTEST_RATE * 1e6)) / BigInt(10) ** BigInt(18);
  return Number(ytestUnits) / 1e6;
}

/**
 * Get the minimum ytest.usd amount for a position.
 * Based on min 0.001 ETH = 0.1 ytest.usd at rate 100.
 */
export function getMinYtestAmount(): number {
  return 0.1;
}

/**
 * Format ytest.usd amount for display.
 */
export function formatYtest(amount: string | number | bigint, decimals = 2): string {
  let num: number;
  if (typeof amount === "bigint") {
    num = Number(amount);
  } else if (typeof amount === "string") {
    num = parseFloat(amount);
  } else {
    num = amount;
  }
  
  if (isNaN(num)) return "0";

  // If amount is in raw units (> 1000), convert
  if (num > 1000) {
    return (num / 1e6).toFixed(decimals);
  }
  return num.toFixed(decimals);
}

/**
 * Parse raw ytest.usd units to human-readable.
 * ytest.usd has 6 decimals.
 */
export function parseYtestUnits(rawUnits: string | bigint): number {
  const units = typeof rawUnits === "string" ? BigInt(rawUnits) : rawUnits;
  return Number(units) / 1e6;
}
