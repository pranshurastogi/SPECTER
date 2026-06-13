# Phase 1 — Contract Migration + Interface/Decoder Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the new `SPECTERAnnouncer` (`0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC`, deploy block `37571591`) fully live and re-indexed, adapting every off-chain read path to the new event (`schemeId` unindexed; `bytes ephemeralPubKey` → `bytes32 ephemeralKeyHash`, ciphertext now in calldata).

**Architecture:** The publisher (`announce(...)` calldata) is unchanged. Off-chain stores keep `ephemeralKeyHash` + the announce tx hash + the (encrypted) metadata blob; the full ciphertext is fetched from calldata only for the ~1/256 events that pass the view-tag filter, with a mandatory `keccak256(ciphertext) == ephemeralKeyHash` check. Turso advances to schema v6 (additive migration) so the Rust registry, the Envio indexer, and the event-poller all write the same columns.

**Tech Stack:** Rust (alloy, libsql/Turso, tokio), TypeScript (Envio HyperIndex, viem), SHAKE-256/keccak256.

**Spec:** `docs/superpowers/specs/2026-06-11-contract-migration-and-privacy-hardening-design.md` (Phase 1 sections 1.1–1.6).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `specter/.env*`, `event-poller/.env*`, `indexer/config.yaml` | New address + deploy/start block | Modify |
| `specter/specter-cli/src/bin/e2e_flow.rs:43` | Hardcoded fallback address | Modify |
| `specter/specter-chain/src/contract.rs` | `sol!` ABI for new event/functions/errors | Rewrite |
| `specter/specter-chain/src/calldata.rs` | Decode `announce` calldata → ciphertext; keccak256 verify; RPC resolver impl | Create |
| `specter/specter-core/src/types/announcement.rs` | `ephemeral_key_hash` field; relax `validate` for hash-only | Modify |
| `specter/specter-core/src/resolver.rs` | `EphemeralKeyResolver` trait (no RPC dep in scanner) | Create |
| `specter/specter-registry/src/turso/schema.rs` | Schema v6 migration + DDL | Modify |
| `specter/specter-registry/src/turso/registry.rs` | Read/write new columns | Modify |
| `specter/specter-scanner/src/lib.rs` | Resolve hash-only announcements via resolver before decapsulating | Modify |
| `indexer/config.yaml`, `schema.graphql`, `src/EventHandlers.ts`, `src/metadata.ts`, `src/turso.ts` | New event sig; store hash + blob; drop plaintext decode | Modify |
| `event-poller/src/index.ts` | New event sig; store hash + blob | Modify |

**Migration ordering constraint:** Turso schema v6 (Task 6) must be deployed to the live DB **before** the indexer/poller (Tasks 9–14) start writing, and before re-index (Task 15).

---

## Task 1: Bump contract address + deploy block in all config

**Files:**
- Modify: `specter/.env`, `specter/.env.example`, `specter/.env.staging.example`, `specter/.env.production.example`, `specter/.env.railway.example`, `specter/.env.sample`, `specter/.env.e2e`
- Modify: `event-poller/.env`, `event-poller/.env.example`
- Modify: `indexer/config.yaml`
- Modify: `specter/specter-cli/src/bin/e2e_flow.rs:43`

- [ ] **Step 1: Find every occurrence of the old address/block**

Run:
```bash
cd "$(git rev-parse --show-toplevel)"
grep -rn "0xCc322132261cE3a1c9c85a6ef69779Ce2D61CA5a\|36100042" \
  specter/.env* event-poller/.env* indexer/config.yaml specter/specter-cli/src/bin/e2e_flow.rs
```
Expected: matches in each file listed above (some `.env*` files may not contain it — that's fine).

- [ ] **Step 2: Replace address + block everywhere**

Run (macOS `sed -i ''`):
```bash
cd "$(git rev-parse --show-toplevel)"
FILES=$(grep -rln "0xCc322132261cE3a1c9c85a6ef69779Ce2D61CA5a\|36100042" \
  specter/.env* event-poller/.env* indexer/config.yaml specter/specter-cli/src/bin/e2e_flow.rs)
for f in $FILES; do
  sed -i '' \
    -e 's/0xCc322132261cE3a1c9c85a6ef69779Ce2D61CA5a/0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC/g' \
    -e 's/36100042/37571591/g' "$f"
done
```

- [ ] **Step 3: Verify no stale references remain**

Run:
```bash
cd "$(git rev-parse --show-toplevel)"
grep -rn "0xCc322132261cE3a1c9c85a6ef69779Ce2D61CA5a\|36100042" \
  specter/ event-poller/ indexer/ --include="*.env*" --include="*.yaml" --include="*.rs" \
  | grep -v target || echo "CLEAN"
```
Expected: `CLEAN` (no remaining matches).

- [ ] **Step 4: Confirm `e2e_flow.rs` fallback updated**

Run: `grep -n "ANNOUNCER_DEFAULT" specter/specter-cli/src/bin/e2e_flow.rs`
Expected: line 43 now shows `0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC`.

- [ ] **Step 5: Commit**

```bash
git add -A specter/.env* event-poller/.env* indexer/config.yaml specter/specter-cli/src/bin/e2e_flow.rs
git commit -m "chore(config): point all services at new SPECTERAnnouncer (0x7a68…fDaC, block 37571591)"
```

---

## Task 2: Verify SCHEME_ID alignment (contract = 1000)

**Files:**
- Inspect: `specter/specter-core/src/constants.rs`, any `schemeId`/`SCHEME_ID` assertion in Rust + indexer.

- [ ] **Step 1: Grep for the scheme id**

Run:
```bash
cd "$(git rev-parse --show-toplevel)"
grep -rn "SCHEME_ID\|scheme_id\|schemeId" specter/specter-core specter/specter-chain specter/specter-api indexer/src event-poller/src | grep -v target
```
Expected: find where the scheme id is defined/asserted.

- [ ] **Step 2: Confirm or fix the value to 1000**

If a constant exists and is not `1000`, set it to `1000`. If no constant exists and nothing asserts `schemeId`, no change is needed (the new event does not index `schemeId`, so filters must not rely on it). Document the finding in the commit message.

- [ ] **Step 3: Commit (only if a change was made)**

```bash
git add -A && git commit -m "fix(core): align SCHEME_ID with deployed contract (1000)"
```

---

## Task 3: Rewrite the alloy `sol!` bindings for the new interface

**Files:**
- Rewrite: `specter/specter-chain/src/contract.rs`
- Test: `specter/specter-chain/tests/abi_decode.rs` (Create)

- [ ] **Step 1: Write the failing test**

Create `specter/specter-chain/tests/abi_decode.rs`:
```rust
//! Verifies the SPECTERAnnouncer ABI bindings match the deployed event:
//! schemeId NOT indexed, ephemeralKeyHash is bytes32.

use alloy::primitives::{Address, B256, U256};
use alloy::sol_types::SolEvent;
use specter_chain::contract::SPECTERAnnouncer;

#[test]
fn announcement_event_has_two_indexed_topics_plus_signature() {
    // 1 topic for the event signature + 2 indexed params (stealthAddress, caller).
    // schemeId is NOT indexed in the new contract.
    assert_eq!(SPECTERAnnouncer::Announcement::TOPIC_COUNT, 3);
}

#[test]
fn announce_call_roundtrips() {
    use alloy::sol_types::SolCall;
    let call = SPECTERAnnouncer::announceCall {
        stealthAddress: Address::ZERO,
        ephemeralPubKey: vec![0u8; 1088].into(),
        metadata: vec![0x7Fu8].into(),
    };
    let encoded = call.abi_encode();
    let decoded = SPECTERAnnouncer::announceCall::abi_decode(&encoded, true).unwrap();
    assert_eq!(decoded.ephemeralPubKey.len(), 1088);
    assert_eq!(decoded.metadata[0], 0x7F);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd specter && cargo test -p specter-chain --test abi_decode`
Expected: FAIL — `TOPIC_COUNT` is currently 4 (schemeId still indexed), or the module path/exports differ.

- [ ] **Step 3: Rewrite `contract.rs`**

Replace the whole `sol!` block in `specter/specter-chain/src/contract.rs` with:
```rust
//! Alloy contract bindings for SPECTERAnnouncer (new deployment).
//!
//! Event change vs. the previous deploy:
//!   - `schemeId` is no longer indexed.
//!   - The log carries `bytes32 ephemeralKeyHash = keccak256(ciphertext)`
//!     instead of the full 1088-byte `bytes ephemeralPubKey`. The ciphertext
//!     lives in `announce()` calldata and is fetched on view-tag match.

use alloy::sol;

sol! {
    #[sol(rpc)]
    contract SPECTERAnnouncer {
        /// Emitted when an announcement is published.
        /// `ephemeralKeyHash` = keccak256(ML-KEM-768 ciphertext); the ciphertext
        /// itself is recoverable from the `announce()` calldata of this tx.
        event Announcement(
            uint256 schemeId,
            address indexed stealthAddress,
            address indexed caller,
            bytes32 ephemeralKeyHash,
            bytes metadata
        );

        /// Publishes a single announcement (ciphertext passed in calldata).
        #[derive(Debug)]
        function announce(
            address stealthAddress,
            bytes calldata ephemeralPubKey,
            bytes calldata metadata
        ) external;

        /// Overload taking an explicit schemeId (must equal SCHEME_ID = 1000).
        #[derive(Debug)]
        function announce(
            uint256 schemeId,
            address stealthAddress,
            bytes calldata ephemeralPubKey,
            bytes calldata metadata
        ) external;

        /// Batch announce — up to MAX_BATCH (50) entries.
        #[derive(Debug)]
        function announceMany(
            address[] calldata stealthAddresses,
            bytes[] calldata ephemeralPubKeys,
            bytes[] calldata metadatas
        ) external;

        /// Block at which the contract was deployed (immutable getter).
        #[derive(Debug)]
        function deployBlock() external view returns (uint256);

        // Custom errors — decode reverts into readable messages.
        error ZeroStealthAddress();
        error EphemeralKeyLength(uint256 actual, uint256 expected);
        error MetadataRequired();
        error SchemeMismatch(uint256 given, uint256 expected);
        error BatchEmpty();
        error BatchTooLarge(uint256 length, uint256 max);
        error BatchLengthMismatch();
    }
}
```

- [ ] **Step 4: Ensure `contract` module is publicly reachable from tests**

Run: `grep -n "pub mod contract\|mod contract" specter/specter-chain/src/lib.rs`
Expected: `pub mod contract;`. If it is `mod contract;`, change it to `pub mod contract;`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd specter && cargo test -p specter-chain --test abi_decode`
Expected: PASS (both tests).

- [ ] **Step 6: Build dependents that call `.announce(...)`**

Run: `cd specter && cargo build -p specter-chain`
Expected: builds. The `announce(address,bytes,bytes)` call in `announcer.rs` still resolves (the overload is a distinct generated type and does not break the 3-arg call).

- [ ] **Step 7: Commit**

```bash
git add specter/specter-chain/src/contract.rs specter/specter-chain/src/lib.rs specter/specter-chain/tests/abi_decode.rs
git commit -m "feat(chain): update SPECTERAnnouncer ABI to new event + announce overload/batch/errors"
```

---

## Task 4: Add `ephemeral_key_hash` to `Announcement` and allow hash-only rows

**Files:**
- Modify: `specter/specter-core/src/types/announcement.rs`
- Test: same file (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `announcement.rs`:
```rust
#[test]
fn hash_only_announcement_is_valid_pending_resolution() {
    // A freshly-indexed announcement has only the keccak256 hash, no ciphertext.
    let mut ann = Announcement::new(Vec::new(), 0x42);
    ann.ephemeral_key_hash = Some(vec![0x11u8; 32]);
    assert!(!ann.is_resolved());
    assert!(ann.validate().is_ok(), "hash-only row must validate");
}

#[test]
fn resolved_announcement_requires_full_ciphertext() {
    let ann = Announcement::new(make_valid_ephemeral_key(), 0x42);
    assert!(ann.is_resolved());
    assert!(ann.validate().is_ok());
}

#[test]
fn empty_with_no_hash_is_invalid() {
    let ann = Announcement::new(Vec::new(), 0x42);
    assert!(ann.validate().is_err(), "no ciphertext and no hash is invalid");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd specter && cargo test -p specter-core announcement::tests::hash_only`
Expected: FAIL — `ephemeral_key_hash` field and `is_resolved` don't exist.

- [ ] **Step 3: Add the field**

In the `Announcement` struct (after `pub ephemeral_key: Vec<u8>`, line ~28) add:
```rust
    /// keccak256(ciphertext) emitted by the new contract event. Present for
    /// chain-indexed rows; the full `ephemeral_key` is fetched from calldata
    /// on view-tag match and verified against this hash.
    #[serde(default, skip_serializing_if = "Option::is_none", with = "opt_hex")]
    pub ephemeral_key_hash: Option<Vec<u8>>,
```
Add this helper module near the top of the file (after the `use` lines):
```rust
/// serde adapter: Option<Vec<u8>> <-> Option<hex string>.
mod opt_hex {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &Option<Vec<u8>>, s: S) -> Result<S::Ok, S::Error> {
        match v {
            Some(bytes) => s.serialize_str(&hex::encode(bytes)),
            None => s.serialize_none(),
        }
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<u8>>, D::Error> {
        let opt = Option::<String>::deserialize(d)?;
        match opt {
            Some(s) => hex::decode(s).map(Some).map_err(serde::de::Error::custom),
            None => Ok(None),
        }
    }
}
```
Add `ephemeral_key_hash: None,` to **both** struct constructors in this file (`Announcement::new` ~line 62 and `from_bytes` ~line 141), and to the `AnnouncementBuilder` (add a `ephemeral_key_hash: Option<Vec<u8>>` field, a setter `pub fn ephemeral_key_hash(mut self, h: Vec<u8>) -> Self { self.ephemeral_key_hash = Some(h); self }`, and `announcement.ephemeral_key_hash = self.ephemeral_key_hash;` in `build`).

- [ ] **Step 4: Add `is_resolved` and relax `validate`**

Add the method inside `impl Announcement`:
```rust
    /// True once the full 1088-byte ciphertext is present (calldata fetched).
    pub fn is_resolved(&self) -> bool {
        self.ephemeral_key.len() == KYBER_CIPHERTEXT_SIZE
    }
```
Replace the ephemeral-key size check at the top of `validate` (lines ~79-93) with:
```rust
        // A hash-only row (indexed from chain, ciphertext not yet fetched) is
        // valid as long as the hash is a 32-byte keccak256 digest.
        if self.ephemeral_key.is_empty() {
            match &self.ephemeral_key_hash {
                Some(h) if h.len() == 32 => return Ok(()),
                _ => {
                    return Err(SpecterError::InvalidAnnouncement(
                        "announcement has neither ciphertext nor a 32-byte key hash".into(),
                    ))
                }
            }
        }

        // Resolved row: full ciphertext must be exactly KYBER_CIPHERTEXT_SIZE…
        if self.ephemeral_key.len() != KYBER_CIPHERTEXT_SIZE {
            return Err(SpecterError::InvalidAnnouncement(format!(
                "ephemeral key size mismatch: expected {}, got {}",
                KYBER_CIPHERTEXT_SIZE,
                self.ephemeral_key.len()
            )));
        }
        if self.ephemeral_key.iter().all(|&b| b == 0) {
            return Err(SpecterError::InvalidAnnouncement(
                "ephemeral key is all zeros".into(),
            ));
        }
```
(Leave the timestamp check that follows unchanged.)

- [ ] **Step 5: Run tests**

Run: `cd specter && cargo test -p specter-core announcement`
Expected: PASS (new tests + all existing announcement tests).

- [ ] **Step 6: Commit**

```bash
git add specter/specter-core/src/types/announcement.rs
git commit -m "feat(core): Announcement carries ephemeral_key_hash; allow hash-only pre-resolution rows"
```

---

## Task 5: `EphemeralKeyResolver` trait (decouple scanner from RPC)

**Files:**
- Create: `specter/specter-core/src/resolver.rs`
- Modify: `specter/specter-core/src/lib.rs` (add `pub mod resolver;` and re-export)

- [ ] **Step 1: Write the failing test**

Create `specter/specter-core/src/resolver.rs`:
```rust
//! Resolves the full ML-KEM ciphertext for a chain-indexed announcement.
//!
//! The new contract emits only keccak256(ciphertext); the ciphertext lives in
//! the `announce()` calldata. Implementors (e.g. an RPC-backed resolver in
//! specter-chain) fetch that calldata and MUST verify keccak256 before
//! returning. Kept here as a trait so the scanner has no chain/RPC dependency.

use async_trait::async_trait;
use crate::error::Result;

#[async_trait]
pub trait EphemeralKeyResolver: Send + Sync {
    /// Fetches and verifies the 1088-byte ciphertext for the given announce tx.
    ///
    /// * `announce_tx_hash` – the Monad tx that called `announce()`.
    /// * `expected_hash` – the 32-byte keccak256 from the event.
    ///
    /// Implementations MUST assert `keccak256(ciphertext) == expected_hash`.
    async fn resolve(&self, announce_tx_hash: &str, expected_hash: &[u8]) -> Result<Vec<u8>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StubResolver;
    #[async_trait]
    impl EphemeralKeyResolver for StubResolver {
        async fn resolve(&self, _tx: &str, _h: &[u8]) -> Result<Vec<u8>> {
            Ok(vec![0x42u8; 1088])
        }
    }

    #[tokio::test]
    async fn stub_resolver_returns_ciphertext() {
        let r = StubResolver;
        let ct = r.resolve("0xabc", &[0u8; 32]).await.unwrap();
        assert_eq!(ct.len(), 1088);
    }
}
```

- [ ] **Step 2: Wire the module**

In `specter/specter-core/src/lib.rs` add `pub mod resolver;` and `pub use resolver::EphemeralKeyResolver;`. Ensure `async-trait` and (dev) `tokio` are deps of `specter-core`:
```bash
grep -n "async-trait\|^tokio" specter/specter-core/Cargo.toml
```
If `async-trait` is absent, add `async-trait = { workspace = true }` under `[dependencies]`; add `tokio = { workspace = true, features = ["macros", "rt"] }` under `[dev-dependencies]`.

- [ ] **Step 3: Run the test**

Run: `cd specter && cargo test -p specter-core resolver`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add specter/specter-core/src/resolver.rs specter/specter-core/src/lib.rs specter/specter-core/Cargo.toml
git commit -m "feat(core): add EphemeralKeyResolver trait for calldata ciphertext recovery"
```

---

## Task 6: Calldata decoder + RPC resolver in specter-chain

**Files:**
- Create: `specter/specter-chain/src/calldata.rs`
- Modify: `specter/specter-chain/src/lib.rs` (`pub mod calldata;`)
- Test: in `calldata.rs`

- [ ] **Step 1: Write the failing test**

Create `specter/specter-chain/src/calldata.rs`:
```rust
//! Recovers the ML-KEM ciphertext from `announce()` calldata and verifies it
//! against the event's keccak256 hash. Used by scanners on view-tag match.

use alloy::primitives::{keccak256, TxHash};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::sol_types::SolCall;
use async_trait::async_trait;
use specter_core::error::{Result, SpecterError};
use specter_core::resolver::EphemeralKeyResolver;

use crate::contract::SPECTERAnnouncer;

/// Decodes `announce()` (or its `(schemeId,…)` overload) calldata into the
/// 1088-byte `ephemeralPubKey`.
pub fn decode_announce_ciphertext(input: &[u8]) -> Result<Vec<u8>> {
    if let Ok(c) = SPECTERAnnouncer::announceCall::abi_decode(input, true) {
        return Ok(c.ephemeralPubKey.to_vec());
    }
    if let Ok(c) = SPECTERAnnouncer::announce_1Call::abi_decode(input, true) {
        return Ok(c.ephemeralPubKey.to_vec());
    }
    Err(SpecterError::ValidationError(
        "calldata is not a recognized announce() call".into(),
    ))
}

/// Verifies keccak256(ciphertext) == expected and returns it.
pub fn verify_ciphertext(ciphertext: Vec<u8>, expected_hash: &[u8]) -> Result<Vec<u8>> {
    let got = keccak256(&ciphertext);
    if got.as_slice() != expected_hash {
        return Err(SpecterError::ValidationError(
            "ciphertext keccak256 does not match event ephemeralKeyHash".into(),
        ));
    }
    Ok(ciphertext)
}

/// RPC-backed resolver: fetch tx by hash → decode calldata → verify hash.
pub struct RpcEphemeralKeyResolver {
    rpc_url: String,
}

impl RpcEphemeralKeyResolver {
    pub fn new(rpc_url: impl Into<String>) -> Self {
        Self { rpc_url: rpc_url.into() }
    }
}

#[async_trait]
impl EphemeralKeyResolver for RpcEphemeralKeyResolver {
    async fn resolve(&self, announce_tx_hash: &str, expected_hash: &[u8]) -> Result<Vec<u8>> {
        let url = self
            .rpc_url
            .parse()
            .map_err(|_| SpecterError::RegistryError("invalid RPC url".into()))?;
        let tx_hash: TxHash = announce_tx_hash
            .trim()
            .parse()
            .map_err(|_| SpecterError::ValidationError("invalid announce tx hash".into()))?;
        let provider = ProviderBuilder::new().on_http(url);
        let tx = provider
            .get_transaction_by_hash(tx_hash)
            .await
            .map_err(|e| SpecterError::RegistryError(format!("eth_getTransactionByHash: {e}")))?
            .ok_or_else(|| SpecterError::RegistryError("announce tx not found".into()))?;
        let ciphertext = decode_announce_ciphertext(tx.input())?;
        verify_ciphertext(ciphertext, expected_hash)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{keccak256, Address};

    fn encode_announce(ct: &[u8]) -> Vec<u8> {
        SPECTERAnnouncer::announceCall {
            stealthAddress: Address::ZERO,
            ephemeralPubKey: ct.to_vec().into(),
            metadata: vec![0x7Fu8].into(),
        }
        .abi_encode()
    }

    #[test]
    fn decode_then_verify_roundtrip() {
        let ct = vec![0xABu8; 1088];
        let input = encode_announce(&ct);
        let decoded = decode_announce_ciphertext(&input).unwrap();
        assert_eq!(decoded, ct);
        let expected = keccak256(&ct);
        assert!(verify_ciphertext(decoded, expected.as_slice()).is_ok());
    }

    #[test]
    fn wrong_hash_is_rejected() {
        let ct = vec![0xABu8; 1088];
        let input = encode_announce(&ct);
        let decoded = decode_announce_ciphertext(&input).unwrap();
        assert!(verify_ciphertext(decoded, &[0u8; 32]).is_err());
    }

    #[test]
    fn garbage_calldata_rejected() {
        assert!(decode_announce_ciphertext(&[0x00, 0x01, 0x02]).is_err());
    }
}
```
> Note: alloy names the overload `announce_1Call`. If `cargo test` reports a different generated name, run `cargo expand -p specter-chain contract` (or read the compiler error) and use the actual identifier.

- [ ] **Step 2: Wire the module**

In `specter/specter-chain/src/lib.rs` add `pub mod calldata;`. Confirm `async-trait` is a dep of `specter-chain` (`grep -n async-trait specter/specter-chain/Cargo.toml`); add `async-trait = { workspace = true }` if missing.

- [ ] **Step 3: Run tests to verify they fail then pass**

Run: `cd specter && cargo test -p specter-chain calldata`
Expected first run may FAIL on the overload identifier; fix per the note, then PASS.

- [ ] **Step 4: Commit**

```bash
git add specter/specter-chain/src/calldata.rs specter/specter-chain/src/lib.rs specter/specter-chain/Cargo.toml
git commit -m "feat(chain): decode announce() calldata + keccak256-verified RPC ephemeral key resolver"
```

---

## Task 7: Turso schema v6 (Rust registry DDL + migration)

**Files:**
- Modify: `specter/specter-registry/src/turso/schema.rs`
- Test: `specter/specter-registry/tests/integration_full_flow.rs` (add a v6 assertion) or a new `tests/schema_v6.rs`

- [ ] **Step 1: Write the failing test**

Create `specter/specter-registry/tests/schema_v6.rs`:
```rust
//! v6 schema: ephemeral_key_hash, metadata_blob, payment_tx_hash_hmac present;
//! ephemeral_key is now nullable; telemetry has ip_hash.

use specter_registry::turso::schema::SCHEMA_VERSION;

#[test]
fn schema_version_is_6() {
    assert_eq!(SCHEMA_VERSION, 6);
}
```
> If `schema` is not a public path, use the actual public re-export (`grep -rn "pub use.*schema\|pub mod schema" specter/specter-registry/src/turso/mod.rs specter/specter-registry/src/lib.rs`).

- [ ] **Step 2: Run to verify failure**

Run: `cd specter && cargo test -p specter-registry --test schema_v6`
Expected: FAIL — `SCHEMA_VERSION` is 5.

- [ ] **Step 3: Bump version + extend fresh DDL**

In `schema.rs`: set `pub const SCHEMA_VERSION: i32 = 6;`.

In `SCHEMA_STATEMENTS`, update the `announcements` CREATE to add the new columns (after `ephemeral_key BLOB` make it nullable, and add the three columns before `created_at`):
```rust
        ephemeral_key      BLOB,                 -- nullable: hash-only rows fill this from calldata
        ephemeral_key_hash BLOB,                 -- keccak256(ciphertext) from the event
        metadata_blob      BLOB,                 -- AEAD-encrypted on-chain metadata (opaque)
        payment_tx_hash_hmac BLOB,               -- HMAC(server_key, payment_tx_hash) — Phase 2 dedup key
```
Add the new indexes after the existing announcements indexes:
```rust
    "CREATE INDEX IF NOT EXISTS idx_announcements_ephem_hash ON announcements(ephemeral_key_hash)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_announcements_payment_hmac_unique ON announcements(payment_tx_hash_hmac) WHERE payment_tx_hash_hmac IS NOT NULL",
```
Change the `_telemetry` CREATE to use `ip_hash BLOB` instead of `ip TEXT`, and replace the `_idx_tel_ip` index with `"CREATE INDEX IF NOT EXISTS _idx_tel_iph ON _telemetry(ip_hash)"`.

- [ ] **Step 4: Add the v5→v6 migration block**

After `MIGRATION_V4_TO_V5`, add:
```rust
/// v5 → v6: new-contract interface + at-rest hardening prep.
/// - announcements: add ephemeral_key_hash, metadata_blob, payment_tx_hash_hmac.
/// - telemetry: add ip_hash (raw `ip` is left in place but no longer written).
/// - dedup moves to payment_tx_hash_hmac (the plaintext unique index is dropped).
/// Note: SQLite cannot make an existing NOT NULL column nullable in place; the
/// legacy `ephemeral_key NOT NULL` constraint is tolerated because every new
/// chain-indexed row writes a 32-byte hash there is no need to — instead new
/// rows write ephemeral_key_hash and leave ephemeral_key empty BLOB (not NULL).
pub const MIGRATION_V5_TO_V6: &[&str] = &[
    "ALTER TABLE announcements ADD COLUMN ephemeral_key_hash BLOB",
    "ALTER TABLE announcements ADD COLUMN metadata_blob BLOB",
    "ALTER TABLE announcements ADD COLUMN payment_tx_hash_hmac BLOB",
    "CREATE INDEX IF NOT EXISTS idx_announcements_ephem_hash ON announcements(ephemeral_key_hash)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_announcements_payment_hmac_unique ON announcements(payment_tx_hash_hmac) WHERE payment_tx_hash_hmac IS NOT NULL",
    "DROP INDEX IF EXISTS idx_announcements_payment_tx_unique",
    "ALTER TABLE _telemetry ADD COLUMN ip_hash BLOB",
    "CREATE INDEX IF NOT EXISTS _idx_tel_iph ON _telemetry(ip_hash)",
    "INSERT OR REPLACE INTO registry_metadata (key, value) VALUES ('schema_version', '6')",
];
```
> The legacy `ephemeral_key BLOB NOT NULL` on already-migrated DBs stays NOT NULL; new chain rows must therefore write an **empty BLOB** (`Value::Blob(vec![])`), not NULL, for `ephemeral_key`. Task 8 does this. On a fresh DB the v6 `SCHEMA_STATEMENTS` makes it nullable.

- [ ] **Step 5: Register the migration in the runner**

Find where migrations are dispatched by version:
```bash
grep -n "MIGRATION_V4_TO_V5\|=> &MIGRATION\|match.*version\|run_migrations" specter/specter-registry/src/turso/registry.rs
```
Add the `5 => MIGRATION_V5_TO_V6` arm following the existing pattern (mirror how `MIGRATION_V4_TO_V5` is wired). The migration must be **idempotent** (the codebase already guards `ALTER … ADD COLUMN`/`CREATE … IF NOT EXISTS` per commit `4986c3c`); wrap `ALTER TABLE … ADD COLUMN` in the same duplicate-column tolerance the existing arms use.

- [ ] **Step 6: Run tests**

Run: `cd specter && cargo test -p specter-registry --test schema_v6 && cargo test -p specter-registry migration`
Expected: PASS (version is 6; existing idempotent-migration tests still pass).

- [ ] **Step 7: Commit**

```bash
git add specter/specter-registry/src/turso/schema.rs specter/specter-registry/src/turso/registry.rs specter/specter-registry/tests/schema_v6.rs
git commit -m "feat(registry): Turso schema v6 — ephemeral_key_hash, metadata_blob, payment_tx_hash_hmac, telemetry ip_hash"
```

---

## Task 8: Registry read/write for the new columns

**Files:**
- Modify: `specter/specter-registry/src/turso/registry.rs` (INSERT ~437-450; the three SELECT column lists ~238, ~417, ~561; row mapping)

- [ ] **Step 1: Write the failing test**

Add to `registry.rs` tests (or `tests/schema_v6.rs`) a round-trip that stores a hash-only announcement and reads it back:
```rust
// Pseudocode shape — adapt to the crate's test harness (in-memory libsql).
// 1. open registry, run migrations
// 2. insert an Announcement with ephemeral_key = vec![] and
//    ephemeral_key_hash = Some(vec![0x11;32]), tx_hash = Some("0xaa..")
// 3. get_by_view_tag(view_tag) -> the row has ephemeral_key_hash == [0x11;32]
//    and ephemeral_key is empty (is_resolved() == false)
```
> Use the existing in-memory test setup in this file as the template (search for `:memory:` or the existing `TursoRegistry::` test constructor).

- [ ] **Step 2: Run to verify failure**

Run: `cd specter && cargo test -p specter-registry hash_only_roundtrip`
Expected: FAIL — INSERT/SELECT don't reference the new columns.

- [ ] **Step 3: Update INSERT**

Change the INSERT (lines ~437-450) to include the new columns and write an **empty BLOB** for `ephemeral_key` when the row is hash-only:
```rust
            "INSERT INTO announcements \
             (view_tag, timestamp, ephemeral_key, ephemeral_key_hash, metadata_blob, \
              source_chain_id, on_chain, block_number, tx_hash, payment_tx_hash, \
              amount, chain, stealth_address, record_source) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                Value::Integer(ann.view_tag as i64),
                Value::Integer(ann.timestamp as i64),
                Value::Blob(ann.ephemeral_key.clone()), // empty Vec for hash-only rows (NOT NULL-safe)
                ann.ephemeral_key_hash.clone().map(Value::Blob).unwrap_or(Value::Null),
                ann.metadata_blob.clone().map(Value::Blob).unwrap_or(Value::Null),
                // …remaining existing bindings (source_chain_id, on_chain, block_number,
                //   tx_hash, payment_tx_hash, amount, chain, stealth_address, record_source)…
            ],
```
> `metadata_blob` is a new `Option<Vec<u8>>` field on `Announcement` — add it in Task 4's struct alongside `ephemeral_key_hash` (same `opt_hex`/`skip_serializing_if` treatment) if not already present. If you prefer to keep Task 4 minimal, add `metadata_blob: Option<Vec<u8>>` now and re-run Task 4's tests.

- [ ] **Step 4: Update the three SELECT column lists + row mapping**

In each of the three SELECTs (lines ~238, ~417, ~561) add `ephemeral_key_hash, metadata_blob` to the column list, and in the row→`Announcement` mapping read them as optional BLOBs:
```rust
        // after reading ephemeral_key:
        ann.ephemeral_key_hash = row.get_value(<idx>).ok().and_then(blob_opt);
        ann.metadata_blob      = row.get_value(<idx>).ok().and_then(blob_opt);
```
where `blob_opt` converts a libsql `Value::Blob` to `Option<Vec<u8>>` (mirror the existing optional-column readers in this file; if none exists, add a small `fn blob_opt(v: Value) -> Option<Vec<u8>> { if let Value::Blob(b) = v { Some(b) } else { None } }`).

- [ ] **Step 5: Run tests**

Run: `cd specter && cargo test -p specter-registry`
Expected: PASS (new round-trip + all existing registry tests).

- [ ] **Step 6: Commit**

```bash
git add specter/specter-registry/src/turso/registry.rs specter/specter-core/src/types/announcement.rs
git commit -m "feat(registry): persist + read ephemeral_key_hash and metadata_blob"
```

---

## Task 9: Scanner resolves hash-only announcements before decapsulating

**Files:**
- Modify: `specter/specter-scanner/src/lib.rs`
- Modify: `specter/specter-scanner/Cargo.toml` (no new heavy deps; trait lives in specter-core)

- [ ] **Step 1: Write the failing test**

Add to the scanner's `tests` module a test using a stub resolver that returns the matching ciphertext for a hash-only announcement, asserting the scan resolves it and discovers the payment. Reuse the existing test scaffolding (`encapsulate`, `generate_keypair`, `compute_view_tag`):
```rust
#[tokio::test]
async fn scanner_resolves_hash_only_announcement() {
    // Build a real (sk, pk); encapsulate to get (ciphertext, shared_secret);
    // construct a hash-only Announcement: ephemeral_key = vec![], 
    //   ephemeral_key_hash = Some(keccak256(ciphertext)), view_tag set.
    // Stub resolver returns `ciphertext` for any tx hash.
    // scan_with_config(... resolver = Some(stub) ...) must discover the payment.
}
```
> If the scanner currently has no async/registry test that discovers a payment, model this on `tests` around line 467+ (which already builds keys + encapsulates).

- [ ] **Step 2: Run to verify failure**

Run: `cd specter && cargo test -p specter-scanner resolves_hash_only`
Expected: FAIL — scanner has no resolver and `scan_announcement` rejects an empty ciphertext.

- [ ] **Step 3: Add an optional resolver to the scanner**

Add a field to `ScannerConfig`:
```rust
    /// Resolves the ciphertext for chain-indexed (hash-only) announcements.
    /// `None` ⇒ hash-only announcements are skipped with a warning.
    pub resolver: Option<std::sync::Arc<dyn specter_core::resolver::EphemeralKeyResolver>>,
```
Default it to `None` in `ScannerConfig::default()`.

In both scan loops (`scan_with_config` ~line 278, `scan_with_progress` ~line 359), before calling `scan_announcement`, resolve hash-only rows:
```rust
                // Resolve the ciphertext from calldata if this row is hash-only.
                let mut announcement = announcement;
                if !announcement.is_resolved() {
                    let (Some(resolver), Some(tx), Some(hash)) = (
                        config.resolver.as_ref(),
                        announcement.tx_hash.as_deref(),
                        announcement.ephemeral_key_hash.as_deref(),
                    ) else {
                        debug!(view_tag, "skipping hash-only announcement (no resolver)");
                        continue;
                    };
                    match resolver.resolve(tx, hash).await {
                        Ok(ct) => announcement.ephemeral_key = ct,
                        Err(e) => {
                            warn!(view_tag, error = %e, "ephemeral key resolution failed; skipping");
                            continue;
                        }
                    }
                }
```
(`scan_with_config` takes `config` by value; `scan_with_progress` likewise — both already own `config.view_tag_filter`, so move `resolver` out before the loop or clone the `Arc`.)

- [ ] **Step 4: Run tests**

Run: `cd specter && cargo test -p specter-scanner`
Expected: PASS (resolver test + all existing scanner tests; the default `None` path keeps current behavior).

- [ ] **Step 5: Commit**

```bash
git add specter/specter-scanner/src/lib.rs specter/specter-scanner/Cargo.toml
git commit -m "feat(scanner): resolve hash-only announcements via EphemeralKeyResolver before decapsulation"
```

---

## Task 10: Wire the RPC resolver into the API/CLI scan path

**Files:**
- Modify: wherever the scanner is constructed for scanning (search below).

- [ ] **Step 1: Locate scanner construction**

Run:
```bash
cd "$(git rev-parse --show-toplevel)"
grep -rn "scan_with_config\|ScannerConfig\|StealthScanner::new\|Scanner::new" specter/specter-api/src specter/specter-cli/src | grep -v target
```
Expected: the API scan handler and the CLI scan command.

- [ ] **Step 2: Inject the resolver**

At each call site that performs a real chain scan, build `ScannerConfig` with:
```rust
    resolver: Some(std::sync::Arc::new(
        specter_chain::calldata::RpcEphemeralKeyResolver::new(monad_rpc_url.clone()),
    )),
```
using the existing Monad RPC URL env (`MONAD_RPC_URL` / the URL already used by `state.rs`). For purely in-memory/dev scans that already hold full ciphertexts, leave `resolver: None`.

- [ ] **Step 3: Build**

Run: `cd specter && cargo build -p specter-api -p specter-cli`
Expected: builds. Confirm `specter-chain` is a dependency of these crates (`grep -n specter-chain specter/specter-api/Cargo.toml`); add it if missing.

- [ ] **Step 4: Commit**

```bash
git add -A specter/specter-api specter/specter-cli
git commit -m "feat(api,cli): inject RPC ephemeral-key resolver into chain scans"
```

---

## Task 11: Indexer — new event signature + config

**Files:**
- Modify: `indexer/config.yaml` (event signature; address/start_block already done in Task 1)
- Modify: `indexer/schema.graphql`

- [ ] **Step 1: Update the event signature in `config.yaml`**

Replace the `events:` entry with the new signature (note `schemeId` no longer `indexed`, `bytes32 ephemeralKeyHash`):
```yaml
        events:
          - event: "Announcement(uint256 schemeId, address indexed stealthAddress, address indexed caller, bytes32 ephemeralKeyHash, bytes metadata)"
```
Confirm `field_selection.transaction_fields` still includes `hash` (scanners need the announce tx to fetch calldata) — it does.

- [ ] **Step 2: Update `schema.graphql`**

In the `AnnouncementEvent` entity: rename `ephemeralPubKey` → `ephemeralKeyHash`; remove the now-unreadable decoded fields `amount`, `txHash` (payment), `sourceChainId` (they live inside the encrypted blob). Keep `viewTag`, `metadataRaw`, `stealthAddress`, `caller`, `schemeId`, block fields, `tursoSynced`.
```bash
grep -n "ephemeralPubKey\|amount\|sourceChainId\|txHash\|metadataRaw\|viewTag" indexer/schema.graphql
```

- [ ] **Step 3: Regenerate Envio types**

Run: `cd indexer && pnpm codegen` (or `npx envio codegen` — match the repo's package manager from `indexer/package.json`).
Expected: regenerates `generated/` against the new event; no errors.

- [ ] **Step 4: Commit**

```bash
git add indexer/config.yaml indexer/schema.graphql
git commit -m "feat(indexer): new Announcement event signature (ephemeralKeyHash); drop on-chain plaintext fields"
```

---

## Task 12: Indexer — handler + metadata + Turso writer

**Files:**
- Modify: `indexer/src/metadata.ts`
- Modify: `indexer/src/EventHandlers.ts`
- Modify: `indexer/src/turso.ts`
- Test: `indexer/src/__tests__/metadata.test.ts`

- [ ] **Step 1: Update `metadata.test.ts` (failing)**

The metadata is now an opaque encrypted blob; only `metadata[0]` (view_tag) is readable. Replace the multi-field decode tests with:
```ts
import { extractViewTag } from "../metadata";

test("extractViewTag reads byte 0 of the metadata blob", () => {
  expect(extractViewTag("0x7f1122334455")).toBe(0x7f);
});

test("extractViewTag throws on empty metadata", () => {
  expect(() => extractViewTag("0x")).toThrow();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd indexer && pnpm test metadata`
Expected: FAIL — `extractViewTag` doesn't exist.

- [ ] **Step 3: Reduce `metadata.ts`**

Replace the struct decoder with a view-tag extractor (keep `EPHEMERAL_KEY_LENGTH` export if other modules import it):
```ts
/** The encrypted on-chain metadata: byte 0 is the plaintext view_tag; the rest
 *  is an AEAD blob only the recipient can decrypt. We only read the view_tag. */
export function extractViewTag(metadata: string): number {
  const hex = metadata.startsWith("0x") ? metadata.slice(2) : metadata;
  if (hex.length < 2) throw new Error("metadata too short: missing view_tag");
  return parseInt(hex.slice(0, 2), 16);
}
```

- [ ] **Step 4: Update `EventHandlers.ts`**

- Destructure `ephemeralKeyHash` instead of `ephemeralPubKey`.
- Replace the 1088-byte length validation (it was for the event field, now a 32-byte hash) with a 32-byte check on `ephemeralKeyHash`.
- Replace `decodeMetadataSafe(...)` with `extractViewTag(metadata)`.
- Drop `paymentTxHash`, `amount`, `sourceChainId` from the Turso write and from `context.AnnouncementEvent.set` (or set them `undefined`); add `ephemeralKeyHash` and `metadataRaw` (the blob).
```ts
  const { schemeId, stealthAddress, caller, ephemeralKeyHash, metadata } = event.params;
  const viewTag = extractViewTag(metadata);
  const keyHashHex = ephemeralKeyHash.startsWith("0x") ? ephemeralKeyHash.slice(2) : ephemeralKeyHash;
  if (keyHashHex.length !== 64) {
    context.log.warn(`[${entityId}] ephemeralKeyHash not 32 bytes (${keyHashHex.length / 2}). Indexing anyway.`);
  }
  // writeTursoAnnouncement({ viewTag, ephemeralKeyHash: keyHashHex, metadataBlob: metadata, txHash, blockNumber, blockTimestamp, stealthAddress, blockTxIndex, chain });
  // context.AnnouncementEvent.set({ id: entityId, schemeId, stealthAddress, caller, ephemeralKeyHash: keyHashHex, viewTag, metadataRaw: metadata, blockNumber, blockTimestamp, transactionHash: txHash, logIndex, tursoSynced });
```

- [ ] **Step 5: Update `turso.ts`**

Change the writer's typed input and SQL to the v6 columns: write `ephemeral_key_hash` (BLOB from the 32-byte hash), `metadata_blob` (BLOB from the metadata bytes), `view_tag`, `tx_hash` (announce tx), `block_number`, `timestamp`, `chain`, `stealth_address`, `block_tx_index`. Stop writing `ephemeral_key`, `payment_tx_hash`, `amount`, `source_chain_id`.
```ts
    sql: `INSERT OR IGNORE INTO announcements
            (view_tag, timestamp, ephemeral_key_hash, metadata_blob, on_chain,
             block_number, tx_hash, chain, stealth_address, block_tx_index)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    args: [viewTag, blockTimestamp, hexToBytes(ephemeralKeyHash), hexToBytes(metadataBlob),
           blockNumber, txHash, chain, stealthAddress, blockTxIndex],
```
Use the existing hex→Buffer helper in this file (the current code converts `ephemeralKey` hex to a Buffer at line ~137; reuse it).

- [ ] **Step 6: Run tests**

Run: `cd indexer && pnpm test`
Expected: PASS (metadata + turso suites updated).

- [ ] **Step 7: Commit**

```bash
git add indexer/src/metadata.ts indexer/src/EventHandlers.ts indexer/src/turso.ts indexer/src/__tests__/metadata.test.ts
git commit -m "feat(indexer): store ephemeralKeyHash + opaque metadata blob; stop decoding on-chain plaintext"
```

---

## Task 13: event-poller — new event signature + writer

**Files:**
- Modify: `event-poller/src/index.ts`

- [ ] **Step 1: Update the event ABI string (~line 92)**
```ts
const ANNOUNCEMENT_EVENT = parseAbiItem(
  "event Announcement(uint256 schemeId, address indexed stealthAddress, address indexed caller, bytes32 ephemeralKeyHash, bytes metadata)"
);
```

- [ ] **Step 2: Update `processLog` (~lines 285-320)**

- Read `args.ephemeralKeyHash` (Hex) instead of `args.ephemeralPubKey`.
- Read `viewTag = parseInt(stripped(metadata).slice(0,2), 16)` from `args.metadata[0]`.
- Drop the `decodeMetadata(...)` struct decode and the 2176-hex ephemeral validation.
- Return `{ ephemeralKeyHash, viewTag, metadataBlob: args.metadata, txHash, blockNumber, blockTimestamp, stealthAddress, logIndex }`.

- [ ] **Step 3: Update `insertAnnouncement` (~lines 236-256)**

Match Turso v6: validate `ephemeralKeyHash` is 32 bytes (64 hex chars), write `ephemeral_key_hash` + `metadata_blob` + `view_tag` + announce `tx_hash` + block fields; stop writing `ephemeral_key`/`amount`/`payment_tx_hash`/`source_chain_id`:
```ts
  if (row.ephemeralKeyHash.length !== 64) {
    throw new Error(`ephemeralKeyHash must be 32 bytes (64 hex chars), got ${row.ephemeralKeyHash.length / 2}`);
  }
  sql: `INSERT OR IGNORE INTO announcements
          (view_tag, timestamp, ephemeral_key_hash, metadata_blob, on_chain,
           block_number, tx_hash, chain, stealth_address, block_tx_index)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
```
(Use the libsql client's BLOB binding for the two hex fields, mirroring the indexer's `turso.ts`.)

- [ ] **Step 4: Typecheck/build**

Run: `cd event-poller && pnpm build` (or `npx tsc --noEmit`).
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add event-poller/src/index.ts
git commit -m "feat(event-poller): decode new Announcement event; store ephemeralKeyHash + metadata blob"
```

---

## Task 14: Workspace build + full test sweep

**Files:** none (verification gate).

- [ ] **Step 1: Rust workspace build + tests**

Run:
```bash
cd specter && cargo build --workspace && cargo test --workspace
```
Expected: builds clean; all tests pass. Fix any call sites still passing the old `Announcement` shape or calling `build_on_chain_metadata`/`relay_announcement` with stale signatures (those were already updated in the in-progress B1 work).

- [ ] **Step 2: Clippy gate (repo uses `.clippy.toml`)**

Run: `cd specter && cargo clippy --workspace --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 3: Indexer + poller checks**

Run: `cd indexer && pnpm test && pnpm codegen` then `cd ../event-poller && pnpm build`
Expected: green.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A && git commit -m "chore: workspace build/test/clippy green after interface migration"
```

---

## Task 15: Re-index + deployment runbook (operator-executed)

**Files:**
- Create: `docs/runbooks/2026-06-11-monad-reindex.md`

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/2026-06-11-monad-reindex.md` documenting the cutover (this is the operator checklist; the agent does not touch production):
```markdown
# Monad re-index runbook — new SPECTERAnnouncer

1. Deploy Turso schema v6 (start API once with new build → migrations run; verify
   `SELECT value FROM registry_metadata WHERE key='schema_version'` == 6).
2. Set on all three services: SPECTER_ANNOUNCER_ADDRESS=0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC,
   SPECTER_ANNOUNCER_DEPLOY_BLOCK=37571591.
3. Reset poller checkpoint: DELETE FROM registry_metadata WHERE key='poller_last_block'
   (it will restart from deploy block).
4. Reset Envio: fresh index (new contract address ⇒ new index); clear persisted state
   so it replays from start_block 37571591.
5. Fund relayer wallet (RELAYER_PRIVATE_KEY) on Monad if balance is low.
6. Restart API, event-poller, indexer. Confirm new rows have ephemeral_key_hash +
   metadata_blob set and ephemeral_key empty.
7. Smoke test: run e2e_flow against the new address; confirm scan resolves a payment
   via calldata fetch (keccak256 match).
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/2026-06-11-monad-reindex.md
git commit -m "docs(runbook): Monad re-index + cutover for new SPECTERAnnouncer"
```

- [ ] **Step 3: Hand off the operator checklist**

Surface the runbook to the user; steps 1–7 require production credentials and are run by the operator, not the agent.

---

## Self-Review notes (addressed)

- **Spec coverage:** 1.1 env/config → T1–T2; 1.2 ABI → T3; 1.3 calldata/scanner → T4–T6, T9–T10; 1.4 indexer → T11–T12; 1.5 event-poller → T13; 1.6 schema v6 → T7–T8; re-index → T15.
- **Migration ordering:** schema v6 (T7) lands before indexer/poller writers (T12–T13) and re-index (T15) — called out at top and in the runbook.
- **Type consistency:** `ephemeral_key_hash: Option<Vec<u8>>` and `metadata_blob: Option<Vec<u8>>` defined in T4, written/read in T8, consumed in T9; `EphemeralKeyResolver::resolve(&self, &str, &[u8])` defined in T5, implemented in T6, injected in T9–T10.
- **Known soft spots (verify at execution):** the alloy overload identifier (`announce_1Call`) and the exact libsql `Value`/row accessor names — both flagged inline with the grep/expand commands to confirm.

---

## REVISION 2026-06-11 (execution): pivot to index-time resolve (supersedes Tasks 10-13)

Reason: view-tag pre-filtering cannot work for ML-KEM (the view tag is derived
from the shared secret, which requires decapsulating the ciphertext), so
store-hash would force O(N) calldata fetches per scan. The indexer/poller now
resolve the ciphertext from calldata once at index time and store the FULL
ciphertext, so scans read it from Turso. Tasks 1-9 are unchanged and remain valid.

### Task 10 (REVISED): API/CLI scan — no resolver wiring needed

The API `scan_payments` handler reads announcements (with full `ephemeral_key`
resolved at index time) from Turso and passes them to
`specter_stealth::discovery::scan_with_context_and_stats`, which already skips any
row whose `ephemeral_key` fails `KyberCiphertext::from_bytes` (no panic). So no
code change is required to make the live API scan work. The
`EphemeralKeyResolver`/`RpcEphemeralKeyResolver` (Tasks 5-6) and the scanner
resolver hook (Task 9) are retained as an OPTIONAL capability for client SDKs that
scan directly from chain without the indexer. Action: verify (a test or manual
check) that a hash-only row is skipped gracefully by the discovery path; no
production code edit.

### Task 11 (REVISED): Indexer — new event signature + calldata selection

- `config.yaml`: new event signature `Announcement(uint256 schemeId, address indexed stealthAddress, address indexed caller, bytes32 ephemeralKeyHash, bytes metadata)`; address + `start_block: 37571591` (already set in Task 1). Set `field_selection.transaction_fields: [hash, input]` so the handler gets the `announce()` calldata WITHOUT an extra RPC. (If the Monad HyperSync/RPC source does not support selecting `input`, fall back to an `eth_getTransactionByHash` call inside the handler using a viem client.)
- `schema.graphql`: rename `ephemeralPubKey` → keep `ephemeralPubKey` as the FULL resolved ciphertext (String hex); ADD `ephemeralKeyHash: String`. Drop the now-unreadable decoded `amount`/`txHash`(payment)/`sourceChainId` fields; keep `viewTag`, add `metadataRaw` (the encrypted blob), keep block/stealth fields, `tursoSynced`.
- Regenerate Envio types (`pnpm codegen`).

### Task 12 (REVISED): Indexer — handler resolves ciphertext from calldata, stores full ciphertext + hash + blob

- `metadata.ts`: reduce to `extractViewTag(metadata)` (byte 0); the rest is an opaque AEAD blob.
- `EventHandlers.ts`:
  1. Read `ephemeralKeyHash` (bytes32) and `metadata` from the event; `viewTag = extractViewTag(metadata)`.
  2. Obtain the `announce()` calldata: prefer `event.transaction.input` (from `transaction_fields: [input]`); else `eth_getTransactionByHash(txHash)` via a viem client.
  3. ABI-decode the calldata (`announce(address,bytes,bytes)` and the `(uint256,…)` overload) to recover `ephemeralPubKey` (1088 bytes).
  4. **Assert `keccak256(ephemeralPubKey) === ephemeralKeyHash`** (viem `keccak256`); on mismatch, log error and skip the row (do not store an unverified ciphertext).
  5. Write to Turso (via `turso.ts`): full `ephemeral_key` = ephemeralPubKey, `ephemeral_key_hash`, `metadata_blob` = metadata, `view_tag`, `tx_hash` (announce tx), block/stealth fields. Stop writing plaintext `amount`/`payment_tx_hash`/`source_chain_id`.
  6. Write the Envio entity (`ephemeralPubKey` resolved, `ephemeralKeyHash`, `viewTag`, `metadataRaw`, block fields, `tursoSynced`).
- `turso.ts`: INSERT columns `(view_tag, timestamp, ephemeral_key, ephemeral_key_hash, metadata_blob, on_chain, block_number, tx_hash, chain, stealth_address, block_tx_index)`; `ephemeral_key` is the full ciphertext BLOB; keep `INSERT OR IGNORE` on `tx_hash`.
- Tests (`__tests__/metadata.test.ts`): `extractViewTag` byte-0 + throws on empty. Add a calldata-decode+keccak256 unit test if a viem-based decoder helper is added.

### Task 13 (REVISED): event-poller — resolve ciphertext from calldata, store full ciphertext + hash + blob

- `ANNOUNCEMENT_EVENT` ABI string → new signature with `bytes32 ephemeralKeyHash`.
- `processLog`: read `ephemeralKeyHash`; `viewTag = metadata[0]`; then `eth_getTransactionByHash(log.transactionHash)` → decode `announce()` calldata → `ephemeralPubKey`; assert `keccak256(ephemeralPubKey) === ephemeralKeyHash` (skip on mismatch). Return the full ciphertext + hash + metadata blob.
- `insertAnnouncement`: validate ciphertext is 1088 bytes; write `ephemeral_key` (full), `ephemeral_key_hash`, `metadata_blob`, `view_tag`, announce `tx_hash`, block fields. (Mirrors the indexer; `INSERT OR IGNORE` on `tx_hash`.)
