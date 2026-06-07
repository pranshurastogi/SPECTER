//! Server-side announcement publishing.
//!
//! This module provides the ability to publish announcements directly to the
//! SPECTERAnnouncer contract. Used for sponsored announcements or testing.

use alloy::{
    network::EthereumWallet,
    primitives::{Address, B256},
    signers::local::PrivateKeySigner,
};
use anyhow::Result;

use crate::contract::SPECTERAnnouncer;

/// Publishes an announcement transaction to the SPECTERAnnouncer contract.
///
/// This function constructs and sends an `announce()` call from a signer,
/// waiting for the receipt before returning the transaction hash.
///
/// # Arguments
///
/// * `rpc_url` - HTTP RPC endpoint URL
/// * `signer` - Local signer with funds for gas
/// * `announcer_addr` - SPECTERAnnouncer contract address
/// * `stealth_addr` - Target stealth address
/// * `ephemeral_key` - Kyber ephemeral key (1088 bytes)
/// * `metadata` - Fixed 77-byte metadata layout
///
/// # Returns
///
/// Transaction hash (B256) on success, or error if the call fails.
///
/// # Example
///
/// ```ignore
/// let tx_hash = publish_announcement(
///     "https://testnet-rpc.monad.xyz",
///     signer,
///     "0xCc322132261cE3a1c9c85a6ef69779Ce2D61CA5a".parse()?,
///     "0x1234...".parse()?,
///     &ephemeral_key,
///     &metadata,
/// ).await?;
/// ```
pub async fn publish_announcement(
    rpc_url: &str,
    signer: PrivateKeySigner,
    announcer_addr: Address,
    stealth_addr: Address,
    ephemeral_key: &[u8; 1088],
    metadata: &[u8; 77],
) -> Result<B256> {
    let provider = alloy::providers::ProviderBuilder::new().on_http(rpc_url.parse()?);
    let _wallet = EthereumWallet::from(signer);
    let contract = SPECTERAnnouncer::new(announcer_addr, &provider);

    let tx = contract
        .announce(stealth_addr, ephemeral_key.to_vec().into(), metadata.to_vec().into())
        .gas(60_000);

    let pending = tx.send().await?;
    let receipt = pending.get_receipt().await?;

    Ok(receipt.transaction_hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_publish_announcement_exists() {
        // Verify that the publish_announcement function exists and is callable
        // Full testing would require mocking the RPC, which is complex with alloy
        // This is a compile-time check that the function signature is correct
        let _ = publish_announcement;
    }
}
