/**
 * Fetch token balances for Yellow supported tokens (native ETH or ERC20).
 */

import { type Address, formatUnits, getAddress } from "viem";
import { publicClient } from "./viemClient";

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export interface TokenBalance {
  balance: bigint;
  formatted: string;
  symbol: string;
  decimals: number;
  address: string;
}

export async function fetchTokenBalance(
  tokenAddress: string,
  userAddress: Address,
  decimals: number,
  symbol: string
): Promise<TokenBalance> {
  const addr = getAddress(tokenAddress);
  const isNative = addr === ZERO_ADDRESS || addr.toLowerCase() === ZERO_ADDRESS.toLowerCase();

  let balance: bigint;
  if (isNative) {
    balance = await publicClient.getBalance({ address: userAddress });
  } else {
    balance = await publicClient.readContract({
      address: addr,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [userAddress],
    });
  }

  return {
    balance,
    formatted: formatUnits(balance, decimals),
    symbol,
    decimals,
    address: tokenAddress,
  };
}

export async function fetchBalancesForTokens(
  tokens: { address: string; symbol: string; decimals: number }[],
  userAddress: Address
): Promise<Record<string, TokenBalance>> {
  const out: Record<string, TokenBalance> = {};
  await Promise.all(
    tokens.map(async (t) => {
      try {
        const tb = await fetchTokenBalance(
          t.address,
          userAddress,
          t.decimals,
          t.symbol
        );
        out[t.address.toLowerCase()] = tb;
      } catch {
        out[t.address.toLowerCase()] = {
          balance: 0n,
          formatted: "0",
          symbol: t.symbol,
          decimals: t.decimals,
          address: t.address,
        };
      }
    })
  );
  return out;
}

/** Threshold below which we show faucet (in token units, e.g. 10 USDC = 10) */
export const LOW_BALANCE_THRESHOLD = 10;

export function isLowBalance(
  formatted: string,
  decimals: number,
  threshold: number = LOW_BALANCE_THRESHOLD
): boolean {
  const num = parseFloat(formatted);
  return num < threshold;
}

/** Faucet URL for ytest.usd tokens. */
export const YTEST_USD_FAUCET = "https://ytest-faucet.vercel.app/";

/** Sepolia ETH faucet. */
export const SEPOLIA_ETH_FAUCET = "https://faucets.chain.link/sepolia";
