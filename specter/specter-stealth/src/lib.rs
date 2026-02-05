//! Stealth address creation and discovery (create_stealth_payment, scan_announcement, SpecterWallet).

#![forbid(unsafe_code)]
#![warn(missing_docs, rust_2018_idioms)]

pub mod wallet;
pub mod payment;
pub mod discovery;

pub use wallet::{SpecterWallet, WalletConfig};
pub use payment::{create_stealth_payment, StealthPayment};
pub use discovery::{scan_announcement, ScanResult, DiscoveredPayment, ScanStats};

