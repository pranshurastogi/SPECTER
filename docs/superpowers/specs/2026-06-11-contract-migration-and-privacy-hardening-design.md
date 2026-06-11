# SPECTER — Contract Migration + Privacy Hardening

**Date:** 2026-06-11
**Branch:** `upgrade/monad`
**Status:** Design — awaiting review

## Context

A new `SPECTERAnnouncer` was deployed on Monad testnet with a **changed event
interface**, and an external review surfaced five privacy weaknesses. This spec
covers both, split into two independently shippable phases (decision: phased).

### New deployment (Monad testnet, chain 10143)

| Field | Value |
|---|---|
| Address | `0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC` |
| Deploy block | `37571591` |
| Salt | `keccak256("specterpq.announcer.v1")` |
| Factory (CREATE2) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Deploy tx | `0xa66a1afe651c26c22b2e361b41ce6803824c87a1a7fbd2793c96e19731a8f354` |
| Verified | Sourcify (full match) |

### New event interface (the breaking change)

```solidity
event Announcement(
    uint256         schemeId,           // SCHEME_ID = 1000 — NO LONGER indexed
    address indexed stealthAddress,
    address indexed caller,
    bytes32         ephemeralKeyHash,   // keccak256(ML-KEM-768 ciphertext) — was `bytes ephemeralPubKey`
    bytes           metadata
);

function announce(address stealthAddress, bytes calldata ephemeralPubKey, bytes calldata metadata) external;
function announce(uint256 schemeId, address stealthAddress, bytes calldata ephemeralPubKey, bytes calldata metadata) external; // overload
function announceMany(address[] calldata, bytes[] calldata, bytes[] calldata) external;
```

Constants: `SCHEME_ID=1000`, `EPHEMERAL_KEY_LENGTH=1088`, `MAX_BATCH=50`, `deployBlock` (immutable).

**Implication:** the publisher side is unchanged — `announce(stealthAddress,
ephemeralPubKey, metadata)` keeps the same calldata. But the **log no longer
carries the 1088-byte ciphertext** — only its keccak256. The full ciphertext now
lives permanently in calldata. Every off-chain *read* path (indexer, event-poller,
scanner, Turso schema) must change accordingly.

### Confirmed-still-present review findings

1. **On-chain metadata in plaintext** — *fix in progress* (AES-256-GCM module at
   `specter-crypto/src/metadata.rs`, wired through `pending.rs`/`handlers.rs`/`payment.rs`).
   Decision: keep AES-256-GCM (not ChaCha20-Poly1305).
2. **Turso plaintext at rest** — `announcements.amount`, `announcements.payment_tx_hash`,
   `_telemetry.ip`, `_telemetry.view_tag` all stored in cleartext.
3. **`payment_tx_hash` unique-index side-channel** — `idx_announcements_payment_tx_unique`
   lets anyone probe whether a given tx was routed through SPECTER.
4. **No cryptographic recipient/amount proof** — `verifier.rs` only checks the tx
   *succeeded*, not that it paid the claimed stealth address/amount.
5. **Pending store in RAM** — `pending.rs` loses `payment_id`→`shared_secret` on
   restart, silently forcing the weaker client-supplied fallback path.

---

## Phase 1 — Contract migration + interface/decoder rewrite

Goal: the new contract is fully live and re-indexed from block `37571591`.

### 1.1 Config / env / hosting (mechanical)

Set in every env file and hosting var:
```
SPECTER_ANNOUNCER_ADDRESS=0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC
SPECTER_ANNOUNCER_DEPLOY_BLOCK=37571591
```
Files: `specter/.env`, `.env.example`, `.env.staging.example`,
`.env.production.example`, `.env.railway.example`, `.env.sample`, `.env.e2e`;
`event-poller/.env`, `event-poller/.env.example`; `indexer/config.yaml`
(`address:` + `start_block:`). Also fix the **hardcoded fallback**
`ANNOUNCER_DEFAULT` at `specter-cli/src/bin/e2e_flow.rs:43`.

Hosting checklist (operator action, listed not automated): API service,
event-poller service, indexer service — update `SPECTER_ANNOUNCER_ADDRESS` /
`SPECTER_ANNOUNCER_DEPLOY_BLOCK`, restart all three. Fund the relayer wallet
(`RELAYER_PRIVATE_KEY`) on Monad if low.

Verify `SCHEME_ID` alignment (contract = 1000) wherever the schemeId is asserted.

### 1.2 Rust ABI bindings — `specter-chain/src/contract.rs`

Rewrite the `sol!` block to the new interface:
- `event Announcement(uint256 schemeId, address indexed stealthAddress, address indexed caller, bytes32 ephemeralKeyHash, bytes metadata)` — note `schemeId` no longer indexed.
- Keep `announce(address,bytes,bytes)`; add the `announce(uint256,address,bytes,bytes)` overload and `announceMany(address[],bytes[],bytes[])`.
- Add the contract's custom errors (`ZeroStealthAddress`, `EphemeralKeyLength`, `MetadataRequired`, `SchemeMismatch`, `BatchEmpty`, `BatchTooLarge`, `BatchLengthMismatch`) so reverts decode to readable messages.
- Keep `deployBlock()` getter.

`announcer.rs` (publish path) needs no signature change.

### 1.3 Read path: fetch ciphertext from calldata (model = store-hash)

The chosen model: off-chain stores keep **`ephemeralKeyHash` + the announce
tx hash**, not the ciphertext. Scanners fetch calldata only for the ~1/256
events that pass the view-tag filter. Per-event flow:

1. From log: `ephemeralKeyHash`, `stealthAddress`, `caller`, `metadata`, announce `txHash`, `logIndex`.
2. Read `metadata[0]` (view_tag); skip ~255/256.
3. On match: `eth_getTransactionByHash(announce_tx)` → ABI-decode `announce` calldata → `ephemeralPubKey` (1088 bytes).
4. **Assert `keccak256(ephemeralPubKey) == ephemeralKeyHash`** (integrity gate).
5. ML-KEM `decaps(sk, ephemeralPubKey)` → shared secret → derive stealth key.
6. (Phase-2 dependency) decrypt the metadata blob with the shared secret.

This touches the `specter-scanner` crate (decode helper + calldata fetch) and any
SDK consumer. The keccak256 assertion is mandatory — without it a malicious
relayer could swap the ciphertext.

### 1.4 Indexer (Envio) — `indexer/`

- `config.yaml`: new event signature (above), new address + `start_block: 37571591`. Keep `field_selection.transaction_fields: [hash]` (scanners need the announce tx to fetch calldata).
- `schema.graphql`: replace `ephemeralPubKey: String` with `ephemeralKeyHash: String`. The decoded `amount`/`txHash`/`sourceChainId` fields become unreadable (metadata is encrypted) — drop them from the entity or mark nullable and always-null for on-chain rows; keep `viewTag` (plaintext byte 0) and `metadataRaw` (the opaque blob).
- `EventHandlers.ts`: read `ephemeralKeyHash` from params; stop the 1088-byte length check on the event field (it's a 32-byte hash now); stop decoding amount/txHash/sourceChainId; write hash + announce tx + raw blob to both Envio and Turso.
- `metadata.ts`: reduce to extracting `view_tag = metadata[0]`; the remaining bytes are opaque ciphertext, not a decodable struct.
- `turso.ts`: write `ephemeral_key_hash`, `tx_hash` (announce tx), `metadata_blob`, `view_tag`, block/stealth fields; stop writing plaintext `amount`/`payment_tx_hash`/`source_chain_id`.
- Re-index: address change means a fresh Envio index; ensure the persisted-state/start-block reset so it replays from `37571591`.

### 1.5 event-poller — `event-poller/src/index.ts`

- `ANNOUNCEMENT_EVENT` ABI string → new signature with `bytes32 ephemeralKeyHash`.
- `processLog`: read `ephemeralKeyHash`; read `view_tag` from `metadata[0]`; drop the plaintext metadata decode and the 2176-hex-char ephemeral validation.
- `insertAnnouncement`: write `ephemeral_key_hash` + announce `tx_hash` + `metadata_blob` + `view_tag` (mirrors the indexer).

### 1.6 Turso schema v6 — `specter-registry/src/turso/schema.rs`

Because re-indexing rebuilds the table, define the final schema once in Phase 1
(Phase 2 only adds API-side *behavior*, not new structural columns beyond the
HMAC column, which we add here so the migration is single-shot):

- Add `ephemeral_key_hash BLOB` (32 bytes); make legacy `ephemeral_key BLOB` nullable and stop writing it.
- Add `metadata_blob BLOB` (the encrypted metadata; lets scanners read it without an extra fetch — the blob is already in the log).
- Add `payment_tx_hash_hmac BLOB` and move the UNIQUE index onto it (`WHERE payment_tx_hash_hmac IS NOT NULL`). Drop the plaintext-`payment_tx_hash` unique index (kills the Phase-2 side-channel structurally).
- `amount`, `payment_tx_hash`, `source_chain_id`: NULL for on-chain/indexer rows (data is inside `metadata_blob`).
- `_telemetry`: replace `ip TEXT` with `ip_hash BLOB`; keep `view_tag` (1-byte, low entropy) but it is no longer linkable to a real IP once the IP is hashed.

SQLite can't drop columns easily; use the additive ALTER pattern already in this
file (v5→v6 migration block) and stop writing the deprecated columns.

### Phase 1 testing
- `metadata.rs` unit tests already cover the AEAD round-trip.
- Add: ABI decode test for the new event (fixture log → expected fields); calldata-decode + keccak256-match test in the scanner; indexer/poller handler tests asserting the new columns are written and plaintext columns stay NULL; a migration test proving v5→v6 is idempotent (per `4986c3c`).
- E2E: `e2e_flow.rs` against the new address publishes, scans via calldata fetch, and recovers the stealth key.

---

## Phase 2 — Privacy hardening (B2–B5)

Goal: no plaintext sensitive data at rest; cryptographic payment proof; durable
pending store. B1 (on-chain encryption) is already in progress and is finished/
verified as part of this phase.

### 2.0 Server key material — one secret, domain-separated subkeys

Introduce `SPECTER_DB_ENC_KEY` (32 random bytes, base64 in env; never in Turso).
Derive purpose-specific subkeys with SHAKE-256 + domain separators, matching the
existing KDF pattern in `specter-crypto`:

```
DB_HMAC_KEY       = SHAKE256("SPECTER_DB_HMAC_V1"       || master)[..32]   // dedup
DB_PENDING_WRAP   = SHAKE256("SPECTER_DB_PENDING_V1"    || master)[..32]   // wrap shared_secret
DB_TELEMETRY_SALT = SHAKE256("SPECTER_DB_TELEMETRY_V1"  || master)[..32]   // base for daily IP salt
```

New domain-separator constants in `specter-core/constants.rs` (extend the
existing non-overlap test). Loud startup error if `SPECTER_DB_ENC_KEY` is unset
when the relayer/persistence features are enabled.

### 2.1 B2 — at-rest encryption + telemetry hashing

- **Indexer/poller rows** are already safe after Phase 1 (no plaintext amount/tx — only the opaque blob). No extra work.
- **API relayer rows**: the API holds plaintext transiently. It writes only the
  encrypted `metadata_blob` (same bytes as on-chain) + `payment_tx_hash_hmac`
  (see 2.3) — no plaintext `amount`/`payment_tx_hash` columns.
- **Telemetry**: store `ip_hash = SHA-256(DB_TELEMETRY_SALT || floor(date) || ip)`
  (daily-rotating salt) instead of raw IP. Still supports abuse detection; breaks
  the IP↔view_tag deanonymization link.

### 2.2 B4 — cryptographic recipient/amount verification — `verifier.rs`

Extend `verify_payment_tx` to prove the payment actually went to the claimed
stealth address/amount, not just that it succeeded:
- **Native transfer:** assert `tx.to == stealth_address && tx.value >= amount`.
- **ERC-20 transfer:** scan the receipt logs for `Transfer(_, stealth_address, v)` with `v >= amount` emitted by the expected token.
- **Indeterminate** (can't match): reject with a clear error, or accept-with-flag (`record_source = unverified`) — recommend reject for the relayed path to keep the registry clean.

This consumes the `stealth_address` + `amount` the API already has in the
`Announcement` before relaying, so no new client input is required.

### 2.3 B3 — dedup without the probing side-channel

- Dedup key = `payment_tx_hash_hmac = HMAC-SHA256(DB_HMAC_KEY, payment_tx_hash)`,
  stored in the Phase-1 UNIQUE column. An attacker can't compute it without the
  server key, so the registry can no longer be probed with raw tx hashes.
- API error parity: "payment not found", "already announced", and the uniqueness
  violation must return **identical** status + body (e.g. a generic
  `409`/`422` with one message), so response differences can't enumerate used
  hashes.

### 2.4 B5 — persist pending payments to Turso

- New `pending_payments` table: `payment_id` (PK), `announcement` (JSON/blob of
  the server-built announcement: ephemeral key, view tag, stealth address),
  `shared_secret_wrapped BLOB` (`shared_secret` sealed with AES-256-GCM under
  `DB_PENDING_WRAP` — a Turso breach alone can't decrypt metadata), `created_at`,
  `expires_at`.
- Semantics mirror today's RAM store: single-use `take` deletes the row; 24h TTL;
  periodic purge of expired rows.
- `PendingPaymentStore` becomes a thin async wrapper over Turso (keep an in-RAM
  read-through cache for latency if useful, but Turso is source of truth). On a
  `payment_id` that resolves to an expired/missing row, the API returns the same
  generic error and does **not** silently fall back — surface that the secure
  path is unavailable.
- `shared_secret` stays `#[serde(skip)]` in `StealthPayment` and zeroized in RAM
  after use; only the wrapped form is persisted.

### Phase 2 testing
- AEAD wrap/unwrap round-trip for `shared_secret`; wrong-KEK fails.
- HMAC dedup: same tx → same HMAC → unique-violation; error-parity test asserts
  identical responses for not-found vs already-announced vs duplicate.
- Telemetry: `ip_hash` is stable within a day, rotates across days, never equals raw IP.
- Verifier: native match/mismatch, ERC-20 match/mismatch, indeterminate → reject.
- Pending persistence: survives a simulated restart (new store instance, same Turso) and resolves the `payment_id`; expired row → generic error, no fallback.

---

## Out of scope / non-goals
- No change to the publisher calldata or the `announce` signature.
- No re-encryption migration of legacy plaintext rows — re-indexing from the new
  deploy block produces a clean v6 dataset; legacy rows age out / are dropped.
- No switch to ChaCha20-Poly1305 (keeping AES-256-GCM).
- No contract changes (contract is external, already deployed + verified).

## Risks
- **Re-index cost / RPC load:** scanners now fetch calldata on view-tag match
  (~1/256) — acceptable; the alternative (per-event fetch) was rejected.
- **Key custody:** `SPECTER_DB_ENC_KEY` loss = unrecoverable pending rows +
  unverifiable dedup. Document backup; rotating it invalidates outstanding
  pending rows (acceptable: 24h TTL).
- **Schema coordination:** Rust registry, indexer, and poller all write the same
  Turso table — v6 must land in all three before re-index starts.

---

## REVISION 2026-06-11 (during Phase 1 execution): pivot store-hash → index-time resolve

**Finding:** The "store hash, scanners fetch calldata only on the ~1/256 view-tag
matches" model assumed a scanner can decide a view-tag match without the
ciphertext. That is false for ML-KEM: `view_tag = SHAKE256(DOMAIN_VIEW_TAG ||
shared_secret)[0]` and `shared_secret = ML-KEM.decaps(ciphertext, viewing_sk)`
(`specter-stealth/src/discovery.rs:214-238`). The view tag is derived from the
shared secret, so determining a match requires decapsulating the ciphertext
first. The view tag only saves the post-decapsulation stealth-key derivation, not
the calldata fetch. (ERC-5564/Umbra get away with view-tag pre-filtering only
because the ephemeral pubkey is in the log; here the new contract emits only its
keccak256.) Store-hash therefore forces O(N) calldata fetches **per scan**.

**Decision (user-approved):** Pivot to **index-time resolve**. The Envio indexer
and the event-poller fetch each ciphertext from the `announce()` calldata once at
index time, assert `keccak256(ciphertext) == ephemeralKeyHash`, and store the
**full ciphertext** in Turso `announcements.ephemeral_key` (as before), alongside
the new `ephemeral_key_hash` and `metadata_blob` columns. Scans read the full
ciphertext directly from Turso — no per-scan RPC. Re-storing the ciphertext has
no privacy cost (it is public on-chain and reveals nothing without the viewing
key); the deanonymization fix is the metadata encryption (B1), which is
unaffected.

**Impact on Phase 1 tasks:** Tasks 1–9 unchanged (all artifacts still used). Task
10 (wire RPC resolver into the API scan) becomes a no-op — the API scan reads
resolved ciphertexts from Turso; `discovery` already skips any row whose
`ephemeral_key` won't parse, so an occasional unresolved row is handled safely.
The `EphemeralKeyResolver` trait + `RpcEphemeralKeyResolver` (Tasks 5-6) and the
scanner resolver hook (Task 9) are retained as an optional capability for direct
client-SDK chain scanning. Tasks 11-13 change: the indexer/poller now resolve the
ciphertext from calldata and store it (prefer Envio `transaction_fields: [hash,
input]` to get calldata without an extra RPC; event-poller uses
`eth_getTransactionByHash`).

---

## PHASE 2 DESIGN (refined 2026-06-12, post-Phase-1)

Phase 1 changed the ground: the indexer/poller no longer write plaintext payment
fields (only the encrypted `metadata_blob`), which (a) silently broke the
`payment_tx_hash` double-announce protection and (b) left the **API** publish path
(`handlers.rs:364` `registry.publish`) as the remaining at-rest plaintext leak —
it still stores `payment_tx_hash`/`amount`/`chain` in cleartext with
`record_source='api'`, duplicating what the indexer stores encrypted. Decisions
(user-approved): **encrypted API rows + HMAC reservation**, delivered as **one
combined plan** in dependency order.

### 2.0 — Server key material (`SPECTER_DB_ENC_KEY`)
- One 32-byte master key (base64 in env; never stored in Turso). Loud startup
  error if unset when the relayer or persistence is enabled.
- Purpose-specific subkeys via SHAKE-256 + domain separators (reuse the existing
  `specter-crypto` KDF pattern), new module `specter-crypto/src/db_keys.rs`:
  ```
  DB_HMAC_KEY       = SHAKE256("SPECTER_DB_HMAC_V1"      || master)[..32]
  DB_PENDING_WRAP   = SHAKE256("SPECTER_DB_PENDING_V1"   || master)[..32]
  DB_TELEMETRY_SALT = SHAKE256("SPECTER_DB_TELEMETRY_V1" || master)[..32]
  ```
- New domain-separator constants in `specter-core/constants.rs` (extend the
  non-overlap test to include them).
- Dedup key: `payment_tx_hash_hmac = HMAC-SHA256(DB_HMAC_KEY, normalize(payment_tx_hash))`
  (normalize = trim + lowercase, matching `registry.rs::normalize_tx_hash`).

### B2 — At-rest: encrypted API rows + telemetry hashing
- **API publish** stores the SAME encrypted shape as the indexer:
  `metadata_blob` = the AEAD blob the relayer already builds, `ephemeral_key_hash`
  = keccak256(ephemeral_key), full `ephemeral_key`; and **does not** persist
  plaintext `payment_tx_hash`/`amount`/`source_chain_id` (those are kept only
  transiently in the handler for payment verification + HMAC, never written).
- **Telemetry**: store `ip_hash = SHA-256(DB_TELEMETRY_SALT || floor(unix/86400) || ip)`
  (daily-rotating) instead of raw IP. `write_telemetry` takes the hashed value;
  the raw `ip` column (retained by v6) is no longer written. Keeps abuse
  detection; breaks the IP↔view_tag deanonymization link.
- Indexer/poller rows are already plaintext-free after Phase 1 — no change.

### B3 — Dedup (reserve-before-relay) + error parity
- Add `payment_tx_hash_hmac: Option<Vec<u8>>` to `Announcement`; the registry
  INSERT writes it (the v6 `idx_announcements_payment_hmac_unique` enforces it).
- **Publish order (race-safe):**
  1. Build the announcement (encrypted blob, hmac); `tx_hash = NULL`, `on_chain = 0`.
  2. **Reserve**: INSERT the row. A duplicate `payment_tx_hash_hmac` hits the
     UNIQUE index → treat as "already announced".
  3. Relay `announce()` on Monad.
  4. **Finalize**: UPDATE the reserved row set `tx_hash = monad_tx`, `on_chain = 1`.
  (Relay failure leaves an `on_chain=0` reserved row; a TTL sweep or the existing
  retry path cleans it. The indexer's later write of the same announce tx is
  deduped by the `tx_hash` UNIQUE index.)
- **Error parity**: the reservation conflict returns a generic `409`
  (`"announcement could not be published"`) with no field that distinguishes
  "already announced" from other publish failures, so an attacker cannot
  enumerate which `payment_tx_hash`es were routed through SPECTER. (Probing is
  already gated by needing a valid pending `payment_id` and an actual relayed tx.)

### B4 — Cryptographic recipient/amount verification (`verifier.rs`)
Extend `verify_payment_tx` (new params: `stealth_address`, `amount`, optional
`token`):
- **Native transfer:** assert `tx.to == stealth_address && tx.value >= amount`.
- **ERC-20:** scan the receipt logs for `Transfer(_, stealth_address, v)` with
  `v >= amount` from the expected token (or any token if unspecified, best-effort).
- **Indeterminate** (no matching transfer): **reject** (keeps the registry clean
  on the relayed path), with the same generic error surface.
Inputs come from the announcement the API already holds; no new client field
required beyond the optional token address.

### B5 — Persist pending payments to Turso (KEK-wrapped secret)
- New `pending_payments` table (schema v7): `payment_id` TEXT PK, `announcement`
  BLOB (serialized server-built announcement), `shared_secret_wrapped` BLOB
  (AES-256-GCM under `DB_PENDING_WRAP` — a Turso breach alone cannot decrypt
  metadata), `created_at`, `expires_at`.
- `PendingPaymentStore` becomes async Turso-backed (replacing the in-memory
  `DashMap`): single-use `take` deletes the row; 24h TTL; periodic purge; survives
  restarts. On a `payment_id` that resolves to an expired/missing row the API
  returns the same generic error and does **not** silently fall back to the weaker
  client-supplied path — it surfaces that the secure path is unavailable.
- `shared_secret` stays `#[serde(skip)]` in `StealthPayment`; only the wrapped
  form is persisted.

### Scan-path metadata decryption (recipient-facing)
- In `specter-stealth::discovery` (`scan_with_context_and_stats` + `scan_announcement`):
  after the view-tag match (so the recipient already holds `shared_secret`), if
  `announcement.metadata_blob` is present, `decrypt_announcement_metadata` →
  `AnnouncementMetadata::decode` → populate the returned announcement's
  `payment_tx_hash` / `amount` / `source_chain_id`. The secret never leaves the
  stealth crate; `DiscoveryDto` then surfaces the payment details again (restoring
  what Phase 1 moved into the encrypted blob).

### Sequencing (one plan, dependency order)
2.0 KEK/subkeys → B2 at-rest + telemetry → B3 HMAC dedup + error parity → B5
pending persistence (schema v7) → B4 payment verification → scan-path decryption.
Schema work: v6 already added `payment_tx_hash_hmac` + `ip_hash`; Phase 2 adds the
`pending_payments` table as **v7** (additive).

### Out of scope (Phase 2)
- No re-encryption of historical plaintext rows (Phase 1 re-index produced a clean
  encrypted dataset).
- No change to the ML-KEM/stealth derivation or the on-chain contract.
