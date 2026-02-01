//! SPECTER wallet implementation.
//!
//! The wallet manages key pairs and provides high-level operations
//! for receiving stealth payments.

use serde::{Deserialize, Serialize};
use zeroize::ZeroizeOnDrop;

use specter_core::error::{Result, SpecterError};
use specter_core::types::{KeyPair, MetaAddress, SpecterKeys, KyberPublicKey};
use specter_crypto::{generate_keypair, decapsulate, compute_view_tag};
use specter_crypto::derive::{derive_stealth_keys, StealthKeys};

/// Configuration for wallet creation.
#[derive(Clone, Debug, Default)]
pub struct WalletConfig {
    /// Optional description for the meta-address
    pub description: Option<String>,
    /// Optional avatar URL
    pub avatar: Option<String>,
}

/// A SPECTER wallet containing keys for receiving private payments.
///
/// The wallet holds:
/// - Spending keys: For deriving stealth private keys and spending funds
/// - Viewing keys: For scanning announcements (can be shared with auditors)
#[derive(ZeroizeOnDrop)]
pub struct SpecterWallet {
    /// The complete key set (spending + viewing)
    keys: SpecterKeys,
    /// Cached meta-address
    #[zeroize(skip)]
    meta_address: MetaAddress,
    /// Wallet configuration
    #[zeroize(skip)]
    config: WalletConfig,
}

impl SpecterWallet {
    /// Generates a new wallet with random keys.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// use specter_stealth::SpecterWallet;
    ///
    /// let wallet = SpecterWallet::generate()?;
    /// println!("Meta-address: {}", wallet.meta_address().to_hex());
    /// ```
    pub fn generate() -> Result<Self> {
        Self::generate_with_config(WalletConfig::default())
    }

    /// Generates a new wallet with custom configuration.
    pub fn generate_with_config(config: WalletConfig) -> Result<Self> {
        // Generate spending and viewing key pairs
        let spending = generate_keypair();
        let viewing = generate_keypair();

        let meta_address = MetaAddress::new(spending.public.clone(), viewing.public.clone());

        let keys = SpecterKeys::new(spending, viewing);

        Ok(Self {
            keys,
            meta_address,
            config,
        })
    }

    /// Creates a wallet from existing keys.
    ///
    /// # Arguments
    ///
    /// * `keys` - The complete SPECTER key set
    pub fn from_keys(keys: SpecterKeys) -> Result<Self> {
        let meta_address = MetaAddress::new(
            keys.spending.public.clone(),
            keys.viewing.public.clone(),
        );

        Ok(Self {
            keys,
            meta_address,
            config: WalletConfig::default(),
        })
    }

    /// Returns the meta-address for publishing.
    ///
    /// This is what recipients share so others can send them payments.
    pub fn meta_address(&self) -> &MetaAddress {
        &self.meta_address
    }

    /// Returns the spending public key.
    pub fn spending_public_key(&self) -> &KyberPublicKey {
        &self.keys.spending.public
    }

    /// Returns the viewing public key.
    pub fn viewing_public_key(&self) -> &KyberPublicKey {
        &self.keys.viewing.public
    }

    /// Computes the view tag for this wallet.
    ///
    /// This is used to filter announcements during scanning.
    /// Note: In SPECTER, the view tag depends on the shared secret,
    /// not just the viewing key. This method returns a "base" view tag
    /// computed from the viewing public key for informational purposes.
    pub fn base_view_tag(&self) -> u8 {
        // This is just for display - actual view tags are per-announcement
        compute_view_tag(self.keys.viewing.public.as_bytes())
    }

    /// Attempts to discover a payment from an announcement.
    ///
    /// # Arguments
    ///
    /// * `ephemeral_key` - The ciphertext from the announcement
    /// * `expected_view_tag` - The view tag from the announcement
    ///
    /// # Returns
    ///
    /// `Ok(Some(StealthKeys))` if this announcement is for us
    /// `Ok(None)` if the view tag doesn't match
    /// `Err(_)` if decapsulation fails
    pub fn try_discover(
        &self,
        ephemeral_key: &[u8],
        expected_view_tag: u8,
    ) -> Result<Option<StealthKeys>> {
        // Decapsulate to get shared secret
        let ciphertext = specter_crypto::KyberCiphertext::from_bytes(ephemeral_key)?;
        let shared_secret = decapsulate(&ciphertext, &self.keys.viewing.secret)?;

        // Check view tag
        let computed_tag = compute_view_tag(&shared_secret);
        if computed_tag != expected_view_tag {
            return Ok(None);
        }

        // View tag matches - derive stealth keys
        let stealth_keys = derive_stealth_keys(
            self.keys.spending.public.as_bytes(),
            self.keys.spending.secret.as_bytes(),
            &shared_secret,
        )?;

        Ok(Some(stealth_keys))
    }

    /// Exports the viewing key for third-party auditing.
    ///
    /// The viewing key allows scanning for payments but not spending them.
    /// This can be shared with tax authorities or auditors.
    pub fn export_viewing_key(&self) -> ViewingKeyExport {
        ViewingKeyExport {
            viewing_public_key: self.keys.viewing.public.to_hex(),
            spending_public_key: self.keys.spending.public.to_hex(),
            // Note: We don't export the viewing secret key here for safety
            // A full implementation would have a separate method for that
        }
    }
}

impl std::fmt::Debug for SpecterWallet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SpecterWallet")
            .field("meta_address", &self.meta_address)
            .field("config", &self.config)
            .field("keys", &"[REDACTED]")
            .finish()
    }
}

/// Exported viewing key information.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ViewingKeyExport {
    /// Viewing public key (hex)
    pub viewing_public_key: String,
    /// Spending public key (hex)  
    pub spending_public_key: String,
}

/// Serializable wallet backup (encrypted keys).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WalletBackup {
    /// Version for forward compatibility
    pub version: u8,
    /// Encrypted spending secret key
    pub spending_sk_encrypted: Vec<u8>,
    /// Encrypted viewing secret key
    pub viewing_sk_encrypted: Vec<u8>,
    /// Spending public key (not encrypted)
    pub spending_pk: String,
    /// Viewing public key (not encrypted)
    pub viewing_pk: String,
    /// Encryption nonce
    pub nonce: Vec<u8>,
    /// Salt for key derivation
    pub salt: Vec<u8>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use specter_crypto::encapsulate;

    #[test]
    fn test_wallet_generation() {
        let wallet = SpecterWallet::generate().unwrap();
        
        // Meta-address should be valid
        assert!(wallet.meta_address().validate().is_ok());
    }

    #[test]
    fn test_wallet_with_config() {
        let config = WalletConfig {
            description: Some("Test wallet".into()),
            avatar: Some("ipfs://test".into()),
        };
        
        let wallet = SpecterWallet::generate_with_config(config).unwrap();
        assert!(wallet.meta_address().validate().is_ok());
    }

    #[test]
    fn test_wallet_try_discover_match() {
        let wallet = SpecterWallet::generate().unwrap();
        
        // Simulate sender creating a payment (sender encapsulates to VIEWING key)
        let (ciphertext, shared_secret) = encapsulate(wallet.viewing_public_key()).unwrap();
        let view_tag = compute_view_tag(&shared_secret);
        
        // Wallet should discover this
        let result = wallet.try_discover(ciphertext.as_bytes(), view_tag).unwrap();
        assert!(result.is_some());
        
        let stealth_keys = result.unwrap();
        assert!(!stealth_keys.address.is_zero());
    }

    #[test]
    fn test_wallet_try_discover_wrong_tag() {
        let wallet = SpecterWallet::generate().unwrap();
        
        let (ciphertext, shared_secret) = encapsulate(wallet.viewing_public_key()).unwrap();
        let view_tag = compute_view_tag(&shared_secret);
        let wrong_tag = view_tag.wrapping_add(1);
        
        // Should return None for wrong view tag
        let result = wallet.try_discover(ciphertext.as_bytes(), wrong_tag).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_wallet_try_discover_wrong_key() {
        let wallet1 = SpecterWallet::generate().unwrap();
        let wallet2 = SpecterWallet::generate().unwrap();
        
        // Payment for wallet1 (encapsulate to wallet1's viewing key)
        let (ciphertext, shared_secret) = encapsulate(wallet1.viewing_public_key()).unwrap();
        let view_tag = compute_view_tag(&shared_secret);
        
        // Wallet2 tries to discover - should fail (different shared secret)
        let result = wallet2.try_discover(ciphertext.as_bytes(), view_tag).unwrap();
        // Note: This will return None because the view tag won't match
        // (decapsulation with wrong key produces random shared secret)
        assert!(result.is_none());
    }

    #[test]
    fn test_viewing_key_export() {
        let wallet = SpecterWallet::generate().unwrap();
        let export = wallet.export_viewing_key();
        
        assert!(!export.viewing_public_key.is_empty());
        assert!(!export.spending_public_key.is_empty());
    }
}
