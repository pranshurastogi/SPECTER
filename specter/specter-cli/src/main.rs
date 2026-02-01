//! SPECTER CLI
//!
//! Command-line interface for the SPECTER post-quantum stealth address protocol.

use std::path::PathBuf;
use std::net::SocketAddr;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use colored::*;
use indicatif::{ProgressBar, ProgressStyle};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use specter_core::types::{MetaAddress, KyberPublicKey, Announcement};
use specter_core::traits::AnnouncementRegistry;
use specter_crypto::{generate_keypair, compute_view_tag};
use specter_stealth::create_stealth_payment;
use specter_registry::MemoryRegistry;
use specter_ens::{SpecterResolver, ResolverConfig};
use specter_api::{ApiServer, ApiConfig};

/// SPECTER - Post-Quantum Stealth Address Protocol
#[derive(Parser)]
#[command(name = "specter")]
#[command(author, version, about, long_about = None)]
struct Cli {
    /// Enable verbose logging
    #[arg(short, long, global = true)]
    verbose: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate new SPECTER keys
    Generate {
        /// Output file for keys (JSON)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },

    /// Resolve an ENS name to a meta-address
    Resolve {
        /// ENS name to resolve
        name: String,
        /// Ethereum RPC URL
        #[arg(long, env = "ETH_RPC_URL")]
        rpc_url: Option<String>,
    },

    /// Create a stealth payment address
    Create {
        /// Recipient's meta-address (hex) or ENS name
        recipient: String,
        /// Ethereum RPC URL (for ENS resolution)
        #[arg(long, env = "ETH_RPC_URL")]
        rpc_url: Option<String>,
    },

    /// Scan announcements for payments
    Scan {
        /// Path to keys file
        #[arg(short, long)]
        keys: PathBuf,
        /// Path to registry file (or use in-memory)
        #[arg(short, long)]
        registry: Option<PathBuf>,
    },

    /// Run the API server
    Serve {
        /// Port to listen on
        #[arg(short, long, default_value = "3001")]
        port: u16,
        /// Bind address
        #[arg(short, long, default_value = "0.0.0.0")]
        bind: String,
    },

    /// Run benchmarks
    Bench {
        /// Number of announcements to generate
        #[arg(short, long, default_value = "10000")]
        count: usize,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Initialize logging
    let filter = if cli.verbose {
        "specter=debug,info"
    } else {
        "specter=info,warn"
    };

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| filter.into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    match cli.command {
        Commands::Generate { output } => cmd_generate(output).await,
        Commands::Resolve { name, rpc_url } => cmd_resolve(&name, rpc_url).await,
        Commands::Create { recipient, rpc_url } => cmd_create(&recipient, rpc_url).await,
        Commands::Scan { keys, registry } => cmd_scan(&keys, registry.as_deref()).await,
        Commands::Serve { port, bind } => cmd_serve(port, &bind).await,
        Commands::Bench { count } => cmd_bench(count).await,
    }
}

/// Generate new SPECTER keys
async fn cmd_generate(output: Option<PathBuf>) -> Result<()> {
    println!("{}", "🔑 Generating SPECTER keys...".cyan().bold());

    let spending = generate_keypair();
    let viewing = generate_keypair();

    let meta = MetaAddress::new(
        KyberPublicKey::from_array(*spending.public.as_array()),
        KyberPublicKey::from_array(*viewing.public.as_array()),
    );

    let view_tag = compute_view_tag(viewing.public.as_bytes());

    let keys_json = serde_json::json!({
        "spending_pk": hex::encode(spending.public.as_bytes()),
        "spending_sk": hex::encode(spending.secret.as_bytes()),
        "viewing_pk": hex::encode(viewing.public.as_bytes()),
        "viewing_sk": hex::encode(viewing.secret.as_bytes()),
        "meta_address": meta.to_hex(),
        "view_tag": view_tag,
    });

    if let Some(path) = output {
        std::fs::write(&path, serde_json::to_string_pretty(&keys_json)?)?;
        println!("{} {}", "✅ Keys saved to:".green(), path.display());
    } else {
        println!("\n{}", "Keys (JSON):".yellow().bold());
        println!("{}", serde_json::to_string_pretty(&keys_json)?);
    }

    println!("\n{}", "⚠️  IMPORTANT: Keep your secret keys safe!".red().bold());
    println!("   spending_sk and viewing_sk must never be shared.");

    Ok(())
}

/// Resolve ENS name to meta-address
async fn cmd_resolve(name: &str, rpc_url: Option<String>) -> Result<()> {
    println!("{} {}", "🔍 Resolving:".cyan().bold(), name);

    let config = if let Some(url) = rpc_url {
        ResolverConfig::with_rpc(url)
    } else {
        ResolverConfig::default()
    };

    let resolver = SpecterResolver::with_config(config);

    let meta = resolver.resolve(name).await
        .context("Failed to resolve ENS name")?;

    println!("\n{}", "✅ Resolved meta-address:".green().bold());
    println!("   {} {}", "Version:".dimmed(), meta.version);
    println!("   {} {}...", "Spending PK:".dimmed(), &meta.spending_pk.to_hex()[..32]);
    println!("   {} {}...", "Viewing PK:".dimmed(), &meta.viewing_pk.to_hex()[..32]);
    println!("\n   {} {}", "Full hex:".dimmed(), &meta.to_hex()[..64]);

    Ok(())
}

/// Create stealth payment address
async fn cmd_create(recipient: &str, rpc_url: Option<String>) -> Result<()> {
    println!("{} {}", "💸 Creating stealth payment to:".cyan().bold(), recipient);

    let meta = if recipient.ends_with(".eth") {
        // Resolve ENS
        println!("   Resolving ENS name...");
        let config = if let Some(url) = rpc_url {
            ResolverConfig::with_rpc(url)
        } else {
            ResolverConfig::default()
        };
        let resolver = SpecterResolver::with_config(config);
        resolver.resolve(recipient).await
            .context("Failed to resolve ENS name")?
    } else {
        // Parse as hex
        MetaAddress::from_hex(recipient)
            .context("Invalid meta-address hex")?
    };

    let payment = create_stealth_payment(&meta)
        .context("Failed to create stealth payment")?;

    println!("\n{}", "✅ Stealth payment created:".green().bold());
    println!("   {} {}", "Address:".yellow(), payment.stealth_address.to_checksum_string());
    println!("   {} {}", "View tag:".dimmed(), payment.announcement.view_tag);
    println!("   {} {}...", "Ephemeral key:".dimmed(), hex::encode(&payment.announcement.ephemeral_key[..16]));

    println!("\n{}", "📋 Announcement (JSON):".yellow().bold());
    let ann_json = serde_json::json!({
        "ephemeral_key": hex::encode(&payment.announcement.ephemeral_key),
        "view_tag": payment.announcement.view_tag,
        "timestamp": payment.announcement.timestamp,
    });
    println!("{}", serde_json::to_string_pretty(&ann_json)?);

    println!("\n{}", "ℹ️  Next steps:".cyan());
    println!("   1. Send funds to the stealth address above");
    println!("   2. Publish the announcement to the registry");

    Ok(())
}

/// Scan for payments
async fn cmd_scan(keys_path: &PathBuf, registry_path: Option<&std::path::Path>) -> Result<()> {
    println!("{}", "🔎 Scanning for payments...".cyan().bold());

    // Load keys
    let keys_json: serde_json::Value = serde_json::from_reader(
        std::fs::File::open(keys_path).context("Failed to open keys file")?
    )?;

    let viewing_sk = hex::decode(
        keys_json["viewing_sk"].as_str().context("Missing viewing_sk")?
    )?;
    let spending_pk = hex::decode(
        keys_json["spending_pk"].as_str().context("Missing spending_pk")?
    )?;
    let spending_sk = hex::decode(
        keys_json["spending_sk"].as_str().context("Missing spending_sk")?
    )?;

    // Load announcements
    let announcements = if let Some(path) = registry_path {
        println!("   Loading registry from: {}", path.display());
        let registry = specter_registry::FileRegistry::new(path).await
            .context("Failed to load registry file")?;
        registry.memory().all_announcements()
    } else {
        println!("   Using empty in-memory registry (use --registry to load from file)");
        let registry = MemoryRegistry::new();
        registry.all_announcements()
    };

    let count = announcements.len() as u64;

    if count == 0 {
        println!("\n{}", "⚠️  Registry is empty. No announcements to scan.".yellow());
        return Ok(());
    }

    let pb = ProgressBar::new(count);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{bar:40.cyan/blue}] {pos}/{len} ({eta})")?
            .progress_chars("#>-"),
    );

    // Scan announcements
    let discoveries = specter_stealth::discovery::scan_announcements(
        &announcements,
        &viewing_sk,
        &spending_pk,
        &spending_sk,
    );

    pb.finish_with_message("done");

    if discoveries.is_empty() {
        println!("\n{}", "No payments found.".yellow());
    } else {
        println!("\n{} {} payment(s) found:", "✅".green(), discoveries.len());
        for (idx, keys) in &discoveries {
            println!("   {} {}", "Address:".green(), keys.address.to_checksum_string());
            println!("      Announcement #{}", idx); // Todo: Use actual ID if available
        }
    }

    Ok(())
}

/// Run API server
async fn cmd_serve(port: u16, bind: &str) -> Result<()> {
    println!("{}", "🚀 Starting SPECTER API server...".cyan().bold());
    println!("   {} http://{}:{}", "Listening on:".green(), bind, port);
    println!("   {} http://{}:{}/health", "Health check:".dimmed(), bind, port);
    println!("\n   Press Ctrl+C to stop.\n");

    let config = ApiConfig::from_env();
    let server = ApiServer::new(config);
    
    let addr: SocketAddr = format!("{}:{}", bind, port).parse()?;
    server.run(addr).await?;

    Ok(())
}

/// Run benchmarks
async fn cmd_bench(count: usize) -> Result<()> {
    println!("{} {} announcements", "📊 Benchmarking with".cyan().bold(), count);

    // Generate keys
    println!("\n{}", "1. Generating keys...".dimmed());
    let start = std::time::Instant::now();
    let spending = generate_keypair();
    let viewing = generate_keypair();
    println!("   ✓ Key generation: {:?}", start.elapsed());

    // Create announcements
    println!("\n{}", "2. Creating announcements...".dimmed());
    let registry = MemoryRegistry::new();
    let meta = MetaAddress::new(
        KyberPublicKey::from_array(*spending.public.as_array()),
        KyberPublicKey::from_array(*viewing.public.as_array()),
    );

    let pb = ProgressBar::new(count as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("   [{bar:40.cyan/blue}] {pos}/{len}")?
            .progress_chars("#>-"),
    );

    let start = std::time::Instant::now();
    for i in 0..count {
        // Mix of our payments and random ones
        if i % 100 == 0 {
            // Our payment
            let payment = create_stealth_payment(&meta)?;
            registry.publish(payment.announcement).await?;
        } else {
            // Random announcement
            let ann = Announcement::new(
                vec![((i as u8) + 1); specter_core::constants::KYBER_CIPHERTEXT_SIZE],
                (i % 256) as u8,
            );
            let _ = registry.publish(ann).await;
        }
        pb.inc(1);
    }
    pb.finish();
    let creation_time = start.elapsed();
    println!("   ✓ Created {} announcements: {:?}", count, creation_time);

    // Scan
    println!("\n{}", "3. Scanning...".dimmed());
    let start = std::time::Instant::now();
    let announcements = registry.all_announcements();
    let discoveries = specter_stealth::discovery::scan_announcements(
        &announcements,
        viewing.secret.as_bytes(),
        spending.public.as_bytes(),
        spending.secret.as_bytes(),
    );
    let scan_time = start.elapsed();

    let rate = count as f64 / scan_time.as_secs_f64();
    
    println!("   ✓ Scanned {} announcements: {:?}", count, scan_time);
    println!("   ✓ Found {} payments", discoveries.len());
    println!("\n{}", "📈 Results:".green().bold());
    println!("   Scan rate: {:.0} announcements/sec", rate);
    println!("   Time per announcement: {:.2}µs", scan_time.as_micros() as f64 / count as f64);

    let expected_discoveries = count / 100;
    if discoveries.len() == expected_discoveries {
        println!("   {} All expected payments found!", "✅".green());
    } else {
        println!("   {} Expected {}, found {}", "❌".red(), expected_discoveries, discoveries.len());
    }

    Ok(())
}
