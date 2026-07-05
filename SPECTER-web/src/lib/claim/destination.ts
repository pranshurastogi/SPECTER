/**
 * Claim destination resolution: a single input that accepts either a raw
 * EVM address or an ENS name (forward-resolved on mainnet, where ENS lives).
 */
import { getAddress, isAddress, zeroAddress } from "viem";
import { normalize } from "viem/ens";
import { ensPublicClient } from "@/lib/blockchain/ensConfig";

export interface ResolvedDestination {
  /** What the user typed. */
  input: string;
  /** Checksummed destination address. */
  address: `0x${string}`;
  kind: "address" | "ens";
}

export async function resolveDestination(raw: string): Promise<ResolvedDestination> {
  const input = raw.trim();
  if (!input) {
    throw new Error("Enter a destination address or ENS name");
  }

  if (isAddress(input, { strict: false })) {
    return { input, address: getAddress(input), kind: "address" };
  }

  if (input.includes(".")) {
    let name: string;
    try {
      name = normalize(input);
    } catch {
      throw new Error(`"${input}" is not a valid ENS name`);
    }
    let address: `0x${string}` | null;
    try {
      address = await ensPublicClient.getEnsAddress({ name });
    } catch {
      throw new Error("ENS lookup failed — check your connection and retry");
    }
    if (!address || address === zeroAddress) {
      throw new Error(`"${input}" does not resolve to an address`);
    }
    return { input, address, kind: "ens" };
  }

  throw new Error("Enter a valid 0x address or ENS name (e.g. alice.eth)");
}
