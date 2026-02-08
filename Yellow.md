# SPECTER x Yellow Network

> **Private state channel trading** powered by post-quantum stealth addresses.

---

## Run everything locally

To use the Yellow section in the app without "Backend not reachable", run both the SPECTER backend and the frontend.

### Prerequisites

- **Rust** (for the backend): [rustup](https://rustup.rs)
- **Node.js 16+** (for the frontend): [nodejs.org](https://nodejs.org)
- **Ethereum wallet** on Sepolia (e.g. MetaMask) for Create/Fund/Transfer/Close

### 1. Backend (Terminal 1)

From the repo root:

```bash
cd specter
cargo run --bin specter -- serve --port 3001
```

Leave this running. You should see: `SPECTER API server listening on 0.0.0.0:3001`.

Optional: create `specter/.env` to override Yellow/ENS settings (see [Environment variables](#environment-variables) below).

### 2. Frontend (Terminal 2)

From the repo root:

```bash
cd SPECTER-web
cp .env.example .env
# Edit .env and set VITE_API_BASE_URL=http://localhost:3001 (default)
npm install
npm run dev
```

Leave this running. The app is usually at **http://localhost:5173**.

### 3. Open the Yellow page

- In the app, go to **Yellow** in the nav (or open **http://localhost:5173/yellow**).
- If the backend is running, the Yellow page loads without the "Backend not reachable" banner.
- If you see that banner, use **Retry** after starting the backend, or check that `VITE_API_BASE_URL` in `SPECTER-web/.env` is `http://localhost:3001`.

### 4. Quick check that the backend is up

```bash
curl -s http://localhost:3001/api/v1/yellow/config | head -5
```

You should get JSON with `ws_url`, `custody_address`, `adjudicator_address`, etc.

---

## What is it?

SPECTER + Yellow Network enables **anonymous off-chain trading**. Traditional state channels expose who is trading with whom on-chain. SPECTER makes the counterparty **unlinkable** by routing channels through one-time stealth addresses.

```
Traditional Channel:    Alice ──channel──> Bob       (everyone sees Alice <-> Bob)
SPECTER + Yellow:       Alice ──channel──> 0xStealth (nobody knows 0xStealth = Bob)
```

---

## How it works

```
                          SPECTER x YELLOW FLOW

  ┌──────────────────────────────────────────────────────────────────────┐
  │                                                                      │
  │  1. SETUP                                                            │
  │  Bob generates SPECTER keys ─> publishes meta-address to ENS         │
  │                                                                      │
  │  2. CHANNEL CREATION (Alice wants to trade with Bob)                 │
  │  ┌─────────┐     ┌──────────────┐     ┌───────────────┐             │
  │  │  Alice   │────>│ Resolve      │────>│ Create Stealth│             │
  │  │  (Sender)│     │ bob.eth      │     │ Address       │             │
  │  └─────────┘     └──────────────┘     └───────┬───────┘             │
  │                                                │                     │
  │                         ┌──────────────────────┤                     │
  │                         v                      v                     │
  │                  ┌──────────────┐     ┌───────────────┐             │
  │                  │ Open Yellow  │     │ Publish       │             │
  │                  │ Channel to   │     │ Announcement  │             │
  │                  │ stealth addr │     │ (+ channel_id)│             │
  │                  └──────────────┘     └───────────────┘             │
  │                                                                      │
  │  3. DISCOVERY (Bob finds the channel)                                │
  │  ┌─────────┐     ┌──────────────┐     ┌───────────────┐             │
  │  │  Bob     │────>│ Scan SPECTER │────>│ Derive stealth│             │
  │  │  (Recvr) │     │ announcements│     │ private key   │             │
  │  └─────────┘     └──────────────┘     └───────┬───────┘             │
  │                                                │                     │
  │                                                v                     │
  │                                       ┌───────────────┐             │
  │                                       │ Import channel│             │
  │                                       │ with key      │             │
  │                                       └───────────────┘             │
  │                                                                      │
  │  4. TRADING (off-chain, instant, gasless)                            │
  │  Alice <────── signed state updates ──────> Bob (via stealth key)    │
  │                                                                      │
  │  5. SETTLEMENT                                                       │
  │  Cooperative close ──> funds to stealth addr ──> Bob withdraws       │
  │                                                                      │
  └──────────────────────────────────────────────────────────────────────┘
```

---

## Privacy guarantees

| Property | Guarantee |
|----------|-----------|
| **Unlinkable** | On-chain observer cannot link stealth address to Bob |
| **Untraceable** | Cannot prove Alice and Bob are trading |
| **Post-quantum** | ML-KEM-768 (~192-bit classical, ~128-bit quantum security) |
| **Efficient** | View tags skip 99.6% of announcements during scanning |

---

## Network configuration (Sepolia Testnet)

| Parameter | Value |
|-----------|-------|
| WebSocket (prod default) | `wss://clearnet.yellow.com/ws` (sandbox: `wss://clearnet-sandbox.yellow.com/ws`) |
| Custody Contract | `0x019B65A265EB3363822f2752141b3dF16131b262` |
| Adjudicator | `0x7c7ccbc98469190849BCC6c926307794fDfB11F2` |
| Chain | Sepolia (`11155111`) |
| Test Token (USDC) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |

---

## API endpoints

All endpoints are under `/api/v1/yellow/`.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/yellow/channel/create` | Create private channel (stealth address + announcement) |
| POST | `/yellow/channel/discover` | Scan for incoming channels with SPECTER keys |
| POST | `/yellow/channel/fund` | Add funds to a channel |
| POST | `/yellow/channel/close` | Close channel and settle on L1 |
| GET | `/yellow/channel/:id/status` | Get channel status and balances |
| POST | `/yellow/transfer` | Off-chain transfer within a channel |
| GET | `/yellow/config` | Get Yellow Network configuration |

### Request / Response examples

**Create Channel**
```bash
curl -X POST http://localhost:3001/api/v1/yellow/channel/create \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "bob.eth",
    "token": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    "amount": "100"
  }'
```
```json
{
  "channel_id": "a1b2c3...64hex",
  "stealth_address": "0x1234...5678",
  "announcement": {
    "ephemeral_key": "...",
    "view_tag": 42,
    "channel_id": "a1b2c3...64hex"
  },
  "tx_hash": "0x..."
}
```

**Discover Channels**
```bash
curl -X POST http://localhost:3001/api/v1/yellow/channel/discover \
  -H "Content-Type: application/json" \
  -d '{
    "viewing_sk": "<hex>",
    "spending_pk": "<hex>",
    "spending_sk": "<hex>"
  }'
```
```json
{
  "channels": [
    {
      "channel_id": "a1b2c3...",
      "stealth_address": "0x1234...",
      "eth_private_key": "0xabcd...",
      "status": "open",
      "discovered_at": 1707400000
    }
  ]
}
```

**Get Config**
```bash
curl http://localhost:3001/api/v1/yellow/config
```
```json
{
  "ws_url": "wss://clearnet.yellow.com/ws",
  "custody_address": "0x019B65A265EB3363822f2752141b3dF16131b262",
  "adjudicator_address": "0x7c7ccbc98469190849BCC6c926307794fDfB11F2",
  "chain_id": 11155111,
  "supported_tokens": [
    { "symbol": "USDC", "address": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", "decimals": 6 },
    { "symbol": "ETH", "address": "0x0000000000000000000000000000000000000000", "decimals": 18 }
  ]
}
```

---

## Testing guide

**First time:** follow [Run everything locally](#run-everything-locally) so the backend and frontend are running.

### 1. Test via the UI

Open **http://localhost:5173/yellow** and follow the tabs:

```
┌──────────────────────────────────────────────────┐
│  Yellow Network                                   │
│                                                   │
│  [ My Channels ] [ Create Channel ] [ Discover ]  │
│                                                   │
│  • Create Channel: Enter recipient (e.g. bob.eth) │
│    Set token and amount, resolve, then Create      │
│  • 5-step wizard: Recipient → Stealth → Open →     │
│    Fund (Yellow session) → Publish                 │
│  • My Channels: Transfer / Fund / Close           │
│  • Discover: Paste SPECTER keys, Scan for channels │
└──────────────────────────────────────────────────┘
```

### 2. Test via curl (API-only)

```bash
# 1. Check Yellow config
curl http://localhost:3001/api/v1/yellow/config | jq .

# 2. Generate keys for Bob (the recipient)
BOB_KEYS=$(curl -s -X POST http://localhost:3001/api/v1/keys/generate)
echo "$BOB_KEYS" | jq .

# 3. Alice creates a private channel to Bob's meta-address
META=$(echo "$BOB_KEYS" | jq -r '.meta_address')
CHANNEL=$(curl -s -X POST http://localhost:3001/api/v1/yellow/channel/create \
  -H "Content-Type: application/json" \
  -d "{\"recipient\": \"$META\", \"token\": \"0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238\", \"amount\": \"500\"}")
echo "$CHANNEL" | jq .

# 4. Bob discovers the channel
VIEWING_SK=$(echo "$BOB_KEYS" | jq -r '.viewing_sk')
SPENDING_PK=$(echo "$BOB_KEYS" | jq -r '.spending_pk')
SPENDING_SK=$(echo "$BOB_KEYS" | jq -r '.spending_sk')
curl -s -X POST http://localhost:3001/api/v1/yellow/channel/discover \
  -H "Content-Type: application/json" \
  -d "{\"viewing_sk\": \"$VIEWING_SK\", \"spending_pk\": \"$SPENDING_PK\", \"spending_sk\": \"$SPENDING_SK\"}" | jq .

# 5. Check channel status
CHANNEL_ID=$(echo "$CHANNEL" | jq -r '.channel_id')
curl -s "http://localhost:3001/api/v1/yellow/channel/$CHANNEL_ID/status" | jq .

# 6. Off-chain transfer
curl -s -X POST http://localhost:3001/api/v1/yellow/transfer \
  -H "Content-Type: application/json" \
  -d "{\"channel_id\": \"$CHANNEL_ID\", \"destination\": \"0x1234\", \"amount\": \"50\", \"asset\": \"ytest.usd\"}" | jq .

# 7. Close channel
curl -s -X POST http://localhost:3001/api/v1/yellow/channel/close \
  -H "Content-Type: application/json" \
  -d "{\"channel_id\": \"$CHANNEL_ID\"}" | jq .
```

### 3. Verify Rust crate tests

```bash
cd specter
cargo test -p specter-yellow
cargo test -p specter-api
```

---

## Environment variables

Add these to `specter/.env` if you want to override defaults:

```bash
# Optional: default is production; for testing use sandbox:
# YELLOW_WS_URL=wss://clearnet-sandbox.yellow.com/ws
YELLOW_WS_URL=wss://clearnet.yellow.com/ws
YELLOW_CUSTODY_ADDRESS=0x019B65A265EB3363822f2752141b3dF16131b262
YELLOW_ADJUDICATOR_ADDRESS=0x7c7ccbc98469190849BCC6c926307794fDfB11F2
YELLOW_CHAIN_ID=11155111
```

---

## Rust crate: `specter-yellow`

```
specter-yellow/src/
├── lib.rs          # Module exports
├── types.rs        # YellowConfig, ChannelStatus, PrivateChannelInfo,
│                   # SessionKey, CreateChannelResult, DiscoveredChannel,
│                   # SettlementResult, RPC message types
├── client.rs       # YellowClient: auth, create_private_channel,
│                   # discover_private_channels, close_channel
├── channel.rs      # PrivateChannelBuilder (fluent API), PrivateChannel
├── discovery.rs    # ChannelDiscovery: scan_all, scan_time_range
└── settlement.rs   # PrivateSettlement: close, withdraw, sweep_to_main_wallet
                    # BatchSettlement: close_all
```

### Key types

```
YellowConfig           ──> ws_url, rpc_url, chain_id, custody/adjudicator addresses
PrivateChannelInfo     ──> channel_id, stealth_address, view_tag, token, status, allocations
DiscoveredChannel      ──> channel_id, stealth_address, stealth_private_key, eth_private_key
CreateChannelResult    ──> channel_id, stealth_address, announcement data, tx_hash
SettlementResult       ──> channel_id, final_balances, close_tx_hash, withdrawal_tx_hash
```

---

## Frontend: `/yellow` page

```
SPECTER-web/src/pages/YellowPage.tsx

Components (all in one file):
├── YellowPage              Main page with tabs and state management
├── YellowStats             Network stats bar (chain, tokens, status)
├── CreatePrivateChannel    5-step animated wizard
├── DiscoverChannels        Key input + scan with progress bar
├── ChannelCard             Single channel display with actions
├── TransferModal           Off-chain transfer dialog
├── FundModal               Add funds dialog
└── CloseChannelModal       5-step settlement flow with L1 tracking
```

---

## Settlement flow

```
Step 1:  Request cooperative close
         └── Both parties sign final state

Step 2:  Submit to Sepolia L1
         └── Tx hash: 0x... [View on Etherscan]

Step 3:  Wait for block confirmations
         └── ████████░░░░░░░░  (progress bar)

Step 4:  Withdraw to stealth address
         └── Funds arrive at one-time address

Step 5:  (Optional) Sweep to main wallet
         └── Import stealth private key, transfer out
```

---

## On-chain channel creation (current flow)

The Yellow section now **creates a real channel on Sepolia**:

1. **Create on-chain**: The app uses the Nitrolite SDK and Yellow ClearNode: connect to ClearNode → auth (if needed) → request CreateChannel params → submit `depositAndCreateChannel` to the custody contract. This locks USDC and creates the channel; you get a real `channelId` and `txHash` on Sepolia.
2. **Register stealth**: The app calls the SPECTER API with that `channel_id` and recipient; the backend publishes the announcement with the real channel ID.
3. **Fund app session**: The app creates a Yellow app session (user + stealth address, allocations) so the locked funds are associated with the stealth address for private settlement.

Closing the channel sends a cooperative close to Yellow with `funds_destination` = stealth address; Yellow’s ClearNode can then settle on-chain so USDC moves to the stealth address.

---

**Legacy channels** (created before on-chain create was added) used a random `channel_id` and no custody contract call, so no on-chain tx or settlement. With the **new flow**, channel create is on-chain; **close** settlement still depends on Yellow’s ClearNode processing the close and submitting to the adjudicator.

---

## Limitations (current)

- **Create is on-chain**: New channels use Nitrolite + ClearNode to create and fund on Sepolia. Close still depends on Yellow’s ClearNode submitting settlement when you send the close request.
- **Default: production**: Yellow WebSocket defaults to `wss://clearnet.yellow.com/ws`. Set `YELLOW_WS_URL=wss://clearnet-sandbox.yellow.com/ws` for sandbox testing.
- **In-memory registry**: Announcements are lost on backend restart
- **Simplified auth**: EIP-712 signing is placeholder (not full production auth)
- **No persistent channels**: Channel state is client-side only
- **Sepolia testnet**: All L1 operations target Sepolia

---

<p align="center">
  <strong>SPECTER x Yellow</strong> = Post-quantum privacy + Off-chain speed
</p>
