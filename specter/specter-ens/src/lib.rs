//! # SPECTER ENS Integration
//!
//! ENS name resolution and IPFS storage for SPECTER meta-addresses.
//!
//! ## Features
//!
//! - **ENS Resolution**: Resolve ENS names to meta-addresses
//! - **IPFS Upload**: Store meta-addresses on IPFS via Pinata
//! - **IPFS Download**: Retrieve meta-addresses from IPFS
//! - **Caching**: Local cache for frequently accessed data
//!
//! ## Example
//!
//! ```rust,ignore
//! use specter_ens::{EnsClient, IpfsClient};
//!
//! // Create clients
//! let ens = EnsClient::new("https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY");
//! let ipfs = IpfsClient::pinata("YOUR_API_KEY", "YOUR_SECRET");
//!
//! // Resolve ENS name to meta-address
//! let meta = ens.resolve("alice.eth").await?;
//!
//! // Upload meta-address to IPFS
//! let cid = ipfs.upload(&meta.to_bytes()).await?;
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs, rust_2018_idioms)]

mod ens;
mod ipfs;
mod cache;
mod resolver;

pub use ens::{EnsClient, EnsConfig};
pub use ipfs::{IpfsClient, IpfsConfig, PinataClient};
pub use cache::MetaAddressCache;
pub use resolver::{SpecterResolver, ResolverConfig};
