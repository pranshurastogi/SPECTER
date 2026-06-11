//! SPECTER End-to-End Flow Test
//!
//! Tests the complete announcement lifecycle against real infrastructure:
//!   1. Load signer from PRIVATE_KEY
//!   2. Generate a recipient SPECTER wallet (ML-KEM keypair)
//!   3. Derive stealth address via ML-KEM encapsulation
//!   4. Send a micro-payment (1000 wei) to the stealth address on Monad testnet
//!   5. Build 77-byte announcement metadata (tx_hash, amount, source_chain_id)
//!   6. Publish the announcement to SPECTERAnnouncer contract on Monad
//!   7. Store the announcement in Turso via insert_onchain_announcement
//!   8. Scan the registry by view_tag and verify the announcement is found
//!
//! Usage:
//!   cargo run --bin e2e-flow --features specter-cli/e2e
//!   ENV_FILE=.env.staging cargo run --bin e2e-flow --features specter-cli/e2e
//!
//! Required env vars:  PRIVATE_KEY, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
//! Optional env vars:  MONAD_RPC_URL, SPECTER_ANNOUNCER_ADDRESS,
//!                     E2E_AMOUNT_WEI, E2E_SKIP_CHAIN

use std::time::Instant;

use alloy::network::EthereumWallet;
use alloy::primitives::{Address, B256, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::rpc::types::TransactionRequest;
use alloy::signers::local::PrivateKeySigner;
use anyhow::{bail, Context, Result};
use colored::*;
use specter_chain::{announcement_from_event, publish_announcement};
use specter_core::traits::AnnouncementRegistry;
use specter_core::types::AnnouncementMetadata;
use specter_crypto::{
    derive::derive_stealth_address, encapsulate, view_tag::compute_view_tag,
};
use specter_registry::turso::TursoRegistry;
use specter_stealth::wallet::SpecterWallet;

// ── Constants ─────────────────────────────────────────────────────────────────

const MONAD_CHAIN_ID: u64 = 10143;
const MONAD_RPC_DEFAULT: &str = "https://testnet-rpc.monad.xyz";
const ANNOUNCER_DEFAULT: &str = "0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC";
const DEFAULT_AMOUNT_WEI: u64 = 1_000; // 1000 wei — negligible cost for test

// ── Helpers ───────────────────────────────────────────────────────────────────

fn step(n: u8, total: u8, msg: &str) {
    println!("\n{} {}", format!("[{n}/{total}]").cyan().bold(), msg.bold());
}
fn ok(msg: &str)     { println!("  {} {}", "✓".green().bold(), msg); }
fn fail_msg(msg: &str) { println!("  {} {}", "✗".red().bold(), msg); }
fn info(msg: &str)   { println!("  {} {}", "→".blue(), msg); }
fn detail(k: &str, v: &str) {
    println!("  {:<24} {}", format!("{k}:").dimmed(), v.cyan());
}

fn redact(s: &str) -> String {
    if s.len() <= 10 { "****".into() }
    else { format!("{}...{}", &s[..6], &s[s.len()-4..]) }
}

// ─────────────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    let total_start = Instant::now();

    // Load order: .env first (base config), then .env.e2e on top (overrides + PRIVATE_KEY).
    // ENV_FILE overrides .env.e2e path.
    dotenvy::dotenv().ok(); // load .env (Turso, Pinata, etc.)
    let e2e_file = std::env::var("ENV_FILE").unwrap_or_else(|_| ".env.e2e".into());
    if std::path::Path::new(&e2e_file).exists() {
        dotenvy::from_filename(&e2e_file).ok();
        eprintln!("Loaded .env + {e2e_file}");
    } else {
        eprintln!("Note: {e2e_file} not found — ensure PRIVATE_KEY is in .env");
    }

    println!("{}", "\n╔══════════════════════════════════════════════════════╗".cyan());
    println!("{}", "║       SPECTER E2E Announcement Flow Test            ║".cyan());
    println!("{}", "╚══════════════════════════════════════════════════════╝\n".cyan());

    let skip_chain = std::env::var("E2E_SKIP_CHAIN").unwrap_or_default() == "1";
    if skip_chain {
        println!("  {} E2E_SKIP_CHAIN=1 — on-chain steps will be simulated\n", "⚡".yellow());
    }

    // ── [1/8] Load configuration ─────────────────────────────────────────────
    step(1, 8, "Loading configuration");

    let pk_hex = std::env::var("PRIVATE_KEY")
        .context("PRIVATE_KEY not set — add it to .env (64-char hex, no 0x prefix)")?;
    let pk_hex = pk_hex.trim().trim_start_matches("0x");

    if pk_hex.len() != 64 {
        bail!("PRIVATE_KEY must be 64 hex characters (got {})", pk_hex.len());
    }

    let rpc_url = std::env::var("MONAD_RPC_URL")
        .or_else(|_| std::env::var("MONAD_TESTNET_RPC_URL"))
        .unwrap_or_else(|_| MONAD_RPC_DEFAULT.into());

    let announcer_str = std::env::var("SPECTER_ANNOUNCER_ADDRESS")
        .unwrap_or_else(|_| ANNOUNCER_DEFAULT.into());

    let turso_url   = std::env::var("TURSO_DATABASE_URL").context("TURSO_DATABASE_URL not set")?;
    let turso_token = std::env::var("TURSO_AUTH_TOKEN").context("TURSO_AUTH_TOKEN not set")?;

    let amount_wei: u64 = std::env::var("E2E_AMOUNT_WEI")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_AMOUNT_WEI);

    let signer: PrivateKeySigner = pk_hex.parse().context("Invalid PRIVATE_KEY")?;
    let sender_addr = signer.address();

    detail("Sender address",     &format!("{sender_addr:?}"));
    detail("RPC",                &rpc_url);
    detail("Announcer",          &announcer_str);
    detail("Amount",             &format!("{amount_wei} wei"));
    detail("Turso DB",           &redact(&turso_url));
    ok("Configuration loaded");

    // ── [2/8] Generate recipient SPECTER wallet ───────────────────────────────
    step(2, 8, "Generating ephemeral recipient SPECTER wallet (ML-KEM-1024)");

    let recipient_wallet = SpecterWallet::generate().context("SpecterWallet::generate failed")?;
    let meta = recipient_wallet.meta_address();

    detail(
        "Viewing key (pub)",
        &format!("{}...{} ({} bytes)",
            hex::encode(&meta.viewing_pk.as_bytes()[..4]),
            hex::encode(&meta.viewing_pk.as_bytes()[meta.viewing_pk.as_bytes().len()-4..]),
            meta.viewing_pk.as_bytes().len()
        ),
    );
    ok("Recipient wallet generated");

    // ── [3/8] ML-KEM encapsulation → stealth address ─────────────────────────
    step(3, 8, "Deriving stealth address via ML-KEM encapsulation");

    // encapsulate(viewing_pk) → (KyberCiphertext, shared_secret: Vec<u8>)
    let (ciphertext, shared_secret) =
        encapsulate(&meta.viewing_pk).context("ML-KEM encapsulation failed")?;

    let view_tag = compute_view_tag(&shared_secret);

    // derive_stealth_address(spending_pk_bytes, shared_secret) → EthAddress
    let stealth_eth =
        derive_stealth_address(meta.spending_pk.as_bytes(), &shared_secret)
            .context("Stealth address derivation failed")?;

    let stealth_addr_hex = stealth_eth.to_checksum_string();

    // Save ephemeral key bytes before consuming ciphertext
    let ephemeral_key_vec: Vec<u8> = ciphertext.into_bytes();
    let ephemeral_key_arr: [u8; 1088] = ephemeral_key_vec
        .as_slice()
        .try_into()
        .map_err(|_| anyhow::anyhow!("ML-KEM ciphertext must be 1088 bytes (got {})", ephemeral_key_vec.len()))?;

    // Convert SPECTER EthAddress → alloy Address for on-chain calls
    let stealth_evm_addr: Address = Address::from_slice(stealth_eth.as_bytes());

    detail("View tag",         &format!("0x{view_tag:02x}"));
    detail("Stealth address",  &stealth_addr_hex);
    detail("Ephemeral key",    &format!("{} bytes (ML-KEM-1024 ciphertext)", ephemeral_key_vec.len()));
    ok("Stealth address derived");

    // ── [4/8] Send micro-payment on Monad testnet ─────────────────────────────
    step(4, 8, "Sending micro-payment on Monad testnet");

    let (send_tx_hash, monad_block) = if skip_chain {
        info("Simulated (E2E_SKIP_CHAIN=1) — using deterministic placeholder");
        (B256::from([0x42u8; 32]), 36_200_000u64)
    } else {
        let wallet = EthereumWallet::from(signer.clone());
        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(rpc_url.parse().context("Invalid MONAD_RPC_URL")?);

        let balance = provider
            .get_balance(sender_addr)
            .await
            .context("eth_getBalance failed — check RPC and network")?;

        let balance_mon = balance.to::<u128>() as f64 / 1e18;
        info(&format!("Sender balance: {} wei ({:.8} MON)", balance, balance_mon));

        // Minimum viable balance: 0.001 MON for gas + amount
        if balance < U256::from(1_000_000_000_000u64) {
            bail!(
                "Insufficient balance ({:.8} MON) in {sender_addr:?}.\n\
                 Fund with Monad testnet MON: https://faucet.monad.xyz",
                balance_mon
            );
        }

        let tx = TransactionRequest::default()
            .to(stealth_evm_addr)
            .value(U256::from(amount_wei));

        info(&format!("Sending {amount_wei} wei → {stealth_addr_hex}..."));
        let t = Instant::now();

        let pending = provider.send_transaction(tx).await
            .context("Failed to broadcast payment tx")?;

        let receipt = pending.get_receipt().await
            .context("Failed to get payment tx receipt")?;

        let tx_hash = receipt.transaction_hash;
        let block   = receipt.block_number.unwrap_or(0);

        detail("Payment tx hash",  &format!("{tx_hash:?}"));
        detail("Block number",     &block.to_string());
        detail("Confirmation",     &format!("{} ms", t.elapsed().as_millis()));
        ok("Micro-payment confirmed");

        (tx_hash, block)
    };

    // ── [5/8] Build 77-byte announcement metadata ─────────────────────────────
    step(5, 8, "Building 77-byte announcement metadata");

    // tx_hash → first 32 bytes of the payment tx hash
    let tx_hash_bytes: [u8; 32] = send_tx_hash.0;

    // amount as uint256 big-endian (right-aligned)
    let mut amount_bytes = [0u8; 32];
    amount_bytes[24..32].copy_from_slice(&amount_wei.to_be_bytes());

    let metadata = AnnouncementMetadata::new(view_tag)
        .with_tx_hash(tx_hash_bytes)
        .with_amount(amount_bytes)
        .with_source_chain_id(MONAD_CHAIN_ID) // funds came FROM Monad
        .encode();

    assert_eq!(metadata.len(), 77, "metadata must be exactly 77 bytes");

    detail("Byte [0]     view_tag",   &format!("0x{view_tag:02x}"));
    detail("Bytes [1..33] tx_hash",   &format!("0x{}...", hex::encode(&tx_hash_bytes[..4])));
    detail("Bytes [33..65] amount",   &format!("{amount_wei} wei"));
    detail("Bytes [65..73] chain_id", &format!("{MONAD_CHAIN_ID} (Monad testnet)"));
    detail("Bytes [73..77] reserved", "0x00000000");
    ok("77-byte metadata encoded");

    // ── [6/8] Publish to SPECTERAnnouncer on Monad ───────────────────────────
    step(6, 8, "Publishing announcement to SPECTERAnnouncer contract");

    let announcer_addr: Address = announcer_str.parse()
        .context("Invalid SPECTER_ANNOUNCER_ADDRESS")?;

    let announce_tx_hash = if skip_chain {
        info("Simulated (E2E_SKIP_CHAIN=1) — using placeholder announce tx hash");
        // Use a unique hash based on view_tag so repeated test runs don't clash
        let mut h = [0xABu8; 32];
        h[0] = view_tag;
        h[1..9].copy_from_slice(&monad_block.to_be_bytes());
        B256::from(h)
    } else {
        let t = Instant::now();

        let hash = publish_announcement(
            &rpc_url,
            signer,
            announcer_addr,
            stealth_evm_addr,
            &ephemeral_key_arr,
            &metadata,
        )
        .await
        .context("SPECTERAnnouncer.announce() failed")?;

        detail("Announce tx hash",  &format!("{hash:?}"));
        detail("Confirmation",      &format!("{} ms", t.elapsed().as_millis()));
        ok("Announcement published on-chain");
        hash
    };

    // ── [7/8] Store in Turso registry ─────────────────────────────────────────
    step(7, 8, "Storing announcement in Turso registry (on_chain=1)");

    let registry = TursoRegistry::new(&turso_url, &turso_token)
        .await
        .context("Turso connect failed — check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN")?;

    ok("Turso connected");

    // Build Announcement via the same decoder the Envio handler uses
    let mut announcement = announcement_from_event(
        ephemeral_key_vec.clone(),
        metadata.to_vec(),
        stealth_evm_addr,
        monad_block,
    )
    .context("announcement_from_event failed")?;

    // tx_hash = Monad announce tx hash (dedup key, always unique)
    // payment_tx_hash = source-chain payment tx hash (from metadata, for recipient)
    announcement.tx_hash = Some(format!("{announce_tx_hash:?}"));
    // payment_tx_hash is already populated by announcement_from_event from metadata bytes

    let ann_id = registry
        .insert_onchain_announcement(&announcement)
        .await
        .context("Turso insert failed")?;

    detail("Announcement ID",  &ann_id.to_string());
    detail("View tag stored",  &format!("0x{:02x}", announcement.view_tag));
    detail("Source chain",     &announcement.source_chain_id.map(|v| v.to_string()).unwrap_or_default());
    detail("on_chain flag",    "1");
    ok("Stored in Turso");

    // ── [8/8] Scan and verify ─────────────────────────────────────────────────
    step(8, 8, "Scanning by view_tag — verifying end-to-end");

    let t = Instant::now();
    let results = registry.get_by_view_tag(view_tag).await
        .context("get_by_view_tag failed")?;
    let scan_ms = t.elapsed().as_millis();

    info(&format!(
        "Scanned in {scan_ms} ms — {} announcement(s) with view_tag=0x{view_tag:02x}",
        results.len()
    ));

    let found = results.iter().find(|a| a.id == ann_id)
        .context("Our announcement was not found in scan results")?;

    let mut errs = 0usize;

    macro_rules! verify {
        ($label:expr, $expected:expr, $actual:expr) => {{
            let exp = $expected.to_string();
            let act = $actual.to_string();
            if act.contains(&exp) || act == exp {
                ok(&format!("{}: {}", $label, act));
            } else {
                fail_msg(&format!("{}: expected '{}', got '{}'", $label, exp, act));
                errs += 1;
            }
        }};
    }

    verify!("view_tag",        format!("0x{view_tag:02x}"),    format!("0x{:02x}", found.view_tag));
    verify!("source_chain_id", MONAD_CHAIN_ID.to_string(),    found.source_chain_id.map(|v| v.to_string()).unwrap_or_default());
    verify!("chain",           "monad-testnet",               found.chain.as_deref().unwrap_or("(none)"));

    if found.stealth_address.is_some() {
        ok(&format!("stealth_address:   {}", found.stealth_address.as_deref().unwrap_or("")));
    } else {
        fail_msg("stealth_address: missing");
        errs += 1;
    }
    if found.tx_hash.is_some() {
        ok(&format!("tx_hash (announce):  {}", found.tx_hash.as_deref().unwrap_or("")));
    } else {
        fail_msg("tx_hash (announce tx): missing");
        errs += 1;
    }
    if found.payment_tx_hash.is_some() {
        ok(&format!("payment_tx_hash:    {}", found.payment_tx_hash.as_deref().unwrap_or("")));
    } else {
        fail_msg("payment_tx_hash: missing — metadata tx_hash bytes were not decoded");
        errs += 1;
    }
    if found.amount.is_some() {
        ok(&format!("amount (raw hex):   {}", found.amount.as_deref().unwrap_or("")));
    } else {
        fail_msg("amount: missing");
        errs += 1;
    }

    // ── Report ────────────────────────────────────────────────────────────────
    let elapsed = total_start.elapsed();
    println!("\n{}", "━".repeat(56).cyan());

    if errs == 0 {
        println!(
            "\n  {} {}",
            "✅".green(),
            format!("PASSED in {:.1}s", elapsed.as_secs_f64()).green().bold()
        );
        println!("\n  {}", "Summary".bold());
        println!("  ├─ Sender:          {sender_addr:?}");
        println!("  ├─ Stealth address: {stealth_addr_hex}");
        println!("  ├─ View tag:        0x{view_tag:02x}");
        println!("  ├─ Payment tx:      {send_tx_hash:?}");
        println!("  ├─ Announce tx:     {announce_tx_hash:?}");
        println!("  ├─ Announcement ID: {ann_id}");
        println!("  └─ Monad block:     {monad_block}");
        println!("\n  {}", "Verify via API:".bold());
        println!("  GET /api/v1/registry/scan?view_tag=0x{view_tag:02x}");
        println!("  GET /api/v1/registry/announcements/{ann_id}");
        if skip_chain {
            println!(
                "\n  {} On-chain steps were simulated. Re-run without E2E_SKIP_CHAIN=1",
                "⚡".yellow()
            );
        }
    } else {
        println!(
            "\n  {} {errs} field error(s) — check Turso schema and API",
            "❌ FAILED:".red().bold()
        );
        std::process::exit(1);
    }

    println!();
    Ok(())
}
