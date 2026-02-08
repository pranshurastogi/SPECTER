<div align="center">
  <img src="assets/SPECTER-logo-with-tagline.png" alt="SPECTER Logo" width="200">
</div>

# SPECTER

SPECTER is a **post-quantum stealth address protocol** for Ethereum. It enables private payments via ENS names using **ML-KEM-768** (Kyber) so that addresses remain secure against future quantum attacks. Each payment uses a one-time stealth address; only the recipient can discover and spend from it.

**The protocol core is implemented in Rust** for security, performance, and reliability—see [Why Rust](#why-rust) and [Rust crates](#rust-crates) below.

---

## Key features

- **Post-quantum**: ML-KEM-768 key encapsulation (NIST FIPS 203).
- **Stealth addresses**: One distinct address per payment; no link between payments and identity.
- **ENS + SuiNS**: Send to names like `alice.eth` or `alice.sui`; meta-address is resolved from ENS/SuiNS (IPFS content hash).
- **View tags**: 1-byte tag per announcement; ~99.6% of announcements skipped when scanning.
- **Yellow Network**: Private off-chain trading via state channels routed through stealth addresses. See [Yellow.md](Yellow.md).

---

## Exact flow

### 1. Recipient: register (one-time)

| Step | Action | Where |
|------|--------|--------|
| 1.1 | Generate spending + viewing keypairs (ML-KEM-768). | `POST /api/v1/keys/generate` or CLI `specter generate` |
| 1.2 | Build meta-address = version \|\| spending_pk \|\| viewing_pk (hex). | Response: `meta_address`, `view_tag` |
| 1.3 | Upload meta-address to IPFS. | `POST /api/v1/ipfs/upload` with `meta_address` and optional `name` |
| 1.4 | Set ENS text record for your name (e.g. `alice.eth`) -> `specter` = `ipfs://<CID>`. | Your ENS resolver (e.g. app.ens.domains) |

Recipient keeps `spending_sk`, `viewing_sk` secret; shares only the ENS name.

### 2. Sender: send payment

| Step | Action | Where |
|------|--------|--------|
| 2.1 | Resolve recipient ENS name to meta-address. | `GET /api/v1/ens/resolve/:name` |
| 2.2 | Create stealth payment from meta-address. | `POST /api/v1/stealth/create` with `meta_address` |
| 2.3 | Send funds (ETH/tokens) to `stealth_address` from the response. | Your wallet / chain |
| 2.4 | Publish announcement so recipient can discover the payment. | `POST /api/v1/registry/announcements` with `ephemeral_key`, `view_tag` (and optional `channel_id`) |

Under the hood: encapsulate to viewing key -> shared secret -> view tag + derive stealth address from spending key.

### 3. Recipient: receive and spend

| Step | Action | Where |
|------|--------|--------|
| 3.1 | Fetch announcements (optionally by `view_tag` or time range). | `GET /api/v1/registry/announcements` or filtered by view tags |
| 3.2 | Scan announcements with viewing_sk + spending keys. | `POST /api/v1/stealth/scan` with `viewing_sk`, `spending_pk`, `spending_sk` |
| 3.3 | For each discovery: use `stealth_address` and `eth_private_key`. | Response: `discoveries[]` with `stealth_address`, `eth_private_key` |
| 3.4 | Import `eth_private_key` into a wallet (e.g. MetaMask) and spend from the matching stealth address. | Your wallet |

Under the hood: for each announcement, decapsulate with viewing_sk -> shared secret; if view tag matches, derive stealth keys; only ~0.4% of announcements need decapsulation.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│  SPECTER-web (Vite + React)       │  specter (Rust workspace)            │
│  -------------------------------- │  ----------------------------------- │
│  Pages:                           │  specter-api (Axum REST, port 3001)  │
│   /setup   - Generate keys        │  specter-core    - types, errors     │
│   /send    - Send payment          │  specter-crypto  - ML-KEM, SHAKE256 │
│   /scan    - Scan payments         │  specter-stealth - payment + scan   │
│   /yellow  - Yellow channels       │  specter-registry - announcements   │
│                                   │  specter-ens     - ENS + IPFS       │
│  Calls API at localhost:3001      │  specter-suins   - SuiNS resolver   │
│                                   │  specter-yellow  - Yellow Network    │
│                                   │  specter-scanner - batch scanning    │
│                                   │  specter-cli     - CLI tool          │
└───────────────────────────────────┴──────────────────────────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    v                   v                   v
              Ethereum RPC        ENS / SuiNS          IPFS (Pinata)
              (resolve names)     (content hash)       (upload meta)
                    │
                    v
            Yellow Network (wss://clearnet.yellow.com/ws)
            (private state channels on Sepolia)
```

- **Backend**: single Rust workspace under `specter/`; API server is `specter-api`; CLI is `specter-cli`.
- **Frontend**: `SPECTER-web/` is a Vite + React app; `VITE_API_BASE_URL` defaults to `http://localhost:3001`.

---

## Getting started

### Prerequisites

- **Rust** (latest stable)
- **Node.js** v18+ and **npm**

### Build and run

1. **Clone**
   ```bash
   git clone https://github.com/pranshurastogi/SPECTER.git
   cd SPECTER
   ```

2. **Backend (Rust)**
   ```bash
   cd specter
   cargo build --release
   cargo run --bin specter -- serve --port 3001
   ```
   API: `http://localhost:3001`; health: `GET /health`.

3. **Frontend (Vite)**
   ```bash
   cd ../SPECTER-web
   npm install
   npm run dev
   ```
   Set `VITE_API_BASE_URL=http://localhost:3001` if needed (default is already that).

### Optional: ENS, IPFS, Yellow

- **ENS resolve**: Backend uses `ETH_RPC_URL` (default: PublicNode). No extra config for resolve-only.
- **Upload to IPFS**: Set `PINATA_JWT`, `PINATA_GATEWAY_URL`, `PINATA_GATEWAY_TOKEN` in `specter/.env`.
- **Yellow Network**: Set `YELLOW_WS_URL`, `YELLOW_CHAIN_ID`, etc. Defaults to production `wss://clearnet.yellow.com/ws`. See [Yellow.md](Yellow.md).

### E2E check

With the API running on 3001:
```bash
./scripts/e2e-stealth-flow.sh
```
Runs: generate keys -> create stealth payment -> publish announcement -> scan -> verify stealth address and `eth_private_key` match.

---

## API summary

### Core stealth protocol

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Health and uptime |
| POST | `/api/v1/keys/generate` | Generate spending/viewing keys and meta-address |
| POST | `/api/v1/stealth/create` | Create stealth address + announcement for a meta-address |
| POST | `/api/v1/stealth/scan` | Scan registry for payments |
| GET | `/api/v1/ens/resolve/:name` | Resolve ENS name to meta-address |
| GET | `/api/v1/suins/resolve/:name` | Resolve SuiNS name to meta-address |
| POST | `/api/v1/ipfs/upload` | Upload meta-address to IPFS |
| GET | `/api/v1/ipfs/:cid` | Retrieve IPFS content |
| GET | `/api/v1/registry/announcements` | List announcements (with filters) |
| POST | `/api/v1/registry/announcements` | Publish announcement |
| GET | `/api/v1/registry/stats` | Registry stats |

### Yellow Network

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/yellow/channel/create` | Create private channel via stealth address |
| POST | `/api/v1/yellow/channel/discover` | Scan for incoming channels |
| POST | `/api/v1/yellow/channel/fund` | Add funds to a channel |
| POST | `/api/v1/yellow/channel/close` | Close and settle on L1 |
| GET | `/api/v1/yellow/channel/:id/status` | Channel status |
| POST | `/api/v1/yellow/transfer` | Off-chain transfer |
| GET | `/api/v1/yellow/config` | Yellow Network configuration |

---

## Why Rust

SPECTER's critical path -- key generation, encapsulation, decapsulation, stealth derivation, and scanning -- runs in **Rust** for good reason:

- **Security**: No undefined behavior; memory and thread safety enforced by the compiler. Secret keys are zeroized on drop. Constant-time crypto where it matters.
- **Performance**: No GC pauses; predictable latency. ML-KEM and SHAKE256 run at tens of thousands of ops per second per core, so scanning large announcement sets stays fast.
- **Reliability**: Strong typing and error handling reduce runtime failures. The same Rust code powers the CLI, the API server, and (via the API) the web app, so there is a single, auditable implementation of the protocol.
- **Ecosystem**: NIST-standard ML-KEM (e.g. `pqcrypto-kyber`), SHA3, and Ethereum libraries (alloy, ethers) are first-class in Rust, making a post-quantum + Ethereum stack natural.

The web UI (Vite + React) is a thin client that calls the Rust backend over HTTP; all crypto and protocol logic stays on the server.

---

## Rust crates

The backend is a **single Cargo workspace** under `specter/`. Each crate has a focused role:

| Crate | Role |
|-------|------|
| **specter-core** | Shared types (`MetaAddress`, `Announcement`, `EthAddress`, `KyberPublicKey`), errors (`SpecterError`), constants (key sizes, domain strings), and traits (e.g. `AnnouncementRegistry`). No I/O; used by every other crate. |
| **specter-crypto** | Post-quantum and derived crypto: ML-KEM-768 keygen/encapsulate/decapsulate (via `pqcrypto-kyber`), SHAKE256 hashing, view-tag computation, and stealth key/address derivation (XOR with SHAKE256 output, then Keccak256 for Ethereum address). All secret material zeroized. |
| **specter-stealth** | High-level protocol: `create_stealth_payment(meta_address)` for senders (encapsulate -> view tag -> derive stealth address) and `scan_announcement` / `scan_with_context` for recipients (decapsulate -> view-tag filter -> derive stealth keys). Defines `StealthPayment`, `SpecterWallet`. |
| **specter-registry** | Announcement storage: in-memory implementation and (optional) file-backed. Used by the API and CLI to publish and list announcements; supports filtering by view tag and time range. |
| **specter-scanner** | Batch scanning and progress reporting (e.g. for CLI or future indexing). Builds on `specter-stealth` discovery. |
| **specter-ens** | ENS resolution (content hash / text records) and IPFS upload (e.g. Pinata) for meta-addresses. Used when resolving `alice.eth` or uploading meta-address for ENS. |
| **specter-suins** | SuiNS resolution for Sui blockchain. Same pattern as ENS but for `.sui` names. |
| **specter-yellow** | Yellow Network integration: private state channels via stealth addresses. Client, channel builder, discovery, and settlement. See [Yellow.md](Yellow.md). |
| **specter-api** | REST API (Axum): routes for keys, stealth create/scan, ENS/SuiNS resolve, IPFS upload, registry publish/list/stats, Yellow channel operations, health. Runs as the backend the web app calls. |
| **specter-cli** | CLI (Clap): `generate`, `resolve`, `create`, `scan`, `serve`, `bench`. Same core libraries as the API; useful for scripting and local testing. |

Dependency flow: **specter-core** <- **specter-crypto** <- **specter-stealth**; **specter-registry** and **specter-ens** use core (and crypto/stealth where needed); **specter-yellow** uses stealth + registry + ens; **specter-api** and **specter-cli** tie them together.

---

## Benchmarking

Run both benchmarks from the repo root:

```bash
cd specter

# 1. CLI: full flow (keygen + create N announcements + scan)
cargo run --bin specter -- bench --count 10000

# 2. Criterion: crypto micro-benchmarks
cargo bench -p specter-crypto
```

<div align="center">
  <img src="assets/benchmarking.png" alt="SPECTER benchmarks: keygen, encapsulate, decapsulate, view_tag, stealth derivation" width="700">
</div>

### 1. CLI integration benchmark

Simulates key generation, creating many announcements (mix of "our" payments and random ones), and a full scan. Example with 10k announcements: key generation ~hundreds of us; scan rate and time per announcement printed at the end. Increase `--count` (e.g. `100000`) for heavier load.

### 2. Criterion (crypto-only)

Micro-benchmarks for the hot crypto functions. Example results (release build):

| Operation | Time | Throughput |
|-----------|------|-------------|
| Key generation (one Kyber keypair) | ~12.3 us | ~81k/sec |
| Encapsulate | ~8.15 us | ~123k/sec |
| Decapsulate | ~9.5 us | ~105k/sec |
| View tag (`compute_view_tag`) | ~306 ns | ~3.27M/sec |
| Derive stealth address | ~44-47 us | ~21-23k/sec |
| Derive stealth keys | ~66-71 us | ~14-15.5k/sec |

So a **full scan** over 100k announcements with view-tag filtering does ~400 decapsulations (0.4% of 100k) plus derivations only for matches; end-to-end is typically on the order of **1-2 seconds** for 100k announcements, depending on hardware.

---

## Technology stack

- **Backend**: **Rust** -- Axum (API), pqcrypto-kyber (ML-KEM-768), sha3 (SHAKE256), alloy/ethers (Ethereum/ENS).
- **Frontend**: TypeScript, Vite, React, TailwindCSS, Framer Motion, Radix UI, Dynamic Labs (wallet), Sui dapp-kit.
- **Infrastructure**: Ethereum (ENS), Sui (SuiNS), IPFS (Pinata), Yellow Network (state channels).

---

## Project layout

```
SPECTER/
├── README.md                 # This file
├── Yellow.md                 # Yellow Network integration docs
├── assets/                   # Logo images
├── scripts/
│   ├── build-and-test.sh     # Build + test Rust workspace
│   ├── e2e-stealth-flow.sh   # E2E: generate -> create -> publish -> scan -> verify
│   └── rebuild-backend.sh
├── specter/                  # Rust workspace (backend + CLI)
│   ├── Cargo.toml
│   ├── specter-api/          # REST API server (core + Yellow endpoints)
│   ├── specter-cli/          # CLI (generate, create, scan, serve, bench, resolve)
│   ├── specter-core/         # Types, errors, constants, traits
│   ├── specter-crypto/       # ML-KEM-768, view tags, stealth derivation
│   ├── specter-ens/          # ENS resolver + IPFS upload
│   ├── specter-suins/        # SuiNS resolver
│   ├── specter-yellow/       # Yellow Network integration
│   ├── specter-registry/     # In-memory (and file) announcement registry
│   ├── specter-scanner/      # Batch scanning
│   ├── specter-stealth/      # Payment creation + discovery
│   └── examples/
│       └── yellow_private_trading.rs  # Yellow integration demo
└── SPECTER-web/              # Vite + React frontend
    ├── package.json
    └── src/
        ├── lib/api.ts        # API client (core + Yellow)
        ├── pages/
        │   ├── Index.tsx          # Landing page
        │   ├── GenerateKeys.tsx   # Key generation wizard
        │   ├── SendPayment.tsx    # Send stealth payment
        │   ├── ScanPayments.tsx   # Scan for payments
        │   └── YellowPage.tsx     # Yellow Network dashboard
        └── components/
```

---

<p align="center">
  Built for ETHGlobal HackMoney 2026
</p>
