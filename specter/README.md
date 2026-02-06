# SPECTER

**Post-Quantum Stealth Address Protocol for EVM and Sui**

SPECTER enables private payments on EVM chains and Sui using quantum-resistant cryptography (ML-KEM-768/Kyber). Recipients publish a meta-address to ENS (EVM) or SuiNS (Sui), and senders can create one-time stealth addresses (Ethereum + Sui from the same key) that only the recipient can discover and spend from.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Step-by-Step Tutorial](#step-by-step-tutorial)
- [CLI Reference](#cli-reference)
- [API Reference](#api-reference)
- [Protocol Overview](#protocol-overview)
- [Cryptographic Details](#cryptographic-details)
- [Benchmarks](#benchmarks)
- [Security Considerations](#security-considerations)

---

## Quick Start

### Prerequisites

- **Rust 1.75+** - Install from [rustup.rs](https://rustup.rs)

### Installation

```bash
git clone https://github.com/pranshurastogi/SPECTER
cd SPECTER/specter

cargo build --release
cargo run --bin specter -- --help   # verify
```

### .env Setup

Create `.env` in the `specter` directory. For the API server (ENS resolve, IPFS), Pinata is required:

```bash
# Required for ENS resolution and IPFS
PINATA_GATEWAY_URL=your-dedicated-gateway.mypinata.cloud
PINATA_GATEWAY_TOKEN=your_gateway_token

# Optional: for IPFS uploads (POST /api/v1/ipfs/upload)
PINATA_JWT=your_pinata_jwt

# Optional: Sepolia testnet (default: mainnet)
USE_TESTNET=true

# Optional: custom RPC (defaults: publicnode mainnet/sepolia)
# ETH_RPC_URL=https://ethereum.publicnode.com
# ETH_RPC_URL_SEPOLIA=https://ethereum-sepolia-rpc.publicnode.com
```

### Running

```bash
# Start API server (port 3001)
cargo run --bin specter -- serve --port 3001

# Or with explicit bind
cargo run --bin specter -- serve --port 3001 --bind 0.0.0.0
```

Health check: `curl http://localhost:3001/health`

---

## Step-by-Step Tutorial

### Step 1: Generate Keys

Generate a new spending/viewing key pair and save to a file:

```bash
cargo run --bin specter -- generate --output my-keys.json
```

**Output:**
```
Generating SPECTER keys...
Keys saved to: my-keys.json

IMPORTANT: Keep your secret keys safe!
   spending_sk and viewing_sk must never be shared.
```

The `my-keys.json` file contains:
```json
{
  "spending_pk": "hex-encoded public key",
  "spending_sk": "hex-encoded secret key (KEEP SECRET)",
  "viewing_pk": "hex-encoded public key",
  "viewing_sk": "hex-encoded secret key (KEEP SECRET)",
  "meta_address": "01...(combined public keys)",
  "view_tag": 42
}
```

### Step 2: Create a Stealth Payment

Using the meta-address from your keys (or someone else's), create a stealth payment:

```bash
# Using hex meta-address
cargo run --bin specter -- create <META_ADDRESS>

# Or resolve from ENS (if configured)
cargo run --bin specter -- create alice.eth --rpc-url https://ethereum.publicnode.com
```

**Output:**
```
Creating stealth payment to: 01abc...

Stealth payment created:
   Address: 0x1234...5678  ← Send funds here!
   View tag: 42
   Ephemeral key: abcd...

Announcement (JSON):
{
  "ephemeral_key": "...",
  "view_tag": 42,
  "timestamp": 1706817600
}

Next steps:
   1. Send funds to the stealth address above
   2. Publish the announcement to the registry
```

### Step 3: Scan for Payments

Scan the registry for payments addressed to your keys:

```bash
cargo run --bin specter -- scan --keys my-keys.json
```

**Note:** The CLI currently uses an in-memory registry. For production, use the API server with a persistent registry.

### Step 4: Run the Benchmark

Test the full flow with simulated payments:

```bash
cargo run --bin specter -- bench --count 1000
```

**Output:**
```
Benchmarking with 1000 announcements

1. Generating keys...
   Key generation: 125µs

2. Creating announcements...
   [########################################] 1000/1000
   Created 1000 announcements: 2.1s

3. Scanning...
   Scanned 1000 announcements: 45ms
   Found 10 payments

Results:
   Scan rate: 22,222 announcements/sec
   Time per announcement: 45µs
   All expected payments found!
```

### Step 5: Start the API Server

For frontend integration or programmatic access:

```bash
cargo run --bin specter -- serve --port 3001 --bind 0.0.0.0
```

**Output:**
```
Starting SPECTER API server...
   Listening on: http://0.0.0.0:3001
   Health check: http://0.0.0.0:3001/health

   Press Ctrl+C to stop.
```

---

## CLI Reference

### Global Options

```bash
specter [OPTIONS] <COMMAND>

Options:
  -v, --verbose  Enable verbose logging
  -h, --help     Print help
  -V, --version  Print version
```

### Commands

#### `generate` - Generate New Keys

```bash
specter generate [OPTIONS]

Options:
  -o, --output <FILE>  Save keys to JSON file (optional)
```

**Examples:**
```bash
# Print keys to console
cargo run --bin specter -- generate

# Save to file
cargo run --bin specter -- generate --output wallet.json
```

#### `resolve` - Resolve ENS Name

```bash
specter resolve <NAME> [OPTIONS]

Arguments:
  <NAME>  ENS name to resolve (e.g., alice.eth)

Options:
  --rpc-url <URL>  Ethereum RPC URL [env: ETH_RPC_URL]
```

**Examples:**
```bash
cargo run --bin specter -- resolve vitalik.eth
cargo run --bin specter -- resolve alice.eth --rpc-url https://ethereum.publicnode.com
```

#### `create` - Create Stealth Payment

```bash
specter create <RECIPIENT> [OPTIONS]

Arguments:
  <RECIPIENT>  Meta-address (hex) or ENS name

Options:
  --rpc-url <URL>  Ethereum RPC URL for ENS resolution
```

**Examples:**
```bash
# Using hex meta-address
cargo run --bin specter -- create 01abcd1234...

# Using ENS name
cargo run --bin specter -- create alice.eth --rpc-url https://ethereum.publicnode.com
```

#### `scan` - Scan for Payments

```bash
specter scan [OPTIONS]

Options:
  -k, --keys <FILE>      Path to keys JSON file (required)
  -r, --registry <FILE>  Path to registry file (optional)
```

**Examples:**
```bash
cargo run --bin specter -- scan --keys my-keys.json
cargo run --bin specter -- scan --keys my-keys.json --registry announcements.bin
```

#### `serve` - Start API Server

```bash
specter serve [OPTIONS]

Options:
  -p, --port <PORT>  Port to listen on [default: 3001]
  -b, --bind <ADDR>  Bind address [default: 0.0.0.0]
```

**Examples:**
```bash
cargo run --bin specter -- serve
cargo run --bin specter -- serve --port 8080 --bind 127.0.0.1
```

#### `bench` - Run Benchmarks

```bash
specter bench [OPTIONS]

Options:
  -c, --count <N>  Number of announcements to generate [default: 10000]
```

**Examples:**
```bash
cargo run --bin specter -- bench
cargo run --bin specter -- bench --count 100000
```

---

## API Reference

### Base URL

```
http://localhost:3001
```

### Endpoints

#### Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime_seconds": 42,
  "announcements_count": 0,
  "use_testnet": false
}
```

#### Generate Keys

```http
POST /api/v1/keys/generate
```

**Response:**
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

#### Create Stealth Payment

```http
POST /api/v1/stealth/create
Content-Type: application/json

{
  "meta_address": "01hex..."
}
```

**Response:**
```json
{
  "stealth_address": "0x1234...5678",
  "stealth_sui_address": "0x...",
  "ephemeral_ciphertext": "hex...",
  "view_tag": 42,
  "announcement": {
    "id": 1,
    "ephemeral_key": "hex...",
    "view_tag": 42,
    "timestamp": 1706817600,
    "channel_id": null
  }
}
```

#### Resolve ENS Name

```http
GET /api/v1/ens/resolve/:name
```

**Example:**
```bash
curl http://localhost:3001/api/v1/ens/resolve/alice.eth
```

#### Publish Announcement

```http
POST /api/v1/registry/announcements
Content-Type: application/json

{
  "ephemeral_key": "hex...",
  "view_tag": 42
}
```

#### List Announcements

```http
GET /api/v1/registry/announcements
```

#### Registry Statistics

```http
GET /api/v1/registry/stats
```

**Response:**
```json
{
  "total_announcements": 1234,
  "view_tag_distribution": [
    { "tag": 42, "count": 5 },
    { "tag": 100, "count": 3 }
  ]
}
```

### Complete API Endpoint Table

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/v1/keys/generate` | Generate new key pair |
| `POST` | `/api/v1/stealth/create` | Create stealth payment |
| `POST` | `/api/v1/stealth/scan` | Scan for payments |
| `GET` | `/api/v1/ens/resolve/:name` | Resolve ENS to meta-address |
| `POST` | `/api/v1/ipfs/upload` | Upload meta-address to IPFS |
| `GET` | `/api/v1/ipfs/:cid` | Get IPFS content (raw bytes) by CID |
| `GET` | `/api/v1/registry/announcements` | List all announcements |
| `POST` | `/api/v1/registry/announcements` | Publish announcement |
| `GET` | `/api/v1/registry/stats` | Get registry statistics |

---

## Protocol Overview

### Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           SPECTER PROTOCOL FLOW                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐                                              ┌─────────────┐
│  RECIPIENT  │                                              │   SENDER    │
│   (Alice)   │                                              │    (Bob)    │
└─────────────┘                                              └─────────────┘
      │                                                            │
      │  1. Generate Keys                                          │
      │  ─────────────────                                         │
      │  spending_keypair = generate()                             │
      │  viewing_keypair = generate()                              │
      │                                                            │
      │  2. Create Meta-Address                                    │
      │  ──────────────────────                                    │
      │  meta = (spending_pk, viewing_pk)                          │
      │                                                            │
      │  3. Publish to ENS                                         │
      │  ─────────────────────                                     │
      │  Upload meta to IPFS → CID                                 │
      │  Set ENS: alice.eth → ipfs://CID                           │
      │                                                            │
      │ ◄──────────────────────────────────────────────────────────┤
      │                                                            │
      │                              4. Resolve ENS                │
      │                              ──────────────                │
      │                              alice.eth → meta              │
      │                                                            │
      │                              5. Create Payment             │
      │                              ─────────────────             │
      │                              (ct, ss) = encapsulate(       │
      │                                           viewing_pk)      │
      │                              view_tag = SHAKE256(ss)[0]    │
      │                              stealth = derive(spending_pk, │
      │                                               ss)          │
      │                                                            │
      │                              6. Send Funds                 │
      │                              ────────────                  │
      │                              ETH → stealth_address         │
      │                                                            │
      │                              7. Publish Announcement       │
      │                              ──────────────────────        │
      │                              Registry ← (ct, view_tag)     │
      │                                                            │
      │ ◄──────────────────────────────────────────────────────────┤
      │                                                            │
      │  8. Scan Announcements                                     │
      │  ──────────────────────                                    │
      │  For each (ct, view_tag):                                  │
      │    ss' = decapsulate(ct, viewing_sk)                       │
      │    if SHAKE256(ss')[0] == view_tag:                        │
      │      stealth_sk = derive(spending_sk, ss')                 │
      │      → Found payment!                                      │
      │                                                            │
      │  9. Spend Funds                                            │
      │  ──────────────                                            │
      │  Sign tx with stealth_sk                                   │
      │                                                            │
      └────────────────────────────────────────────────────────────┘
```

### Registration Phase

1. **Key Generation**: Recipient generates two ML-KEM-768 keypairs
   - `spending_keypair`: For deriving stealth private keys
   - `viewing_keypair`: For scanning (can be shared with auditors)

2. **Meta-Address Creation**: Combine public keys into meta-address
   - Format: `version (1) || spending_pk (1184) || viewing_pk (1184)`

3. **ENS Publication**: Store on IPFS and link via ENS
   - Upload meta-address to IPFS/Pinata
   - Set ENS text record: `specter` → `ipfs://<CID>`

### Sending Phase

1. **Resolution**: Sender resolves `alice.eth` → meta-address
2. **Encapsulation**: Create shared secret with viewing key
3. **View Tag**: Compute 1-byte tag for efficient scanning
4. **Stealth Address**: Derive one-time address from spending key
5. **Transaction**: Send funds to stealth address
6. **Announcement**: Publish ephemeral key + view tag

### Receiving Phase

1. **Scanning**: Periodically check new announcements
2. **View Tag Filter**: Skip 99.6% of announcements
3. **Decapsulation**: Recover shared secret for matches
4. **Key Derivation**: Compute stealth private key
5. **Spending**: Use stealth key to sign transactions

---

## Cryptographic Details

### ML-KEM-768 (Kyber768) Parameters

| Parameter | Size | Description |
|-----------|------|-------------|
| Public Key | 1,184 bytes | For encapsulation |
| Secret Key | 2,400 bytes | For decapsulation |
| Ciphertext | 1,088 bytes | Encapsulated shared secret |
| Shared Secret | 32 bytes | Derived symmetric key |

### View Tag Efficiency

| Metric | Value |
|--------|-------|
| Tag Size | 1 byte (256 values) |
| False Positive Rate | 1/256 = 0.39% |
| Filtering Efficiency | 99.6% |

**Example for 100,000 announcements:**
- Without view tags: 100,000 decapsulations (~2 seconds)
- With view tags: ~391 decapsulations (~8 milliseconds)

### Key Derivation Functions

```
// Stealth public key derivation
stealth_pk = spending_pk ⊕ SHAKE256("SPECTER_STEALTH_PK" || shared_secret, 1184)

// Stealth secret key derivation
stealth_sk = spending_sk ⊕ SHAKE256("SPECTER_STEALTH_SK" || shared_secret, 2400)

// Ethereum address derivation
eth_address = keccak256(stealth_pk)[12:32]

// View tag computation
view_tag = SHAKE256("SPECTER_VIEW_TAG" || shared_secret, 1)[0]
```

---

## Benchmarks

### Run Benchmarks

```bash
# CLI benchmark (quick)
cargo run --bin specter -- bench --count 10000

# Full criterion benchmarks
cargo bench -p specter-crypto
```

### Expected Performance (Apple M1)

| Operation | Time | Throughput |
|-----------|------|------------|
| Key Generation | ~15 µs | 66,000/sec |
| Encapsulation | ~18 µs | 55,000/sec |
| Decapsulation | ~20 µs | 50,000/sec |
| View Tag Check | ~100 ns | 10M/sec |
| Scan (100k announcements) | ~1.5 s | 66,000/sec |

---

## Security Considerations

### Key Management

- **Never expose `spending_sk` or `viewing_sk`**
- All secret keys are automatically zeroized on drop (`zeroize` crate)
- Use encrypted storage for production key management

### Cryptographic Security

- ML-KEM-768 provides IND-CCA2 security (128-bit quantum, 192-bit classical)
- SHAKE256 is used for domain-separated key derivation
- Constant-time operations prevent timing attacks

### Privacy Trade-offs

- View tags leak 8 bits of information per announcement
- This is an acceptable trade-off for 99.6% scanning efficiency
- For maximum privacy, disable view tags (not recommended)

### Network Security

- Use HTTPS for all RPC and API communications
- Validate all ENS resolutions against known registries
- Pin IPFS content to prevent content manipulation

---

## Acknowledgments

- [NIST FIPS 203](https://csrc.nist.gov/pubs/fips/203/final) - ML-KEM Standard
- [pqcrypto-kyber](https://crates.io/crates/pqcrypto-kyber) - Rust Kyber implementation
- [Ethereum Foundation](https://ethereum.org) - Stealth address research
- [Umbra Protocol](https://umbra.cash) - Inspiration and prior art
- [EIP-5564](https://eips.ethereum.org/EIPS/eip-5564) - Stealth Address standard


