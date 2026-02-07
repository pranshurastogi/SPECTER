//! Channel discovery for recipients.
//!
//! This module allows recipients to discover private channels opened to them.

use tracing::{debug, info};

use specter_core::error::{Result, SpecterError};
use specter_core::traits::AnnouncementRegistry;
use specter_core::types::Announcement;
use specter_stealth::SpecterWallet;
use specter_crypto::derive::StealthKeys;

use crate::types::{DiscoveredChannel, PrivateChannelInfo, ChannelStatus};

/// Channel discovery service.
///
/// Scans SPECTER announcements with channel IDs and attempts to
/// discover channels that belong to the given wallet.
pub struct ChannelDiscovery<'a> {
    wallet: &'a SpecterWallet,
}

impl<'a> ChannelDiscovery<'a> {
    /// Creates a new discovery service for the given wallet.
    pub fn new(wallet: &'a SpecterWallet) -> Self {
        Self { wallet }
    }

    /// Scans all announcements with channel IDs.
    pub async fn scan_all<R: AnnouncementRegistry>(
        &self,
        registry: &R,
    ) -> Result<Vec<DiscoveredChannel>> {
        let count = registry.count().await?;
        info!(total = count, "Starting channel discovery scan");

        let mut discovered = Vec::new();

        // In production, we'd filter by view tag first for efficiency
        // For now, iterate all and check channel_id presence
        
        // Get all announcements (would be optimized in production)
        for tag in 0..=255u8 {
            let announcements = registry.get_by_view_tag(tag).await?;
            
            for ann in announcements {
                if let Some(result) = self.try_discover_channel(&ann)? {
                    discovered.push(result);
                }
            }
        }

        info!(
            found = discovered.len(),
            "Channel discovery complete"
        );

        Ok(discovered)
    }

    /// Scans announcements within a time range.
    pub async fn scan_time_range<R: AnnouncementRegistry>(
        &self,
        registry: &R,
        from: u64,
        to: u64,
    ) -> Result<Vec<DiscoveredChannel>> {
        let announcements = registry.get_by_time_range(from, to).await?;
        
        let mut discovered = Vec::new();
        
        for ann in announcements {
            if let Some(result) = self.try_discover_channel(&ann)? {
                discovered.push(result);
            }
        }

        Ok(discovered)
    }

    /// Attempts to discover a single announcement.
    fn try_discover_channel(&self, ann: &Announcement) -> Result<Option<DiscoveredChannel>> {
        // Only process announcements with channel_id
        let channel_id = match ann.channel_id {
            Some(id) => id,
            None => return Ok(None),
        };

        // Try to discover using wallet
        let keys = match self.wallet.try_discover(&ann.ephemeral_key, ann.view_tag)? {
            Some(k) => k,
            None => return Ok(None),
        };

        debug!(
            channel_id = hex::encode(channel_id),
            stealth_address = %keys.address,
            "Discovered private channel"
        );

        Ok(Some(DiscoveredChannel {
            channel_id: hex::encode(channel_id),
            stealth_address: keys.address,
            stealth_private_key: keys.private_key.as_bytes().to_vec(),
            eth_private_key: keys.private_key.to_eth_private_key(),
            channel_info: None,
            discovered_at: ann.timestamp,
        }))
    }

    /// Checks if a specific announcement is for this wallet.
    pub fn is_for_me(&self, ann: &Announcement) -> Result<bool> {
        if ann.channel_id.is_none() {
            return Ok(false);
        }

        Ok(self.wallet.try_discover(&ann.ephemeral_key, ann.view_tag)?.is_some())
    }
}

/// Extension trait for discovered channels.
impl DiscoveredChannel {
    /// Checks if the channel is still active on Yellow Network.
    ///
    /// This would query the Yellow Node for channel status.
    pub async fn is_active(&self, _ws_url: &str) -> Result<bool> {
        // Would query Yellow Node
        // For now, assume active if recently discovered
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // Consider active if discovered within last hour
        Ok(now - self.discovered_at < 3600)
    }

    /// Accepts the channel and starts participating.
    ///
    /// This uses the derived stealth private key to sign channel states.
    pub async fn accept(&self) -> Result<()> {
        info!(
            channel_id = %self.channel_id,
            "Accepting private channel"
        );

        // Would:
        // 1. Connect to Yellow Node with stealth key
        // 2. Fetch current channel state
        // 3. Begin participating in state updates

        Ok(())
    }

    /// Exports credentials for use in external Yellow client.
    ///
    /// Returns the information needed to import this channel into
    /// the standard Yellow SDK.
    pub fn export_credentials(&self) -> ChannelCredentials {
        ChannelCredentials {
            channel_id: self.channel_id.clone(),
            stealth_address: self.stealth_address.to_checksum_string(),
            private_key: hex::encode(&self.eth_private_key),
        }
    }
}

/// Credentials for importing into Yellow SDK.
#[derive(Debug, Clone)]
pub struct ChannelCredentials {
    /// Channel ID (hex)
    pub channel_id: String,
    /// Stealth address (checksummed)
    pub stealth_address: String,
    /// Private key (hex, 32 bytes)
    pub private_key: String,
}

impl std::fmt::Display for ChannelCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Channel Credentials:")?;
        writeln!(f, "  Channel ID: {}", self.channel_id)?;
        writeln!(f, "  Address:    {}", self.stealth_address)?;
        writeln!(f, "  Private Key: {}...", &self.private_key[..16])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::constants::KYBER_CIPHERTEXT_SIZE;

    #[test]
    fn test_channel_credentials_display() {
        let creds = ChannelCredentials {
            channel_id: "0x1234".into(),
            stealth_address: "0xABCD".into(),
            private_key: "0123456789abcdef0123456789abcdef".repeat(2),
        };

        let display = format!("{}", creds);
        assert!(display.contains("Channel ID"));
        assert!(display.contains("0x1234"));
    }
}
