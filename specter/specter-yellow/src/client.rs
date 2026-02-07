//! Yellow Network client with SPECTER privacy integration.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures::stream::{SplitSink, SplitStream};
use futures::{SinkExt, StreamExt};
use parking_lot::RwLock;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use tracing::{debug, error, info, warn};

use specter_core::error::{Result, SpecterError};
use specter_core::types::MetaAddress;
use specter_ens::{SpecterResolver, ResolverConfig};
use specter_stealth::{create_stealth_payment, SpecterWallet};

use crate::types::*;

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;
type WsSink = SplitSink<WsStream, Message>;
type WsSource = SplitStream<WsStream>;

/// Yellow Network client with SPECTER privacy features.
pub struct YellowClient {
    config: YellowConfig,
    /// User's main wallet address
    wallet_address: String,
    /// User's main wallet private key (for EIP-712 signing)
    wallet_private_key: Vec<u8>,
    /// Current session key
    session: RwLock<Option<SessionKey>>,
    /// ENS resolver for meta-address lookup
    resolver: SpecterResolver,
    /// WebSocket connection state
    ws_connected: RwLock<bool>,
}

impl YellowClient {
    /// Creates a new Yellow client.
    ///
    /// # Arguments
    ///
    /// * `config` - Yellow Network configuration
    /// * `wallet_address` - User's Ethereum address
    /// * `wallet_private_key` - User's private key (for signing)
    pub fn new(
        config: YellowConfig,
        wallet_address: impl Into<String>,
        wallet_private_key: Vec<u8>,
    ) -> Self {
        let resolver = SpecterResolver::with_config(ResolverConfig::new(&config.rpc_url, "", ""));

        Self {
            config,
            wallet_address: wallet_address.into(),
            wallet_private_key,
            session: RwLock::new(None),
            resolver,
            ws_connected: RwLock::new(false),
        }
    }

    /// Returns the wallet address.
    pub fn wallet_address(&self) -> &str {
        &self.wallet_address
    }

    /// Checks if authenticated.
    pub fn is_authenticated(&self) -> bool {
        if let Some(session) = self.session.read().as_ref() {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs();
            session.expires_at > now
        } else {
            false
        }
    }

    /// Authenticates with Yellow Network.
    ///
    /// This performs the full authentication flow:
    /// 1. Generate session keypair
    /// 2. Send auth_request
    /// 3. Receive auth_challenge
    /// 4. Sign challenge with main wallet (EIP-712)
    /// 5. Send auth_verify
    /// 6. Receive confirmation
    pub async fn authenticate(&self) -> Result<()> {
        info!("Authenticating with Yellow Network...");

        // Generate session keypair
        let session_private_key = self.generate_session_key();
        let session_address = self.derive_address(&session_private_key);

        let expires_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 3600; // 1 hour

        let allowances = vec![Allowance {
            asset: "ytest.usd".into(),
            amount: "1000000000".into(),
        }];

        // Connect to WebSocket
        let (ws_stream, _) = connect_async(&self.config.ws_url)
            .await
            .map_err(|e| SpecterError::ConnectionTimeout(e.to_string()))?;

        let (mut sink, mut stream) = ws_stream.split();
        *self.ws_connected.write() = true;

        // Build auth request
        let auth_request = rpc::AuthRequest {
            address: self.wallet_address.clone(),
            application: "SPECTER".into(),
            session_key: session_address.clone(),
            allowances: allowances.clone(),
            expires_at,
            scope: "specter.private_trading".into(),
        };

        // Send auth request
        let msg = self.build_rpc_message("auth_request", &auth_request)?;
        sink.send(Message::Text(msg))
            .await
            .map_err(|e| SpecterError::HttpError(e.to_string()))?;

        // Handle response
        while let Some(msg) = stream.next().await {
            let msg = msg.map_err(|e| SpecterError::HttpError(e.to_string()))?;

            if let Message::Text(text) = msg {
                let response: serde_json::Value = serde_json::from_str(&text)?;

                if let Some(res) = response.get("res") {
                    let method = res.get(1).and_then(|v| v.as_str()).unwrap_or("");

                    match method {
                        "auth_challenge" => {
                            // Sign challenge with main wallet
                            let challenge = res
                                .get(2)
                                .and_then(|v| v.get("challenge_message"))
                                .and_then(|v| v.as_str())
                                .ok_or_else(|| {
                                    SpecterError::YellowError("Missing challenge".into())
                                })?;

                            let signature = self.sign_eip712_challenge(challenge)?;

                            // Send auth_verify
                            let verify_msg = serde_json::json!({
                                "req": [
                                    uuid::Uuid::new_v4().to_string(),
                                    "auth_verify",
                                    {
                                        "challenge": challenge,
                                        "signature": signature
                                    }
                                ]
                            });

                            sink.send(Message::Text(verify_msg.to_string()))
                                .await
                                .map_err(|e| SpecterError::HttpError(e.to_string()))?;
                        }
                        "auth_verify" => {
                            // Authentication successful
                            info!("Authenticated successfully");

                            *self.session.write() = Some(SessionKey {
                                address: session_address.clone(),
                                private_key: session_private_key.clone(),
                                expires_at,
                                allowances,
                            });

                            return Ok(());
                        }
                        _ => {}
                    }
                }

                if response.get("error").is_some() {
                    let error_msg = response
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                        .unwrap_or("Unknown error");

                    return Err(SpecterError::YellowError(error_msg.into()));
                }
            }
        }

        Err(SpecterError::YellowError(
            "WebSocket closed before authentication".into(),
        ))
    }

    /// Creates a private channel to a recipient.
    ///
    /// # Arguments
    ///
    /// * `recipient` - ENS name (e.g., "bob.eth") or meta-address hex
    /// * `token` - Token address to trade
    /// * `amount` - Initial funding amount
    pub async fn create_private_channel(
        &self,
        recipient: &str,
        token: &str,
        amount: u64,
    ) -> Result<CreateChannelResult> {
        // Ensure authenticated
        if !self.is_authenticated() {
            self.authenticate().await?;
        }

        info!(recipient, token, amount, "Creating private channel");

        // Resolve meta-address
        let meta_address = if recipient.ends_with(".eth") {
            self.resolver.resolve(recipient).await?
        } else {
            MetaAddress::from_hex(recipient)?
        };

        // Create stealth payment (generates stealth address + announcement)
        let payment = create_stealth_payment(&meta_address)?;

        let stealth_address = payment.stealth_address;
        let ephemeral_ciphertext = payment.announcement.ephemeral_key.clone();
        let view_tag = payment.announcement.view_tag;

        debug!(
            stealth_address = %stealth_address,
            view_tag,
            "Generated stealth address for recipient"
        );

        // Connect to WebSocket for channel operations
        let (ws_stream, _) = connect_async(&self.config.ws_url)
            .await
            .map_err(|e| SpecterError::ConnectionTimeout(e.to_string()))?;

        let (mut sink, mut stream) = ws_stream.split();

        // Re-authenticate on this connection
        // (In production, you'd manage a persistent connection)
        self.authenticate_on_connection(&mut sink, &mut stream)
            .await?;

        // Create channel request with stealth address as participant
        let session = self.session.read();
        let session = session
            .as_ref()
            .ok_or_else(|| SpecterError::YellowError("Not authenticated".into()))?;

        let create_request = rpc::CreateChannelRequest {
            chain_id: self.config.chain_id,
            token: token.into(),
            participant: Some(stealth_address.to_checksum_string()),
        };

        let msg = self.build_signed_rpc_message("create_channel", &create_request, session)?;

        sink.send(Message::Text(msg))
            .await
            .map_err(|e| SpecterError::HttpError(e.to_string()))?;

        // Wait for channel creation response
        let channel_id = self.wait_for_channel_creation(&mut stream).await?;

        // Fund the channel
        self.fund_channel(&mut sink, &mut stream, &channel_id, amount)
            .await?;

        // Build result
        let announcement = AnnouncementData {
            ephemeral_key: hex::encode(&ephemeral_ciphertext),
            view_tag,
            channel_id: channel_id.clone(),
        };

        Ok(CreateChannelResult {
            channel_id,
            stealth_address,
            announcement,
            tx_hash: "pending".into(), // Would be set after on-chain confirmation
        })
    }

    /// Discovers private channels for a wallet.
    ///
    /// Scans SPECTER announcements and matches them against Yellow channels.
    pub async fn discover_private_channels(
        &self,
        wallet: &SpecterWallet,
        registry: &specter_registry::MemoryRegistry,
    ) -> Result<Vec<DiscoveredChannel>> {
        use specter_core::traits::AnnouncementRegistry;

        info!("Scanning for private channels...");

        let mut discovered = Vec::new();

        // Get all announcements (in production, would filter more efficiently)
        let announcements = registry.all_announcements();

        for ann in announcements {
            // Only process announcements with channel_id
            if ann.channel_id.is_none() {
                continue;
            }

            // Try to discover this announcement
            if let Some(keys) = wallet.try_discover(&ann.ephemeral_key, ann.view_tag)? {
                let channel_id = hex::encode(ann.channel_id.unwrap());

                info!(
                    channel_id,
                    address = %keys.address,
                    "Discovered private channel"
                );

                discovered.push(DiscoveredChannel {
                    channel_id,
                    stealth_address: keys.address,
                    stealth_private_key: keys.private_key.as_bytes().to_vec(),
                    eth_private_key: keys.private_key.to_eth_private_key(),
                    channel_info: None, // Would fetch from Yellow Node
                    discovered_at: ann.timestamp,
                });
            }
        }

        info!(count = discovered.len(), "Discovery complete");
        Ok(discovered)
    }

    /// Closes a channel and settles on-chain.
    pub async fn close_channel(&self, channel_id: &str) -> Result<SettlementResult> {
        if !self.is_authenticated() {
            self.authenticate().await?;
        }

        info!(channel_id, "Closing channel");

        let (ws_stream, _) = connect_async(&self.config.ws_url)
            .await
            .map_err(|e| SpecterError::ConnectionTimeout(e.to_string()))?;

        let (mut sink, mut stream) = ws_stream.split();

        self.authenticate_on_connection(&mut sink, &mut stream)
            .await?;

        let session = self.session.read();
        let session = session
            .as_ref()
            .ok_or_else(|| SpecterError::YellowError("Not authenticated".into()))?;

        let close_request = rpc::CloseChannelRequest {
            channel_id: channel_id.into(),
            funds_destination: self.wallet_address.clone(),
        };

        let msg = self.build_signed_rpc_message("close_channel", &close_request, session)?;

        sink.send(Message::Text(msg))
            .await
            .map_err(|e| SpecterError::HttpError(e.to_string()))?;

        // Wait for close confirmation
        let result = self.wait_for_close(&mut stream, channel_id).await?;

        info!(channel_id, "Channel closed successfully");
        Ok(result)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER METHODS
    // ═══════════════════════════════════════════════════════════════════════════

    fn generate_session_key(&self) -> Vec<u8> {
        use rand::RngCore;
        let mut key = vec![0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        key
    }

    fn derive_address(&self, private_key: &[u8]) -> String {
        // Simplified - in production use proper secp256k1 derivation
        use specter_crypto::hash::keccak256;
        let hash = keccak256(private_key);
        format!("0x{}", hex::encode(&hash[12..32]))
    }

    fn sign_eip712_challenge(&self, _challenge: &str) -> Result<String> {
        // Simplified - in production use proper EIP-712 signing
        // This would sign with the main wallet private key
        Ok("0x".to_string() + &hex::encode(vec![0u8; 65]))
    }

    fn build_rpc_message<T: serde::Serialize>(&self, method: &str, params: &T) -> Result<String> {
        let msg = serde_json::json!({
            "req": [
                uuid::Uuid::new_v4().to_string(),
                method,
                params
            ]
        });
        Ok(msg.to_string())
    }

    fn build_signed_rpc_message<T: serde::Serialize>(
        &self,
        method: &str,
        params: &T,
        _session: &SessionKey,
    ) -> Result<String> {
        // In production, this would sign with the session key
        self.build_rpc_message(method, params)
    }

    async fn authenticate_on_connection(
        &self,
        _sink: &mut WsSink,
        _stream: &mut WsSource,
    ) -> Result<()> {
        // Simplified - would re-run auth flow
        Ok(())
    }

    async fn wait_for_channel_creation(&self, stream: &mut WsSource) -> Result<String> {
        while let Some(msg) = stream.next().await {
            let msg = msg.map_err(|e| SpecterError::HttpError(e.to_string()))?;

            if let Message::Text(text) = msg {
                let response: serde_json::Value = serde_json::from_str(&text)?;

                if let Some(res) = response.get("res") {
                    let method = res.get(1).and_then(|v| v.as_str()).unwrap_or("");

                    if method == "create_channel" {
                        let channel_id = res
                            .get(2)
                            .and_then(|v| v.get("channel_id"))
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| {
                                SpecterError::YellowError("Missing channel_id".into())
                            })?;

                        return Ok(channel_id.into());
                    }
                }
            }
        }

        Err(SpecterError::YellowError("Channel creation failed".into()))
    }

    async fn fund_channel(
        &self,
        sink: &mut WsSink,
        stream: &mut WsSource,
        channel_id: &str,
        amount: u64,
    ) -> Result<()> {
        let session = self.session.read();
        let session = session
            .as_ref()
            .ok_or_else(|| SpecterError::YellowError("Not authenticated".into()))?;

        let resize_request = rpc::ResizeChannelRequest {
            channel_id: channel_id.into(),
            allocate_amount: amount,
            funds_destination: self.wallet_address.clone(),
        };

        let msg = self.build_signed_rpc_message("resize_channel", &resize_request, session)?;

        sink.send(Message::Text(msg))
            .await
            .map_err(|e| SpecterError::HttpError(e.to_string()))?;

        // Wait for resize confirmation
        while let Some(msg) = stream.next().await {
            let msg = msg.map_err(|e| SpecterError::HttpError(e.to_string()))?;

            if let Message::Text(text) = msg {
                let response: serde_json::Value = serde_json::from_str(&text)?;

                if let Some(res) = response.get("res") {
                    let method = res.get(1).and_then(|v| v.as_str()).unwrap_or("");

                    if method == "resize_channel" {
                        return Ok(());
                    }
                }
            }
        }

        Err(SpecterError::YellowError("Channel funding failed".into()))
    }

    async fn wait_for_close(
        &self,
        stream: &mut WsSource,
        channel_id: &str,
    ) -> Result<SettlementResult> {
        while let Some(msg) = stream.next().await {
            let msg = msg.map_err(|e| SpecterError::HttpError(e.to_string()))?;

            if let Message::Text(text) = msg {
                let response: serde_json::Value = serde_json::from_str(&text)?;

                if let Some(res) = response.get("res") {
                    let method = res.get(1).and_then(|v| v.as_str()).unwrap_or("");

                    if method == "close_channel" {
                        return Ok(SettlementResult {
                            channel_id: channel_id.into(),
                            final_balances: vec![],
                            close_tx_hash: "0x...".into(),
                            withdrawal_tx_hash: None,
                        });
                    }
                }
            }
        }

        Err(SpecterError::YellowError("Channel close failed".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_default() {
        let config = YellowConfig::default();
        assert!(config.ws_url.contains("sandbox"));
        assert_eq!(config.chain_id, 11155111);
    }

    #[test]
    fn test_client_creation() {
        let config = YellowConfig::default();
        let client = YellowClient::new(config, "0x1234", vec![0u8; 32]);

        assert_eq!(client.wallet_address(), "0x1234");
        assert!(!client.is_authenticated());
    }
}
