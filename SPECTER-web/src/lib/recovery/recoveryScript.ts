/**
 * Single source of truth for the self-runnable, headless recovery script shown
 * on `/i-dont-trust-specter` and `/self-host`.
 *
 * This is the exact logic behind the on-page "Recover my funds" button, distilled
 * to a dependency-light Node script: it reads SPECTER announcements straight from
 * a Monad RPC and runs ML-KEM-768 decapsulation + stealth-key derivation locally
 * via `@specterpq/sdk` (which ships a Node WASM build), with ZERO SPECTER calls.
 * It is a faithful port of `src/lib/recovery/recover.ts` + `announcer.ts`.
 *
 * Kept as data (not JSX) so both pages render byte-identical copy — they can
 * never drift. The script deliberately avoids backticks and `${...}` so it lives
 * cleanly inside this template literal.
 */

/** Setup commands the user runs before `recover.mjs`. */
export const RECOVERY_INSTALL: readonly string[] = [
  "npm init -y && npm pkg set type=module",
  "npm i @specterpq/sdk viem",
  "node recover.mjs ./specter-keys.json",
];

/** The full `recover.mjs` script, shown inline for the user to copy and run. */
export const RECOVERY_SCRIPT = `// recover.mjs — headless SPECTER fund recovery.
// The exact logic behind /i-dont-trust-specter, with zero SPECTER calls: reads
// announcements straight from a Monad RPC and runs ML-KEM-768 decapsulation +
// stealth-key derivation locally via @specterpq/sdk. Your secret keys never
// leave this machine.
//
//   npm init -y && npm pkg set type=module
//   npm i @specterpq/sdk viem
//   node recover.mjs ./specter-keys.json [rpcUrl]

import { readFileSync } from "node:fs";
import { createPublicClient, http, decodeFunctionData, keccak256, parseAbiItem } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { initSpecterSdk, scanAnnouncement } from "@specterpq/sdk";

// Protocol facts baked into the deployed contract (not fetched from SPECTER).
const ANNOUNCER = "0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC";
const DEPLOY_BLOCK = 37571591n;
const CHUNK = 100n;        // Monad public RPC caps eth_getLogs at 100 blocks
const RATE_PER_SEC = 18;   // stay under the ~25 req/s public cap

const ANNOUNCEMENT_EVENT = parseAbiItem(
  "event Announcement(uint256 schemeId, address indexed stealthAddress, address indexed caller, bytes32 ephemeralKeyHash, bytes metadata)"
);
const ANNOUNCE_ABI = [
  { type: "function", name: "announce", stateMutability: "nonpayable", outputs: [],
    inputs: [{ name: "stealthAddress", type: "address" }, { name: "ephemeralPubKey", type: "bytes" }, { name: "metadata", type: "bytes" }] },
  { type: "function", name: "announce", stateMutability: "nonpayable", outputs: [],
    inputs: [{ name: "schemeId", type: "uint256" }, { name: "stealthAddress", type: "address" }, { name: "ephemeralPubKey", type: "bytes" }, { name: "metadata", type: "bytes" }] },
];

const with0x = (s) => (s.startsWith("0x") ? s : "0x" + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const keysPath = process.argv[2] || "./specter-keys.json";
  const rpcUrl = process.argv[3] || process.env.RPC_URL || "https://testnet-rpc.monad.xyz";

  const k = JSON.parse(readFileSync(keysPath, "utf8"));
  for (const f of ["viewing_pk", "viewing_sk", "spending_pk", "spending_sk"])
    if (!k[f]) throw new Error('keys file missing "' + f + '"');
  const viewingKeys = { publicKey: with0x(k.viewing_pk), secretKey: with0x(k.viewing_sk) };
  const spendingPk = with0x(k.spending_pk);
  const spendingSk = with0x(k.spending_sk);

  await initSpecterSdk();
  const client = createPublicClient({ transport: http(rpcUrl) });
  const tip = await client.getBlockNumber();
  console.log("Scanning announcer " + ANNOUNCER);
  console.log("Blocks " + DEPLOY_BLOCK + ".." + tip + " via " + rpcUrl + "\\n");

  let hits = 0, seen = 0, last = 0;
  const gate = async () => { const w = last + 1000 / RATE_PER_SEC - Date.now(); if (w > 0) await sleep(w); last = Date.now(); };

  for (let end = tip; end >= DEPLOY_BLOCK; end -= CHUNK) {   // newest-first
    const start = end - CHUNK + 1n > DEPLOY_BLOCK ? end - CHUNK + 1n : DEPLOY_BLOCK;
    await gate();
    let logs;
    try {
      logs = await client.getLogs({ address: ANNOUNCER, event: ANNOUNCEMENT_EVENT, fromBlock: start, toBlock: end });
    } catch (e) { console.warn("  ! " + start + "-" + end + ": " + (e.shortMessage || e.message)); continue; }

    for (const log of logs) {
      const { ephemeralKeyHash, metadata } = log.args;
      if (!ephemeralKeyHash || !metadata || metadata === "0x") continue;
      seen++;
      // The full 1088-byte ciphertext lives in announce() calldata, not the log.
      await gate();
      const tx = await client.getTransaction({ hash: log.transactionHash });
      const args = decodeFunctionData({ abi: ANNOUNCE_ABI, data: tx.input }).args;
      const ciphertext = args.length === 3 ? args[1] : args[2];
      if (keccak256(ciphertext).toLowerCase() !== ephemeralKeyHash.toLowerCase()) continue; // tampered

      const viewTag = parseInt(metadata.slice(2, 4), 16); // plaintext byte 0
      let res;
      try {
        res = scanAnnouncement({ ephemeralCiphertext: ciphertext, viewTag }, viewingKeys, spendingPk, spendingSk);
      } catch { continue; }
      if (!res.isMatch || !res.stealthKeys) continue;

      const { ethAddress, ethPrivateKey } = res.stealthKeys;
      const ok = privateKeyToAddress(ethPrivateKey).toLowerCase() === ethAddress.toLowerCase();
      hits++;
      console.log("MATCH  " + ethAddress + (ok ? "" : "  (ADDRESS MISMATCH!)"));
      console.log("  key  " + ethPrivateKey);
      console.log("  tx   " + log.transactionHash + "  block " + log.blockNumber + "\\n");
    }
  }
  console.log("Done. Scanned " + seen + " announcement(s); recovered " + hits + " key(s).");
}

main().catch((e) => { console.error(e); process.exit(1); });
`;
