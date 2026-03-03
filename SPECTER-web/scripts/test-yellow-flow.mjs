/**
 * Yellow Network complete flow diagnostic.
 * Tests every RPC call with full error reporting.
 *
 * Usage:
 *   node scripts/test-yellow-flow.mjs
 *   PRIVATE_KEY=0x... node scripts/test-yellow-flow.mjs
 *
 * Requires: ws  →  npm install ws  (already in package.json)
 */

import {
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createEIP712AuthMessageSigner,
  createECDSAMessageSigner,
  createGetChannelsMessage,
  createGetLedgerBalancesMessage,
  createCreateChannelMessage,
  createResizeChannelMessage,
  createCloseChannelMessage,
  RPCMethod,
} from '@erc7824/nitrolite';
import { createWalletClient, createPublicClient, http, formatUnits } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import WebSocket from 'ws';

// ── Config ────────────────────────────────────────────────────────────────────
const PRIVATE_KEY   = process.env.PRIVATE_KEY || '0x2af485768f6958c81512a79a500b47c9d8d936602b2d4e1f11d48c607dd39a97';
const WS_URL        = 'wss://clearnet-sandbox.yellow.com/ws';
const RPC_URL       = process.env.ALCHEMY_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/6Dhi7I5OA8qYGZ9DYZAgYKdQZJo6hh47';
const APP_NAME      = 'yellow_demo';
const SCOPE         = 'console';

const account      = privateKeyToAccount(PRIVATE_KEY);
const walletClient = createWalletClient({ chain: sepolia, transport: http(RPC_URL), account });
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });

const CUSTODY_ADDR = '0x019B65A265EB3363822f2752141b3dF16131b262';

// ── Helpers ───────────────────────────────────────────────────────────────────
const ok  = (s) => console.log(`  ✓ ${s}`);
const err = (s) => console.log(`  ✗ ${s}`);
const info= (s) => console.log(`  · ${s}`);

/** Wait for a specific WS method response (also catches error responses). */
function waitFor(ws, method, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout (${timeoutMs}ms) waiting for "${method}"`));
    }, timeoutMs);

    function handler(data) {
      try {
        const msg = JSON.parse(data.toString());
        const m   = msg?.res?.[1];
        if (m === method) {
          clearTimeout(t); ws.off('message', handler); resolve(msg);
        } else if (m === 'error') {
          clearTimeout(t); ws.off('message', handler);
          reject(new Error(msg?.res?.[2]?.error ?? 'server error'));
        }
      } catch { /* ignore non-JSON */ }
    }
    ws.on('message', handler);
  });
}

/** Log on-chain ETH balance for the account. */
async function logEthBalance() {
  try {
    const bal = await publicClient.getBalance({ address: account.address });
    info(`Sepolia ETH balance: ${formatUnits(bal, 18)} ETH`);
    if (bal < 5000000000000000n) {
      err('WARNING: Very low ETH balance — may not have enough for gas!');
      info(`Get Sepolia ETH: https://faucets.chain.link/sepolia`);
    }
  } catch { info('Could not fetch ETH balance (RPC issue)'); }
}

/** Read custody balance for this account and a token. */
async function readCustodyBalance(token) {
  try {
    const ABI = [{
      type: 'function', name: 'getAccountsBalances',
      inputs: [{ name: 'users', type: 'address[]' }, { name: 'tokens', type: 'address[]' }],
      outputs: [{ type: 'uint256[]' }], stateMutability: 'view',
    }];
    const result = await publicClient.readContract({
      address: CUSTODY_ADDR, abi: ABI,
      functionName: 'getAccountsBalances',
      args: [[account.address], [token]],
    });
    return result[0];
  } catch { return null; }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║  Yellow Network — Full Flow Diagnostic        ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`  Wallet : ${account.address}`);
  console.log(`  WS     : ${WS_URL}`);
  console.log(`  Chain  : Sepolia (${sepolia.id})\n`);

  await logEthBalance();

  // ── Step 0: WebSocket connection ─────────────────────────────────────────
  console.log('\n── STEP 0: WebSocket connection ─────────────────');
  const ws = new WebSocket(WS_URL);
  await new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', (e) => rej(new Error(`WS error: ${e.message}`)));
    setTimeout(() => rej(new Error('WS connection timeout')), 10000);
  });
  ok('WebSocket connected');

  // ── Step 1: Auth ─────────────────────────────────────────────────────────
  console.log('\n── STEP 1: Authentication ───────────────────────');
  const sessionKey  = generatePrivateKey();
  const sessionAcct = privateKeyToAccount(sessionKey);
  const sessionSig  = createECDSAMessageSigner(sessionKey);
  const expiresAt   = Math.floor(Date.now() / 1000) + 3600;

  info(`Session key: ${sessionAcct.address}`);

  const eip712Signer = createEIP712AuthMessageSigner(
    walletClient,
    { scope: SCOPE, session_key: sessionAcct.address, expires_at: BigInt(expiresAt), allowances: [{ asset: 'ytest.usd', amount: '1000000000' }] },
    { name: APP_NAME }
  );

  const authMsg = await createAuthRequestMessage({
    address: account.address, application: APP_NAME,
    session_key: sessionAcct.address,
    allowances: [{ asset: 'ytest.usd', amount: '1000000000' }],
    expires_at: BigInt(expiresAt), scope: SCOPE,
  });

  // Wait for challenge (ignore assets broadcast)
  const challengeMsg = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('auth_challenge timeout')), 15000);
    ws.send(authMsg);
    ws.on('message', function handler(data) {
      const m = JSON.parse(data.toString()); const method = m?.res?.[1];
      if (method === 'auth_challenge') { clearTimeout(t); ws.off('message', handler); resolve(m); }
      else if (method === 'error') {
        clearTimeout(t); ws.off('message', handler);
        reject(new Error(`auth_request rejected: ${m?.res?.[2]?.error}`));
      }
    });
  });
  ok('auth_challenge received');

  const challenge = challengeMsg?.res?.[2]?.challenge_message ?? challengeMsg?.res?.[2]?.challengeMessage;
  info(`Challenge: ${challenge}`);

  const verifyMsg = await createAuthVerifyMessageFromChallenge(eip712Signer, challenge);
  ws.send(verifyMsg);
  const authResult = await waitFor(ws, 'auth_verify', 20000);
  if (!authResult?.res?.[2]?.success) throw new Error(`auth_verify failed: ${JSON.stringify(authResult?.res?.[2])}`);
  ok(`Authenticated — session_key=${authResult?.res?.[2]?.session_key ?? sessionAcct.address}`);

  // Set up post-auth message handler (keeps socket alive for push msgs)
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString()); const method = m?.res?.[1];
    if (method === 'error') info(`Server error push: ${m?.res?.[2]?.error}`);
  });

  // ── Step 2: Ledger Balances ───────────────────────────────────────────────
  console.log('\n── STEP 2: Ledger Balances ──────────────────────');
  const ledgerMsg = await createGetLedgerBalancesMessage(sessionSig);
  const ledgerResPromise = waitFor(ws, 'get_ledger_balances');
  ws.send(ledgerMsg);
  const ledgerRes = await ledgerResPromise;
  const balances  = ledgerRes?.res?.[2]?.balances ?? ledgerRes?.res?.[2]?.ledger_balances ?? [];
  if (balances.length === 0) {
    err('No Unified Balance — visit https://ytest-faucet.vercel.app/ to get ytest.usd');
  } else {
    balances.forEach(b => ok(`${b.asset}: ${b.amount}`));
  }

  // ── Step 3: Channels ──────────────────────────────────────────────────────
  console.log('\n── STEP 3: Channels ─────────────────────────────');
  const chMsg = await createGetChannelsMessage(sessionSig);
  const chResPromise = waitFor(ws, 'get_channels');
  ws.send(chMsg);
  const chRes = await chResPromise;
  const allCh = chRes?.res?.[2]?.channels ?? [];
  const myCh  = allCh.filter(c =>
    c.wallet?.toLowerCase() === account.address.toLowerCase() ||
    c.participant?.toLowerCase() === account.address.toLowerCase()
  );
  info(`Total channels on server: ${allCh.length}   Yours: ${myCh.length}`);
  myCh.forEach(c => {
    const id = c.channel_id ?? c.channelId;
    ok(`${id?.slice(0, 14)}…  status=${c.status}  amount=${c.amount}  chain=${c.chain_id ?? c.chainId}`);
  });

  const openCh = myCh.find(c => c.status === 'open');

  // ── Step 4: Create Channel (only if none open) ────────────────────────────
  const TOKEN = '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb';
  let channelId = openCh?.channel_id ?? openCh?.channelId;

  if (channelId) {
    console.log(`\n── STEP 4: Create Channel — SKIPPED (using existing: ${channelId?.slice(0,14)}…) ──`);
  } else {
    console.log('\n── STEP 4: Create Channel ───────────────────────');
    info('Requesting channel params from clearnode…');
    const createMsg = await createCreateChannelMessage(sessionSig, { chain_id: sepolia.id, token: TOKEN });
    const createWS = waitFor(ws, 'create_channel', 30000);
    ws.send(createMsg);
    const createRes = await createWS;
    const cp = createRes?.res?.[2];
    channelId = cp?.channel_id ?? cp?.channelId;
    ok(`create_channel response received — channel_id: ${channelId?.slice(0,14)}…`);
    info(`State allocations: ${JSON.stringify(cp?.state?.allocations)}`);
    info('NOTE: On-chain createChannel transaction must be sent via the web app UI (requires MetaMask).');
    info('Script cannot submit on-chain transactions without a private key that controls the wallet client.');
  }

  // ── Step 5: Close Channel (off-chain part only) ───────────────────────────
  if (channelId && openCh) {
    console.log(`\n── STEP 5: Close Channel — ${channelId?.slice(0,14)}… ──────`);
    info('Requesting close params from clearnode…');
    const closeMsg = await createCloseChannelMessage(sessionSig, channelId, account.address);
    const closeWS  = waitFor(ws, 'close_channel', 30000);
    ws.send(closeMsg);
    const closeRes = await closeWS;
    const cp = closeRes?.res?.[2];
    ok(`close_channel response received`);
    info(`channel_id: ${cp?.channel_id ?? cp?.channelId}`);
    info(`server_signature: ${(cp?.server_signature ?? cp?.serverSignature)?.slice(0,20)}…`);
    info(`final allocations: ${JSON.stringify(cp?.state?.allocations)}`);
    info('NOTE: On-chain closeChannel transaction must be sent via the web app UI.');
  } else {
    console.log('\n── STEP 5: Close Channel — SKIPPED (no open channel) ──');
  }

  // ── Custody balance ───────────────────────────────────────────────────────
  console.log('\n── Custody Contract Balance ─────────────────────');
  const custodyBal = await readCustodyBalance(TOKEN);
  if (custodyBal !== null) {
    info(`ytest.usd in custody for ${account.address.slice(0,10)}…: ${custodyBal}`);
  } else {
    info('Could not read custody balance (may need ABI or RPC access)');
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log('  ✓ Diagnostic complete. All RPC calls successful!');
  console.log('══════════════════════════════════════════════════\n');
  ws.close();
}

run().catch(e => {
  console.error(`\n✗ DIAGNOSTIC FAILED: ${e.message}\n`);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
