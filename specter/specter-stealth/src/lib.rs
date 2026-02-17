//! Stealth address creation and discovery (create_stealth_payment, scan_announcement, SpecterWallet).

#![forbid(unsafe_code)]
#![warn(missing_docs, rust_2018_idioms)]

pub mod discovery;
pub mod payment;
pub mod wallet;

pub use discovery::{scan_announcement, DiscoveredPayment, ScanResult, ScanStats};
pub use payment::{create_stealth_payment, StealthPayment};
pub use wallet::{SpecterWallet, WalletConfig};
