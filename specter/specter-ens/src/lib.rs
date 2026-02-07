//! # SPECTER ENS Integration
//!
//! ENS name resolution for SPECTER meta-addresses.
//! Uses specter-ipfs for IPFS storage/retrieval.

#![forbid(unsafe_code)]
#![warn(missing_docs, rust_2018_idioms)]

mod ens;
mod resolver;

pub use ens::{EnsClient, EnsConfig};
pub use specter_ipfs::{IpfsClient, IpfsConfig, PinataClient};
pub use resolver::{SpecterResolver, ResolverConfig, ResolveResult};
