<div align="center">
  <img src="assets/logo/Specterpq-dark.png" alt="SPECTER" width="280" />

  <h1>SPECTER</h1>

  <strong>The private payments layer for onchain money, built to outlive quantum computers.</strong>
  <br />
  <sub>Private payments today. Quantum-safe forever.</sub>

  <br /><br />

  [![Website](https://img.shields.io/badge/Live-specterpq.com-black?style=flat-square&logo=vercel)](https://specterpq.com)
  [![Docs](https://img.shields.io/badge/Docs-Mintlify-6C47FF?style=flat-square&logo=gitbook)](https://docs.specterpq.com)
  [![SDK](https://img.shields.io/badge/SDK-@specterpq/sdk-CB3837?style=flat-square&logo=npm)](https://www.npmjs.com/package/@specterpq/sdk)
  [![Paper](https://img.shields.io/badge/Paper-arXiv%202501.13733-B31B1B?style=flat-square&logo=arxiv)](https://arxiv.org/pdf/2501.13733v1)
  [![NIST FIPS 203](https://img.shields.io/badge/Crypto-ML--KEM--768%20(FIPS%20203)-2C7CB0?style=flat-square)](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.203.pdf)
  [![Twitter](https://img.shields.io/badge/Twitter-@SpecterPQ-1DA1F2?style=flat-square&logo=twitter)](https://twitter.com/SpecterPQ)

  <br />

  <img src="assets/cover-SPECTER.png" alt="SPECTER cover" width="100%" />
</div>

---

> **Every payment you have ever made on a public blockchain is a permanent, searchable record — your counterparties, your balances, your salary, your runway. Today it is merely exposed. Tomorrow, a quantum computer makes the little privacy that exists reversible. SPECTER is the payments layer that fixes both — private now, and provably private after quantum.**

SPECTER lets anyone send money to a human-readable name (`alice.eth`, `bob.sui`) so that **only the recipient can discover, link, or spend it** — using cryptography standardized by NIST to withstand quantum attack. It is **live**, multi-chain, non-custodial, and shipped as both a consumer app and a developer SDK.

---

## Table of Contents

1. [Why This Matters Now](#1--why-this-matters-now)
2. [The Opportunity](#2--the-opportunity)
3. [What SPECTER Is](#3--what-specter-is)
4. [Why SPECTER Wins](#4--why-specter-wins)
5. [How It Works](#5--how-it-works)
6. [Under the Hood — Protocol Design](#6--under-the-hood--protocol-design)
7. [Architecture](#7--architecture)
8. [Performance](#8--performance)
9. [Security & Trust Model](#9--security--trust-model)
10. [Use Cases](#10--use-cases)
11. [Traction & Status](#11--traction--status)
12. [Roadmap](#12--roadmap)
13. [Build with SPECTER](#13--build-with-specter)
14. [Testing](#14--testing)
15. [Research & References](#15--research--references)

---

## 1 · Why This Matters Now

Public blockchains made money programmable — and, as a side effect, made it **transparent to everyone, forever**. A wallet address is a lifelong identity. Anyone with a block explorer can see who paid whom, how much, and how often. For consumers this is a privacy problem; for businesses, treasuries, and payroll it is a non-starter.

The existing answer — **stealth addresses** (Umbra, Fluidkey, ERC-5564) — gives each payment a fresh, unlinkable address. But every one of these systems is built on **ECDH over secp256k1**, the same elliptic-curve math that **Shor's algorithm breaks completely** on a sufficiently large quantum computer.

This is not a distant, theoretical risk:

- **The migration window is open.** In 2024, NIST finalized its post-quantum cryptography standards, including **ML-KEM (FIPS 203)** — the successor to classical key exchange. Governments and standards bodies are already mandating the transition.
- **The attack is already underway.** Adversaries are recording encrypted and on-chain data *today* to decrypt it once quantum hardware matures.

> *"Store now, decrypt later attacks mean data encrypted today may be vulnerable tomorrow."*
> — CISA / NSA Joint Advisory, 2022

Payment history that users believe is private today — pseudonymous, or "hidden" behind classical stealth addresses — may not stay that way. **The privacy of on-chain money needs to be re-architected once, correctly, before the deadline arrives.** That is the market SPECTER was built for.

---

## 2 · The Opportunity

Trillions of dollars now move across public blockchains every year, and stablecoins have turned crypto rails into real payment infrastructure for payroll, remittance, commerce, and corporate treasury. Every one of those flows is, by default, **fully public**.

Two forces are converging:

| Force | Consequence |
|---|---|
| **Money is moving on-chain at scale** | Privacy is no longer a niche preference — it is a compliance, safety, and competitive requirement for anyone running real value on public ledgers. |
| **Post-quantum migration is now mandated** | Every classical privacy system on-chain is on a countdown. The winners will be the ones that are quantum-safe *by construction*, not retrofitted later. |

SPECTER sits precisely at that intersection: **the privacy layer for on-chain payments that is also the first to be quantum-safe.** We don't ask users to change behavior — they still pay to a name — we change the cryptography underneath so their financial life is private today and stays private after quantum.

---

## 3 · What SPECTER Is

SPECTER replaces the quantum-vulnerable key exchange at the heart of stealth addresses with **ML-KEM-768** (NIST FIPS 203), the standardized post-quantum key encapsulation mechanism — while keeping the experience users already understand:

> **Send to a name. Discover what's yours. Spend from any wallet. No one else can link the two.**

It ships as a complete, production-grade stack — a consumer product *and* the infrastructure others can build on:

| Layer | What it delivers |
|---|---|
| **`specterpq.com`** | Live web wallet — set up an identity, attach it to ENS/SuiNS, send, scan, and recover payments. |
| **`@specterpq/sdk`** | Browser-first SDK (Rust → WebAssembly). Any app can generate keys, build payments, and scan **entirely in the user's browser** — no secret ever touches a server. |
| **`specter-api`** | Public-data services — announcement registry, ENS/SuiNS resolution, IPFS pinning, gas-sponsored relaying. |
| **`specter-*` (Rust)** | The audited core: ML-KEM-768 primitives, secp256k1 stealth derivation, batch scanning, and persistence. |

Supported today: **Ethereum** (mainnet + testnet) and **Sui** (mainnet + testnet), with **ENS** and **SuiNS** name resolution.

**Non-custodial by construction.** Keys are generated and used inside the user's device via the WASM SDK. The server sees only public data. There is no key to leak, subpoena, or lose on our side.

---

## 4 · Why SPECTER Wins

**We are the first production-grade stealth address protocol that is quantum-safe — and we shipped the full stack, not a paper.**

|  | **SPECTER** | Umbra | Fluidkey |
|---|:---:|:---:|:---:|
| Post-quantum cryptography | ✅ ML-KEM-768 (FIPS 203) | ❌ ECDH secp256k1 | ❌ ECDH secp256k1 |
| Harvest-now-decrypt-later safe | ✅ | ❌ | ❌ |
| Non-custodial (keys never leave device) | ✅ WASM SDK | ✅ | ❌ server-delegated |
| Chains | Ethereum + Sui | Ethereum | Ethereum |
| Name resolution | ENS + SuiNS | ENS | ENS |
| Developer SDK | ✅ npm, browser-first | ❌ | ❌ |
| Scan 100k announcements | ~1–2 s | ~10–15 s | n/a (delegated) |
| Open source & research-backed | ✅ | ✅ | ❌ |

**The moat:**

1. **Standards-grade cryptography, correctly implemented.** ML-KEM-768 is the NIST standard, not a bespoke scheme. The stealth derivation is a hardened, ERC-5564-style construction with a regression test that *proves the sender cannot derive the recipient's key*.
2. **First-mover in an unavoidable migration.** Every competitor must eventually rebuild on post-quantum crypto. We already have.
3. **Distribution as infrastructure.** The SDK turns SPECTER from an app into a primitive other wallets and apps can embed — compounding reach.
4. **Real product, real UX.** Live, multi-chain, with name resolution and payment recovery — the unglamorous work that makes privacy usable.

---

## 5 · How It Works

Three steps, familiar to anyone who has used a wallet.

### ① Set up — a private identity, once

The recipient's device generates two keypairs — a **secp256k1 spending** key and a post-quantum **ML-KEM-768 viewing** key — bundles their public halves into a **meta-address**, pins it to IPFS, and attaches it to an ENS or SuiNS name. Secret keys never leave the device. The meta-address is public and reveals no history.

<div align="center"><img src="assets/setup.png" alt="Setup flow" width="72%"/></div>

### ② Send — pay to a name

The sender resolves `alice.eth` → meta-address, derives a **fresh one-time address** for this payment, sends funds to it, and publishes a small **announcement** to the registry. The sender learns nothing about the recipient's other payments, and nobody watching the chain can link the payment to `alice.eth`.

<div align="center"><img src="assets/send.png" alt="Send flow" width="72%"/></div>

### ③ Receive — discover and claim

The recipient's wallet scans announcements, instantly skipping ~99.6% of them with a 1-byte tag, and recognizes the payments that are theirs. From there, **claiming is one flow, in-app**: the wallet reads live balances for every discovered stealth address, and sweeps all funded ones to any address or ENS name the user chooses — each transfer signed locally on the device, no private-key export or wallet import required. The claim produces a downloadable receipt (PNG / PDF / JSON) and a per-identity claim history, so a recipient always knows what was claimed, where it went, and what is still sitting in stealth addresses. (Power users can still export a per-payment private key into MetaMask or a Sui wallet.) **Discovery is view-only and can run anywhere; spending requires the secret key, which stays on the device.**

<div align="center"><img src="assets/receive.png" alt="Receive flow" width="72%"/></div>

---

## 6 · Under the Hood — Protocol Design

*For the technically inclined reader performing diligence.*

### Hybrid keys: post-quantum where it counts

A meta-address (protocol **v2**) is a secp256k1 spending public key plus an ML-KEM-768 viewing public key:

```
spending_pub (secp256k1, 33B) ‖ viewing_pk (ML-KEM, 1184B)  →  meta-address  →  IPFS CID  →  ENS / SuiNS
```

- The **viewing key is post-quantum (ML-KEM).** This is the key that protects *linkability* — exactly what "harvest-now-decrypt-later" attacks target. It stays quantum-safe.
- The **spending key is secp256k1**, because Ethereum and Sui accounts are secp256k1. A quantum adversary capable of breaking it could already drain any ordinary account — so the meaningful post-quantum guarantee lives in discovery, where we place it.

### One-time address derivation

For each payment, sender and recipient share a per-payment secret via ML-KEM. From it they derive an additive tweak `t` and shift the spending key — an ERC-5564-style construction over secp256k1:

```text
(shared_secret, ciphertext) = ML-KEM-768.Encaps(viewing_pk)
t         = H_to_scalar("SPECTER_STEALTH_TWEAK_V2" ‖ shared_secret)   // secp256k1 scalar
P         = spending_pub  +  t·G          // stealth address — sender-computable from PUBLIC data
p         = spending_sk   +  t  (mod n)   // stealth private key — needs the SECRET spending key
eth_addr  = keccak256(uncompressed(P))[12:]
sui_addr  = blake2b256(0x01 ‖ compressed(P))
view_tag  = SHAKE256("SPECTER_VIEW_TAG_V1" ‖ shared_secret, 1)[0]
```

Because `p·G = P`, the address the sender funds from public data is exactly the one the recipient can spend. **Critically, the sender cannot derive `p`** — that needs the secret spending scalar, which never leaves the recipient. This property is enforced by a dedicated regression test in the crypto crate.

### Efficient, view-only discovery

The 1-byte `view_tag` lets a scanner discard ~99.6% of announcements with a single comparison — no cryptography — before doing one ML-KEM decapsulation on the rest. **Detection needs only the viewing secret + the spending *public* key**, so it can run on a watch-only client, an auditor, or a service. Turning a discovered payment into a spendable key is a separate, device-local step.

### Publish integrity

A wrong `view_tag` at publish time would make a payment land correctly yet be forever invisible to the recipient. SPECTER closes this failure mode with a server-authoritative publish path (`payment_id` → the server publishes the exact announcement it generated), plus client-side recovery (a pending vault, a phase-aware send state machine, and one-click recovery export) so a user can interrupt and resume from any later session.

---

## 7 · Architecture

```
SPECTER/
├── specter/                        # Rust workspace (the audited core)
│   ├── specter-core/               # Shared types, errors, constants
│   ├── specter-crypto/             # ML-KEM-768, SHAKE256, secp256k1 stealth derivation
│   ├── specter-stealth/            # One-time address derivation + payment discovery
│   ├── specter-scanner/            # Batch scanning engine
│   ├── specter-registry/           # Announcement store (memory / libSQL / Turso)
│   ├── specter-ipfs/               # Pinata IPFS client (upload + fetch)
│   ├── specter-ens/                # ENS resolution (alloy + IPFS)
│   ├── specter-suins/              # SuiNS resolution (Sui JSON-RPC + IPFS)
│   ├── specter-yellow/             # Yellow Network channel integration
│   └── specter-api/                # Axum HTTP server (public data only)
├── SPECTER-web/                    # React + TypeScript wallet
│   └── src/lib/crypto/specter.ts   # Client-side crypto via @specterpq/sdk (WASM)
└── @specterpq/sdk                  # Browser-first SDK (published to npm)
```

**Registry backends:** `memory` for local/CI, and **Turso** (libSQL, SQLite-compatible) for production — with a 256-slot LRU per view tag, per-wallet scanner checkpoints for incremental restart, and Yellow Network channel tracking. A single VPS sustains tens of millions of announcements without degrading scan times.

---

## 8 · Performance

<div align="center"><img src="assets/benchmarking.png" alt="Benchmarks" width="70%"/></div>

| Operation | Latency |
|---|---|
| ML-KEM-768 key generation | < 1 ms |
| Encapsulation (stealth address creation) | < 2 ms |
| View-tag check per announcement | ~0.5 µs |
| Full scan — 100,000 announcements | ~1–2 s |
| Announcement publish (Turso / SQLite) | < 5 ms |
| Cached registry lookup by view tag | < 1 ms |

The 1-byte view tag is the dominant speed primitive: only 1 in 256 announcements requires full ML-KEM decapsulation.

---

## 9 · Security & Trust Model

**Design principle: the server holds no secret it could ever leak.**

- **Client-side keys.** Key generation, scanning, and spend-key derivation run in the browser via the WASM SDK. `spending_sk` and `viewing_sk` **never cross the network**. The server sees only public data (meta-addresses, announcements) and relays gas-sponsored transactions.
- **Standards-grade, pure-Rust crypto** ([RustCrypto](https://github.com/RustCrypto)): `ml-kem`, `sha3`, `k256`, `blake2`. `#![forbid(unsafe_code)]` workspace-wide.
- **Secret-safe engineering.** Keys are `Zeroize`'d on drop; comparisons are constant-time via `subtle`; the sender-cannot-derive property is asserted by test.
- **On-device key vault.** Secret keys are stored only as AES-256-GCM ciphertext, unlocked by **password** (PBKDF2-SHA256, 600k iterations) or **passkey** (WebAuthn PRF + HKDF). The client-side recovery vault stores only public fields — never private key material.
- **Hardened services.** Per-IP rate limiting on write endpoints, security headers, and WAL-mode SQLite with a busy timeout.

Responsible disclosure: **hello@pranshurastogi.com**

---

## 10 · Use Cases

| For | Why SPECTER |
|---|---|
| **Payroll & contractors** | Pay a team on-chain without publishing every salary to the world. |
| **Corporate & DAO treasuries** | Move funds and vendor payments without broadcasting cash position and counterparties. |
| **Creators, donations & aid** | Receive support at a public name without exposing every backer or the total raised. |
| **Personal finance** | Get paid to `you.eth` without turning your address into a lifelong, searchable profile. |
| **Wallets & apps (via SDK)** | Add quantum-safe private payments in-app, non-custodially, in a few calls. |

---

## 11 · Traction & Status

- **Live in production** at [specterpq.com](https://specterpq.com) — full setup → send → scan → claim flow, including in-app sweeping of discovered funds to any wallet or ENS name with receipts and claim history.
- **Multi-chain:** Ethereum and Sui, with ENS and SuiNS name resolution.
- **Developer SDK published** to npm as [`@specterpq/sdk`](https://www.npmjs.com/package/@specterpq/sdk) — browser-first, WASM-backed.
- **Research-backed:** built on peer-reviewed post-quantum stealth-address research ([arXiv 2501.13733](https://arxiv.org/pdf/2501.13733v1)) and the NIST FIPS 203 standard.
- **Open source** across the full stack — verifiable, auditable, integrable.

---

## 12 · Roadmap

| Horizon | Focus |
|---|---|
| **Now** | Hardened v2 protocol (secp256k1 tweak + ML-KEM viewing), client-side SDK, Ethereum + Sui, ENS/SuiNS. |
| **Next** | Broader chain and wallet integrations via the SDK; deeper stablecoin/payments flows; third-party security audit. |
| **Later** | Fully post-quantum spending as chains adopt PQ-native accounts; enterprise payroll & treasury tooling. |

---

## 13 · Build with SPECTER

### SDK (recommended — client-side, non-custodial)

```bash
npm install @specterpq/sdk
```

```ts
import { initSpecterSdk, generateSpecterKeys, createStealthPayment,
         scanAnnouncement, deriveStealthKeys } from "@specterpq/sdk";

await initSpecterSdk();                       // load WASM once
const keys = generateSpecterKeys();           // in-browser; secrets never leave the device
const payment = createStealthPayment(metaAddressHex); // sender: one-time address, no secret learned
```

### Run the stack

**Requirements:** Rust (stable), Node.js ≥ 18, a Pinata account (IPFS), and an Ethereum RPC endpoint.

```bash
# Backend (public-data services)
git clone https://github.com/pranshurastogi/SPECTER.git
cd SPECTER/specter && cp .env.sample .env
cargo run -p specter-cli -- serve --port 3001
# Production: REGISTRY_BACKEND=turso cargo run --release -p specter-cli -- serve --port 3001

# Frontend
cd ../SPECTER-web && cp .env.sample .env
npm install && npm run dev            # http://localhost:8080
```

### CLI

```bash
specter generate --output keys.json    # generate a key set
specter resolve  vitalik.eth           # ENS → meta-address
specter create   alice.eth             # build a stealth payment
specter scan     --keys keys.json      # scan the registry for owned payments
specter bench    --count 100000        # throughput benchmark
```

### API (public data only)

Base URL: `https://backend.specterpq.com` · local: `http://localhost:3001`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check + uptime |
| `POST` | `/api/v1/stealth/create` | Build a stealth payment for a **public** meta-address → `payment_id`, `stealth_address`, `announcement` |
| `GET` | `/api/v1/registry/announcements` | List announcements (paginated) — scanned client-side |
| `POST` | `/api/v1/registry/announcements` | Publish an announcement (`payment_id` preferred) |
| `GET` | `/api/v1/ens/resolve/:name` · `/api/v1/suins/resolve/:name` | Resolve a name → meta-address |
| `POST` | `/api/v1/ipfs/upload` · `GET /api/v1/ipfs/:cid` | Pin / fetch a meta-address |
| `GET` | `/api/v1/registry/stats` | Registry stats and view-tag distribution |

> Key generation and scanning are performed **client-side in the SDK** — the API deliberately exposes no endpoint that receives a secret key. Full schemas and a Postman collection: [`specter/SPECTER_API.postman_collection.json`](specter/SPECTER_API.postman_collection.json) · [docs.specterpq.com](https://docs.specterpq.com).

---

## 14 · Testing

```bash
cargo test --workspace                                   # Rust core (incl. sender-cannot-derive proof)
cargo test -p specter-registry --features sqlite -- sqlite # persistence
cd SPECTER-web && npm test                                # frontend (vitest)
```

| Test | What it asserts |
|---|---|
| `sender_cannot_derive_stealth_private_key` | The sender provably cannot compute the recipient's spend key |
| `test_create_then_publish_via_payment_id` | End-to-end server-authoritative publish |
| `test_payment_id_is_single_use` | `payment_id` is consumed on first success |
| `test_scan_stats_count_view_tag_matches_independently` | Scan reports `view_tag_matches` separately from `discoveries` |

---

## 15 · Research & References

- [Post-Quantum Stealth Address Protocols](https://arxiv.org/pdf/2501.13733v1) — arXiv 2501.13733
- [NIST FIPS 203 — ML-KEM Standard](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.203.pdf)
- [ERC-5564 — Stealth Addresses for Ethereum](https://eips.ethereum.org/EIPS/eip-5564) — SPECTER extends ERC-5564 with post-quantum discovery

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
  <a href="https://www.npmjs.com/package/@specterpq/sdk">SDK</a>
  &nbsp;·&nbsp;
  <a href="https://arxiv.org/pdf/2501.13733v1">Research</a>
  <br /><br />
  <sub>Private payments today. Quantum-safe forever. · Built with Rust · Powered by ML-KEM-768</sub>
</div>
