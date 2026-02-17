//! # SPECTER SuiNS Integration
//!
//! SuiNS name resolution for SPECTER meta-addresses.
//! Uses specter-ipfs for IPFS storage/retrieval.

#![forbid(unsafe_code)]
#![warn(missing_docs, rust_2018_idioms)]

mod resolver;
mod suins;

pub use resolver::{SuinsResolveResult, SuinsResolver, SuinsResolverConfig};
pub use specter_ipfs::{IpfsClient, IpfsConfig, PinataClient};
pub use suins::{SuinsClient, SuinsConfig};
