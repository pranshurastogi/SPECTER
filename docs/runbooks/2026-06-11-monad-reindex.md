# Runbook — Monad re-index for the new SPECTERAnnouncer

**Date:** 2026-06-11
**Applies to:** Phase 1 (contract migration + index-time ciphertext resolve)

New deployment:

| Field | Value |
|---|---|
| Contract | `0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC` |
| Deploy block | `37571591` |
| Chain | Monad testnet (10143) |

This runbook is **operator-executed** — it needs production credentials (Turso,
Railway/host env, relayer key). The agent does not run these steps.

## What changed (why a re-index is needed)

- The contract address changed, and the event signature changed (`schemeId` no
  longer indexed; the log carries `bytes32 ephemeralKeyHash` instead of the full
  ciphertext). The old index is for a different address and is not reusable.
- Off-chain stores now **resolve the ciphertext from `announce()` calldata at
  index time** and store the full ciphertext in `announcements.ephemeral_key`,
  plus `ephemeral_key_hash` and the encrypted `metadata_blob`.
- On-chain metadata is now AEAD-encrypted (B1); the indexer/poller no longer
  decode `payment_tx_hash`/`amount`/`source_chain_id` (they are inside the blob).

## Pre-flight

1. Deploy the new builds (API, event-poller, indexer) from branch `upgrade/monad`.
2. Set on **all three** services:
   ```
   SPECTER_ANNOUNCER_ADDRESS=0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC
   SPECTER_ANNOUNCER_DEPLOY_BLOCK=37571591
   ```
3. Ensure `RELAYER_PRIVATE_KEY` is set for the API and the relayer wallet has MON
   for gas on Monad testnet (top up if low).
4. Ensure `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` are set for the API,
   event-poller, and indexer.

## Cutover steps

1. **Apply Turso schema v6.** Start the API once on the new build; `init_schema`
   runs the additive v5→v6 migration. Verify:
   ```sql
   SELECT value FROM registry_metadata WHERE key = 'schema_version';   -- expect 6
   ```
   Confirm the new columns exist:
   ```sql
   PRAGMA table_info(announcements);   -- expect ephemeral_key_hash, metadata_blob, payment_tx_hash_hmac
   ```

2. **Reset the event-poller checkpoint** so it replays from the deploy block:
   ```sql
   DELETE FROM registry_metadata WHERE key = 'poller_last_block';
   ```
   (On next start the poller begins at `SPECTER_ANNOUNCER_DEPLOY_BLOCK - 1`.)

3. **Reset the Envio index.** A new contract address means a fresh index —
   clear Envio's persisted state so it backfills from `start_block: 37571591`
   (`indexer/config.yaml`). On the Envio hosted service this is a fresh deployment;
   locally, remove the generated persisted-state / Postgres volume per Envio docs.

4. **Restart all three services** (API, event-poller, indexer).

## Post-cutover verification

1. New rows are written with the resolved ciphertext + hash + blob:
   ```sql
   SELECT length(ephemeral_key)      AS ek_bytes,        -- expect 1088
          length(ephemeral_key_hash) AS hash_bytes,      -- expect 32
          length(metadata_blob)      AS blob_bytes,      -- expect >= 1 (e.g. 93)
          payment_tx_hash, amount, source_chain_id       -- expect NULL on indexer/poller rows
     FROM announcements
    WHERE record_source = 'indexer'
    ORDER BY id DESC LIMIT 5;
   ```
2. The indexer/poller logs show no `keccak256 != ephemeralKeyHash` skips (a skip
   means a malformed/forged announce tx — investigate that tx, not the pipeline).
3. **End-to-end smoke test** against the new address:
   ```bash
   cd specter && SPECTER_ANNOUNCER_ADDRESS=0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC \
     SPECTER_ANNOUNCER_DEPLOY_BLOCK=37571591 cargo run -p specter-cli --bin e2e_flow
   ```
   Confirm: announcement publishes, the recipient scans, decapsulates, and recovers
   the stealth key. (The scan reads the full ciphertext from Turso — no per-scan
   calldata fetch.)

## Rollback

If the new pipeline misbehaves, repoint the three services back to the previous
`SPECTER_ANNOUNCER_ADDRESS` / `SPECTER_ANNOUNCER_DEPLOY_BLOCK` and restart. The v6
schema is additive (no columns dropped), so the old build remains compatible with
the same Turso DB; the old plaintext columns are untouched.

## Notes

- Re-indexing is idempotent: writers use `INSERT OR IGNORE` on the Monad announce
  `tx_hash`, so replays do not duplicate rows.
- The `EphemeralKeyResolver` (Rust) is retained as an optional capability for
  client SDKs that scan directly from chain without the indexer; the server scan
  path does not use it.

---

## Phase 2 — at-rest hardening (operations)

Phase 2 removes plaintext payment data at rest, adds API-driven double-announce
dedup, cryptographic recipient/amount verification, and restart-durable pending
payments.

### Required env

- **`SPECTER_DB_ENC_KEY`** — 32-byte base64 master key on the API service.
  Generate: `openssl rand -base64 32`. **Required in production** when
  `RELAYER_PRIVATE_KEY` is set; without it the API logs a loud startup warning and
  degrades: no dedup MAC, telemetry records NO IP at all (fail-closed), and pending
  payments fall back to in-memory (lost on restart).
- Optional per-publish field `token` (ERC-20 token address) tightens payment
  verification to that token; omitted ⇒ native match, else best-effort ERC-20.

### Key custody (critical)

- **Back up `SPECTER_DB_ENC_KEY` securely** (secret manager). It derives — via
  SHAKE-256 domain separation — the dedup MAC key, the daily telemetry-hash salt,
  and the AEAD key that wraps the pending ML-KEM shared secret.
- **Losing or rotating it:** invalidates all outstanding pending payments (they
  can no longer be unwrapped — clients must re-create; 24h TTL bounds the impact)
  and resets the dedup MAC (a payment announced under the old key is no longer
  recognized as a duplicate). Rotate during low traffic.
- A Turso breach alone does NOT reveal pending secrets or raw IPs — they are
  wrapped/hashed under this key, which lives only in the service env.

### Schema v7

- Verify after deploy: `SELECT value FROM registry_metadata WHERE key='schema_version';` → `7`.
- New table: `pending_payments` (durable, KEK-wrapped `shared_secret_wrapped`).
- v7 is additive (no drops); rollback to a v6 build remains compatible.

### What changed at rest

- **API announcement rows** now store the encrypted `metadata_blob` +
  `ephemeral_key_hash` + `payment_tx_hash_hmac` — never plaintext
  `payment_tx_hash`/`amount`/`source_chain_id` (those live only inside the
  AEAD blob; the recipient decrypts them during scan).
- **Telemetry** stores `ip_hash` (daily-salted SHAKE-256), never raw IPs.
- **Double-announce dedup** is reserved before relay via the unique
  `payment_tx_hash_hmac` index; a duplicate payment returns a generic `409`
  (no field reveals "already announced"), so used payment hashes can't be enumerated.
- **Payment verification** now proves the source-chain tx actually paid the
  stealth address for ≥ the claimed amount (native or ERC-20); unverifiable
  payments are rejected.
