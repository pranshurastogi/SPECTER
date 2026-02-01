//! Stealth key and address derivation.
//!
//! This module implements the core cryptographic operations for deriving
//! stealth public/private keys and Ethereum addresses.
//!
//! ## Derivation Flow
//!
//! ```text
//! shared_secret
//!       ↓
//! SHAKE256(DOMAIN_STEALTH_PK || shared_secret) → stealth_factor (1184 bytes)
//!       ↓
//! stealth_pk = spending_pk ⊕ stealth_factor
//!       ↓
//! eth_address = keccak256(stealth_pk)[12..32]
//! ```
//!
//! ## Private Key Derivation
//!
//! The recipient can derive the stealth private key:
//!
//! ```text
//! stealth_sk = spending_sk ⊕ stealth_factor
//! ```

use zeroize::Zeroize;

use specter_core::constants::{
    DOMAIN_STEALTH_PK, DOMAIN_STEALTH_SK, ETH_ADDRESS_SIZE, KYBER_PUBLIC_KEY_SIZE,
    KYBER_SECRET_KEY_SIZE,
};
use specter_core::error::{Result, SpecterError};
use specter_core::types::EthAddress;

use crate::hash::{keccak256, shake256};

/// Result of stealth key derivation.
#[derive(Debug)]
pub struct StealthKeys {
    /// The stealth public key (1184 bytes)
    pub public_key: Vec<u8>,
    /// The stealth private key (2400 bytes, zeroized on drop)
    pub private_key: StealthPrivateKey,
    /// The derived Ethereum address
    pub address: EthAddress,
}

/// Wrapper for stealth private key with automatic zeroization.
pub struct StealthPrivateKey {
    bytes: Vec<u8>,
}

impl StealthPrivateKey {
    /// Creates from raw bytes.
    pub fn from_bytes(bytes: Vec<u8>) -> Self {
        Self { bytes }
    }

    /// Returns the raw bytes.
    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Extracts the 32-byte seed for Ethereum signing.
    ///
    /// For Ethereum compatibility, we derive a 32-byte private key
    /// from the Kyber secret key material.
    pub fn to_eth_private_key(&self) -> [u8; 32] {
        // Use first 32 bytes of stealth SK as Ethereum private key
        // In production, this should use proper key derivation
        let mut eth_sk = [0u8; 32];
        eth_sk.copy_from_slice(&self.bytes[..32]);
        eth_sk
    }
}

impl Drop for StealthPrivateKey {
    fn drop(&mut self) {
        self.bytes.zeroize();
    }
}

impl std::fmt::Debug for StealthPrivateKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "StealthPrivateKey([REDACTED])")
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEALTH PUBLIC KEY DERIVATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Derives a stealth public key from the spending public key and shared secret.
///
/// # Algorithm
///
/// ```text
/// stealth_factor = SHAKE256(DOMAIN_STEALTH_PK || shared_secret, 1184)
/// stealth_pk = spending_pk ⊕ stealth_factor
/// ```
///
/// # Arguments
///
/// * `spending_pk` - The recipient's spending public key (1184 bytes)
/// * `shared_secret` - The shared secret from Kyber encapsulation
///
/// # Returns
///
/// The stealth public key (1184 bytes)
pub fn derive_stealth_public_key(spending_pk: &[u8], shared_secret: &[u8]) -> Result<Vec<u8>> {
    if spending_pk.len() != KYBER_PUBLIC_KEY_SIZE {
        return Err(SpecterError::InvalidKeySize {
            expected: KYBER_PUBLIC_KEY_SIZE,
            actual: spending_pk.len(),
        });
    }

    // Derive stealth factor
    let stealth_factor = shake256(DOMAIN_STEALTH_PK, shared_secret, KYBER_PUBLIC_KEY_SIZE);

    // XOR with spending public key
    let stealth_pk: Vec<u8> = spending_pk
        .iter()
        .zip(stealth_factor.iter())
        .map(|(a, b)| a ^ b)
        .collect();

    Ok(stealth_pk)
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEALTH PRIVATE KEY DERIVATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Derives a stealth private key from the spending secret key and shared secret.
///
/// # Algorithm
///
/// ```text
/// stealth_factor = SHAKE256(DOMAIN_STEALTH_SK || shared_secret, 2400)
/// stealth_sk = spending_sk ⊕ stealth_factor
/// ```
///
/// # Security
///
/// This function handles sensitive key material. The output is automatically
/// zeroized when dropped.
///
/// # Arguments
///
/// * `spending_sk` - The recipient's spending secret key (2400 bytes)
/// * `shared_secret` - The shared secret from Kyber decapsulation
pub fn derive_stealth_private_key(
    spending_sk: &[u8],
    shared_secret: &[u8],
) -> Result<StealthPrivateKey> {
    if spending_sk.len() != KYBER_SECRET_KEY_SIZE {
        return Err(SpecterError::InvalidKeySize {
            expected: KYBER_SECRET_KEY_SIZE,
            actual: spending_sk.len(),
        });
    }

    // Derive stealth factor
    let stealth_factor = shake256(DOMAIN_STEALTH_SK, shared_secret, KYBER_SECRET_KEY_SIZE);

    // XOR with spending secret key
    let stealth_sk: Vec<u8> = spending_sk
        .iter()
        .zip(stealth_factor.iter())
        .map(|(a, b)| a ^ b)
        .collect();

    Ok(StealthPrivateKey::from_bytes(stealth_sk))
}

// ═══════════════════════════════════════════════════════════════════════════════
// ETHEREUM ADDRESS DERIVATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Derives an Ethereum address from a stealth public key.
///
/// # Algorithm
///
/// For Kyber keys, we use a simplified derivation:
/// ```text
/// address = keccak256(stealth_pk)[12..32]
/// ```
///
/// Note: This is different from secp256k1-based derivation. In a real
/// implementation, we might want to derive an intermediate secp256k1 key
/// for full Ethereum compatibility.
///
/// # Arguments
///
/// * `stealth_pk` - The stealth public key (1184 bytes)
pub fn derive_eth_address(stealth_pk: &[u8]) -> Result<EthAddress> {
    if stealth_pk.len() != KYBER_PUBLIC_KEY_SIZE {
        return Err(SpecterError::InvalidKeySize {
            expected: KYBER_PUBLIC_KEY_SIZE,
            actual: stealth_pk.len(),
        });
    }

    let hash = keccak256(stealth_pk);
    
    // Take last 20 bytes as Ethereum address
    let mut address_bytes = [0u8; ETH_ADDRESS_SIZE];
    address_bytes.copy_from_slice(&hash[32 - ETH_ADDRESS_SIZE..]);

    Ok(EthAddress::from_array(address_bytes))
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMBINED DERIVATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Derives complete stealth keys (public, private, and address).
///
/// This is the main function used by recipients to derive keys for discovered
/// payments.
///
/// # Arguments
///
/// * `spending_pk` - The recipient's spending public key
/// * `spending_sk` - The recipient's spending secret key
/// * `shared_secret` - The shared secret from Kyber decapsulation
pub fn derive_stealth_keys(
    spending_pk: &[u8],
    spending_sk: &[u8],
    shared_secret: &[u8],
) -> Result<StealthKeys> {
    let public_key = derive_stealth_public_key(spending_pk, shared_secret)?;
    let private_key = derive_stealth_private_key(spending_sk, shared_secret)?;
    let address = derive_eth_address(&public_key)?;

    Ok(StealthKeys {
        public_key,
        private_key,
        address,
    })
}

/// Derives only the address (for senders who don't need the private key).
///
/// This is the function used by senders to compute where to send funds.
pub fn derive_stealth_address(spending_pk: &[u8], shared_secret: &[u8]) -> Result<EthAddress> {
    let stealth_pk = derive_stealth_public_key(spending_pk, shared_secret)?;
    derive_eth_address(&stealth_pk)
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Verifies that a stealth address was correctly derived.
///
/// Used to confirm a discovered payment is actually for this recipient.
pub fn verify_stealth_address(
    spending_pk: &[u8],
    shared_secret: &[u8],
    expected_address: &EthAddress,
) -> Result<bool> {
    let derived = derive_stealth_address(spending_pk, shared_secret)?;
    Ok(subtle::ConstantTimeEq::ct_eq(
        derived.as_bytes(),
        expected_address.as_bytes(),
    )
    .into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_pk() -> Vec<u8> {
        vec![0x42u8; KYBER_PUBLIC_KEY_SIZE]
    }

    fn make_test_sk() -> Vec<u8> {
        vec![0x99u8; KYBER_SECRET_KEY_SIZE]
    }

    fn make_test_secret() -> [u8; 32] {
        [0xAB; 32]
    }

    #[test]
    fn test_derive_stealth_public_key() {
        let spending_pk = make_test_pk();
        let shared_secret = make_test_secret();

        let stealth_pk = derive_stealth_public_key(&spending_pk, &shared_secret).unwrap();

        assert_eq!(stealth_pk.len(), KYBER_PUBLIC_KEY_SIZE);
        // Stealth PK should be different from spending PK
        assert_ne!(stealth_pk, spending_pk);
    }

    #[test]
    fn test_derive_stealth_public_key_deterministic() {
        let spending_pk = make_test_pk();
        let shared_secret = make_test_secret();

        let pk1 = derive_stealth_public_key(&spending_pk, &shared_secret).unwrap();
        let pk2 = derive_stealth_public_key(&spending_pk, &shared_secret).unwrap();

        assert_eq!(pk1, pk2);
    }

    #[test]
    fn test_derive_stealth_public_key_different_secrets() {
        let spending_pk = make_test_pk();
        let secret1 = [1u8; 32];
        let secret2 = [2u8; 32];

        let pk1 = derive_stealth_public_key(&spending_pk, &secret1).unwrap();
        let pk2 = derive_stealth_public_key(&spending_pk, &secret2).unwrap();

        // Different secrets should produce different stealth PKs
        assert_ne!(pk1, pk2);
    }

    #[test]
    fn test_derive_stealth_private_key() {
        let spending_sk = make_test_sk();
        let shared_secret = make_test_secret();

        let stealth_sk = derive_stealth_private_key(&spending_sk, &shared_secret).unwrap();

        assert_eq!(stealth_sk.as_bytes().len(), KYBER_SECRET_KEY_SIZE);
    }

    #[test]
    fn test_derive_eth_address() {
        let stealth_pk = make_test_pk();
        let address = derive_eth_address(&stealth_pk).unwrap();

        assert_eq!(address.as_bytes().len(), ETH_ADDRESS_SIZE);
    }

    #[test]
    fn test_derive_stealth_keys() {
        let spending_pk = make_test_pk();
        let spending_sk = make_test_sk();
        let shared_secret = make_test_secret();

        let keys = derive_stealth_keys(&spending_pk, &spending_sk, &shared_secret).unwrap();

        assert_eq!(keys.public_key.len(), KYBER_PUBLIC_KEY_SIZE);
        assert_eq!(keys.private_key.as_bytes().len(), KYBER_SECRET_KEY_SIZE);
        assert_eq!(keys.address.as_bytes().len(), ETH_ADDRESS_SIZE);
    }

    #[test]
    fn test_derive_stealth_address() {
        let spending_pk = make_test_pk();
        let shared_secret = make_test_secret();

        let address = derive_stealth_address(&spending_pk, &shared_secret).unwrap();

        // Should match the address from full key derivation
        let keys = derive_stealth_keys(&spending_pk, &make_test_sk(), &shared_secret).unwrap();
        assert_eq!(address, keys.address);
    }

    #[test]
    fn test_verify_stealth_address() {
        let spending_pk = make_test_pk();
        let shared_secret = make_test_secret();

        let address = derive_stealth_address(&spending_pk, &shared_secret).unwrap();

        assert!(verify_stealth_address(&spending_pk, &shared_secret, &address).unwrap());

        // Wrong address should fail
        let wrong_address = EthAddress::from_array([0xFF; ETH_ADDRESS_SIZE]);
        assert!(!verify_stealth_address(&spending_pk, &shared_secret, &wrong_address).unwrap());
    }

    #[test]
    fn test_xor_reversibility() {
        // XOR is its own inverse: (A ⊕ B) ⊕ B = A
        let original = make_test_pk();
        let shared_secret = make_test_secret();

        let stealth = derive_stealth_public_key(&original, &shared_secret).unwrap();

        // Apply the same operation to recover original
        let factor = shake256(DOMAIN_STEALTH_PK, &shared_secret, KYBER_PUBLIC_KEY_SIZE);
        let recovered: Vec<u8> = stealth.iter().zip(factor.iter()).map(|(a, b)| a ^ b).collect();

        assert_eq!(original, recovered);
    }

    #[test]
    fn test_stealth_private_key_zeroized_on_drop() {
        let spending_sk = make_test_sk();
        let shared_secret = make_test_secret();

        // Create and immediately drop
        {
            let _stealth_sk = derive_stealth_private_key(&spending_sk, &shared_secret).unwrap();
            // Key is zeroized when _stealth_sk goes out of scope
        }
        
        // Can't directly verify zeroization, but the Drop impl ensures it
    }

    #[test]
    fn test_invalid_key_sizes() {
        let too_short = vec![0u8; 100];
        let shared_secret = make_test_secret();

        assert!(derive_stealth_public_key(&too_short, &shared_secret).is_err());
        assert!(derive_stealth_private_key(&too_short, &shared_secret).is_err());
        assert!(derive_eth_address(&too_short).is_err());
    }
}
