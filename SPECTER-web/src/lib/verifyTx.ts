/**
 * Verify on-chain transactions before publishing announcements.
 * Ensures funds were actually sent to the stealth address.
 */

import { formatEther } from "viem";
import { publicClient } from "./viemClient";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { useTestnet } from "./chainConfig";

export type TxChain = "ethereum" | "sui";

export interface VerifiedTx {
  chain: TxChain;
  amount: string;
  amountFormatted: string;
  txHash: string;
  success: boolean;
}

/** Verify an Ethereum transaction: recipient matches and get amount (ETH). */
export async function verifyEthTx(
  txHash: string,
  expectedRecipient: string
): Promise<VerifiedTx> {
  const hash = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
  const tx = await publicClient.getTransaction({ hash });
  if (!tx) {
    throw new Error("Transaction not found");
  }
  const expected = expectedRecipient.toLowerCase().replace(/^0x/, "");
  const to = tx.to?.toLowerCase().replace(/^0x/, "") ?? "";
  if (to !== expected) {
    throw new Error(
      `Transaction recipient (${tx.to}) does not match stealth address (${expectedRecipient})`
    );
  }
  const valueWei = tx.value ?? 0n;
  const amountFormatted = formatEther(valueWei);
  return {
    chain: "ethereum",
    amount: valueWei.toString(),
    amountFormatted,
    txHash: hash,
    success: true,
  };
}

/** Verify a Sui transaction: recipient matches and get amount (SUI). */
export async function verifySuiTx(
  txDigest: string,
  expectedRecipient: string
): Promise<VerifiedTx> {
  const network = useTestnet ? "testnet" : "mainnet";
  const client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(network),
    network,
  });
  const expected = expectedRecipient.toLowerCase().replace(/^0x/, "");
  const tx = await client.getTransactionBlock({
    digest: txDigest,
    options: {
      showBalanceChanges: true,
      showEffects: true,
    },
  });
  if (!tx.effects?.status || tx.effects.status !== "success") {
    throw new Error("Transaction did not succeed");
  }
  const balanceChanges = tx.balanceChanges ?? [];
  let amountMist = 0n;
  let found = false;
  const SUI_COIN = "0x2::sui::SUI";
  for (const bc of balanceChanges) {
    const owner = (bc as { owner?: { AddressOwner?: string } }).owner;
    const addr = owner?.AddressOwner?.toLowerCase().replace(/^0x/, "");
    const coinType = (bc as { coinType?: string }).coinType;
    if (addr === expected && coinType === SUI_COIN) {
      const change = (bc as { amount?: string }).amount;
      if (change) {
        const delta = BigInt(change);
        // Only count positive (receiving) balance changes
        if (delta > 0n) {
          amountMist += delta;
          found = true;
        }
      }
    }
  }
  if (!found || amountMist <= 0n) {
    throw new Error(
      `No SUI transfer found to ${expectedRecipient}. Ensure the tx is a direct SUI transfer to the stealth address.`
    );
  }
  const amountFormatted = (Number(amountMist) / 1e9).toFixed(9);
  return {
    chain: "sui",
    amount: amountMist.toString(),
    amountFormatted,
    txHash: txDigest,
    success: true,
  };
}

/** Verify a transaction based on chain type. */
export async function verifyTx(
  txHash: string,
  chain: TxChain,
  expectedRecipient: string
): Promise<VerifiedTx> {
  if (chain === "ethereum") {
    return verifyEthTx(txHash, expectedRecipient);
  }
  return verifySuiTx(txHash, expectedRecipient);
}
