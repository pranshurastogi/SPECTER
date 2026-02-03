# SPECTER Cheatsheet

Quick reference for **commands**, **API routes**, **environment variables**, **testing**, and **benchmarks**.

---

## Table of Contents

1. [Project setup & run](#1-project-setup--run)
2. [CLI commands](#2-cli-commands)
3. [API routes](#3-api-routes)
4. [Environment variables](#4-environment-variables)
5. [Testing](#5-testing)
6. [Benchmarks](#6-benchmarks)
7. [Example flows](#7-example-flows)

---

## 1. Project setup & run

### Prerequisites

- **Rust 1.75+** ([rustup.rs](https://rustup.rs))

### Build & verify

```bash
cd SPECTER/specter

# Build (release)
cargo build --release

# Verify CLI
cargo run --bin specter -- --help
```

### Start API server

```bash
# Default: http://0.0.0.0:3001
cargo run --bin specter -- serve

# Custom port and bind
cargo run --bin specter -- serve --port 8080 --bind 127.0.0.1
```

### Run from project root (SPECTER/)

```bash
cd specter && cargo run --bin specter -- <command> [options]
```

---

## 2. CLI commands

**Binary name:** `specter`  
**Global options:** `-v, --verbose` | `-h, --help` | `-V, --version`

| Command | Description |
|--------|-------------|
| `generate` | Generate new SPECTER keys |
| `resolve <name>` | Resolve ENS name to meta-address |
| `create <recipient>` | Create stealth payment (meta-address or ENS) |
| `scan` | Scan announcements for payments (requires keys file) |
| `serve` | Start REST API server |
| `bench` | Run benchmark (keygen + create + scan) |

### `generate`

```bash
# Print keys to stdout
cargo run --bin specter -- generate

# Save to file
cargo run --bin specter -- generate --output my-keys.json
cargo run --bin specter -- generate -o wallet.json
```

**Output (JSON):** `spending_pk`, `spending_sk`, `viewing_pk`, `viewing_sk`, `meta_address`, `view_tag`

---

### `resolve`

```bash
# Resolve ENS name (uses default RPC or ETH_RPC_URL)
cargo run --bin specter -- resolve alice.eth

# With explicit RPC
cargo run --bin specter -- resolve alice.eth --rpc-url https://ethereum.publicnode.com
```

---

### `create`

```bash
# Recipient = hex meta-address
cargo run --bin specter -- create 01abcd1234...

# Recipient = ENS name (resolves first)
cargo run --bin specter -- create alice.eth
cargo run --bin specter -- create alice.eth --rpc-url https://ethereum.publicnode.com
```

**Output:** Stealth address (send funds here), view tag, ephemeral key, announcement JSON. Next: send funds, then publish announcement to registry.

---

### `scan`

```bash
# Scan with keys file (in-memory empty registry if no --registry)
cargo run --bin specter -- scan --keys my-keys.json
cargo run --bin specter -- scan -k my-keys.json

# Scan with file-based registry
cargo run --bin specter -- scan --keys my-keys.json --registry announcements.bin
cargo run --bin specter -- scan -k my-keys.json -r announcements.bin
```

**Keys file** must contain: `viewing_sk`, `spending_pk`, `spending_sk` (hex strings).

---

### `serve`

```bash
# Default: port 3001, bind 0.0.0.0
cargo run --bin specter -- serve

# Custom
cargo run --bin specter -- serve --port 8080 --bind 127.0.0.1
cargo run --bin specter -- serve -p 3001 -b 0.0.0.0
```

**Endpoints base:** `http://<bind>:<port>` (e.g. `http://localhost:3001`)

---

### `bench`

```bash
# Default 10,000 announcements
cargo run --bin specter -- bench

# Custom count
cargo run --bin specter -- bench --count 1000
cargo run --bin specter -- bench -c 100000
```

**Flow:** Generate keys → create N announcements (1/100 for “us”, rest random) → scan all → report rate and discoveries.

---

## 3. API routes

**Base URL (default):** `http://localhost:3001`

### Summary table

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/v1/keys/generate` | Generate new key pair |
| `POST` | `/api/v1/stealth/create` | Create stealth payment |
| `POST` | `/api/v1/stealth/scan` | Scan for payments |
| `GET` | `/api/v1/ens/resolve/:name` | Resolve ENS to meta-address |
| `POST` | `/api/v1/ens/upload` | Upload meta-address to IPFS |
| `GET` | `/api/v1/registry/announcements` | List announcements (with query params) |
| `POST` | `/api/v1/registry/announcements` | Publish announcement |
| `GET` | `/api/v1/registry/stats` | Registry statistics |

---

### `GET /health`

No body.

**Response (200):**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime_seconds": 123,
  "announcements_count": 0
}
```

**Example:**
```bash
curl http://localhost:3001/health
```

---

### `POST /api/v1/keys/generate`

No body.

**Response (200):**
```json
{
  "spending_pk": "hex...",
  "spending_sk": "hex...",
  "viewing_pk": "hex...",
  "viewing_sk": "hex...",
  "meta_address": "01hex...",
  "view_tag": 42
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/api/v1/keys/generate
```

---

### `POST /api/v1/stealth/create`

**Request body:**
```json
{
  "meta_address": "01hex...",
  "channel_id": "optional_hex_32_bytes"
}
```

**Response (200):**
```json
{
  "stealth_address": "0x1234...5678",
  "ephemeral_ciphertext": "hex...",
  "view_tag": 42,
  "announcement": {
    "id": 0,
    "ephemeral_key": "hex...",
    "view_tag": 42,
    "timestamp": 1706817600,
    "channel_id": null
  }
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/api/v1/stealth/create \
  -H "Content-Type: application/json" \
  -d '{"meta_address": "01abc..."}'
```

---

### `POST /api/v1/stealth/scan`

**Request body:**
```json
{
  "viewing_sk": "hex...",
  "spending_pk": "hex...",
  "spending_sk": "hex...",
  "view_tags": [42, 43],
  "from_timestamp": 1706800000,
  "to_timestamp": 1706817600
}
```

- `view_tags`: optional; if set, only announcements with these view tags are scanned.
- `from_timestamp` / `to_timestamp`: optional; time range filter.

**Response (200):**
```json
{
  "discoveries": [
    {
      "stealth_address": "0x...",
      "stealth_sk": "hex...",
      "eth_private_key": "hex_32_bytes",
      "announcement_id": 1,
      "timestamp": 1706817600,
      "channel_id": null
    }
  ],
  "stats": {
    "total_scanned": 100,
    "view_tag_matches": 2,
    "discoveries": 1,
    "duration_ms": 50,
    "rate": 2000.0
  }
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/api/v1/stealth/scan \
  -H "Content-Type: application/json" \
  -d '{"viewing_sk":"...","spending_pk":"...","spending_sk":"..."}'
```

---

### `GET /api/v1/ens/resolve/:name`

**Path:** `name` = ENS name (e.g. `alice.eth`).

**Response (200):**
```json
{
  "ens_name": "alice.eth",
  "meta_address": "01hex...",
  "spending_pk": "hex...",
  "viewing_pk": "hex...",
  "ipfs_cid": null
}
```

**Example:**
```bash
curl http://localhost:3001/api/v1/ens/resolve/alice.eth
```

---

### `POST /api/v1/ens/upload`

**Request body:**
```json
{
  "meta_address": "01hex...",
  "name": "alice.eth-specter-profile"
}
```

`name` is optional (used for Pinata metadata).

**Response (200):**
```json
{
  "cid": "Qm...",
  "text_record": "ipfs://Qm..."
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/api/v1/ens/upload \
  -H "Content-Type: application/json" \
  -d '{"meta_address":"01...","name":"alice.eth"}'
```

---

### `GET /api/v1/registry/announcements`

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `view_tag` | u8 | Filter by view tag |
| `from_timestamp` | u64 | Start of time range |
| `to_timestamp` | u64 | End of time range |
| `offset` | u64 | Pagination offset (default 0) |
| `limit` | u64 | Pagination limit (default 100) |

**Response (200):**
```json
{
  "announcements": [
    {
      "id": 1,
      "ephemeral_key": "hex...",
      "view_tag": 42,
      "timestamp": 1706817600,
      "channel_id": null
    }
  ],
  "total": 1
}
```

**Examples:**
```bash
curl "http://localhost:3001/api/v1/registry/announcements"
curl "http://localhost:3001/api/v1/registry/announcements?view_tag=42"
curl "http://localhost:3001/api/v1/registry/announcements?offset=0&limit=50"
```

---

### `POST /api/v1/registry/announcements`

**Request body:**
```json
{
  "ephemeral_key": "hex_1088_bytes...",
  "view_tag": 42,
  "channel_id": "optional_hex_32_bytes"
}
```

**Response (200):**
```json
{
  "id": 1,
  "success": true
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/api/v1/registry/announcements \
  -H "Content-Type: application/json" \
  -d '{"ephemeral_key":"...","view_tag":42}'
```

---

### `GET /api/v1/registry/stats`

No body.

**Response (200):**
```json
{
  "total_announcements": 100,
  "view_tag_distribution": [
    { "tag": 0, "count": 5 },
    { "tag": 42, "count": 3 }
  ]
}
```

**Example:**
```bash
curl http://localhost:3001/api/v1/registry/stats
```

---

## 4. Environment variables

Used by the **API server** when started via `specter serve` (e.g. `ApiConfig::from_env()`). Optional: create a `.env` in `specter/` or export before running.

| Variable | Description | Default / note |
|----------|-------------|----------------|
| `ETH_RPC_URL` | Ethereum RPC for ENS resolution | `https://ethereum.publicnode.com` |
| `PINATA_API_KEY` | Pinata API key (IPFS upload) | Required for upload |
| `PINATA_SECRET_KEY` | Pinata secret key | Required for upload |
| `ENABLE_CACHE` | Enable ENS/IPFS cache | `true` if unset |

**CLI:** `--rpc-url` overrides RPC for `resolve` and `create`; `ETH_RPC_URL` is used when `--rpc-url` is not set.

**Example:**
```bash
export ETH_RPC_URL="https://ethereum.publicnode.com"
export PINATA_API_KEY="your_key"
export PINATA_SECRET_KEY="your_secret"
# Optional
export RUST_LOG="specter=debug"
```

---

## 5. Testing

### All crates

```bash
cd specter
cargo test --workspace
```

### With output and logging

```bash
cargo test --workspace -- --nocapture
RUST_LOG=debug cargo test --workspace
```

### Per crate

```bash
cargo test -p specter-core
cargo test -p specter-crypto
cargo test -p specter-stealth
cargo test -p specter-registry
cargo test -p specter-scanner
cargo test -p specter-ens
cargo test -p specter-api
```

---

## 6. Benchmarks

### CLI benchmark (full flow)

```bash
cargo run --bin specter -- bench --count 10000
cargo run --bin specter -- bench -c 100000
```

### Criterion (crypto only)

```bash
cargo bench -p specter-crypto
```

---

## 7. Example flows

### A. Generate keys and save

```bash
cargo run --bin specter -- generate -o my-keys.json
```

### B. Start server and create a stealth payment via API

```bash
# Terminal 1
cargo run --bin specter -- serve -p 3001

# Terminal 2: get keys and meta_address
curl -s -X POST http://localhost:3001/api/v1/keys/generate | jq .

# Use meta_address from response, then create stealth payment
curl -s -X POST http://localhost:3001/api/v1/stealth/create \
  -H "Content-Type: application/json" \
  -d '{"meta_address":"<PASTE_META_ADDRESS>"}' | jq .

# Publish the announcement (use ephemeral_key and view_tag from create response)
curl -s -X POST http://localhost:3001/api/v1/registry/announcements \
  -H "Content-Type: application/json" \
  -d '{"ephemeral_key":"<EPHEMERAL_HEX>","view_tag":<VIEW_TAG>}' | jq .
```

### C. Scan for payments via API

Use the same server; request body must include `viewing_sk`, `spending_pk`, `spending_sk` from your keys (e.g. from `my-keys.json`):

```bash
curl -s -X POST http://localhost:3001/api/v1/stealth/scan \
  -H "Content-Type: application/json" \
  -d '{
    "viewing_sk":"<FROM_KEYS>",
    "spending_pk":"<FROM_KEYS>",
    "spending_sk":"<FROM_KEYS>"
  }' | jq .
```

### D. Resolve ENS and create payment (CLI)

```bash
# Resolve
cargo run --bin specter -- resolve alice.eth --rpc-url https://ethereum.publicnode.com

# Create (paste meta_address hex or use ENS name)
cargo run --bin specter -- create alice.eth --rpc-url https://ethereum.publicnode.com
```

### E. Quick benchmark

```bash
cargo run --bin specter -- bench -c 100
```

---

## Quick reference

| I want to… | Command / route |
|------------|------------------|
| Generate keys | `specter generate -o keys.json` or `POST /api/v1/keys/generate` |
| Resolve ENS | `specter resolve alice.eth` or `GET /api/v1/ens/resolve/alice.eth` |
| Create stealth payment | `specter create <meta_or_ens>` or `POST /api/v1/stealth/create` |
| Publish announcement | `POST /api/v1/registry/announcements` (body: ephemeral_key, view_tag) |
| List announcements | `GET /api/v1/registry/announcements?view_tag=42&limit=100` |
| Scan for payments | `specter scan -k keys.json` or `POST /api/v1/stealth/scan` |
| Upload meta to IPFS | `POST /api/v1/ens/upload` (body: meta_address, name) |
| Start API | `specter serve -p 3001` |
| Run tests | `cargo test --workspace` |
| Run benchmark | `specter bench -c 10000` or `cargo bench -p specter-crypto` |
