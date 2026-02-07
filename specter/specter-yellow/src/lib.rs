//! # SPECTER Yellow Network Integration
//!
//! This module enables **private state channel trading** by combining SPECTER's
//! post-quantum stealth addresses with Yellow Network's state channel infrastructure.
//!
//! ## The Problem
//!
//! Traditional state channels expose trading relationships on-chain:
//! - Alice opens channel with Bob → Everyone sees Alice ↔ Bob traded
//! - Trading patterns, volumes, and counterparties are all visible
//!
//! ## The Solution
//!
//! SPECTER + Yellow enables anonymous trading:
//! 1. Bob publishes SPECTER meta-address to ENS
//! 2. Alice creates stealth address for Bob
//! 3. Alice opens Yellow channel to Bob's stealth address
//! 4. Alice publishes SPECTER announcement with channel_id
//! 5. Bob scans announcements, discovers channel, derives stealth key
//! 6. Bob can now participate in the channel using his stealth key
//! 7. On settlement, funds go to stealth address (unlinkable to Bob)
//!
//! ## Example
//!
//! ```rust,ignore
//! use specter_yellow::{YellowClient, PrivateChannelBuilder};
//!
//! // Alice wants to trade with Bob privately
//! let alice_client = YellowClient::new(alice_config).await?;
//!
//! // Create private channel to Bob
//! let channel = PrivateChannelBuilder::new()
//!     .recipient_ens("bob.eth")
//!     .token("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238") // USDC
//!     .amount(1000)
//!     .build(&alice_client)
//!     .await?;
//!
//! // Alice publishes announcement so Bob can discover
//! channel.publish_announcement(&registry).await?;
//!
//! // --- Meanwhile, Bob scans for incoming channels ---
//! let bob_client = YellowClient::new(bob_config).await?;
//! let discovered = bob_client.discover_private_channels(&bob_wallet).await?;
//!
//! for channel in discovered {
//!     // Bob can now trade on this channel using his derived stealth key
//!     channel.accept().await?;
//! }
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs, rust_2018_idioms)]

pub mod client;
pub mod channel;
pub mod types;
pub mod discovery;
pub mod settlement;

pub use client::YellowClient;
pub use channel::{PrivateChannel, PrivateChannelBuilder};
pub use types::*;
pub use discovery::ChannelDiscovery;
pub use settlement::PrivateSettlement;
