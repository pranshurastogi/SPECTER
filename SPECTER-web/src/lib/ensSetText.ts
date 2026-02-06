/**
 * ENS setText utility for attaching SPECTER meta-address (IPFS CID) to ENS.
 * Uses the resolver contract set for the name.
 */

import { namehash } from 'viem/ens';
import { normalize } from 'viem/ens';
import type { WalletClient, PublicClient, Address } from 'viem';

const ENS_TEXT_RECORD_KEY = 'specter';

// Minimal ABI for setText(bytes32 node, string key, string value)
const RESOLVER_SET_TEXT_ABI = [
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    name: 'setText',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export interface SetEnsTextParams {
  ensName: string;
  value: string;
  walletClient: WalletClient;
  publicClient: PublicClient;
  account: Address;
}

/**
 * Sets the ENS text record for the given name.
 * The caller must own the ENS name.
 *
 * @param params.ensName - ENS name (e.g. alice.eth)
 * @param params.value - Text record value (e.g. ipfs://Qm...)
 * @param params.walletClient - Viem wallet client for signing
 * @param params.publicClient - Viem public client for resolver lookup
 * @param params.account - Account address (must be name owner)
 * @returns Transaction hash
 */
export async function setEnsTextRecord(params: SetEnsTextParams): Promise<`0x${string}`> {
  const { ensName, value, walletClient, publicClient, account } = params;
  const normalized = normalize(ensName.trim());
  const node = namehash(normalized);

  const resolverAddress = await publicClient.getEnsResolver({
    name: normalized as `${string}.eth`,
  });

  if (!resolverAddress || resolverAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error(`No resolver set for ${ensName}. Set a resolver in the ENS app first.`);
  }

  const hash = await walletClient.writeContract({
    address: resolverAddress,
    abi: RESOLVER_SET_TEXT_ABI,
    functionName: 'setText',
    args: [node, ENS_TEXT_RECORD_KEY, value],
    account,
  });

  return hash;
}

export { ENS_TEXT_RECORD_KEY };
