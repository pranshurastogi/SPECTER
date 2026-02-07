//! # SPECTER × Yellow Network Integration Example
//!
//! This example demonstrates private trading using SPECTER stealth addresses
//! with Yellow Network state channels.
//!
//! ## Scenario
//!
//! Alice wants to trade with Bob privately. On-chain observers should not
//! be able to determine that Alice and Bob are trading partners.
//!
//! ## Run
//!
//! ```bash
//! cargo run --example yellow_private_trading
//! ```

use std::sync::Arc;

use specter_core::types::{MetaAddress, KyberPublicKey, Announcement};
use specter_core::traits::AnnouncementRegistry;
use specter_crypto::generate_keypair;
use specter_stealth::{SpecterWallet, create_stealth_payment};
use specter_registry::MemoryRegistry;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    println!("═══════════════════════════════════════════════════════════════════");
    println!("          SPECTER × Yellow Network: Private Trading Demo");
    println!("═══════════════════════════════════════════════════════════════════\n");

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: BOB SETS UP HIS SPECTER IDENTITY
    // ═══════════════════════════════════════════════════════════════════════════
    
    println!("📋 STEP 1: Bob creates his SPECTER identity\n");

    let bob_wallet = SpecterWallet::generate()?;
    let bob_meta = bob_wallet.meta_address();

    println!("   Bob's Meta-Address (published to ENS: bob.eth):");
    println!("   └─ Version:     {}", bob_meta.version);
    println!("   └─ Spending PK: {}...", &bob_meta.spending_pk.to_hex()[..32]);
    println!("   └─ Viewing PK:  {}...", &bob_meta.viewing_pk.to_hex()[..32]);
    println!();

    // In production: Bob uploads meta-address to IPFS and sets ENS text record
    // await ipfs.upload(bob_meta.to_bytes())
    // await ens.setText("bob.eth", "specter", "ipfs://Qm...")

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: ALICE WANTS TO OPEN A PRIVATE CHANNEL WITH BOB
    // ═══════════════════════════════════════════════════════════════════════════

    println!("📋 STEP 2: Alice creates a stealth payment for Bob\n");

    // Alice resolves bob.eth → gets meta-address (simulated here)
    println!("   Alice resolves bob.eth...");
    
    // Create stealth payment
    let payment = create_stealth_payment(bob_meta)?;

    println!("   ✅ Stealth payment created:");
    println!("   └─ Stealth Address:    {}", payment.stealth_address);
    println!("   └─ View Tag:           {}", payment.announcement.view_tag);
    println!("   └─ Ephemeral Key:      {}...", hex::encode(&payment.announcement.ephemeral_key[..16]));
    println!();

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: ALICE OPENS YELLOW CHANNEL TO STEALTH ADDRESS
    // ═══════════════════════════════════════════════════════════════════════════

    println!("📋 STEP 3: Alice opens Yellow channel to stealth address\n");

    // Simulate Yellow channel creation
    let channel_id = [0x42u8; 32]; // Would come from Yellow Network
    
    println!("   Alice connects to Yellow Network...");
    println!("   Alice calls create_channel with:");
    println!("   └─ Chain:       Sepolia (11155111)");
    println!("   └─ Token:       0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 (USDC)");
    println!("   └─ Participant: {} (Bob's stealth address)", payment.stealth_address);
    println!();
    
    println!("   ✅ Channel created: 0x{}", hex::encode(&channel_id));
    println!();

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: ALICE PUBLISHES SPECTER ANNOUNCEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    println!("📋 STEP 4: Alice publishes SPECTER announcement\n");

    // Create registry
    let registry = MemoryRegistry::new();

    // Create announcement with channel ID
    let announcement = Announcement::with_channel(
        payment.announcement.ephemeral_key.clone(),
        payment.announcement.view_tag,
        channel_id,
    );

    let ann_id = registry.publish(announcement).await?;

    println!("   ✅ Announcement published:");
    println!("   └─ ID:         {}", ann_id);
    println!("   └─ View Tag:   {}", payment.announcement.view_tag);
    println!("   └─ Channel ID: 0x{}", hex::encode(&channel_id));
    println!();
    println!("   📢 Bob can now discover this channel by scanning announcements");
    println!();

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 5: BOB SCANS AND DISCOVERS THE CHANNEL
    // ═══════════════════════════════════════════════════════════════════════════

    println!("📋 STEP 5: Bob scans announcements to discover channels\n");

    // Get all announcements
    let announcements = registry.all_announcements();
    println!("   Bob scans {} announcement(s)...", announcements.len());

    for ann in &announcements {
        // Check if this announcement has a channel ID
        if let Some(ch_id) = ann.channel_id {
            // Try to discover
            if let Some(keys) = bob_wallet.try_discover(&ann.ephemeral_key, ann.view_tag)? {
                println!();
                println!("   🎉 BOB DISCOVERED A PRIVATE CHANNEL!");
                println!("   └─ Channel ID:      0x{}", hex::encode(&ch_id));
                println!("   └─ Stealth Address: {}", keys.address);
                println!("   └─ Can derive private key: ✅");
                
                // Bob now has the stealth private key
                let eth_key = keys.private_key.to_eth_private_key();
                println!("   └─ ETH Private Key: 0x{}...", hex::encode(&eth_key[..8]));
                println!();
                
                // ═══════════════════════════════════════════════════════════════
                // STEP 6: BOB CAN NOW PARTICIPATE IN THE CHANNEL
                // ═══════════════════════════════════════════════════════════════
                
                println!("📋 STEP 6: Bob joins the Yellow channel\n");
                
                println!("   Bob imports stealth key into Yellow SDK...");
                println!("   Bob can now:");
                println!("   └─ ✅ Sign state updates with stealth key");
                println!("   └─ ✅ Trade with Alice off-chain");
                println!("   └─ ✅ Receive settlement at stealth address");
                println!();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRIVACY ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════════

    println!("═══════════════════════════════════════════════════════════════════");
    println!("                        PRIVACY ANALYSIS");
    println!("═══════════════════════════════════════════════════════════════════\n");

    println!("   WHAT AN ON-CHAIN OBSERVER SEES:");
    println!("   └─ Alice opened channel with: {}", payment.stealth_address);
    println!("   └─ Channel ID: 0x{}", hex::encode(&channel_id));
    println!();
    
    println!("   WHAT AN ON-CHAIN OBSERVER CANNOT DETERMINE:");
    println!("   └─ ❌ Cannot link {} to Bob", payment.stealth_address);
    println!("   └─ ❌ Cannot prove Alice and Bob are trading");
    println!("   └─ ❌ Cannot see trading patterns between them");
    println!();
    
    println!("   WHAT ONLY BOB KNOWS:");
    println!("   └─ ✅ The stealth address belongs to him");
    println!("   └─ ✅ The private key to spend from that address");
    println!("   └─ ✅ His trading relationship with Alice");
    println!();

    // ═══════════════════════════════════════════════════════════════════════════
    // POST-QUANTUM SECURITY
    // ═══════════════════════════════════════════════════════════════════════════

    println!("═══════════════════════════════════════════════════════════════════");
    println!("                    POST-QUANTUM SECURITY");
    println!("═══════════════════════════════════════════════════════════════════\n");

    println!("   SPECTER uses ML-KEM-768 (Kyber768):");
    println!("   └─ NIST FIPS 203 standardized");
    println!("   └─ ~192 bits classical security");
    println!("   └─ ~128 bits quantum security");
    println!();
    
    println!("   Even with a quantum computer:");
    println!("   └─ ✅ Stealth addresses remain unlinkable");
    println!("   └─ ✅ Past transactions stay private");
    println!("   └─ ✅ Bob's identity is protected");
    println!();

    println!("═══════════════════════════════════════════════════════════════════");
    println!("                          DEMO COMPLETE");
    println!("═══════════════════════════════════════════════════════════════════\n");

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPESCRIPT EQUIVALENT FOR FRONTEND
// ═══════════════════════════════════════════════════════════════════════════════

/*
// This is what the frontend TypeScript code would look like:

import { NitroliteClient, createECDSAMessageSigner } from '@erc7824/nitrolite';

// Alice wants to trade with Bob privately
async function createPrivateChannel(
  client: NitroliteClient,
  bobEnsName: string,
  token: string,
  amount: bigint
) {
  // 1. Resolve Bob's meta-address from ENS
  const response = await fetch(`/api/v1/ens/resolve/${bobEnsName}`);
  const { meta_address, spending_pk, viewing_pk } = await response.json();

  // 2. Create stealth payment
  const stealthResponse = await fetch('/api/v1/stealth/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meta_address }),
  });
  
  const {
    stealth_address,
    ephemeral_ciphertext,
    view_tag,
    announcement
  } = await stealthResponse.json();

  // 3. Open Yellow channel to stealth address
  const createChannelMsg = await createCreateChannelMessage(
    sessionSigner,
    {
      chain_id: 11155111,
      token: token,
      participant: stealth_address, // Bob's stealth address
    }
  );
  ws.send(createChannelMsg);

  // 4. Wait for channel creation, get channel_id
  const channelId = await waitForChannelCreation();

  // 5. Publish SPECTER announcement with channel_id
  await fetch('/api/v1/registry/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ephemeral_key: announcement.ephemeral_key,
      view_tag: announcement.view_tag,
      channel_id: channelId,
    }),
  });

  return { channelId, stealthAddress: stealth_address };
}

// Bob discovers private channels
async function discoverPrivateChannels(bobKeys: BobKeys) {
  // 1. Scan announcements
  const discoveries = await fetch('/api/v1/stealth/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      viewing_sk: bobKeys.viewing_sk,
      spending_pk: bobKeys.spending_pk,
      spending_sk: bobKeys.spending_sk,
    }),
  }).then(r => r.json());

  // 2. For each discovery with channel_id, import into Yellow
  for (const discovery of discoveries.discoveries) {
    if (discovery.channel_id) {
      // Import stealth key into Yellow SDK
      const stealthWallet = new Wallet(discovery.eth_private_key);
      
      // Now Bob can participate in the channel
      console.log(`Discovered channel ${discovery.channel_id}`);
      console.log(`Stealth address: ${discovery.stealth_address}`);
    }
  }

  return discoveries;
}
*/
