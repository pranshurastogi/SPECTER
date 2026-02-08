# SPECTER Backend

Rust workspace powering the SPECTER stealth address protocol. Handles all cryptography, protocol logic, name resolution, and chain interactions.

See the [root README](../README.md) for full project documentation.

---

## Setup

```bash
cp .env.example .env        # fill in RPC URLs, Pinata keys
cargo build --release
cargo run --bin specter -- serve --port 3001
```

Health check: `curl http://localhost:3001/health`

### Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `PINATA_GATEWAY_URL` | Yes | Dedicated Pinata gateway for IPFS reads |
| `PINATA_GATEWAY_TOKEN` | Yes | Gateway auth token |
| `PINATA_JWT` | For uploads | JWT for IPFS uploads (POST) |
| `USE_TESTNET` | No | `true` for Sepolia + Sui testnet (default: mainnet) |
| `ETH_RPC_URL` | No | Custom Ethereum mainnet RPC |
| `ETH_RPC_URL_SEPOLIA` | No | Custom Sepolia RPC |
| `SUI_RPC_URL` | No | Custom Sui RPC |

---

## Workspace Crates

```
specter/
├── specter-core/       # Shared types, errors, constants
├── specter-crypto/     # ML-KEM-768, SHAKE256, stealth key derivation
├── specter-stealth/    # Payment creation (encapsulate + derive)
├── specter-scanner/    # Batch announcement scanning with view tag filtering
├── specter-registry/   # In-memory announcement storage
├── specter-cache/      # Lock-free concurrent caching (dashmap)
├── specter-ipfs/       # Pinata IPFS client (upload + fetch)
├── specter-ens/        # ENS resolution (alloy + IPFS)
├── specter-suins/      # SuiNS resolution (Sui JSON-RPC + IPFS)
├── specter-yellow/     # Yellow Network state channel integration
├── specter-api/        # REST API server (Axum)
└── specter-cli/        # CLI tool (generate, create, scan, bench, serve)
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check + stats |
| `POST` | `/api/v1/keys/generate` | Generate ML-KEM-768 keypair |
| `POST` | `/api/v1/stealth/create` | Create stealth payment from meta-address |
| `POST` | `/api/v1/stealth/scan` | Scan announcements for payments |
| `GET` | `/api/v1/ens/resolve/:name` | Resolve ENS name to meta-address |
| `GET` | `/api/v1/suins/resolve/:name` | Resolve SuiNS name to meta-address |
| `POST` | `/api/v1/ipfs/upload` | Upload meta-address to IPFS |
| `GET` | `/api/v1/ipfs/:cid` | Fetch IPFS content by CID |
| `GET` | `/api/v1/registry/announcements` | List all announcements |
| `POST` | `/api/v1/registry/announcements` | Publish announcement |
| `GET` | `/api/v1/registry/stats` | Registry statistics |

---

## CLI

```bash
cargo run --bin specter -- --help

# Generate keys
cargo run --bin specter -- generate --output keys.json

# Create stealth payment
cargo run --bin specter -- create alice.eth --rpc-url https://ethereum.publicnode.com

# Scan for payments
cargo run --bin specter -- scan --keys keys.json

# Run benchmark
cargo run --bin specter -- bench --count 100000

# Start API server
cargo run --bin specter -- serve --port 3001
```

---

## Cryptographic Details

### ML-KEM-768 Parameters

| Parameter | Size |
|-----------|------|
| Public Key | 1,184 bytes |
| Secret Key | 2,400 bytes |
| Ciphertext | 1,088 bytes |
| Shared Secret | 32 bytes |

### Key Derivation

```
stealth_pk = spending_pk XOR SHAKE256("SPECTER_STEALTH_PK" || shared_secret, 1184)
stealth_sk = spending_sk XOR SHAKE256("SPECTER_STEALTH_SK" || shared_secret, 2400)
eth_address = keccak256(stealth_pk)[12:32]
sui_address = blake2b256(0x00 || stealth_pk)
view_tag    = SHAKE256("SPECTER_VIEW_TAG" || shared_secret, 1)[0]
```

### View Tag Filtering

Each announcement carries a 1-byte view tag. Recipients check this tag before attempting the expensive decapsulation step, filtering out ~99.6% of irrelevant announcements (false positive rate: 1/256 = 0.39%).

---

## Benchmarks

Criterion benchmarks for all core cryptographic operations (ML-KEM-768 keygen, encapsulation, decapsulation, view tag computation, stealth address derivation, and full stealth key derivation):

![Benchmarks](../assets/benchmarking.png)

### Run benchmarks

```bash
# Criterion benchmarks (detailed, with HTML reports)
cargo bench -p specter-crypto

# CLI benchmark (quick, end-to-end with scanning)
cargo run --bin specter -- bench --count 100000
```

---

## Tests

```bash
cargo test                          # all tests
cargo test -p specter-crypto        # crypto unit tests
cargo test -p specter-scanner       # scanner tests
```

---

## Security

- All secret keys are zeroized on drop (`zeroize` crate)
- Constant-time comparisons via `subtle` crate prevent timing attacks
- ML-KEM-768 provides IND-CCA2 security (128-bit quantum, 192-bit classical)
- SHAKE256 with domain separation for all key derivation
- `#![forbid(unsafe_code)]` enforced across crates
