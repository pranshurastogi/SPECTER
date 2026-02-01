//! ML-KEM-768 (Kyber) key encapsulation mechanism.
//!
//! This module wraps the `pqcrypto-kyber` crate to provide a clean interface
//! for SPECTER's cryptographic operations.
//!
//! ## Security Level
//!
//! ML-KEM-768 provides approximately 192 bits of classical security and
//! 128+ bits of quantum security, equivalent to AES-192.
//!
//! ## References
//!
//! - NIST FIPS 203: ML-KEM specification
//! - pqcrypto-kyber: https://crates.io/crates/pqcrypto-kyber

use pqcrypto_kyber::kyber768;
use pqcrypto_traits::kem::{Ciphertext, PublicKey, SecretKey, SharedSecret};
use zeroize::Zeroize;

use specter_core::constants::{KYBER_CIPHERTEXT_SIZE, KYBER_PUBLIC_KEY_SIZE, KYBER_SECRET_KEY_SIZE, KYBER_SHARED_SECRET_SIZE};
use specter_core::error::{Result, SpecterError};
use specter_core::types::{KeyPair, KyberPublicKey, KyberSecretKey};

// ═══════════════════════════════════════════════════════════════════════════════
// CIPHERTEXT TYPE
// ═══════════════════════════════════════════════════════════════════════════════

/// Kyber ciphertext (encapsulated key).
///
/// This is what gets published in announcements for recipients to decapsulate.
#[derive(Clone)]
pub struct KyberCiphertext {
    bytes: Vec<u8>,
}

impl KyberCiphertext {
    /// Creates ciphertext from raw bytes.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != KYBER_CIPHERTEXT_SIZE {
            return Err(SpecterError::InvalidCiphertextSize {
                expected: KYBER_CIPHERTEXT_SIZE,
                actual: bytes.len(),
            });
        }
        Ok(Self {
            bytes: bytes.to_vec(),
        })
    }

    /// Returns the raw bytes.
    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Consumes self and returns the bytes.
    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }

    /// Returns hex-encoded ciphertext.
    pub fn to_hex(&self) -> String {
        hex::encode(&self.bytes)
    }

    /// Creates from hex string.
    pub fn from_hex(s: &str) -> Result<Self> {
        let bytes = hex::decode(s)?;
        Self::from_bytes(&bytes)
    }
}

impl std::fmt::Debug for KyberCiphertext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "KyberCiphertext({}...{})",
            hex::encode(&self.bytes[..8]),
            hex::encode(&self.bytes[KYBER_CIPHERTEXT_SIZE - 8..])
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// KEY GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Generates a new ML-KEM-768 key pair.
///
/// This uses the system's cryptographically secure random number generator.
///
/// # Returns
///
/// A `KeyPair` containing the public key (for encapsulation) and
/// secret key (for decapsulation).
///
/// # Example
///
/// ```rust,ignore
/// use specter_crypto::generate_keypair;
///
/// let keypair = generate_keypair();
/// println!("Public key size: {} bytes", keypair.public.as_bytes().len());
/// ```
pub fn generate_keypair() -> KeyPair {
    let (pk, sk) = kyber768::keypair();

    let public = KyberPublicKey::from_array(
        pk.as_bytes()
            .try_into()
            .expect("Kyber768 public key should be 1184 bytes"),
    );

    let secret = KyberSecretKey::from_array(
        sk.as_bytes()
            .try_into()
            .expect("Kyber768 secret key should be 2400 bytes"),
    );

    KeyPair::new(public, secret)
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENCAPSULATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Encapsulates a shared secret to a public key.
///
/// This is used by senders to create the ephemeral key for announcements.
///
/// # Arguments
///
/// * `public_key` - The recipient's Kyber public key
///
/// # Returns
///
/// A tuple of (ciphertext, shared_secret) where:
/// - ciphertext: 1088 bytes to include in the announcement
/// - shared_secret: 32 bytes used for stealth address derivation
///
/// # Security
///
/// The shared secret is only computable by:
/// - This function (sender)
/// - The holder of the corresponding secret key (recipient)
pub fn encapsulate(public_key: &KyberPublicKey) -> Result<(KyberCiphertext, [u8; KYBER_SHARED_SECRET_SIZE])> {
    // Convert our public key type to pqcrypto's type
    let pk = kyber768::PublicKey::from_bytes(public_key.as_bytes())
        .map_err(|e| SpecterError::EncapsulationError(format!("Invalid public key: {:?}", e)))?;

    // Perform encapsulation
    let (ss, ct) = kyber768::encapsulate(&pk);

    // Extract shared secret
    let mut shared_secret = [0u8; KYBER_SHARED_SECRET_SIZE];
    shared_secret.copy_from_slice(ss.as_bytes());

    // Wrap ciphertext
    let ciphertext = KyberCiphertext::from_bytes(ct.as_bytes())?;

    Ok((ciphertext, shared_secret))
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECAPSULATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Decapsulates a ciphertext to recover the shared secret.
///
/// This is used by recipients to recover the shared secret from announcements.
///
/// # Arguments
///
/// * `ciphertext` - The ciphertext from the announcement
/// * `secret_key` - The recipient's Kyber secret key
///
/// # Returns
///
/// The 32-byte shared secret, which can be used for stealth address derivation.
///
/// # Security
///
/// The decapsulation is implicitly verified - if the ciphertext was not
/// created for this public key, the result will be a pseudo-random value
/// (not an error), which is the standard KEM security property.
pub fn decapsulate(
    ciphertext: &KyberCiphertext,
    secret_key: &KyberSecretKey,
) -> Result<[u8; KYBER_SHARED_SECRET_SIZE]> {
    // Convert to pqcrypto types
    let ct = kyber768::Ciphertext::from_bytes(ciphertext.as_bytes())
        .map_err(|e| SpecterError::DecapsulationError(format!("Invalid ciphertext: {:?}", e)))?;

    let sk = kyber768::SecretKey::from_bytes(secret_key.as_bytes())
        .map_err(|e| SpecterError::DecapsulationError(format!("Invalid secret key: {:?}", e)))?;

    // Perform decapsulation
    let ss = kyber768::decapsulate(&ct, &sk);

    // Extract shared secret
    let mut shared_secret = [0u8; KYBER_SHARED_SECRET_SIZE];
    shared_secret.copy_from_slice(ss.as_bytes());

    Ok(shared_secret)
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Verifies that encapsulation and decapsulation produce the same shared secret.
///
/// This is primarily used for testing and debugging.
pub fn verify_roundtrip(
    public_key: &KyberPublicKey,
    secret_key: &KyberSecretKey,
) -> Result<bool> {
    let (ciphertext, sender_secret) = encapsulate(public_key)?;
    let receiver_secret = decapsulate(&ciphertext, secret_key)?;
    
    // Constant-time comparison
    Ok(subtle::ConstantTimeEq::ct_eq(&sender_secret[..], &receiver_secret[..]).into())
}

/// Verifies key pair consistency.
///
/// Ensures the public and secret keys form a valid pair.
pub fn verify_keypair(keypair: &KeyPair) -> Result<bool> {
    verify_roundtrip(&keypair.public, &keypair.secret)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keypair_generation() {
        let keypair = generate_keypair();
        
        assert_eq!(keypair.public.as_bytes().len(), KYBER_PUBLIC_KEY_SIZE);
        assert_eq!(keypair.secret.as_bytes().len(), KYBER_SECRET_KEY_SIZE);
    }

    #[test]
    fn test_encapsulation_decapsulation_roundtrip() {
        let keypair = generate_keypair();
        
        // Encapsulate
        let (ciphertext, sender_secret) = encapsulate(&keypair.public).unwrap();
        
        // Verify ciphertext size
        assert_eq!(ciphertext.as_bytes().len(), KYBER_CIPHERTEXT_SIZE);
        
        // Decapsulate
        let receiver_secret = decapsulate(&ciphertext, &keypair.secret).unwrap();
        
        // Shared secrets must match
        assert_eq!(sender_secret, receiver_secret);
    }

    #[test]
    fn test_multiple_encapsulations_produce_different_secrets() {
        let keypair = generate_keypair();
        
        let (_, secret1) = encapsulate(&keypair.public).unwrap();
        let (_, secret2) = encapsulate(&keypair.public).unwrap();
        
        // Each encapsulation should produce a different shared secret
        assert_ne!(secret1, secret2);
    }

    #[test]
    fn test_different_keypairs_produce_different_secrets() {
        let keypair1 = generate_keypair();
        let keypair2 = generate_keypair();
        
        let (ct1, secret1) = encapsulate(&keypair1.public).unwrap();
        let (ct2, secret2) = encapsulate(&keypair2.public).unwrap();
        
        // Different public keys should produce different ciphertexts and secrets
        assert_ne!(ct1.as_bytes(), ct2.as_bytes());
        assert_ne!(secret1, secret2);
    }

    #[test]
    fn test_verify_roundtrip() {
        let keypair = generate_keypair();
        assert!(verify_roundtrip(&keypair.public, &keypair.secret).unwrap());
    }

    #[test]
    fn test_verify_keypair() {
        let keypair = generate_keypair();
        assert!(verify_keypair(&keypair).unwrap());
    }

    #[test]
    fn test_ciphertext_hex_roundtrip() {
        let keypair = generate_keypair();
        let (ciphertext, _) = encapsulate(&keypair.public).unwrap();
        
        let hex = ciphertext.to_hex();
        let recovered = KyberCiphertext::from_hex(&hex).unwrap();
        
        assert_eq!(ciphertext.as_bytes(), recovered.as_bytes());
    }

    #[test]
    fn test_invalid_public_key_size() {
        let bad_key = KyberPublicKey::from_bytes(&[0u8; 100]);
        assert!(bad_key.is_err());
    }

    #[test]
    fn test_invalid_ciphertext_size() {
        let bad_ct = KyberCiphertext::from_bytes(&[0u8; 100]);
        assert!(bad_ct.is_err());
    }

    #[test]
    fn test_wrong_key_decapsulation() {
        let keypair1 = generate_keypair();
        let keypair2 = generate_keypair();
        
        // Encapsulate with keypair1's public key
        let (ciphertext, sender_secret) = encapsulate(&keypair1.public).unwrap();
        
        // Decapsulate with keypair2's secret key (wrong key!)
        let wrong_secret = decapsulate(&ciphertext, &keypair2.secret).unwrap();
        
        // Should produce a different (pseudo-random) secret, not the original
        assert_ne!(sender_secret, wrong_secret);
    }
}
