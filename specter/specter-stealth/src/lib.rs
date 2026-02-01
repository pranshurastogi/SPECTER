//! # SPECTER Stealth Address Protocol
//!
//! High-level API for creating and discovering stealth addresses.
//!
//! This crate provides:
//!
//! - **Key Generation**: Create SPECTER key pairs (spending + viewing)
//! - **Meta-Address Creation**: Build publishable meta-addresses
//! - **Stealth Address Creation**: Generate one-time addresses for payments
//! - **Payment Discovery**: Scan announcements to find incoming payments
//!
//! ## Quick Start
//!
//! ```rust,ignore
//! use specter_stealth::{SpecterWallet, create_stealth_payment};
//!
//! // Recipient: Generate keys and publish meta-address
//! let wallet = SpecterWallet::generate()?;
//! let meta_address = wallet.meta_address();
//! // ... publish meta_address to ENS
//!
//! // Sender: Create stealth payment
//! let payment = create_stealth_payment(&meta_address)?;
//! // Send funds to payment.stealth_address
//! // Publish payment.announcement to registry
//!
//! // Recipient: Discover payments
//! let discoveries = wallet.scan(&registry).await?;
//! for discovery in discoveries {
//!     println!("Found payment at: {}", discovery.address);
//! }
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs, rust_2018_idioms)]

pub mod wallet;
pub mod payment;
pub mod discovery;

pub use wallet::{SpecterWallet, WalletConfig};
pub use payment::{create_stealth_payment, StealthPayment};
pub use discovery::{scan_announcement, ScanResult, DiscoveredPayment, ScanStats};

