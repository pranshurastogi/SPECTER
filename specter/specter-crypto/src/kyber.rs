//! ML-KEM-768 (Kyber) key encapsulation mechanism.
//!
//! This module uses the `ml-kem` crate from RustCrypto to provide ML-KEM-768
//! key encapsulation for SPECTER's post-quantum stealth address protocol.
//!
//! ## Implementation
//!
//! - **Pure Rust**: No C dependencies, compiles to WASM natively
//! - **FIPS 203 compliant**: Implements the finalized ML-KEM standard
//! - **Production ready**: Maintained by RustCrypto with constant-time operations
//!
//! ## Security Level
//!
//! ML-KEM-768 provides approximately 192 bits of classical security and
//! 128+ bits of quantum security, equivalent to AES-192.
//!
//! ## Key Sizes
//!
//! - Public key (encapsulation key): 1184 bytes
//! - Secret key (decapsulation key): 2400 bytes
//! - Ciphertext: 1088 bytes
//! - Shared secret: 32 bytes
//!
//! ## References
//!
//! - NIST FIPS 203: ML-KEM specification
//! - ml-kem: https://crates.io/crates/ml-kem
//! - RustCrypto KEMs: https://github.com/RustCrypto/KEMs

use ml_kem::{MlKem768, KemCore, EncodedSizeUser, Encoded};
use ml_kem::kem::{Encapsulate, Decapsulate};

#[allow(unused_imports)]
use specter_core::constants::{
    KYBER_CIPHERTEXT_SIZE, KYBER_PUBLIC_KEY_SIZE, KYBER_SECRET_KEY_SIZE, KYBER_SHARED_SECRET_SIZE,
};
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
    let mut rng = rand::thread_rng();
    let (dk, ek) = MlKem768::generate(&mut rng);

    // Convert to byte arrays
    let public = KyberPublicKey::from_array(
        ek.as_bytes()
            .try_into()
            .expect("MlKem768 encapsulation key should be 1184 bytes"),
    );

    let secret = KyberSecretKey::from_array(
        dk.as_bytes()
            .try_into()
            .expect("MlKem768 decapsulation key should be 2400 bytes"),
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
    // Convert public key bytes to the encoded form using the Encoded type alias
    type EkType = <MlKem768 as KemCore>::EncapsulationKey;
    
    let ek_array = Encoded::<EkType>::try_from(public_key.as_bytes())
        .map_err(|_| SpecterError::EncapsulationError("Invalid public key size".to_string()))?;
    
    // Create encapsulation key from the encoded bytes
    let ek = EkType::from_bytes(&ek_array);

    // Perform encapsulation
    let mut rng = rand::thread_rng();
    let (ct, ss) = ek.encapsulate(&mut rng)
        .map_err(|e| SpecterError::EncapsulationError(format!("Encapsulation failed: {:?}", e)))?;

    // Extract ciphertext - ct is a Ciphertext (Array), convert to bytes
    let ciphertext = KyberCiphertext::from_bytes(&ct[..])?;

    // Extract shared secret - ss is a SharedSecret (Array), convert to bytes
    let mut shared_secret = [0u8; KYBER_SHARED_SECRET_SIZE];
    shared_secret.copy_from_slice(&ss[..]);

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
    // Convert ciphertext bytes to ml-kem Ciphertext type (Array)
    let ct = ml_kem::Ciphertext::<MlKem768>::try_from(ciphertext.as_bytes())
        .map_err(|e| SpecterError::DecapsulationError(format!("Invalid ciphertext: {:?}", e)))?;

    // Convert secret key bytes to the encoded form using the Encoded type alias
    type DkType = <MlKem768 as KemCore>::DecapsulationKey;
    
    let dk_array = Encoded::<DkType>::try_from(secret_key.as_bytes())
        .map_err(|_| SpecterError::DecapsulationError("Invalid secret key size".to_string()))?;
    
    // Create decapsulation key from the encoded bytes
    let dk = DkType::from_bytes(&dk_array);

    // Perform decapsulation
    let ss = dk.decapsulate(&ct)
        .map_err(|e| SpecterError::DecapsulationError(format!("Decapsulation failed: {:?}", e)))?;

    // Extract shared secret - ss is a SharedSecret (Array), convert to bytes
    let mut shared_secret = [0u8; KYBER_SHARED_SECRET_SIZE];
    shared_secret.copy_from_slice(&ss[..]);

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
