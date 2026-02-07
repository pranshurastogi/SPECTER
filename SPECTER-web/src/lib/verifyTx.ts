/**
 * Verify on-chain transactions before publishing announcements.
 * Ensures funds were actually sent to the stealth address.
 */

import { formatEther } from "viem";
import { publicClient } from "./viemClient";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { normalizeSuiAddress } from "@mysten/sui/utils";
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
  const hash = (txHash.startsWith("0x") ? txHash : `0x${txHash}`) as `0x${string}`;
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

/** Extract address from owner (handles AddressOwner, ObjectOwner, snake_case, or string). */
function getOwnerAddress(owner: unknown): string | null {
  if (!owner) return null;
  if (typeof owner === "string") return owner;
  if (typeof owner === "object" && owner !== null) {
    const o = owner as Record<string, unknown>;
    // PascalCase (JSON-RPC)
    if (typeof o.AddressOwner === "string") return o.AddressOwner;
    // camelCase / nested
    if (typeof o.address === "string") return o.address;
    // snake_case (some RPC implementations)
    if (typeof (o as Record<string, unknown>).address_owner === "string")
      return (o as Record<string, unknown>).address_owner as string;
    if (typeof o.ObjectOwner === "string") return o.ObjectOwner;
  }
  return null;
}

/** Verify a Sui transaction: recipient matches and get amount (SUI). */
export async function verifySuiTx(
  txDigest: string,
  expectedRecipient: string
): Promise<VerifiedTx> {
  const expectedNorm = normalizeSuiAddress(expectedRecipient);
  const digest = txDigest.startsWith("0x") ? txDigest.slice(2) : txDigest.trim();

  // Try preferred network first, then the other if tx not found
  const networks: Array<"mainnet" | "testnet"> = useTestnet ? ["testnet", "mainnet"] : ["mainnet", "testnet"];
  let tx: Awaited<ReturnType<SuiJsonRpcClient["getTransactionBlock"]>> | null = null;
  let client: SuiJsonRpcClient | null = null;

  const fetchTx = async (c: SuiJsonRpcClient, d: string) =>
    c.getTransactionBlock({
      digest: d,
      options: {
        showBalanceChanges: true,
        showEffects: true,
        showObjectChanges: true,
      },
    });

  const maxRetries = 5;
  const retryDelayMs = 1500;

  for (const network of networks) {
    client = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl(network),
      network,
    });
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        tx = await fetchTx(client, digest);
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isNotFound =
          msg.includes("not found") ||
          msg.includes("Transaction") ||
          msg.includes("Could not find");
        if (isNotFound && attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, retryDelayMs));
          continue;
        }
        if (isNotFound) {
          break; // Try next network
        }
        throw e;
      }
    }
    if (tx) break;
  }

  if (!tx) {
    throw new Error("Transaction not found. Check that the digest is correct and the tx is confirmed.");
  }
  // Sui JSON-RPC returns effects.status as { status: 'success' | 'failure', error?: string }
  const statusObj = tx.effects?.status;
  const statusValue =
    typeof statusObj === "object" && statusObj !== null && "status" in statusObj
      ? (statusObj as { status?: string }).status
      : statusObj;
  const isSuccess = statusValue === "success";
  if (!isSuccess) {
    const errMsg =
      typeof statusObj === "object" && statusObj !== null && "error" in statusObj
        ? (statusObj as { error?: string }).error
        : "Unknown";
    throw new Error(`Transaction did not succeed. ${errMsg || statusValue || "Unknown status"}`);
  }
  const balanceChanges = tx.balanceChanges ?? [];
  const objectChanges = tx.objectChanges ?? [];
  let amountMist = 0n;
  let found = false;
  // SUI coin type (allow minor format variations)
  const isSuiCoin = (ct: string) =>
    ct === "0x2::sui::SUI" || ct?.toLowerCase().includes("sui::sui");
  const isSuiCoinType = (ot: string) =>
    ot?.includes("coin::Coin") && (ot?.includes("sui::SUI") || ot?.includes("sui::sui"));

  // 1. Try balanceChanges (pay, paySui)
  for (const bc of balanceChanges) {
    const owner = (bc as { owner?: unknown }).owner;
    const addrRaw = getOwnerAddress(owner);
    if (!addrRaw) continue;
    const addrNorm = normalizeSuiAddress(addrRaw);
    const coinType = (bc as { coinType?: string }).coinType ?? "";
    if (addrNorm === expectedNorm && isSuiCoin(coinType)) {
      const change = (bc as { amount?: string }).amount;
      if (change) {
        const delta = BigInt(change);
        if (delta > 0n) {
          amountMist += delta;
          found = true;
        }
      }
    }
  }

  // 2. Fallback: objectChanges for transferred or created coins (transferObjects, pay)
  if (!found && objectChanges.length > 0) {
    const coinObjectIds: string[] = [];
    for (const oc of objectChanges) {
      const obj = oc as {
        type?: string;
        recipient?: unknown;
        owner?: unknown;
        objectType?: string;
        objectId?: string;
      };
      const ot = obj.objectType ?? "";
      if (!isSuiCoinType(ot)) continue;
      let matches = false;
      if (obj.type === "transferred") {
        const recipientRaw = getOwnerAddress(obj.recipient);
        matches = recipientRaw ? normalizeSuiAddress(recipientRaw) === expectedNorm : false;
      } else if (obj.type === "created") {
        const ownerRaw = getOwnerAddress(obj.owner);
        matches = ownerRaw ? normalizeSuiAddress(ownerRaw) === expectedNorm : false;
      }
      if (matches && obj.objectId) coinObjectIds.push(obj.objectId);
    }
    if (coinObjectIds.length > 0 && client) {
      const objects = await client.multiGetObjects({
        ids: coinObjectIds,
        options: { showContent: true },
      });
      for (const obj of objects) {
        if (obj.data?.content && "dataType" in obj.data.content) {
          const content = obj.data.content as {
            dataType?: string;
            fields?: { balance?: string | { value?: string; fields?: { value?: string } } };
          };
          if (content.dataType !== "moveObject" || !content.fields?.balance) continue;
          const bal = content.fields.balance;
          const val =
            typeof bal === "string"
              ? bal
              : bal?.fields?.value ?? (bal as { value?: string }).value;
          if (val) {
            amountMist += BigInt(val);
            found = true;
          }
        }
      }
    }
  }

  if (!found || amountMist <= 0n) {
    throw new Error(
      `No SUI transfer found to ${expectedRecipient}. Ensure the tx is a direct SUI transfer (pay/paySui or transferObjects of SUI coins) to the stealth address.`
    );
  }
  const amountFormatted = (Number(amountMist) / 1e9).toFixed(9);
  return {
    chain: "sui",
    amount: amountMist.toString(),
    amountFormatted,
    txHash: digest,
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
