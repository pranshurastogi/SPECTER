/**
 * ENS reverse lookup on Ethereum mainnet.
 *
 * viem's getEnsName uses CCIP-read batch gateways; many public RPCs fail those calls.
 * We use a CCIP-capable mainnet endpoint and fall back to ensdata.net.
 */

import type { Address } from 'viem';
import { ensPublicClient } from './ensConfig';

async function lookupViaViem(address: Address): Promise<string | null> {
  try {
    return (await ensPublicClient.getEnsName({ address })) ?? null;
  } catch {
    return null;
  }
}

async function lookupViaEnsData(address: Address): Promise<string | null> {
  const timeoutMs = Number(import.meta.env.VITE_ENS_RESOLUTION_TIMEOUT_MS) || 5000;
  try {
    const res = await fetch(`https://api.ensdata.net/${address}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ens_primary?: string; ens?: string };
    const name = data.ens_primary ?? data.ens;
    return name?.trim() ? name : null;
  } catch {
    return null;
  }
}

/** Returns the primary ENS name for an address on Ethereum mainnet, or null. */
export async function getEnsNameForAddress(address: Address): Promise<string | null> {
  const viaViem = await lookupViaViem(address);
  if (viaViem) return viaViem;
  return lookupViaEnsData(address);
}
