//! Private settlement for Yellow channels.
//!
//! Handles the final settlement of channels where funds go to stealth addresses.

use tracing::{info, debug};

use specter_core::error::{Result, SpecterError};

use crate::types::{DiscoveredChannel, SettlementResult, Allocation};
use crate::client::YellowClient;

/// Private settlement handler.
///
/// Manages the settlement process for private channels where the
/// recipient is using a SPECTER stealth address.
pub struct PrivateSettlement {
    /// The discovered channel
    channel: DiscoveredChannel,
}

impl PrivateSettlement {
    /// Creates a new settlement handler for a discovered channel.
    pub fn new(channel: DiscoveredChannel) -> Self {
        Self { channel }
    }

    /// Initiates cooperative close of the channel.
    ///
    /// Both parties sign the final state and submit to L1.
    /// Funds are settled to the stealth address.
    pub async fn close(&self, client: &YellowClient) -> Result<SettlementResult> {
        info!(
            channel_id = %self.channel.channel_id,
            "Initiating private channel close"
        );

        // Use the Yellow client to close
        let result = client.close_channel(&self.channel.channel_id).await?;

        info!(
            tx_hash = %result.close_tx_hash,
            "Channel closed on-chain"
        );

        Ok(result)
    }

    /// Withdraws funds from the stealth address.
    ///
    /// After settlement, the funds are in the custody contract.
    /// This withdraws them to the stealth address, from which
    /// the recipient can then move them using the stealth private key.
    pub async fn withdraw(&self, client: &YellowClient, token: &str) -> Result<String> {
        info!(
            channel_id = %self.channel.channel_id,
            token,
            "Withdrawing settled funds"
        );

        // In production, would:
        // 1. Query custody contract for withdrawable balance
        // 2. Call withdrawal function with stealth address

        Ok("0x...withdrawal_tx".into())
    }

    /// Sweeps funds from stealth address to main wallet.
    ///
    /// Uses the derived stealth private key to transfer funds
    /// from the stealth address to the user's main address.
    pub async fn sweep_to_main_wallet(
        &self,
        main_address: &str,
        token: &str,
        amount: u64,
    ) -> Result<String> {
        info!(
            from = %self.channel.stealth_address,
            to = main_address,
            amount,
            "Sweeping funds to main wallet"
        );

        // Would:
        // 1. Create transfer transaction from stealth address
        // 2. Sign with stealth private key (self.channel.eth_private_key)
        // 3. Submit transaction

        debug!(
            private_key_available = !self.channel.eth_private_key.iter().all(|&b| b == 0),
            "Using stealth private key for signing"
        );

        Ok("0x...sweep_tx".into())
    }

    /// Returns the stealth private key for external use.
    ///
    /// This can be imported into a standard wallet to manage the stealth address.
    ///
    /// # Security Warning
    ///
    /// Handle this key with extreme care. It controls the funds at the stealth address.
    pub fn stealth_private_key(&self) -> &[u8; 32] {
        &self.channel.eth_private_key
    }

    /// Returns the stealth private key as hex string.
    pub fn stealth_private_key_hex(&self) -> String {
        hex::encode(&self.channel.eth_private_key)
    }
}

/// Batch settlement for multiple channels.
pub struct BatchSettlement {
    channels: Vec<DiscoveredChannel>,
}

impl BatchSettlement {
    /// Creates a new batch settlement.
    pub fn new(channels: Vec<DiscoveredChannel>) -> Self {
        Self { channels }
    }

    /// Closes all channels.
    pub async fn close_all(&self, client: &YellowClient) -> Result<Vec<SettlementResult>> {
        let mut results = Vec::new();

        for channel in &self.channels {
            let settlement = PrivateSettlement::new(channel.clone());
            match settlement.close(client).await {
                Ok(result) => results.push(result),
                Err(e) => {
                    tracing::error!(
                        channel_id = %channel.channel_id,
                        error = %e,
                        "Failed to close channel"
                    );
                }
            }
        }

        Ok(results)
    }

    /// Returns total number of channels.
    pub fn count(&self) -> usize {
        self.channels.len()
    }
}

/// Settlement statistics.
#[derive(Debug, Clone, Default)]
pub struct SettlementStats {
    /// Number of channels settled
    pub channels_settled: u64,
    /// Total value settled (in token units)
    pub total_value: u64,
    /// Number of failed settlements
    pub failures: u64,
    /// Settlement duration in milliseconds
    pub duration_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::types::EthAddress;

    fn make_test_channel() -> DiscoveredChannel {
        DiscoveredChannel {
            channel_id: "0x1234".into(),
            stealth_address: EthAddress::from_array([0x42; 20]),
            stealth_private_key: vec![0u8; 2400],
            eth_private_key: [0xAB; 32],
            channel_info: None,
            discovered_at: 12345,
        }
    }

    #[test]
    fn test_settlement_creation() {
        let channel = make_test_channel();
        let settlement = PrivateSettlement::new(channel);
        
        assert_eq!(settlement.stealth_private_key_hex().len(), 64);
    }

    #[test]
    fn test_batch_settlement() {
        let channels = vec![make_test_channel(), make_test_channel()];
        let batch = BatchSettlement::new(channels);
        
        assert_eq!(batch.count(), 2);
    }
}
