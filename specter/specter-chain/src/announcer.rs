//! Server-side announcement publishing.
//!
//! Used for sponsored announcements (server pays gas) or integration testing.

use alloy::{
    network::EthereumWallet,
    primitives::{Address, B256},
    signers::local::PrivateKeySigner,
};
use anyhow::Result;

use crate::contract::SPECTERAnnouncer;

/// Publishes an announcement transaction to the SPECTERAnnouncer contract.
///
/// Constructs and sends an `announce()` call from the provided signer,
/// waiting for on-chain confirmation before returning the transaction hash.
///
/// # Arguments
///
/// * `rpc_url` - Monad HTTP RPC endpoint
/// * `signer` - Local signer with funds for gas
/// * `announcer_addr` - SPECTERAnnouncer contract address
/// * `stealth_addr` - Recipient's stealth address
/// * `ephemeral_key` - ML-KEM ciphertext (must be exactly 1088 bytes)
/// * `metadata` - Metadata bytes emitted in the event: 77 bytes = plaintext
///   layout, 93 bytes = AES-256-GCM encrypted. Any non-empty slice is accepted.
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
///     "0x7a687B5a7c98c880f23F00003A820e7E2fF7fDaC".parse()?,
///     stealth_addr,
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
    metadata: &[u8],
) -> Result<B256> {
    let wallet = EthereumWallet::from(signer);
    // with_recommended_fillers adds nonce management, gas estimation, and chain-ID filling.
    // Without it alloy rejects the tx with "missing properties: nonce, max_fee_per_gas, …"
    let provider = alloy::providers::ProviderBuilder::new()
        .with_recommended_fillers()
        .wallet(wallet)
        .on_http(rpc_url.parse()?);
    let contract = SPECTERAnnouncer::new(announcer_addr, &provider);

    // 1088-byte ephemeral_key + metadata calldata ≈ 18 000 gas for data alone.
    // Add base tx (21 000) + event emission (~3 000) → 150 000 is safe.
    // alloy renames the overloaded `announce` functions: the 3-arg form
    // (address, bytes, bytes) is generated as `announce_0`; the 4-arg
    // schemeId overload is `announce_1`.
    let tx = contract
        .announce_0(
            stealth_addr,
            ephemeral_key.to_vec().into(),
            metadata.to_vec().into(),
        )
        .gas(150_000);

    let pending = tx
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("announce() send failed: {e}"))?;

    let receipt = pending
        .get_receipt()
        .await
        .map_err(|e| anyhow::anyhow!("waiting for receipt failed: {e}"))?;

    Ok(receipt.transaction_hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_publish_announcement_signature() {
        // Compile-time check that publish_announcement accepts the correct parameter types.
        // Runtime testing requires a live Monad RPC; that belongs in integration tests.
        fn _check(
            url: &str,
            signer: PrivateKeySigner,
            ann: Address,
            stealth: Address,
            ek: &[u8; 1088],
            meta: &[u8],
        ) {
            // Compile-time signature check only; the future is intentionally never awaited.
            let _fut = publish_announcement(url, signer, ann, stealth, ek, meta);
        }
    }
}
