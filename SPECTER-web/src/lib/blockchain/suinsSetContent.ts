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
  /** Sender address — used to fetch fresh gas coins, bypassing wallet's stale cache */
  senderAddress: string;
  /** signAndExecuteTransaction mutateAsync from dapp-kit */
  signAndExecute: (args: { transaction: Transaction }) => Promise<{ digest: string }>;
}

/**
 * Sets the contentHash on a SuiNS name record.
 * The caller must own the SuiNS name.
 *
 * Explicitly sets gas payment from freshly-fetched RPC coin data to avoid
 * wallet extensions using stale/spent coin objects from their local cache
 * (common after testnet resets).
 *
 * @returns Transaction digest
 */
export async function setSuinsContentHash(params: SetSuinsContentParams): Promise<string> {
  const { nftId, value, suiClient, network, senderAddress, signAndExecute } = params;

  const suinsClient = new SuinsClient({ client: suiClient, network });
  const tx = new Transaction();
  const suinsTx = new SuinsTransaction(suinsClient, tx);

  suinsTx.setUserData({
    nft: nftId,
    key: ALLOWED_METADATA.contentHash,
    value,
    isSubname: false,
  });

  // Fetch fresh gas coins directly from the RPC so the wallet doesn't fall back
  // to its own potentially-stale coin cache (a common issue after testnet resets
  // where coin object IDs in the wallet's storage no longer exist on-chain).
  const coinsRes = await suiClient.getCoins({ owner: senderAddress, coinType: '0x2::sui::SUI' });
  const gasCoins = coinsRes?.data ?? [];
  if (gasCoins.length === 0) {
    throw new Error(`No SUI coins found for ${senderAddress}. Fund the wallet with testnet SUI from the faucet.`);
  }

  tx.setGasPayment(
    gasCoins.map((c) => ({
      objectId: c.coinObjectId,
      version: c.version,
      digest: c.digest,
    })),
  );

  const result = await signAndExecute({ transaction: tx });
  return result.digest;
}
