#!/usr/bin/env node
/**
 * SPECTER SuiNS end-to-end test.
 *
 * 1. Import Sui wallet from private key
 * 2. Find SuiNS names owned by the wallet
 * 3. Generate SPECTER keys (via backend API)
 * 4. Upload meta-address to IPFS (via backend API)
 * 5. Set contentHash on SuiNS name (on-chain Sui tx)
 * 6. Resolve via backend API
 * 7. Verify match
 *
 * Usage:
 *   SUI_PRIVATE_KEY=suiprivkey1qq... node run.mjs
 *   SUI_PRIVATE_KEY=suiprivkey1qq... BASE_URL=http://localhost:3001 node run.mjs
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Transaction } from "@mysten/sui/transactions";
import { SuinsClient } from "@mysten/suins";

const BACKEND = process.env.BASE_URL || "http://localhost:3001";
const PRIVATE_KEY = process.env.SUI_PRIVATE_KEY;
const NETWORK = process.env.SUI_NETWORK || "testnet";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function keypairFromPrivateKey(bech32Key) {
  const { scheme, secretKey } = decodeSuiPrivateKey(bech32Key);
  if (scheme === "ED25519") return Ed25519Keypair.fromSecretKey(secretKey);
  if (scheme === "Secp256k1") return Secp256k1Keypair.fromSecretKey(secretKey);
  throw new Error(`Unsupported key scheme: ${scheme}`);
}

async function api(path, opts = {}) {
  const url = `${BACKEND}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const body = await res.text();
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    json = body;
  }
  if (!res.ok) {
    const msg =
      (json && typeof json === "object" && (json.error?.message || json.message)) ||
      body ||
      res.statusText;
    throw new Error(`API ${res.status}: ${msg}`);
  }
  return json;
}

function step(n, label) {
  console.log(`\n==> Step ${n}: ${label}`);
}

function info(msg) {
  console.log(`    ${msg}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║        SPECTER — SuiNS End-to-End Test                  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  if (!PRIVATE_KEY) {
    console.error(
      "\nError: SUI_PRIVATE_KEY env var required.\n" +
        "Usage: SUI_PRIVATE_KEY=suiprivkey1qq... node run.mjs\n"
    );
    process.exit(1);
  }

  // ── Step 0: Setup wallet ──────────────────────────────────────────────────

  step(0, "Setup wallet");

  const keypair = keypairFromPrivateKey(PRIVATE_KEY);
  const address = keypair.getPublicKey().toSuiAddress();
  info(`Address:  ${address}`);
  info(`Network:  ${NETWORK}`);
  info(`Backend:  ${BACKEND}`);

  // Check backend health
  const health = await api("/health");
  info(`Backend:  OK (v${health.version}, testnet=${health.use_testnet})`);

  // Setup Sui + SuiNS clients
  const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(NETWORK) });
  const suinsClient = new SuinsClient({ client: suiClient, network: NETWORK });

  // Check balance
  const balance = await suiClient.getBalance({ owner: address });
  const suiBalance = (Number(balance.totalBalance) / 1e9).toFixed(4);
  info(`Balance:  ${suiBalance} SUI`);

  if (Number(balance.totalBalance) === 0) {
    console.error("\n    Error: No SUI balance. Fund the wallet first.");
    console.error("    Testnet faucet: https://faucet.sui.io/");
    process.exit(1);
  }

  // ── Step 1: Find SuiNS names ─────────────────────────────────────────────

  step(1, "Find SuiNS names");

  const namesResult = await suiClient.resolveNameServiceNames({ address });
  const names = namesResult.data;

  if (!names || names.length === 0) {
    console.error("\n    Error: No SuiNS names found for this wallet.");
    console.error("    Register a name at https://suins.io first.");
    process.exit(1);
  }

  info(`Found ${names.length} name(s): ${names.join(", ")}`);
  const suinsName = names[0];
  info(`Using:    ${suinsName}`);

  // Get name record (we need the NFT ID)
  const nameRecord = await suinsClient.getNameRecord(suinsName);
  info(`NFT ID:   ${nameRecord.nftId}`);
  info(`Target:   ${nameRecord.targetAddress || "(not set)"}`);

  if (nameRecord.data?.contentHash) {
    info(`Current contentHash: ${nameRecord.data.contentHash}`);
  }

  // ── Step 2: Generate SPECTER keys ─────────────────────────────────────────

  step(2, "Generate SPECTER keys");

  const keys = await api("/api/v1/keys/generate", { method: "POST" });
  info(`Meta-address: ${keys.meta_address.slice(0, 40)}...`);
  info(`View tag:     ${keys.view_tag}`);

  // ── Step 3: Upload meta-address to IPFS ───────────────────────────────────

  step(3, "Upload meta-address to IPFS");

  const upload = await api("/api/v1/ipfs/upload", {
    method: "POST",
    body: JSON.stringify({
      meta_address: keys.meta_address,
      name: `${suinsName.replace(/\.sui$/i, "")}-specter-profile`,
    }),
  });

  info(`CID:          ${upload.cid}`);
  info(`Content hash: ${upload.text_record}`);

  // Verify IPFS retrieval
  try {
    await api(`/api/v1/ipfs/${upload.cid}`);
    info(`IPFS:         OK (retrievable)`);
  } catch {
    info(`IPFS:         WARNING - retrieval failed, may need time to propagate`);
  }

  // ── Step 4: Set contentHash on SuiNS ──────────────────────────────────────

  step(4, `Set contentHash on ${suinsName}`);

  info(`Value: ${upload.text_record}`);

  // Build the setUserData transaction.
  //
  // The SuiNS SDK's SuinsTransaction wraps a PTB and provides helpers.
  // We import it dynamically in case the export location differs between versions.
  let SuinsTransaction, ALLOWED_METADATA;
  try {
    const suinsModule = await import("@mysten/suins");
    SuinsTransaction = suinsModule.SuinsTransaction;
    ALLOWED_METADATA = suinsModule.ALLOWED_METADATA;
  } catch (e) {
    console.error("\n    Error importing SuinsTransaction:", e.message);
    console.error("    Try: npm install @mysten/suins@latest");
    process.exit(1);
  }

  if (!SuinsTransaction || !ALLOWED_METADATA) {
    console.error(
      "\n    Error: SuinsTransaction or ALLOWED_METADATA not found in @mysten/suins exports."
    );
    console.error("    Available exports:");
    const mod = await import("@mysten/suins");
    console.error("   ", Object.keys(mod).join(", "));
    process.exit(1);
  }

  const tx = new Transaction();
  const suinsTx = new SuinsTransaction(suinsClient, tx);

  suinsTx.setUserData({
    nft: nameRecord.nftId,
    key: ALLOWED_METADATA.contentHash,
    value: upload.text_record,
    isSubname: false,
  });

  info("Signing and sending transaction...");

  const result = await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });

  info(`Tx digest: ${result.digest}`);

  // Wait for confirmation
  info("Waiting for confirmation...");
  await suiClient.waitForTransaction({ digest: result.digest });

  const status = result.effects?.status?.status || "unknown";
  if (status !== "success") {
    console.error(`\n    Error: Transaction failed with status: ${status}`);
    process.exit(1);
  }

  info(`Status:   ${status}`);

  // Small delay for RPC propagation
  info("Waiting 3s for RPC propagation...");
  await new Promise((r) => setTimeout(r, 3000));

  // ── Step 5: Resolve via backend ───────────────────────────────────────────

  step(5, `Resolve ${suinsName} via backend`);

  try {
    const resolved = await api(
      `/api/v1/suins/resolve/${encodeURIComponent(suinsName)}?no_cache=true`
    );

    info(`Resolved name:  ${resolved.suins_name}`);
    info(`Meta-address:   ${resolved.meta_address.slice(0, 40)}...`);
    if (resolved.ipfs_cid) {
      info(`IPFS CID:       ${resolved.ipfs_cid}`);
    }

    // ── Step 6: Verify ────────────────────────────────────────────────────────

    step(6, "Verify match");

    const match = keys.meta_address === resolved.meta_address;

    console.log("");
    console.log(
      "────────────────────────────────────────────────────────────"
    );
    console.log(`  Original:  ${keys.meta_address.slice(0, 30)}...`);
    console.log(`  Resolved:  ${resolved.meta_address.slice(0, 30)}...`);
    console.log("");

    if (match) {
      console.log("  ✓ MATCH — SuiNS + IPFS round-trip verified!");
    } else {
      console.log("  ✗ MISMATCH");
    }
    console.log(
      "────────────────────────────────────────────────────────────"
    );

    process.exit(match ? 0 : 1);
  } catch (err) {
    console.error(`\n    Resolution failed: ${err.message}`);
    console.error("\n    Possible causes:");
    console.error(
      "    - Backend SUI_RPC_URL doesn't match the network used for the tx"
    );
    console.error(
      "    - Content hash format not recognized by backend resolver"
    );
    console.error("    - RPC propagation delay (try again in a few seconds)");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
