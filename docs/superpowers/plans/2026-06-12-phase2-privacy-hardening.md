# Phase 2 — Privacy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining at-rest and verification gaps: no plaintext payment data at rest (API rows + telemetry), API-driven double-announce dedup, cryptographic recipient/amount proof, restart-durable pending payments, and recipient-side decryption of on-chain metadata.

**Architecture:** One server-held key `SPECTER_DB_ENC_KEY` derives purpose-specific subkeys (SHAKE-256, domain-separated) for a keyed dedup MAC, daily-salted telemetry IP hashing, and AEAD-wrapping the pending ML-KEM shared secret. The API publish path stores the same encrypted shape as the indexer (`metadata_blob` + `ephemeral_key_hash`, NULL plaintext payment fields) plus `payment_tx_hash_hmac`, reserving the dedup slot via the v6 UNIQUE index before relaying. The recipient's scan decrypts `metadata_blob` inside `specter-stealth` (where it already holds the shared secret).

**Tech Stack:** Rust (alloy, libsql/Turso, tokio, aes-gcm, sha3/SHAKE-256, keccak256). No new crypto crates — keyed MAC + telemetry hash use SHAKE-256.

**Spec:** `docs/superpowers/specs/2026-06-11-contract-migration-and-privacy-hardening-design.md` → section "PHASE 2 DESIGN (refined 2026-06-12, post-Phase-1)".

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `specter/specter-core/src/constants.rs` | Domain separators for the 3 DB subkeys | Modify |
| `specter/specter-crypto/src/db_keys.rs` | `DbKeys`: subkey derivation, payment HMAC, telemetry hash, secret wrap/unwrap | Create |
| `specter/specter-crypto/src/lib.rs` | export `db_keys` | Modify |
| `specter/specter-api/src/state.rs` | Load `SPECTER_DB_ENC_KEY` → `Arc<DbKeys>` in `AppState`; telemetry takes `ip_hash` | Modify |
| `specter/specter-core/src/types/announcement.rs` | `payment_tx_hash_hmac` field | Modify |
| `specter/specter-registry/src/turso/registry.rs` | INSERT/SELECT hmac; `reserve_announcement` / `finalize_announcement`; telemetry `ip_hash` | Modify |
| `specter/specter-registry/src/turso/schema.rs` | schema v7: `pending_payments` table | Modify |
| `specter/specter-api/src/handlers.rs` | publish: encrypted row + HMAC reserve→relay→finalize + error parity; telemetry hashing; create/publish use async pending store | Modify |
| `specter/specter-api/src/verifier.rs` | recipient/amount verification (native + ERC-20) | Modify |
| `specter/specter-api/src/pending.rs` | Turso-backed async `PendingPaymentStore` (wrap secret) | Modify |
| `specter/specter-stealth/src/discovery.rs` | decrypt `metadata_blob` → populate payment fields | Modify |
| `specter/.env.example` + siblings | document `SPECTER_DB_ENC_KEY` | Modify |
| `docs/runbooks/2026-06-11-monad-reindex.md` | key custody note | Modify |

**Dependency order (matches spec):** Task 1 (subkeys) → Task 2 (config) → Task 3 (telemetry) → Task 4 (hmac column) → Task 5 (publish dedup + encrypted row) → Task 6 (verifier) → Task 7 (schema v7) → Task 8 (pending persistence) → Task 9 (scan decryption) → Task 10 (sweep) → Task 11 (docs).

---

## Task 1: Server key material (`DbKeys`)

**Files:**
- Modify: `specter/specter-core/src/constants.rs`
- Create: `specter/specter-crypto/src/db_keys.rs`
- Modify: `specter/specter-crypto/src/lib.rs`

- [ ] **Step 1: Add domain separators**

In `constants.rs`, after `DOMAIN_META_ENC_NONCE`, add:
```rust
/// Domain separator: derive the dedup-MAC subkey from the DB master key.
pub const DOMAIN_DB_HMAC_KEY: &[u8] = b"SPECTER_DB_HMAC_V1";
/// Domain separator: derive the pending-secret AEAD-wrap subkey.
pub const DOMAIN_DB_PENDING_WRAP: &[u8] = b"SPECTER_DB_PENDING_V1";
/// Domain separator: derive the telemetry IP-hash salt from the DB master key.
pub const DOMAIN_DB_TELEMETRY_SALT: &[u8] = b"SPECTER_DB_TELEMETRY_V1";
/// Domain separator: keyed MAC over a normalized payment tx hash (dedup key).
pub const DOMAIN_DB_PAYMENT_MAC: &[u8] = b"SPECTER_DB_PAYMENT_MAC_V1";
/// Domain separator: telemetry IP hash (salt + day + ip).
pub const DOMAIN_DB_IP_HASH: &[u8] = b"SPECTER_DB_IP_HASH_V1";
```
Add these five to the `domains` array in `test_domain_separators_unique` so the non-overlap test covers them.

- [ ] **Step 2: Write the failing test (in the new module)**

Create `specter/specter-crypto/src/db_keys.rs`:
```rust
//! Server-side key material derived from a single master key (`SPECTER_DB_ENC_KEY`).
//!
//! One 32-byte master derives three purpose-specific subkeys via SHAKE-256 with
//! distinct domain separators — a keyed MAC for double-announce dedup, a daily
//! salt for telemetry IP hashing, and an AEAD-wrap key for the pending ML-KEM
//! shared secret. Subkeys never overlap and are never persisted.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use rand::RngCore;
use specter_core::constants::{
    DOMAIN_DB_HMAC_KEY, DOMAIN_DB_IP_HASH, DOMAIN_DB_PAYMENT_MAC, DOMAIN_DB_PENDING_WRAP,
    DOMAIN_DB_TELEMETRY_SALT,
};
use specter_core::error::{Result, SpecterError};
use zeroize::Zeroize;

use crate::hash::{shake256, shake256_multi};

/// Wrapped-secret layout: 12-byte nonce || 32-byte ciphertext || 16-byte tag.
pub const WRAPPED_SECRET_SIZE: usize = 12 + 32 + 16;

/// Purpose-separated server subkeys derived from the DB master key.
pub struct DbKeys {
    hmac_key: [u8; 32],
    pending_wrap: [u8; 32],
    telemetry_salt: [u8; 32],
}

impl DbKeys {
    /// Derives all subkeys from the 32-byte master key.
    pub fn from_master(master: &[u8; 32]) -> Self {
        let mut hmac_key = [0u8; 32];
        hmac_key.copy_from_slice(&shake256(DOMAIN_DB_HMAC_KEY, master, 32));
        let mut pending_wrap = [0u8; 32];
        pending_wrap.copy_from_slice(&shake256(DOMAIN_DB_PENDING_WRAP, master, 32));
        let mut telemetry_salt = [0u8; 32];
        telemetry_salt.copy_from_slice(&shake256(DOMAIN_DB_TELEMETRY_SALT, master, 32));
        Self { hmac_key, pending_wrap, telemetry_salt }
    }

    /// Keyed MAC over a normalized payment tx hash — the dedup key.
    /// SHAKE-256 is not length-extendable, so prefix-keying is a sound MAC.
    pub fn payment_hmac(&self, normalized_tx_hash: &str) -> Vec<u8> {
        shake256_multi(DOMAIN_DB_PAYMENT_MAC, &[&self.hmac_key, normalized_tx_hash.as_bytes()], 32)
    }

    /// Daily-rotating telemetry IP hash. `unix_secs` is the event time.
    pub fn telemetry_ip_hash(&self, ip: &str, unix_secs: u64) -> Vec<u8> {
        let day = (unix_secs / 86_400).to_be_bytes();
        shake256_multi(DOMAIN_DB_IP_HASH, &[&self.telemetry_salt, &day, ip.as_bytes()], 32)
    }

    /// AEAD-wrap a 32-byte secret for at-rest storage (random nonce, prepended).
    pub fn wrap_secret(&self, secret: &[u8; 32]) -> Vec<u8> {
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.pending_wrap));
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct = cipher
            .encrypt(nonce, secret.as_slice())
            .expect("AES-256-GCM: fixed key/nonce sizes are always valid");
        let mut out = Vec::with_capacity(WRAPPED_SECRET_SIZE);
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ct);
        out
    }

    /// Unwrap a secret produced by `wrap_secret`. Errors on auth failure/tamper.
    pub fn unwrap_secret(&self, wrapped: &[u8]) -> Result<[u8; 32]> {
        if wrapped.len() != WRAPPED_SECRET_SIZE {
            return Err(SpecterError::ValidationError(format!(
                "wrapped secret must be {WRAPPED_SECRET_SIZE} bytes, got {}",
                wrapped.len()
            )));
        }
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.pending_wrap));
        let nonce = Nonce::from_slice(&wrapped[..12]);
        let pt = cipher
            .decrypt(nonce, &wrapped[12..])
            .map_err(|_| SpecterError::DecapsulationError("pending secret unwrap failed".into()))?;
        let mut secret = [0u8; 32];
        secret.copy_from_slice(&pt);
        Ok(secret)
    }
}

impl Drop for DbKeys {
    fn drop(&mut self) {
        self.hmac_key.zeroize();
        self.pending_wrap.zeroize();
        self.telemetry_salt.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys() -> DbKeys {
        DbKeys::from_master(&[0x11u8; 32])
    }

    #[test]
    fn payment_hmac_is_deterministic_and_keyed() {
        let k = keys();
        assert_eq!(k.payment_hmac("0xabc"), k.payment_hmac("0xabc"));
        assert_ne!(k.payment_hmac("0xabc"), k.payment_hmac("0xabd"));
        // Different master → different MAC for the same input.
        let other = DbKeys::from_master(&[0x22u8; 32]);
        assert_ne!(k.payment_hmac("0xabc"), other.payment_hmac("0xabc"));
        assert_eq!(k.payment_hmac("0xabc").len(), 32);
    }

    #[test]
    fn telemetry_hash_rotates_daily_and_hides_ip() {
        let k = keys();
        let ip = "203.0.113.7";
        let day1 = k.telemetry_ip_hash(ip, 100);
        let day1b = k.telemetry_ip_hash(ip, 86_399);
        let day2 = k.telemetry_ip_hash(ip, 86_400);
        assert_eq!(day1, day1b, "same day → same hash");
        assert_ne!(day1, day2, "next day → different hash");
        assert_ne!(day1, ip.as_bytes(), "hash must not equal raw ip");
    }

    #[test]
    fn wrap_unwrap_roundtrip_and_tamper_fails() {
        let k = keys();
        let secret = [0x42u8; 32];
        let wrapped = k.wrap_secret(&secret);
        assert_eq!(wrapped.len(), WRAPPED_SECRET_SIZE);
        assert_eq!(k.unwrap_secret(&wrapped).unwrap(), secret);
        let mut bad = wrapped.clone();
        bad[20] ^= 0xFF;
        assert!(k.unwrap_secret(&bad).is_err());
        // Wrong master cannot unwrap.
        let other = DbKeys::from_master(&[0x99u8; 32]);
        assert!(other.unwrap_secret(&wrapped).is_err());
    }

    #[test]
    fn wrap_uses_random_nonce() {
        let k = keys();
        let secret = [0x42u8; 32];
        assert_ne!(k.wrap_secret(&secret), k.wrap_secret(&secret), "nonce must be random");
    }

    #[test]
    fn subkeys_are_distinct() {
        let k = keys();
        assert_ne!(k.hmac_key, k.pending_wrap);
        assert_ne!(k.hmac_key, k.telemetry_salt);
        assert_ne!(k.pending_wrap, k.telemetry_salt);
    }
}
```

- [ ] **Step 3: Wire the module + confirm deps**

In `specter/specter-crypto/src/lib.rs` add `pub mod db_keys;` and re-export: `pub use db_keys::{DbKeys, WRAPPED_SECRET_SIZE};`.
Confirm `aes-gcm`, `rand`, `zeroize`, `sha3` are already deps of specter-crypto (`grep -E "aes-gcm|rand|zeroize|sha3" specter/specter-crypto/Cargo.toml`) — all were added in earlier work; no Cargo change expected. If `shake256_multi` is not `pub`, make it `pub` in `hash.rs`.

- [ ] **Step 4: Run tests (fail → pass)**

Run: `cd specter && cargo test -p specter-crypto db_keys && cargo test -p specter-core constants`
Expected: PASS (db_keys tests + the extended uniqueness test).

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add specter/specter-core/src/constants.rs specter/specter-crypto/src/db_keys.rs specter/specter-crypto/src/lib.rs specter/specter-crypto/src/hash.rs
git commit -m "feat(crypto): DbKeys — server subkeys for dedup MAC, telemetry hash, secret wrap"
```

---

## Task 2: Load `SPECTER_DB_ENC_KEY` into `AppState`

**Files:**
- Modify: `specter/specter-api/src/state.rs`
- Modify: `specter/.env.example`, `specter/.env.staging.example`, `specter/.env.production.example`, `specter/.env.railway.example`

- [ ] **Step 1: Write the failing test**

Add to `state.rs` tests:
```rust
#[test]
fn db_keys_loads_from_base64_env() {
    // 32 zero bytes, base64 standard.
    let b64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    let master = AppState::decode_db_master(b64).expect("valid 32-byte base64");
    assert_eq!(master, [0u8; 32]);
    assert!(AppState::decode_db_master("too-short").is_err());
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd specter && cargo test -p specter-api db_keys_loads`
Expected: FAIL — `decode_db_master` doesn't exist.

- [ ] **Step 3: Add the loader + AppState field**

Add a `base64` dependency if absent (`grep base64 specter/specter-api/Cargo.toml`; add `base64 = { workspace = true }` or `base64 = "0.22"` — match the workspace style). Add to `AppState`:
```rust
    /// Server key material for at-rest hardening (dedup MAC, telemetry hash,
    /// pending-secret wrap). `None` when SPECTER_DB_ENC_KEY is unset (dev only).
    pub db_keys: Option<std::sync::Arc<specter_crypto::DbKeys>>,
```
Add the decode helper + loader:
```rust
impl AppState {
    /// Decodes a base64 (standard) 32-byte DB master key.
    pub fn decode_db_master(b64: &str) -> anyhow::Result<[u8; 32]> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let bytes = STANDARD.decode(b64.trim())
            .map_err(|e| anyhow::anyhow!("SPECTER_DB_ENC_KEY is not valid base64: {e}"))?;
        let arr: [u8; 32] = bytes.as_slice().try_into()
            .map_err(|_| anyhow::anyhow!("SPECTER_DB_ENC_KEY must decode to exactly 32 bytes"))?;
        Ok(arr)
    }

    /// Loads DbKeys from `SPECTER_DB_ENC_KEY` if set.
    pub fn load_db_keys() -> Option<std::sync::Arc<specter_crypto::DbKeys>> {
        let b64 = std::env::var("SPECTER_DB_ENC_KEY").ok().filter(|s| !s.trim().is_empty())?;
        match Self::decode_db_master(&b64) {
            Ok(master) => Some(std::sync::Arc::new(specter_crypto::DbKeys::from_master(&master))),
            Err(e) => {
                tracing::error!("Invalid SPECTER_DB_ENC_KEY — at-rest hardening disabled: {e}");
                None
            }
        }
    }
}
```
Wire `db_keys: Self::load_db_keys()` into wherever `AppState` is constructed (find it: `grep -n "AppState {" specter/specter-api/src/*.rs`). If the relayer is configured (`relayer_config.is_some()`) but `db_keys` is `None`, log a loud `tracing::warn!` at startup that dedup/telemetry hardening is off (do not hard-fail — keeps dev usable).

- [ ] **Step 4: Document the env var**

In each `.env*.example`, add under a "Server-side secrets" section:
```
# 32-byte base64 master key for at-rest hardening (dedup MAC, telemetry IP
# hashing, pending-secret wrapping). Generate: openssl rand -base64 32
# REQUIRED in production when RELAYER_PRIVATE_KEY is set.
SPECTER_DB_ENC_KEY=
```

- [ ] **Step 5: Run tests + build**

Run: `cd specter && cargo test -p specter-api db_keys_loads && cargo build -p specter-api`
Expected: PASS + green.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add specter/specter-api/src/state.rs specter/specter-api/Cargo.toml specter/.env*.example
git commit -m "feat(api): load SPECTER_DB_ENC_KEY into AppState as DbKeys"
```

---

## Task 3: B2 — telemetry IP hashing

**Files:**
- Modify: `specter/specter-registry/src/turso/registry.rs` (telemetry INSERT)
- Modify: `specter/specter-api/src/state.rs` (`write_telemetry` signature)
- Modify: `specter/specter-api/src/handlers.rs` (compute ip_hash at the call site)

- [ ] **Step 1: Write the failing test**

Add to `registry.rs` tests a telemetry round-trip asserting the row stores `ip_hash` (BLOB) and the raw `ip` column is NULL:
```rust
// Insert a telemetry event with ip_hash = [0xAB;32], assert SELECT ip_hash
// returns it and ip IS NULL. Model on existing telemetry/registry test setup.
```

- [ ] **Step 2: Run to verify failure**

Run: `cd specter && cargo test -p specter-registry --features turso telemetry_ip_hash`
Expected: FAIL — the INSERT still writes `ip`, not `ip_hash`.

- [ ] **Step 3: Update the registry telemetry INSERT**

In `registry.rs` `write_telemetry`, change the parameter `ip: Option<&str>` to `ip_hash: Option<&[u8]>` and the INSERT to write the `ip_hash` BLOB column instead of `ip`:
```rust
            "INSERT INTO _telemetry (event, ip_hash, ua, chain, chain_id, view_tag, status, err, ms) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
```
Bind `ip_hash.map(|h| Value::Blob(h.to_vec())).unwrap_or(Value::Null)` for `?2`. (The raw `ip TEXT` column remains in the table but is never written — it stays NULL.)

- [ ] **Step 4: Update the `AppState::write_telemetry` wrapper**

In `state.rs`, change its `ip: Option<&str>` param to `ip_hash: Option<&[u8]>` and forward it. Update the memory-backend no-op path accordingly.

- [ ] **Step 5: Update the call site in handlers.rs**

At `handlers.rs:~385`, replace the raw-ip telemetry write:
```rust
    let ip = extract_client_ip(&headers, maybe_connect.as_ref());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let ip_hash = state.db_keys.as_ref().map(|k| k.telemetry_ip_hash(&ip.to_string(), now));
    state.registry.write_telemetry(
        "announce",
        ip_hash.as_deref(),
        ua.as_deref(),
        chain_for_tel.as_deref(),
        chain_id_for_tel,
        Some(view_tag),
        "success",
        None,
        elapsed_ms,
    ).await;
```
Do the same for any OTHER `write_telemetry` call site (`grep -n "write_telemetry(" specter/specter-api/src/handlers.rs`). When `db_keys` is `None`, `ip_hash` is `None` → no IP recorded at all (fail-closed for privacy).

- [ ] **Step 6: Run tests + build**

Run: `cd specter && cargo test -p specter-registry --features turso telemetry_ip_hash && cargo build -p specter-api`
Expected: PASS + green.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add specter/specter-registry/src/turso/registry.rs specter/specter-api/src/state.rs specter/specter-api/src/handlers.rs
git commit -m "feat(api): store hashed telemetry IP (daily salt) instead of raw IP"
```

---

## Task 4: `payment_tx_hash_hmac` on `Announcement` + registry write

**Files:**
- Modify: `specter/specter-core/src/types/announcement.rs`
- Modify: `specter/specter-registry/src/turso/registry.rs`
- Modify: `specter/specter-api/src/dto.rs` (struct-literal construction site, `None` default)

- [ ] **Step 1: Write the failing test**

Add to `announcement.rs` tests:
```rust
#[test]
fn payment_hmac_roundtrips_through_serde() {
    let mut ann = Announcement::new(make_valid_ephemeral_key(), 0x42);
    ann.payment_tx_hash_hmac = Some(vec![0x33u8; 32]);
    let json = serde_json::to_string(&ann).unwrap();
    let back: Announcement = serde_json::from_str(&json).unwrap();
    assert_eq!(back.payment_tx_hash_hmac, Some(vec![0x33u8; 32]));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd specter && cargo test -p specter-core payment_hmac_roundtrips`
Expected: FAIL — field doesn't exist.

- [ ] **Step 3: Add the field**

In `Announcement`, after `metadata_blob`, add (reuse the `opt_hex` module added in Phase 1):
```rust
    /// HMAC(server_key, normalize(payment_tx_hash)) — the double-announce dedup key.
    /// Never reveals the payment tx; only the API (holding the key) can compute it.
    #[serde(default, skip_serializing_if = "Option::is_none", with = "opt_hex")]
    pub payment_tx_hash_hmac: Option<Vec<u8>>,
```
Add `payment_tx_hash_hmac: None,` to both constructors (`new`, `from_bytes`) and to `AnnouncementBuilder` (field + `pub fn payment_tx_hash_hmac(mut self, h: Vec<u8>) -> Self {...}` setter + assignment in `build`).

- [ ] **Step 4: Patch the dto.rs construction site**

In `specter/specter-api/src/dto.rs` `TryFrom<AnnouncementDto>`, add `payment_tx_hash_hmac: None,` to the struct literal (client DTOs never carry it). (The registry `row_to_announcement` does NOT need it — the column is write-only for dedup; do not add it to SELECTs.)

- [ ] **Step 5: Write the hmac into the registry INSERT**

In `registry.rs` `insert_announcement_inner`, add `payment_tx_hash_hmac` to the INSERT column list + bindings:
```rust
             (view_tag, timestamp, ephemeral_key, ephemeral_key_hash, metadata_blob, \
              payment_tx_hash_hmac, source_chain_id, on_chain, block_number, tx_hash, \
              payment_tx_hash, amount, chain, stealth_address, record_source) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
```
with binding `ann.payment_tx_hash_hmac.clone().map(Value::Blob).unwrap_or(Value::Null)` in the `?6` slot (renumber the rest accordingly). Keep all existing bindings.

- [ ] **Step 6: Run tests + build**

Run: `cd specter && cargo test -p specter-core payment_hmac && cargo build -p specter-registry -p specter-api`
Expected: PASS + green.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add specter/specter-core/src/types/announcement.rs specter/specter-registry/src/turso/registry.rs specter/specter-api/src/dto.rs
git commit -m "feat(registry): persist payment_tx_hash_hmac dedup key on announcements"
```

---

## Task 5: B3 dedup (reserve→relay→finalize) + B2 encrypted API row

**Files:**
- Modify: `specter/specter-registry/src/turso/registry.rs` (`reserve_announcement`, `finalize_announcement`)
- Modify: `specter/specter-core/src/error.rs` (a `DuplicatePayment` signal)
- Modify: `specter/specter-api/src/handlers.rs` (publish flow)

- [ ] **Step 1: Add a duplicate-signal error**

In `specter/specter-core/src/error.rs`, add a variant to `SpecterError`:
```rust
    /// A unique constraint rejected a reservation (e.g. payment already announced).
    #[error("duplicate")]
    Duplicate,
```
(If the enum derives `thiserror::Error`, match the existing attribute style.)

- [ ] **Step 2: Write the failing test (registry reserve/finalize)**

Add to `registry.rs` tests (turso-gated):
```rust
// 1. reserve_announcement(ann with payment_tx_hash_hmac=Some([7;32]), on_chain=0) → Ok(id), tx_hash NULL.
// 2. reserve a SECOND ann with the SAME hmac → Err(SpecterError::Duplicate).
// 3. finalize_announcement(id, "0xmonadtx") → row now has tx_hash set, on_chain=1.
```

- [ ] **Step 3: Run to verify failure**

Run: `cd specter && cargo test -p specter-registry --features turso reserve_`
Expected: FAIL — methods don't exist.

- [ ] **Step 4: Implement `reserve_announcement` + `finalize_announcement`**

In `registry.rs`:
```rust
    /// Reserves a dedup slot by inserting the (encrypted) announcement with
    /// `on_chain = 0` and `tx_hash = NULL`. A duplicate `payment_tx_hash_hmac`
    /// hits the UNIQUE index and returns `SpecterError::Duplicate`.
    pub async fn reserve_announcement(&self, ann: &Announcement) -> Result<u64> {
        match self.insert_announcement_inner(ann, false, "api").await {
            Ok(id) => Ok(id),
            Err(SpecterError::RegistryError(m)) if m.to_lowercase().contains("unique constraint") => {
                Err(SpecterError::Duplicate)
            }
            Err(e) => Err(e),
        }
    }

    /// Finalizes a reserved announcement after the relay tx is broadcast.
    pub async fn finalize_announcement(&self, id: u64, monad_tx_hash: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE announcements SET tx_hash = ?1, on_chain = 1 WHERE id = ?2",
            params![monad_tx_hash.to_string(), id as i64],
        )
        .await
        .map_err(|e| SpecterError::RegistryError(format!("finalize: {e}")))?;
        self.cache.write().await.pop(&{ /* view_tag */ 0u8 }); // see note below
        Ok(())
    }
```
Note: `insert_announcement_inner` currently inserts `tx_hash` from `ann.tx_hash`; for a reservation `ann.tx_hash` must be `None` and `on_chain=false`. Verify `insert_announcement_inner` surfaces the libsql unique-constraint error text containing "unique constraint" (it does — that's the v6 `idx_announcements_payment_hmac_unique`); if the driver phrasing differs, match the actual substring. For the cache invalidation in `finalize`, invalidate the announcement's `view_tag` bucket — pass the view_tag in (change the signature to `finalize_announcement(&self, id: u64, view_tag: u8, monad_tx_hash: &str)`), or call the existing cache-clear used by `publish`.

- [ ] **Step 5: Rewrite the publish flow in handlers.rs**

Replace steps 2/5/6 of `publish_announcement` (lines ~286-368) so it (a) keeps plaintext payment fields ONLY locally for verification + hmac, (b) builds the encrypted row, (c) reserves → relays → finalizes:
```rust
    // ── 2. Local-only payment metadata (NOT persisted in plaintext) ───────────
    let payment_tx_hash = req.payment_tx_hash.clone().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let amount = req.amount.clone().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let chain = req.chain.clone().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    // These go INTO the encrypted metadata blob the relayer builds, and are used
    // for verification + the dedup MAC — but are never written as plaintext columns.
    announcement.payment_tx_hash = payment_tx_hash.clone();
    announcement.amount = amount.clone();
    announcement.chain = chain.clone();
    if let Some(cid) = req.source_chain_id { announcement.source_chain_id = Some(cid); }

    // ── 3. Validate ephemeral key (unchanged) ─────────────────────────────────
    // ... existing 1088-byte + non-zero checks ...

    // ── 4. Verify payment on source chain (B4 — see Task 6 for the richer check)
    // ... existing verify_payment_tx call ...

    // ── 5. Compute dedup MAC + ephemeral_key_hash + encrypted blob ────────────
    let db_keys = state.db_keys.as_ref();
    if let (Some(keys), Some(ptx)) = (db_keys, &payment_tx_hash) {
        let norm = ptx.trim().to_lowercase();
        announcement.payment_tx_hash_hmac = Some(keys.payment_hmac(&norm));
    }
    announcement.ephemeral_key_hash = Some(specter_crypto::keccak256(&announcement.ephemeral_key).to_vec());
    let blob = build_on_chain_metadata(&announcement, shared_secret.as_ref());
    announcement.metadata_blob = Some(blob.clone());
    // Strip plaintext payment fields from the PERSISTED row (kept only in the blob).
    announcement.payment_tx_hash = None;
    announcement.amount = None;
    announcement.source_chain_id = None;
    announcement.tx_hash = None; // reservation has no tx yet

    // ── 6. Reserve dedup slot BEFORE relaying ─────────────────────────────────
    let view_tag = announcement.view_tag;
    let reserved_id = match state.registry.reserve_announcement(&announcement).await {
        Ok(id) => id,
        Err(specter_core::error::SpecterError::Duplicate) => {
            return Err(ApiError::conflict("announcement could not be published"));
        }
        Err(e) => return Err(ApiError::bad_request(format!("Publish failed: {e}"))),
    };

    // ── 7. Relay (or accept dev tx_hash) ──────────────────────────────────────
    let monad_tx_hash = if let Some(relayer) = &state.relayer_config {
        // Relay must publish the SAME encrypted blob: pass it through.
        relay_announcement_with_blob(&announcement, relayer, &blob).await?
    } else {
        req.tx_hash.as_deref().map(str::trim).filter(|s| !s.is_empty())
            .ok_or_else(|| ApiError::bad_request("tx_hash is required when the relayer is not configured (dev mode)."))?
            .to_string()
    };

    // ── 8. Finalize the reserved row ──────────────────────────────────────────
    state.registry.finalize_announcement(reserved_id, view_tag, &monad_tx_hash).await
        .map_err(|e| ApiError::internal(format!("finalize failed: {e}")))?;
```
Notes:
- `relay_announcement` currently rebuilds the metadata via `build_on_chain_metadata`. Refactor it to accept the already-built `blob` (add `relay_announcement_with_blob(ann, relayer, blob)` or pass the blob into the existing fn) so the on-chain tx and the stored `metadata_blob` are byte-identical. Keep the existing `build_on_chain_metadata` for the blob construction.
- Add `ApiError::conflict(msg)` returning HTTP `409` if it doesn't exist (`grep -n "pub fn conflict\|StatusCode::CONFLICT" specter/specter-api/src/error.rs`; add it mirroring `bad_request`).
- **Error parity:** the `Duplicate` arm and any other publish failure must return the same generic body — do not echo the payment_tx_hash or say "already announced" specifically.

- [ ] **Step 6: Update the build_on_chain_metadata note + fallback**

`build_on_chain_metadata` reads `ann.payment_tx_hash`/`ann.amount`/`ann.source_chain_id` — call it (Step 5) BEFORE stripping those fields. Confirm the ordering in your edit: compute `blob` first, THEN null the plaintext fields. (The Step 5 snippet already does this.)

- [ ] **Step 7: Run tests + build**

Run: `cd specter && cargo test -p specter-registry --features turso reserve_ && cargo build -p specter-api`
Expected: PASS + green. Add/adjust any handler unit tests that constructed the old publish flow.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add specter/specter-core/src/error.rs specter/specter-registry/src/turso/registry.rs specter/specter-api/src/handlers.rs specter/specter-api/src/error.rs
git commit -m "feat(api): encrypted API rows + HMAC reserve→relay→finalize dedup with error parity"
```

---

## Task 6: B4 — cryptographic recipient/amount verification

**Files:**
- Modify: `specter/specter-api/src/verifier.rs`
- Modify: `specter/specter-api/src/handlers.rs` (pass stealth_address + amount)

- [ ] **Step 1: Write the failing test**

Add to `verifier.rs` tests a unit test for the amount/recipient matching logic. Since live RPC isn't available, factor the decision into a pure function and test that:
```rust
#[test]
fn native_match_requires_recipient_and_amount() {
    // to == stealth && value >= amount → Ok
    assert!(super::native_payment_ok(STEALTH, STEALTH, 1000, 1000));
    assert!(super::native_payment_ok(STEALTH, STEALTH, 1500, 1000)); // overpay ok
    assert!(!super::native_payment_ok(STEALTH, OTHER, 1000, 1000));  // wrong recipient
    assert!(!super::native_payment_ok(STEALTH, STEALTH, 999, 1000)); // underpay
}
```
(Define `STEALTH`/`OTHER` as two distinct `alloy::primitives::Address` consts in the test.)

- [ ] **Step 2: Run to verify failure**

Run: `cd specter && cargo test -p specter-api native_match`
Expected: FAIL — `native_payment_ok` doesn't exist.

- [ ] **Step 3: Implement the richer verifier**

Add the pure helper and extend `verify_payment_tx` to take `stealth_address: Address`, `expected_amount: U256`, and `token: Option<Address>`:
```rust
use alloy::primitives::{Address, U256, B256};

/// Native-transfer match: funds went to the stealth address for at least `amount`.
pub(crate) fn native_payment_ok(stealth: Address, tx_to: Address, value: U256, amount: U256) -> bool {
    tx_to == stealth && value >= amount
}

/// ERC-20 Transfer(address,address,uint256) topic0.
const ERC20_TRANSFER_TOPIC: B256 = /* keccak256("Transfer(address,address,uint256)") literal */;
```
After the existing receipt-success check in `verify_payment_tx`:
- Fetch the full tx (`provider.get_transaction_by_hash`) for native `to`/`value`.
- If `token.is_none()` and `native_payment_ok(stealth, tx.to, tx.value, expected_amount)` → Ok.
- Else scan `receipt.logs` for a log with `topics[0] == ERC20_TRANSFER_TOPIC`, `topics[2] == stealth` (left-padded), `U256::from_be_slice(&log.data) >= expected_amount`, and (if `token` is Some) `log.address == token`. Match → Ok.
- No match → `Err(ApiError::bad_request("payment could not be verified to the stealth address"))` (generic; do not leak which check failed).
Compute `ERC20_TRANSFER_TOPIC` via `alloy::primitives::keccak256("Transfer(address,address,uint256)")` in a `once`/`const` fashion (use `B256::from(keccak256(...))` in a `LazyLock`/`OnceLock` if a const literal is awkward).

- [ ] **Step 4: Update the call site in handlers.rs**

At the verification block (`handlers.rs:~318`), pass the new args: parse `announcement.stealth_address` → `Address`, parse `amount` → `U256` (hex or decimal per the DTO; the e2e/dto store amount as raw hex uint256 — parse accordingly), and `req.token` (add an optional `token: Option<String>` to `PublishAnnouncementRequest` in `dto.rs` if not present; default `None`). Only verify when `payment_tx_hash` + `chain` + a configured RPC exist (as today). Reject (propagate the error) on verification failure.

- [ ] **Step 5: Run tests + build**

Run: `cd specter && cargo test -p specter-api verifier && cargo test -p specter-api native_match && cargo build -p specter-api`
Expected: PASS + green.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add specter/specter-api/src/verifier.rs specter/specter-api/src/handlers.rs specter/specter-api/src/dto.rs
git commit -m "feat(api): verify payment actually paid the stealth address/amount (native + ERC-20)"
```

---

## Task 7: Schema v7 — `pending_payments` table

**Files:**
- Modify: `specter/specter-registry/src/turso/schema.rs`
- Modify: `specter/specter-registry/src/turso/registry.rs` (register migration)
- Test: `specter/specter-registry/tests/schema_v6.rs` (rename intent → add v7 assertion) or new `tests/schema_v7.rs`

- [ ] **Step 1: Write the failing test**

Create `specter/specter-registry/tests/schema_v7.rs`:
```rust
use specter_registry::turso::schema::SCHEMA_VERSION;
#[test]
fn schema_version_is_7() { assert_eq!(SCHEMA_VERSION, 7); }
```
Add a `[[test]]` stanza in `specter-registry/Cargo.toml` with `name = "schema_v7"`, `required-features = ["turso"]`.

- [ ] **Step 2: Run to verify failure**

Run: `cd specter && cargo test -p specter-registry --test schema_v7 --features turso`
Expected: FAIL — version is 6.

- [ ] **Step 3: Add the table + migration; bump version**

In `schema.rs`: set `SCHEMA_VERSION = 7`. Add to `SCHEMA_STATEMENTS`:
```rust
    "CREATE TABLE IF NOT EXISTS pending_payments (
        payment_id            TEXT    PRIMARY KEY,
        announcement          BLOB    NOT NULL,
        shared_secret_wrapped BLOB    NOT NULL,
        created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        expires_at            INTEGER NOT NULL
    )",
    "CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_payments(expires_at)",
```
Add `MIGRATION_V6_TO_V7`:
```rust
/// v6 → v7: durable pending-payment store (survives API restarts).
pub const MIGRATION_V6_TO_V7: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS pending_payments (
        payment_id            TEXT    PRIMARY KEY,
        announcement          BLOB    NOT NULL,
        shared_secret_wrapped BLOB    NOT NULL,
        created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        expires_at            INTEGER NOT NULL
    )",
    "CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_payments(expires_at)",
    "INSERT OR REPLACE INTO registry_metadata (key, value) VALUES ('schema_version', '7')",
];
```
In `registry.rs` `init_schema`, add `.chain(schema::MIGRATION_V6_TO_V7)` to the migration loop.

- [ ] **Step 4: Run tests**

Run: `cd specter && cargo test -p specter-registry --features turso 2>&1 | tail -20`
Expected: schema_v7 passes; existing registry tests pass (idempotency preserved).

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add specter/specter-registry/src/turso/schema.rs specter/specter-registry/src/turso/registry.rs specter/specter-registry/tests/schema_v7.rs specter/specter-registry/Cargo.toml
git commit -m "feat(registry): schema v7 — durable pending_payments table"
```

---

## Task 8: B5 — Turso-backed pending payment store

**Files:**
- Modify: `specter/specter-api/src/pending.rs`
- Modify: `specter/specter-api/src/handlers.rs` (`create_stealth`, `resolve_pending_announcement` → async; no silent fallback)
- Modify: `specter/specter-registry/src/turso/registry.rs` (pending CRUD methods)

- [ ] **Step 1: Add registry pending CRUD + failing test**

In `registry.rs`, add (turso-gated tests + methods):
```rust
    pub async fn pending_insert(&self, payment_id: &str, announcement_blob: &[u8], wrapped_secret: &[u8], expires_at: i64) -> Result<()>;
    pub async fn pending_take(&self, payment_id: &str) -> Result<Option<(Vec<u8>, Vec<u8>)>>; // (announcement_blob, wrapped_secret); deletes the row
    pub async fn pending_purge_expired(&self, now: i64) -> Result<u64>;
```
Implement `pending_take` as a single-use read-then-delete (SELECT then DELETE in the same connection; return None if absent or `expires_at <= now`). Test: insert → take returns the blobs → second take returns None; expired row → take returns None.

- [ ] **Step 2: Run to verify failure**

Run: `cd specter && cargo test -p specter-registry --features turso pending_`
Expected: FAIL — methods don't exist.

- [ ] **Step 3: Implement the registry methods**

Use `params!` + `conn.execute`/`conn.query` mirroring existing registry methods. Serialize/deserialize is the caller's job (store opaque BLOBs). `pending_take`: `SELECT announcement, shared_secret_wrapped, expires_at WHERE payment_id=?`; if found and `expires_at > now`, `DELETE WHERE payment_id=?` and return `Some((ann, wrapped))`; else (and on expired) ensure the row is deleted and return `None`.

- [ ] **Step 4: Rewrite `PendingPaymentStore` over Turso**

In `pending.rs`, replace the in-memory `DashMap` store with a Turso-backed async one holding `Arc<TursoRegistry>` + `Arc<DbKeys>` + TTL. Keep the `PendingPayment { announcement, shared_secret }` shape returned by `take`:
```rust
pub struct PendingPaymentStore {
    registry: std::sync::Arc<specter_registry::turso::TursoRegistry>,
    db_keys: std::sync::Arc<specter_crypto::DbKeys>,
    ttl: std::time::Duration,
}
impl PendingPaymentStore {
    pub fn new(registry: ..., db_keys: ..., ttl: Duration) -> Self { ... }

    /// Persist a pending payment; returns the payment_id (UUID v4).
    pub async fn insert(&self, announcement: Announcement, shared_secret: [u8; 32]) -> Result<Uuid> {
        let id = Uuid::new_v4();
        let blob = serde_json::to_vec(&announcement)?;          // shared_secret is #[serde(skip)]
        let wrapped = self.db_keys.wrap_secret(&shared_secret);
        let expires_at = (now_secs() + self.ttl.as_secs()) as i64;
        self.registry.pending_insert(&id.to_string(), &blob, &wrapped, expires_at).await?;
        Ok(id)
    }

    /// Single-use take; unwraps the secret. None if missing/expired.
    pub async fn take(&self, id: &Uuid) -> Result<Option<PendingPayment>> {
        let Some((blob, wrapped)) = self.registry.pending_take(&id.to_string()).await? else { return Ok(None); };
        let announcement: Announcement = serde_json::from_slice(&blob)?;
        let shared_secret = self.db_keys.unwrap_secret(&wrapped)?;
        Ok(Some(PendingPayment { announcement, shared_secret }))
    }
}
```
Keep `spawn_cleanup_task` but have it call `registry.pending_purge_expired(now)` on the interval. Remove `created_at`/`is_expired` in-memory logic (TTL is enforced by `expires_at` in the DB). Update the existing pending tests to the async Turso-backed shape using `TursoRegistry::new_test()` + a fixed `DbKeys`.

- [ ] **Step 5: Wire create_stealth + resolve_pending_announcement (async, no silent fallback)**

In `handlers.rs`:
- `create_stealth`: `let payment_id = state.pending_payments.insert(ann.clone(), payment.shared_secret).await.map_err(|e| ApiError::internal(format!("pending persist failed: {e}")))?;`
- `resolve_pending_announcement`: make it `async`; for the `payment_id` arm use `state.pending_payments.take(&pid).await?`; if it returns `None`, return the SAME generic error as other publish failures AND do not fall through to the client-`announcement` fallback when a `payment_id` was supplied (a supplied-but-missing id means the secure path is unavailable — surface it, don't silently downgrade). The raw-`announcement` fallback path (no payment_id) stays as-is (plaintext, with its existing warning).

- [ ] **Step 6: Construct the store in AppState**

Where `AppState.pending_payments` is built, construct the Turso-backed store with the registry + db_keys + 24h TTL. If `db_keys` is `None` (dev), either keep an in-memory fallback OR require db_keys for persistence — simplest: when `db_keys` is `None`, log a warning and use a 24h TTL in-memory `DashMap` shim behind the same async API (feature-flag or an enum). Pick the enum approach: `enum PendingPaymentStore { Turso{...}, Memory(DashMap...) }` so dev without a key still works. Implement both arms of `insert`/`take`.

- [ ] **Step 7: Run tests + build**

Run: `cd specter && cargo test -p specter-api -p specter-registry --features specter-registry/turso 2>&1 | tail -20 && cargo build -p specter-api`
Expected: PASS + green.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add specter/specter-api/src/pending.rs specter/specter-api/src/handlers.rs specter/specter-registry/src/turso/registry.rs
git commit -m "feat(api): persist pending payments to Turso with KEK-wrapped secret (restart-durable)"
```

---

## Task 9: Scan-path metadata decryption

**Files:**
- Modify: `specter/specter-stealth/src/discovery.rs`
- Modify: `specter/specter-stealth/Cargo.toml` (ensure specter-crypto metadata fns reachable — already a dep)

- [ ] **Step 1: Write the failing test**

Add to `discovery.rs` tests: build a keypair, `encapsulate` → (ciphertext, shared_secret), `view_tag`; build plaintext `AnnouncementMetadata` with a tx_hash/amount/source_chain_id, `encrypt_announcement_metadata(&plaintext, &shared_secret)` → blob; construct an `Announcement` with that ciphertext + `metadata_blob = Some(blob)`; run `scan_with_context_and_stats(&[ann], viewing_sk, spending_pk, spending_sk)`; assert the returned `DiscoveryResult.announcement.payment_tx_hash`/`amount`/`source_chain_id` are populated from the decrypted blob.

- [ ] **Step 2: Run to verify failure**

Run: `cd specter && cargo test -p specter-stealth scan_decrypts_metadata`
Expected: FAIL — fields stay None (no decryption yet).

- [ ] **Step 3: Decrypt in the scan loop**

In `scan_with_context_and_stats` (and `scan_announcement`), after `compute_view_tag` matches and BEFORE pushing the result, if `ann.metadata_blob` is `Some`, decrypt and enrich a cloned announcement:
```rust
        let mut enriched = ann.clone();
        if let Some(blob) = &ann.metadata_blob {
            if let Ok(pt) = specter_crypto::decrypt_announcement_metadata(blob, &shared_secret) {
                let meta = specter_core::types::AnnouncementMetadata::decode(&pt);
                enriched.view_tag = meta.view_tag;
                if let Some(h) = meta.tx_hash {
                    enriched.payment_tx_hash = Some(format!("0x{}", hex::encode(h)));
                }
                if let Some(a) = meta.amount {
                    enriched.amount = Some(format!("0x{}", hex::encode(a)));
                }
                enriched.source_chain_id = meta.source_chain_id;
            }
        }
        // push DiscoveryResult { announcement: enriched, keys }
```
`shared_secret` is already in scope in the loop. Use `enriched` for the `DiscoveryResult`. Confirm `specter_core::types::AnnouncementMetadata` is importable and `decode` returns the field shapes used above (it does — `with_tx_hash([u8;32])`, `with_amount([u8;32])`, `with_source_chain_id(u64)`).

- [ ] **Step 4: Run tests + build**

Run: `cd specter && cargo test -p specter-stealth && cargo build -p specter-stealth -p specter-api`
Expected: PASS + green. The API `scan_payments` DTO now surfaces the decrypted payment fields with no handler change (it already reads `d.announcement.amount` etc.).

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add specter/specter-stealth/src/discovery.rs
git commit -m "feat(stealth): decrypt metadata_blob during scan to restore payment fields"
```

---

## Task 10: Workspace build + full sweep

**Files:** none (verification gate).

- [ ] **Step 1: Build + test (CI-exact features)**

Run:
```bash
cd specter
cargo build --workspace
cargo test --workspace --all-features 2>&1 | grep -E "FAILED|panicked|test result: FAILED" ; echo "(empty = green)"
```
Expected: builds; no failures.

- [ ] **Step 2: Clippy (CI-exact)**

Run: `cd specter && cargo clippy --all-targets --all-features -- -D warnings 2>&1 | tail -3`
Expected: `Finished`, no warnings. Fix any introduced lints.

- [ ] **Step 3: Indexer + poller unaffected (sanity)**

Run: `cd indexer && npm test 2>&1 | grep "Tests " ; cd ../event-poller && npx tsc --noEmit && echo tsc_ok`
Expected: indexer tests pass; poller typechecks. (Phase 2 is API/registry-only; these should be untouched.)

- [ ] **Step 4: Commit any fixups**

```bash
cd "$(git rev-parse --show-toplevel)"
git add -A specter/ && git commit -m "chore: workspace green after Phase 2" || echo "nothing to commit"
```

---

## Task 11: Docs — key custody + env

**Files:**
- Modify: `docs/runbooks/2026-06-11-monad-reindex.md`

- [ ] **Step 1: Add a Phase 2 operations section**

Append to the runbook:
```markdown
## Phase 2 — at-rest hardening (operations)

- Set `SPECTER_DB_ENC_KEY` (32-byte base64; `openssl rand -base64 32`) on the API
  service. REQUIRED in production: without it, dedup/telemetry hashing/pending
  persistence degrade (loud startup warning).
- **Key custody:** back up `SPECTER_DB_ENC_KEY` securely. Losing it invalidates all
  outstanding pending payments (24h TTL) and the dedup MAC (re-announce protection
  resets). Rotating it has the same effect — schedule rotations during low traffic.
- After deploy, verify schema v7: `SELECT value FROM registry_metadata WHERE key='schema_version';` → 7.
- Telemetry now stores `ip_hash` (daily-salted), never raw IPs; API rows store the
  encrypted `metadata_blob` + `payment_tx_hash_hmac`, never plaintext payment data.
```

- [ ] **Step 2: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add docs/runbooks/2026-06-11-monad-reindex.md
git commit -m "docs(runbook): Phase 2 key custody + at-rest operations"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** 2.0 → T1–T2; B2 at-rest API rows → T5, telemetry → T3; B3 dedup+parity → T4–T5; B4 → T6; B5 → T7–T8; scan decryption → T9; ops/key custody → T11.
- **Dependency order:** subkeys (T1) before everything; hmac column (T4) before dedup (T5); schema v7 (T7) before pending store (T8).
- **Type consistency:** `DbKeys::{payment_hmac, telemetry_ip_hash, wrap_secret, unwrap_secret}` defined T1, used T3/T5/T8; `Announcement.payment_tx_hash_hmac` defined T4, written T5; `SpecterError::Duplicate` defined T5 step 1, used in `reserve_announcement`; `reserve_announcement`/`finalize_announcement` defined T5, used in publish T5; `pending_insert/pending_take/pending_purge_expired` defined T8.
- **Known soft spots (verify at execution):** the exact libsql unique-constraint error substring (T5 step 4 — match the driver's phrasing), the `ApiError::conflict` helper existence (T5 step 5), `AnnouncementMetadata::decode` field accessors (T9), and the amount encoding (hex vs decimal) when parsing for B4 (T6 step 4).
