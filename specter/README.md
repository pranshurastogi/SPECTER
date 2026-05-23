# SPECTER Backend

Rust workspace that implements the SPECTER post-quantum stealth address protocol — cryptography, storage, name resolution, chain integration, and the public HTTP API. See the [root README](../README.md) for protocol-level documentation and the overall product story.

---

## Quickstart

```bash
cp .env.example .env                 # fill in RPC URLs + Pinata credentials
cargo build --release
cargo run -p specter-cli -- serve --port 3001

curl http://localhost:3001/health
```

---

## Workspace Layout

```
specter/
├── specter-core/        # Shared types (Announcement, MetaAddress), errors, constants
├── specter-crypto/      # ML-KEM-768, SHAKE256, view-tag derivation, stealth keys
├── specter-stealth/     # Payment creation + discovery (scanner glue)
├── specter-scanner/     # Batch announcement scanning with view-tag filtering
├── specter-registry/    # Announcement storage — memory · file · Turso/libSQL
├── specter-cache/       # Lock-free concurrent caching (dashmap + lru)
├── specter-ipfs/        # Pinata IPFS client (upload + fetch)
├── specter-ens/         # ENS resolution (alloy + IPFS)
├── specter-suins/       # SuiNS resolution (Sui JSON-RPC + IPFS)
├── specter-yellow/      # Yellow Network state-channel integration
├── specter-api/         # Axum REST API (handlers, middleware, pending store)
└── specter-cli/         # CLI — keygen, create, scan, bench, serve
```

---

## HTTP API

| Method | Endpoint | Description |
|--------|---------------------------------------|------------------------------------------------|
| `GET`  | `/health`                              | Liveness + uptime + counts                     |
| `POST` | `/api/v1/keys/generate`                | ML-KEM-768 keypair (no `view_tag` — see below) |
| `POST` | `/api/v1/stealth/create`               | Build stealth payment; returns `payment_id`    |
| `POST` | `/api/v1/stealth/scan`                 | Scan announcements for a viewing key           |
| `GET`  | `/api/v1/ens/resolve/:name`            | Resolve ENS → meta-address                     |
| `GET`  | `/api/v1/suins/resolve/:name`          | Resolve SuiNS → meta-address                   |
| `POST` | `/api/v1/ipfs/upload`                  | Upload meta-address to IPFS                    |
| `GET`  | `/api/v1/ipfs/:cid`                    | Fetch IPFS content                              |
| `GET`  | `/api/v1/registry/announcements`       | List announcements (paginated)                  |
| `POST` | `/api/v1/registry/announcements`       | Publish an announcement (`payment_id` preferred) |
| `GET`  | `/api/v1/registry/stats`               | Registry counts + view-tag distribution         |

Full request / response shapes live in [`SPECTER_API.postman_collection.json`](./SPECTER_API.postman_collection.json).

---

## CLI

```bash
cargo run -p specter-cli -- --help

cargo run -p specter-cli -- generate --output keys.json
cargo run -p specter-cli -- create   alice.eth --rpc-url https://ethereum.publicnode.com
cargo run -p specter-cli -- scan     --keys keys.json
cargo run -p specter-cli -- bench    --count 100000
cargo run -p specter-cli -- serve    --port 3001
```

---

## Cryptography

### ML-KEM-768 parameters

| Component        | Size       |
|------------------|------------|
| Public key       | 1 184 B    |
| Secret key       | 2 400 B    |
| Ciphertext       | 1 088 B    |
| Shared secret    | 32 B       |

### Key derivation

```text
stealth_pk = spending_pk XOR SHAKE256("SPECTER_STEALTH_PK" || shared_secret, 1184)
stealth_sk = spending_sk XOR SHAKE256("SPECTER_STEALTH_SK" || shared_secret, 2400)
eth_addr   = keccak256(stealth_pk)[12:32]
sui_addr   = blake2b256(0x00 || stealth_pk)
view_tag   = SHAKE256("SPECTER_VIEW_TAG_V1" || shared_secret, 1)[0]
             ─ per payment, derived from the ML-KEM shared secret
             ─ NOT derivable from a wallet / viewing key alone
```

### View-tag semantics

A `view_tag` is **always** the protocol-level, per-payment tag defined above. The legacy "wallet-level" tag (derived from `viewing_pk`) has been removed from `/keys/generate` in `v1` — it was a semantic foot-gun: scanners need the per-payment tag, but the wallet-level tag advertised one that was never going to match.

ML-KEM decapsulation is the expensive step, so the 1-byte tag saves the cheap stealth-key derivation that follows. A 1-byte tag is the sweet spot for SPECTER:

- false-positive rate = 1/256 ≈ 0.39 %
- skip rate ≈ 99.6 %
- larger tags hurt scan UX (more registry shards) without reducing the dominant decapsulation cost.

### Server-authoritative publish (`payment_id`)

| Step | Endpoint | What the server does |
|------|----------|----------------------|
| 1    | `POST /stealth/create` | Builds the full `Announcement`, mints a `payment_id` (UUID v4), stores `(payment_id → announcement)` in `PendingPaymentStore` with 24 h TTL, returns both |
| 2    | client → on-chain tx   | Sender broadcasts the funding transaction |
| 3    | `POST /registry/announcements` with `{ payment_id, tx_hash }` | Server publishes the **announcement it built**, not the one the client supplies. `payment_id` is single-use and consumed on success |
| 3-fallback | `POST /registry/announcements` with `{ announcement, tx_hash }` | If the pending entry expired (restart, restart-on-scale-out), the client may resubmit the full `AnnouncementDto` it was given at create time |

A background task in `specter-api::lib::ApiServer::run` periodically prunes expired entries from the in-memory `PendingPaymentStore`.

> **Invariant guaranteed by this design:** the published `view_tag` is always the one derived from the Kyber shared secret at create time. A buggy or malicious client cannot tamper with it.

---

## Configuration

| Variable                  | Required        | Default          | Description                                  |
|---------------------------|-----------------|------------------|----------------------------------------------|
| `ETH_RPC_URL`             | ✅              | —                | Ethereum mainnet RPC                          |
| `ETH_RPC_URL_SEPOLIA`     | optional        | —                | Sepolia RPC (used when `USE_TESTNET=true`)    |
| `SUI_RPC_URL`             | optional        | public mainnet   | Sui JSON-RPC                                  |
| `PINATA_JWT`              | ✅ (uploads)    | —                | Pinata JWT for IPFS POST                      |
| `PINATA_GATEWAY_URL`      | ✅              | —                | Pinata dedicated gateway URL                  |
| `PINATA_GATEWAY_TOKEN`    | ✅              | —                | Gateway auth token                            |
| `USE_TESTNET`             | optional        | `false`          | `true` → Sepolia + Sui testnet                |
| `REGISTRY_BACKEND`        | optional        | `memory`         | `memory` \| `turso`                           |
| `TURSO_DATABASE_URL`      | if `turso`      | —                | `libsql://…`                                  |
| `TURSO_AUTH_TOKEN`        | if `turso`      | —                | Turso auth token                              |
| `API_KEY`                 | optional        | —                | Bearer token for write endpoints              |
| `RATE_LIMIT_RPS`          | optional        | `10`             | Requests per second per IP                    |
| `RATE_LIMIT_BURST`        | optional        | `30`             | Burst capacity per IP                         |
| `ALLOWED_ORIGINS`         | optional        | `*`              | CORS allowlist (comma-separated)              |
| `MAX_BODY_SIZE`           | optional        | `1048576`        | Max request body, bytes                       |
| `ENABLE_CACHE`            | optional        | `true`           | Enable LRU announcement cache                 |

---

## Benchmarks

Criterion benchmarks cover ML-KEM-768 keygen, encapsulation, decapsulation, view-tag computation, stealth-address derivation, and the full stealth-key pipeline.

![Benchmarks](../assets/benchmarking.png)

```bash
cargo bench -p specter-crypto                 # Criterion (HTML reports)
cargo run -p specter-cli -- bench --count 100000   # end-to-end with scanning
```

---

## Tests

```bash
cargo test --workspace                                    # everything
cargo test -p specter-crypto                              # crypto unit tests
cargo test -p specter-scanner                             # scanner tests
cargo test -p specter-registry --features sqlite -- sqlite   # Turso/SQLite suite
```

Notable invariant tests:

| Test                                                       | Crate              | What it asserts |
|------------------------------------------------------------|--------------------|------------------|
| `test_generate_keys`                                       | `specter-api`      | `/keys/generate` no longer leaks a `view_tag` |
| `test_create_then_publish_via_payment_id`                  | `specter-api`      | Round-trip server-authoritative publish |
| `test_payment_id_is_single_use`                            | `specter-api`      | `payment_id` is consumed on success |
| `test_publish_rejects_loose_view_tag`                      | `specter-api`      | Old `{ephemeral_key, view_tag}` body is rejected |
| `test_scan_stats_count_view_tag_matches_independently`     | `specter-stealth`  | Scan stats distinguish `view_tag_matches` from `discoveries` |
| `test_base_view_tag_is_not_protocol_tag`                   | `specter-stealth`  | Wallet-level tag must not be conflated with protocol tag |

---

## Security

- Pure-Rust crypto via [RustCrypto](https://github.com/RustCrypto) — `ml-kem`, `sha3`, `k256`, `blake2`.
- Secret keys are `Zeroize`'d on drop.
- Constant-time comparisons (`subtle`) — no timing side-channels.
- `#![forbid(unsafe_code)]` enforced workspace-wide.
- API rate limiting per-IP via `governor`.
- ML-KEM-768 → IND-CCA2 (128-bit quantum, 192-bit classical).
- SHAKE256 with explicit domain separation for every key-derivation step.

To report a vulnerability, email **hello@pranshurastogi.com**.
