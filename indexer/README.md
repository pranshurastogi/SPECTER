# SPECTER Indexer

Envio HyperIndex for the `SPECTERAnnouncer` contract on Monad testnet.

Indexes `Announcement` events, decodes the 77-byte SPECTER metadata, and dual-writes to:
- **Envio Postgres** — queryable via GraphQL (for real-time scanning)
- **Turso** — the SPECTER API registry (for `/scan` endpoint consumers)

---

## Architecture

```
Monad testnet
  └── SPECTERAnnouncer contract
        └── Announcement events
              │
              ▼
         Envio HyperIndex (this project)
              │   ├── Decode 77-byte metadata
              │   ├── Validate 1088-byte ephemeralPubKey
              │   │
              ├──▶ Envio Postgres  (GraphQL API)
              │       AnnouncementEvent entities
              │
              └──▶ Turso (libSQL remote)
                      announcements table (on_chain=1)
```

**Confirmation depth**: 2 blocks. Monad uses MonadBFT which achieves single-slot finality, but we add a 2-block buffer before processing events to guard against any transient network issues.

---

## Setup

### 1. Install the Envio CLI

```bash
npm install -g envio
```

### 2. Set environment variables

```bash
export TURSO_DATABASE_URL="libsql://your-db.turso.io"
export TURSO_AUTH_TOKEN="your-auth-token"
```

If `TURSO_DATABASE_URL` or `TURSO_AUTH_TOKEN` are not set, the indexer still runs — it will index events to Envio Postgres only and log a warning about the missing Turso configuration.

### 3. Install dependencies and generate types

```bash
cd indexer
cp .env.example .env   # then edit .env with your Turso credentials
npm install
npm run codegen        # generates generated/ types from config.yaml + schema.graphql
```

Or use the one-liner:
```bash
npm run setup          # copies .env.example → .env, installs, runs codegen
```

### 4. Run

```bash
# Development (with live reload and local Postgres)
npm run dev

# Production
npm start
```

---

## Metadata format (77 bytes)

Each `Announcement` event carries a `metadata` payload encoding payment details:

```
Byte offset  Field            Type      Notes
──────────────────────────────────────────────────────────────────────────
[0]          view_tag         uint8     Always present. First byte of SHAKE-256(shared_secret).
                                        Recipients compute their own tag and compare.
                                        256 values → ~99.6% of non-matching events skipped.
[1..33]      tx_hash          bytes32   Source-chain tx hash. All-zero = absent.
[33..65]     amount           uint256   Payment amount (big-endian). All-zero = absent.
[65..73]     source_chain_id  uint64    EIP-155 chain ID (big-endian). 0 = absent.
[73..77]     reserved         bytes4    Always zero. Reserved for future use.
```

`ephemeralPubKey` is always **1088 bytes** (ML-KEM-1024 ciphertext, schemeId=1000).

---

## GraphQL queries

After running `envio dev`, the GraphQL API is available at `http://localhost:8080`.

### Scan by view tag (primary recipient scan)

```graphql
query {
  AnnouncementEvent(
    where: { viewTag: { _eq: 42 }, blockNumber: { _gte: "37571591" } }
    order_by: { blockNumber: asc }
    limit: 1000
  ) {
    id stealthAddress ephemeralPubKey viewTag txHash sourceChainId
    amount blockNumber blockTimestamp transactionHash
  }
}
```

### Latest indexed block (sync checkpoint)

```graphql
query {
  AnnouncementEvent(order_by: { blockNumber: desc }, limit: 1) {
    blockNumber blockTimestamp transactionHash
  }
}
```

See `queries/` for all pre-written query files:

| File | Purpose |
|---|---|
| `scan_by_view_tag.graphql` | Primary recipient scan (filter O(1) by view tag) |
| `scan_by_block_range.graphql` | Block-window scan (Turso catch-up / backfill) |
| `scan_by_source_chain.graphql` | Filter by originating chain (e.g., all Arbitrum payments) |
| `scan_by_stealth_address.graphql` | Look up a specific stealth address |
| `latest_block.graphql` | Latest indexed block (sync checkpoint) |
| `unsynced_turso.graphql` | Find events where Turso write failed (retry queue) |

---

## Error handling

| Scenario | Behaviour |
|---|---|
| Metadata < 77 bytes | Log error, decode with zero defaults, continue indexing |
| Invalid ephemeralPubKey length | Log warning, index the event anyway |
| Turso unavailable / timeout | Retry 3× with exponential backoff (100ms → 200ms → 400ms) |
| Turso all retries failed | Log error, mark `tursoSynced=false`, continue indexing |
| Duplicate tx_hash on Turso | `INSERT OR IGNORE` — treated as success (idempotent) |
| `TURSO_DATABASE_URL` not set | Log warning once, skip all Turso writes silently |

Unsynced events can be found via the `UnsyncedTurso` query and re-tried by a background job.

---

## Contract production issues (action required before mainnet)

The `SPECTERAnnouncer` contract currently lacks production-grade validation. Before mainnet deployment, the contract developer should add:

1. **`require(ephemeralPubKey.length == 1088)`** — rejects malformed ML-KEM ciphertexts on-chain
2. **`require(metadata.length == 77)`** — enforces the fixed metadata layout
3. **`require(stealthAddress != address(0))`** — rejects zero-address announcements
4. **`schemeId` parameter in `announce()`** — currently hardcoded; adding it enables multi-scheme support
5. **Anti-spam fee** — even 0.001 MON makes spam economically infeasible
6. **Pause mechanism** — `Ownable` + `Pausable` for emergency response
7. **Gas review** — 1088-byte calldata ≈ ~18k gas; 60k server-side cap should be adequate but verify under load

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `TURSO_DATABASE_URL` | No (logs warning) | `libsql://your-db.turso.io` |
| `TURSO_AUTH_TOKEN` | No (logs warning) | Turso auth token |

All other Envio configuration (RPC URLs, etc.) is in `config.yaml`.
