//! Stealth payment creation (sender side).

use serde::{Deserialize, Serialize};

use specter_core::error::{Result, SpecterError};
use specter_core::types::{Announcement, EthAddress, MetaAddress, SuiAddress};
use specter_crypto::{compute_view_tag, decapsulate, encapsulate, KyberCiphertext};
use specter_crypto::derive::{
    derive_eth_address_from_seed, derive_stealth_address, derive_stealth_keys,
    derive_stealth_sui_address,
};

/// Stealth payment: address to send to and announcement to publish.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StealthPayment {
    /// The one-time Ethereum address to send funds to
    pub stealth_address: EthAddress,
    /// The one-time Sui address (same key)
    pub stealth_sui_address: SuiAddress,
    /// The announcement to publish (contains ephemeral key + view tag)
    pub announcement: Announcement,
    /// Metadata about the payment
    pub metadata: PaymentMetadata,
}

/// Metadata about a stealth payment.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PaymentMetadata {
    /// Recipient's ENS name (if resolved)
    pub recipient_ens: Option<String>,
    /// Payment amount (informational only)
    pub amount: Option<String>,
    /// Payment token (e.g., "ETH", "USDC")
    pub token: Option<String>,
    /// Optional memo (not stored on-chain)
    pub memo: Option<String>,
}

/// Creates a stealth payment: encapsulate to viewing key, derive stealth address, build announcement.
pub fn create_stealth_payment(meta_address: &MetaAddress) -> Result<StealthPayment> {
    meta_address.validate()?;

    let (ciphertext, shared_secret) = encapsulate(&meta_address.viewing_pk)?;
    let view_tag = compute_view_tag(&shared_secret);
    let stealth_address = derive_stealth_address(
        meta_address.spending_pk.as_bytes(),
        &shared_secret,
    )?;
    let stealth_sui_address = derive_stealth_sui_address(
        meta_address.spending_pk.as_bytes(),
        &shared_secret,
    )?;
    let announcement = Announcement::new(ciphertext.into_bytes(), view_tag);

    Ok(StealthPayment {
        stealth_address,
        stealth_sui_address,
        announcement,
        metadata: PaymentMetadata::default(),
    })
}

pub fn create_stealth_payment_with_metadata(
    meta_address: &MetaAddress,
    metadata: PaymentMetadata,
) -> Result<StealthPayment> {
    let mut payment = create_stealth_payment(meta_address)?;
    payment.metadata = metadata;
    Ok(payment)
}

#[derive(Default)]
pub struct StealthPaymentBuilder {
    meta_address: Option<MetaAddress>,
    recipient_ens: Option<String>,
    amount: Option<String>,
    token: Option<String>,
    memo: Option<String>,
    channel_id: Option<[u8; 32]>,
}

impl StealthPaymentBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn recipient(mut self, meta_address: MetaAddress) -> Self {
        self.meta_address = Some(meta_address);
        self
    }

    pub fn recipient_ens(mut self, name: impl Into<String>) -> Self {
        self.recipient_ens = Some(name.into());
        self
    }

    pub fn amount(mut self, amount: impl Into<String>) -> Self {
        self.amount = Some(amount.into());
        self
    }

    pub fn token(mut self, token: impl Into<String>) -> Self {
        self.token = Some(token.into());
        self
    }

    pub fn memo(mut self, memo: impl Into<String>) -> Self {
        self.memo = Some(memo.into());
        self
    }

    pub fn channel_id(mut self, id: [u8; 32]) -> Self {
        self.channel_id = Some(id);
        self
    }

    pub fn build(self) -> Result<StealthPayment> {
        let meta_address = self
            .meta_address
            .ok_or_else(|| SpecterError::ValidationError("recipient meta-address is required".into()))?;

        meta_address.validate()?;

        let (ciphertext, shared_secret) = encapsulate(&meta_address.viewing_pk)?;
        let view_tag = compute_view_tag(&shared_secret);
        let stealth_address = derive_stealth_address(
            meta_address.spending_pk.as_bytes(),
            &shared_secret,
        )?;
        let stealth_sui_address = derive_stealth_sui_address(
            meta_address.spending_pk.as_bytes(),
            &shared_secret,
        )?;
        let announcement = if let Some(channel_id) = self.channel_id {
            Announcement::with_channel(ciphertext.into_bytes(), view_tag, channel_id)
        } else {
            Announcement::new(ciphertext.into_bytes(), view_tag)
        };

        let metadata = PaymentMetadata {
            recipient_ens: self.recipient_ens,
            amount: self.amount,
            token: self.token,
            memo: self.memo,
        };

        Ok(StealthPayment {
            stealth_address,
            stealth_sui_address,
            announcement,
            metadata,
        })
    }
}

pub fn verify_payment(payment: &StealthPayment, meta_address: &MetaAddress) -> Result<bool> {
    payment.announcement.validate()?;
    if payment.announcement.ephemeral_key.len() != specter_core::constants::KYBER_CIPHERTEXT_SIZE {
        return Ok(false);
    }

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_core::types::KyberPublicKey;
    use specter_crypto::generate_keypair;

    fn create_test_meta_address() -> MetaAddress {
        let spending = generate_keypair();
        let viewing = generate_keypair();
        MetaAddress::new(spending.public.clone(), viewing.public.clone())
    }

    #[test]
    fn test_create_stealth_payment() {
        let meta = create_test_meta_address();
        let payment = create_stealth_payment(&meta).unwrap();

        // Stealth addresses should not be zero
        assert!(!payment.stealth_address.is_zero());
        assert!(!payment.stealth_sui_address.is_zero());

        // Announcement should be valid
        assert!(payment.announcement.validate().is_ok());

        // View tag should be set
        assert!(payment.announcement.view_tag <= 255);
    }

    #[test]
    fn test_create_stealth_payment_deterministic_address() {
        // Each call should produce a DIFFERENT address (due to random encapsulation)
        let meta = create_test_meta_address();

        let payment1 = create_stealth_payment(&meta).unwrap();
        let payment2 = create_stealth_payment(&meta).unwrap();

        assert_ne!(payment1.stealth_address, payment2.stealth_address);
        assert_ne!(payment1.announcement.ephemeral_key, payment2.announcement.ephemeral_key);
    }

    #[test]
    fn test_create_stealth_payment_with_metadata() {
        let meta = create_test_meta_address();
        let metadata = PaymentMetadata {
            recipient_ens: Some("alice.eth".into()),
            amount: Some("1.5".into()),
            token: Some("ETH".into()),
            memo: Some("Thanks!".into()),
        };

        let payment = create_stealth_payment_with_metadata(&meta, metadata).unwrap();

        assert_eq!(payment.metadata.recipient_ens, Some("alice.eth".into()));
        assert_eq!(payment.metadata.amount, Some("1.5".into()));
    }

    #[test]
    fn test_payment_builder() {
        let meta = create_test_meta_address();

        let payment = StealthPaymentBuilder::new()
            .recipient(meta)
            .recipient_ens("bob.eth")
            .amount("100")
            .token("USDC")
            .memo("Payment for services")
            .build()
            .unwrap();

        assert_eq!(payment.metadata.recipient_ens, Some("bob.eth".into()));
        assert_eq!(payment.metadata.token, Some("USDC".into()));
    }

    #[test]
    fn test_payment_builder_with_channel() {
        let meta = create_test_meta_address();
        let channel_id = [0xAB; 32];

        let payment = StealthPaymentBuilder::new()
            .recipient(meta)
            .channel_id(channel_id)
            .build()
            .unwrap();

        assert_eq!(payment.announcement.channel_id, Some(channel_id));
    }

    #[test]
    fn test_payment_builder_missing_recipient() {
        let result = StealthPaymentBuilder::new()
            .amount("1.0")
            .build();

        assert!(result.is_err());
    }

    #[test]
    fn test_verify_payment() {
        let meta = create_test_meta_address();
        let payment = create_stealth_payment(&meta).unwrap();

        assert!(verify_payment(&payment, &meta).unwrap());
    }

    /// Full round-trip: create payment then "scan" with same keys.
    /// Proves stealth_address matches the address derived from eth_private_key (wallet compatibility).
    #[test]
    fn test_stealth_address_matches_eth_private_key() {
        let spending = generate_keypair();
        let viewing = generate_keypair();
        let meta = MetaAddress::new(spending.public.clone(), viewing.public.clone());

        let payment = create_stealth_payment(&meta).unwrap();
        let ciphertext = KyberCiphertext::from_bytes(&payment.announcement.ephemeral_key).unwrap();
        let shared_secret = decapsulate(&ciphertext, &viewing.secret).unwrap();

        let keys = derive_stealth_keys(
            spending.public.as_bytes(),
            spending.secret.as_bytes(),
            &shared_secret,
        )
        .unwrap();

        assert_eq!(
            keys.address.as_bytes(),
            payment.stealth_address.as_bytes(),
            "scan-derived address must match create stealth_address"
        );

        let addr_from_pk = derive_eth_address_from_seed(&keys.private_key.to_eth_private_key()).unwrap();
        assert_eq!(
            keys.address.as_bytes(),
            addr_from_pk.as_bytes(),
            "eth_private_key must derive to stealth_address (MetaMask compatibility)"
        );
    }

    #[test]
    fn test_invalid_meta_address_rejected() {
        // Create invalid meta-address with zero keys
        let invalid_meta = MetaAddress::default();

        let result = create_stealth_payment(&invalid_meta);
        assert!(result.is_err());
    }

    #[test]
    fn test_payment_serialization() {
        let meta = create_test_meta_address();
        let payment = create_stealth_payment(&meta).unwrap();

        // Should serialize to JSON
        let json = serde_json::to_string(&payment).unwrap();
        assert!(!json.is_empty());

        // Should deserialize back
        let restored: StealthPayment = serde_json::from_str(&json).unwrap();
        assert_eq!(payment.stealth_address, restored.stealth_address);
        assert_eq!(payment.stealth_sui_address, restored.stealth_sui_address);
    }
}
