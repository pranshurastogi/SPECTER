/**
 * SuiNS setUserData utility for attaching SPECTER meta-address (IPFS CID) to SuiNS.
 * Uses the @mysten/suins SDK to build the transaction.
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuinsClient, SuinsTransaction, ALLOWED_METADATA } from '@mysten/suins';
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

export interface SetSuinsContentParams {
  /** SuiNS name (e.g. alice.sui) */
  suinsName: string;
  /** NFT object ID of the SuiNS name record */
  nftId: string;
  /** Value to set as contentHash (e.g. ipfs://bafkrei...) */
  value: string;
  /** Sui JSON-RPC client */
  suiClient: SuiJsonRpcClient;
  /** Network ('mainnet' | 'testnet') */
  network: 'mainnet' | 'testnet';
  /** signAndExecuteTransaction mutateAsync from dapp-kit */
  signAndExecute: (args: { transaction: Transaction }) => Promise<{ digest: string }>;
}

/**
 * Sets the contentHash on a SuiNS name record.
 * The caller must own the SuiNS name.
 *
 * @returns Transaction digest
 */
export async function setSuinsContentHash(params: SetSuinsContentParams): Promise<string> {
  const { nftId, value, suiClient, network, signAndExecute } = params;

  const suinsClient = new SuinsClient({ client: suiClient, network });
  const tx = new Transaction();
  const suinsTx = new SuinsTransaction(suinsClient, tx);

  suinsTx.setUserData({
    nft: nftId,
    key: ALLOWED_METADATA.contentHash,
    value,
    isSubname: false,
  });

  const result = await signAndExecute({ transaction: tx });
  return result.digest;
}
