<div align="center">
  <img src="assets/logo/Specterpq-dark.png" alt="SPECTER" width="280" />

  <h1>SPECTER</h1>

  <strong>Post-quantum stealth address protocol for Ethereum and Sui.</strong>
  <br />
  <sub>Private payments today. Quantum-safe forever.</sub>

  <br /><br />

  [![Website](https://img.shields.io/badge/Website-specterpq.com-black?style=flat-square&logo=vercel)](https://specterpq.com)
  [![Docs](https://img.shields.io/badge/Docs-Mintlify-6C47FF?style=flat-square&logo=gitbook)](https://docs.specterpq.com)
  [![Paper](https://img.shields.io/badge/Paper-arXiv%202501.13733-B31B1B?style=flat-square&logo=arxiv)](https://arxiv.org/pdf/2501.13733v1)
  [![NIST FIPS 203](https://img.shields.io/badge/Crypto-ML--KEM--768%20(FIPS%20203)-2C7CB0?style=flat-square)](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.203.pdf)
  [![Twitter](https://img.shields.io/badge/Twitter-@SpecterPQ-1DA1F2?style=flat-square&logo=twitter)](https://twitter.com/SpecterPQ)

  <br />

  <img src="assets/cover-SPECTER.png" alt="SPECTER cover" width="100%" />
</div>

---

## Table of Contents

1. [The Problem](#the-problem)
2. [What is SPECTER](#what-is-specter)
3. [Protocol Design](#protocol-design)
4. [Architecture](#architecture)
5. [Performance](#performance)
6. [Comparison](#comparison)
7. [API Reference](#api-reference)
8. [Getting Started](#getting-started)
9. [Testing](#testing)
10. [Security](#security)
11. [Research](#research)

---

## The Problem

Every transaction on a public blockchain is a permanent, queryable record. Counterparties, balances, and payment patterns are exposed to anyone — retroactively and indefinitely.

The existing privacy layer for Ethereum — stealth addresses, as implemented in Umbra, Fluidkey, and ERC-5564 — relies on ECDH over secp256k1. Shor's algorithm, running on a sufficiently capable quantum computer, breaks ECDH entirely. The implication is not a future problem: nation-state adversaries are actively archiving public blockchain data today under the assumption that they can decrypt it once the hardware exists. This is the "harvest now, decrypt later" threat.

> *"Store now, decrypt later attacks mean data encrypted today may be vulnerable tomorrow."*
> — CISA / NSA Joint Advisory, 2022

NIST finalized its post-quantum cryptography standards in 2024 (FIPS 203). The window to migrate classical cryptographic systems is open now. Payment history that users consider private today may not remain so.

---

## What is SPECTER

SPECTER replaces ECDH in the stealth address construction with **ML-KEM-768** (NIST FIPS 203), the standardized post-quantum key encapsulation mechanism. The protocol preserves the same user experience — a sender pays to a human-readable name, the recipient scans to discover what's theirs — while making the underlying privacy guarantees quantum-resistant by construction.

It ships as a complete product:

| Component | Description |
|---|---|
| `specter-api` | Axum REST API — key generation, stealth payment creation, scanning, ENS/SuiNS resolution, IPFS pinning |
| `specter-web` | React + TypeScript wallet interface — setup, send, scan, payment history, key recovery |
| `specter-cli` | CLI for key generation, name resolution, scanning, and throughput benchmarking |
| `specter-crypto / stealth` | Pure-Rust ML-KEM-768 primitives and one-time address derivation |
| `specter-registry` | Announcement store (in-memory for development, Turso/libSQL for production) |
| `specter-yellow` | Yellow Network state channel integration |

SPECTER supports Ethereum (mainnet + Sepolia) and Sui (mainnet + testnet) with ENS and SuiNS name resolution. It is live at [specterpq.com](https://specterpq.com).

---

## Protocol Design

### Key generation — recipient

The recipient generates two ML-KEM-768 keypairs — `spending` and `viewing` — locally. Their public keys are concatenated into a single **meta-address**, pinned to IPFS, and linked to an ENS or SuiNS name under the `specter.meta` text record. Private keys never leave the device. The meta-address is public by design and reveals no payment history.

```
spending_pk ‖ viewing_pk  →  meta-address  →  IPFS CID  →  ENS / SuiNS text record
```

<div align="center"><img src="assets/setup.png" alt="Setup flow" width="72%"/></div>

### Send

1. Resolve the recipient's name → IPFS CID → meta-address.
2. `ML-KEM-768.Encaps(viewing_pk)` → `(shared_secret, ciphertext)`.
3. Derive a one-time stealth address from `shared_secret` and `spending_pk`.
4. Transfer funds to the stealth address on-chain.
5. Publish an announcement to the registry: `ciphertext` + a 1-byte `view_tag`.

```text
stealth_pk = spending_pk  ⊕  SHAKE256("SPECTER_STEALTH_PK" ‖ shared_secret, 1184)
stealth_sk = spending_sk  ⊕  SHAKE256("SPECTER_STEALTH_SK" ‖ shared_secret, 2400)
eth_addr   = keccak256(stealth_pk)[12:]
sui_addr   = blake2b256(0x00 ‖ stealth_pk)
view_tag   = SHAKE256("SPECTER_VIEW_TAG_V1" ‖ shared_secret, 1)[0]
```

<div align="center"><img src="assets/send.png" alt="Send flow" width="72%"/></div>

### Receive

For each announcement in the registry, the scanner:

1. Compares the 1-byte `view_tag` — eliminates ~99.6% of all entries without any cryptographic work.
2. Runs `ML-KEM-768.Decaps(ciphertext, viewing_sk)` → `shared_secret`.
3. Derives the stealth private key and checks the resulting address against the on-chain stealth address.

A match means the recipient holds the spending key and can move funds from any standard wallet.

<div align="center"><img src="assets/receive.png" alt="Receive flow" width="72%"/></div>

### Server-authoritative publish

A mismatched `view_tag` at announcement publish time renders a payment silently invisible to the recipient — the funds land correctly but the recipient can never find them. SPECTER eliminates this failure mode at the API layer:

```
POST /api/v1/stealth/create
  → { payment_id, announcement, stealth_address }
    Server holds the canonical Announcement pinned to payment_id (24 h TTL)

POST /api/v1/registry/announcements  { payment_id }
  → Server publishes the announcement it generated — not what the client passes
```

If the server's pending entry has expired (restart, scale-out), the client may re-submit the full `Announcement` DTO received at create time. Either path enforces the invariant: the published `view_tag` is always derived from the protocol shared secret.

The web interface implements layered recovery on top of this: a client-side pending vault (localStorage, 7-day TTL), a phase-aware send state machine (`signing → broadcasting → publishing`), a sticky retry panel for unpublished payments, and a one-click recovery JSON download — so a user can interrupt the flow at any point and resume from any subsequent session.

---

## Architecture

```
SPECTER/
├── specter/                        # Rust workspace
│   ├── specter-core/               # Shared types, errors, constants
│   ├── specter-crypto/             # ML-KEM-768, SHAKE256, view tag derivation
│   ├── specter-stealth/            # One-time address derivation + payment discovery
│   ├── specter-scanner/            # Batch scanning engine
│   ├── specter-registry/           # Announcement store (memory / libSQL / Turso)
│   ├── specter-cache/              # Lock-free LRU + dashmap caches
│   ├── specter-ipfs/               # Pinata IPFS client (upload + fetch)
│   ├── specter-ens/                # ENS resolution (alloy + IPFS)
│   ├── specter-suins/              # SuiNS resolution (Sui JSON-RPC + IPFS)
│   ├── specter-yellow/             # Yellow Network channel integration
│   └── specter-api/                # Axum HTTP server
│       ├── handlers.rs
│       ├── pending.rs              # PendingPaymentStore (payment_id → Announcement)
│       ├── middleware.rs           # Rate limiting, auth, security headers
│       └── state.rs                # AppState, RegistryBackend
└── SPECTER-web/                    # React + TypeScript
    └── src/
        ├── pages/                  # Setup, Send, Scan, Yellow, Use Cases
        ├── lib/
        │   ├── api.ts              # Typed REST client
        │   ├── pendingPayment.ts   # Client-side recovery vault
        │   ├── paymentHistory.ts   # Session payment log (status-aware)
        │   ├── blockchain/         # viem, ENS, SuiNS, tx verification
        │   └── crypto/             # Browser key vault (AES-GCM, PBKDF2)
        └── components/             # Radix UI + Tailwind
```

### Registry backends

| Backend | Use case |
|---|---|
| `memory` | Local development and CI |
| `turso` | Staging and production (libSQL, SQLite-compatible) |

The Turso backend ships with a 256-slot LRU per view tag, per-wallet scanner checkpoints for incremental restart, and Yellow Network channel lifecycle tracking.

---

## Performance

<div align="center"><img src="assets/benchmarking.png" alt="Benchmarks" width="70%"/></div>

| Operation | Latency |
|---|---|
| ML-KEM-768 key generation | < 1 ms |
| Encapsulation (stealth address creation) | < 2 ms |
| View tag check per announcement | ~0.5 µs |
| Full scan — 100,000 announcements | ~1–2 s |
| Announcement publish (SQLite / Turso) | < 5 ms |
| Cached registry lookup by view tag | < 1 ms |

The 1-byte view tag is the dominant speed primitive: only 1 in 256 announcements requires full ML-KEM decapsulation. A single VPS can sustain a registry of tens of millions of announcements without degrading recipient-side scan times.

---

## Comparison

|  | **SPECTER** | Umbra | Fluidkey |
|---|:---:|:---:|:---:|
| Cryptography | ML-KEM-768 (FIPS 203) | ECDH secp256k1 | ECDH secp256k1 |
| Quantum resistant | ✅ | ❌ | ❌ |
| Harvest-now-decrypt-later safe | ✅ | ❌ | ❌ |
| Chains | Ethereum + Sui | Ethereum | Ethereum |
| Name resolution | ENS + SuiNS | ENS | ENS |
| View tags | ✅ ~99.6% skip | ✅ v2 only | Server-delegated |
| Scan 100k announcements | ~1–2 s | ~10–15 s | n/a (delegated) |
| Self-sovereign | ✅ | ✅ | ❌ |
| Meta-address storage | IPFS | On-chain | On-chain |
| Server-authoritative publish | ✅ | ❌ | n/a |
| Open source | ✅ | ✅ | ❌ |

---

## API Reference

Base URL: `https://backend.specterpq.com` — local: `http://localhost:3001`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check + uptime |
| `POST` | `/api/v1/keys/generate` | Generate ML-KEM-768 keypair |
| `POST` | `/api/v1/stealth/create` | Create stealth payment — returns `payment_id`, `stealth_address`, `announcement` |
| `POST` | `/api/v1/stealth/scan` | Scan announcements against a viewing key |
| `GET` | `/api/v1/ens/resolve/:name` | Resolve ENS name → meta-address |
| `GET` | `/api/v1/suins/resolve/:name` | Resolve SuiNS name → meta-address |
| `POST` | `/api/v1/ipfs/upload` | Upload meta-address to IPFS |
| `GET` | `/api/v1/ipfs/:cid` | Fetch IPFS content by CID |
| `GET` | `/api/v1/registry/announcements` | List announcements (paginated) |
| `POST` | `/api/v1/registry/announcements` | Publish announcement (`payment_id` preferred, full `announcement` as fallback) |
| `GET` | `/api/v1/registry/stats` | Registry stats and view tag distribution |

Full request/response schemas and a Postman collection are in [`specter/SPECTER_API.postman_collection.json`](specter/SPECTER_API.postman_collection.json). Extended documentation at [docs.specterpq.com](https://docs.specterpq.com).

---

## Getting Started

### Requirements

- **Rust** stable — [rustup.rs](https://rustup.rs)
- **Node.js** ≥ 18
- **Pinata** account for IPFS storage — free tier is sufficient
- **Ethereum RPC** — Alchemy, Infura, or a public endpoint

### Backend

```bash
git clone https://github.com/pranshurastogi/SPECTER.git
cd SPECTER/specter

cp .env.sample .env
# Fill in ETH_RPC_URL, Pinata credentials, and (for production) Turso connection details

# Local development — in-memory registry
cargo run -p specter-cli -- serve --port 3001

# Production — persistent registry, release build
REGISTRY_BACKEND=turso cargo run --release -p specter-cli -- serve --port 3001
```

### Frontend

```bash
cd SPECTER/SPECTER-web

cp .env.sample .env
# Set VITE_API_BASE_URL to your backend and VITE_ETH_RPC_URL to your RPC endpoint

npm install
npm run dev          # http://localhost:8080
```

### CLI

```bash
specter generate --output keys.json        # ML-KEM-768 keypair
specter resolve vitalik.eth                # ENS → meta-address
specter create   alice.eth                 # Build stealth payment
specter scan     --keys keys.json          # Scan registry for owned payments
specter bench    --count 100000            # Throughput benchmark
specter serve    --port 3001               # Start API server
```

### Docker

```dockerfile
FROM rust:1.83 AS builder
WORKDIR /app
COPY . .
RUN cargo build --release -p specter-api

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/specter-api /usr/local/bin/
EXPOSE 8080
CMD ["specter-api"]
```

```bash
docker run -p 8080:8080 \
  -e ETH_RPC_URL=https://... \
  -e PINATA_JWT=... \
  -e PINATA_GATEWAY_URL=... \
  -e PINATA_GATEWAY_TOKEN=... \
  -e REGISTRY_BACKEND=turso \
  -e TURSO_DATABASE_URL=libsql://your-db.turso.io \
  -e TURSO_AUTH_TOKEN=... \
  specter-api
```

---

## Testing

```bash
# Rust — full workspace
cargo test --workspace

# Rust — SQLite registry
cargo test -p specter-registry --features sqlite -- sqlite

# Frontend — vitest
cd SPECTER-web && npm test
```

Key integration test coverage:

| Test | What it asserts |
|---|---|
| `test_generate_keys` | `view_tag` is absent from the keygen response |
| `test_create_then_publish_via_payment_id` | End-to-end server-authoritative publish |
| `test_payment_id_is_single_use` | `payment_id` is consumed on first success |
| `test_publish_rejects_loose_view_tag` | Legacy `{ephemeral_key, view_tag}` body is rejected |
| `test_scan_stats_count_view_tag_matches_independently` | Scan reports `view_tag_matches` separately from `discoveries` |

Frontend test suites: `pendingPayment` (31 cases), `paymentHistory` (16 cases), `recentRecipients`, `setupProgress`, `utils`, `appEnv`.

---

## Security

- All cryptography is pure Rust ([RustCrypto](https://github.com/RustCrypto)): `ml-kem`, `sha3`, `k256`, `blake2`.
- Secret keys are `Zeroize`'d on drop and never transmitted.
- Constant-time comparisons via `subtle` — no timing side-channels.
- `#![forbid(unsafe_code)]` enforced workspace-wide.
- Per-IP rate limiting on all write endpoints (`governor`).
- SQLite runs in WAL mode with foreign-key constraints and a 5 s busy timeout.
- The browser key vault stores secret keys as an AES-GCM blob derived from a user password (PBKDF2-SHA256, 600k iterations) — never in cleartext.
- The client-side pending-payment vault stores only public fields (stealth address, ciphertext, view tag, payment ID) — no private key material is written to localStorage.

To report a vulnerability: **hello@pranshurastogi.com**

---

## Research

- [Post-Quantum Stealth Address Protocols](https://arxiv.org/pdf/2501.13733v1) — arXiv 2501.13733
- [NIST FIPS 203 — ML-KEM Standard](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.203.pdf)
- [ERC-5564 — Stealth Addresses for Ethereum](https://eips.ethereum.org/EIPS/eip-5564) — SPECTER extends ERC-5564 with post-quantum cryptography

---

## Contributing

| Branch | Environment | Network |
|---|---|---|
| `main` | Development | Sepolia |
| `staging` | Staging | Sepolia |
| `production` | Production | Ethereum mainnet |

`feat/*` → PR → `main` → PR → `staging` → review → `production`. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

<div align="center">
  <img src="assets/logo/Specterpq-dark.png" alt="SPECTER" width="110" />
  <br /><br />
  <strong><a href="https://specterpq.com">specterpq.com</a></strong>
  &nbsp;·&nbsp;
  <a href="https://twitter.com/SpecterPQ">@SpecterPQ</a>
  &nbsp;·&nbsp;
  <a href="https://docs.specterpq.com">Docs</a>
  &nbsp;·&nbsp;
  <a href="https://arxiv.org/pdf/2501.13733v1">Research</a>
  <br /><br />
  <sub>Built with Rust · Powered by ML-KEM-768 · Private by design</sub>
</div>
