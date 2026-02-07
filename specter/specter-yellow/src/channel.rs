//! Private channel creation and management.

use specter_core::error::{Result, SpecterError};
use specter_core::traits::AnnouncementRegistry;
use specter_core::types::{Announcement, EthAddress, MetaAddress};
use specter_stealth::create_stealth_payment;

use crate::types::*;
use crate::client::YellowClient;

/// Builder for creating private Yellow channels.
///
/// # Example
///
/// ```rust,ignore
/// let channel = PrivateChannelBuilder::new()
///     .recipient_ens("bob.eth")
///     .token("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238")
///     .amount(1000)
///     .build(&client)
///     .await?;
/// ```
pub struct PrivateChannelBuilder {
    recipient: Option<String>,
    token: Option<String>,
    amount: Option<u64>,
    params: ChannelParams,
}

impl PrivateChannelBuilder {
    /// Creates a new builder.
    pub fn new() -> Self {
        Self {
            recipient: None,
            token: None,
            amount: None,
            params: ChannelParams::default(),
        }
    }

    /// Sets the recipient by ENS name.
    pub fn recipient_ens(mut self, name: impl Into<String>) -> Self {
        self.recipient = Some(name.into());
        self
    }

    /// Sets the recipient by meta-address hex.
    pub fn recipient_meta(mut self, meta_hex: impl Into<String>) -> Self {
        self.recipient = Some(meta_hex.into());
        self
    }

    /// Sets the token address.
    pub fn token(mut self, address: impl Into<String>) -> Self {
        self.token = Some(address.into());
        self
    }

    /// Sets the initial funding amount.
    pub fn amount(mut self, amount: u64) -> Self {
        self.amount = Some(amount);
        self
    }

    /// Sets custom challenge duration.
    pub fn challenge_duration(mut self, seconds: u64) -> Self {
        self.params.challenge_duration = Some(seconds);
        self
    }

    /// Sets custom metadata.
    pub fn metadata(mut self, data: impl Into<String>) -> Self {
        self.params.metadata = Some(data.into());
        self
    }

    /// Builds and creates the private channel.
    pub async fn build(self, client: &YellowClient) -> Result<PrivateChannel> {
        let recipient = self.recipient
            .ok_or_else(|| SpecterError::ValidationError("recipient is required".into()))?;

        let token = self.token
            .ok_or_else(|| SpecterError::ValidationError("token is required".into()))?;

        let amount = self.amount
            .ok_or_else(|| SpecterError::ValidationError("amount is required".into()))?;

        // Create the channel via Yellow client
        let result = client.create_private_channel(&recipient, &token, amount).await?;

        Ok(PrivateChannel {
            channel_id: result.channel_id,
            stealth_address: result.stealth_address,
            announcement: result.announcement,
            token,
            amount,
            status: ChannelStatus::Open,
        })
    }
}

impl Default for PrivateChannelBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// A private Yellow channel with SPECTER privacy.
#[derive(Debug)]
pub struct PrivateChannel {
    /// Channel ID
    pub channel_id: String,
    /// Recipient's stealth address
    pub stealth_address: EthAddress,
    /// SPECTER announcement data
    pub announcement: AnnouncementData,
    /// Token being traded
    pub token: String,
    /// Funded amount
    pub amount: u64,
    /// Current status
    pub status: ChannelStatus,
}

impl PrivateChannel {
    /// Returns the channel ID.
    pub fn id(&self) -> &str {
        &self.channel_id
    }

    /// Returns the stealth address.
    pub fn stealth_address(&self) -> &EthAddress {
        &self.stealth_address
    }

    /// Publishes the SPECTER announcement so recipient can discover the channel.
    ///
    /// This is critical - without publishing, the recipient won't know about the channel.
    pub async fn publish_announcement<R: AnnouncementRegistry>(
        &self,
        registry: &R,
    ) -> Result<u64> {
        let ephemeral_key = hex::decode(&self.announcement.ephemeral_key)
            .map_err(|e| SpecterError::HexError(e))?;

        let channel_id_bytes = hex::decode(&self.announcement.channel_id)
            .map_err(|e| SpecterError::HexError(e))?;

        let mut channel_id_arr = [0u8; 32];
        if channel_id_bytes.len() == 32 {
            channel_id_arr.copy_from_slice(&channel_id_bytes);
        }

        let announcement = Announcement::with_channel(
            ephemeral_key,
            self.announcement.view_tag,
            channel_id_arr,
        );

        let id = registry.publish(announcement).await?;
        Ok(id)
    }

    /// Creates the full announcement ready for the SPECTER registry.
    pub fn to_announcement(&self) -> Result<Announcement> {
        let ephemeral_key = hex::decode(&self.announcement.ephemeral_key)
            .map_err(|e| SpecterError::HexError(e))?;

        let channel_id_bytes = hex::decode(&self.announcement.channel_id)
            .map_err(|e| SpecterError::HexError(e))?;

        let mut channel_id_arr = [0u8; 32];
        if channel_id_bytes.len() == 32 {
            channel_id_arr.copy_from_slice(&channel_id_bytes);
        }

        Ok(Announcement::with_channel(
            ephemeral_key,
            self.announcement.view_tag,
            channel_id_arr,
        ))
    }
}

/// Helper to create a private channel with minimal configuration.
pub async fn create_private_channel(
    client: &YellowClient,
    recipient_ens: &str,
    token: &str,
    amount: u64,
) -> Result<PrivateChannel> {
    PrivateChannelBuilder::new()
        .recipient_ens(recipient_ens)
        .token(token)
        .amount(amount)
        .build(client)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builder_validation() {
        let builder = PrivateChannelBuilder::new()
            .token("0x123")
            .amount(100);
        // Missing recipient - would fail on build
        assert!(builder.recipient.is_none());
    }

    #[test]
    fn test_builder_complete() {
        let builder = PrivateChannelBuilder::new()
            .recipient_ens("alice.eth")
            .token("0x123")
            .amount(100)
            .challenge_duration(7200)
            .metadata("test");

        assert_eq!(builder.recipient, Some("alice.eth".into()));
        assert_eq!(builder.amount, Some(100));
        assert_eq!(builder.params.challenge_duration, Some(7200));
    }
}
