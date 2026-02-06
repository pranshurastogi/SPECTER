//! IPFS client for storing and retrieving SPECTER meta-addresses.
//!
//! Supports multiple IPFS gateways and Pinata v3 for pinning.

mod ipfs;

pub use ipfs::{IpfsClient, IpfsConfig, PinataClient};
