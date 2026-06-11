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
