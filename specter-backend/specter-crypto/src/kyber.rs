//! ML-KEM-768 (Kyber768) operations

use pqcrypto_kyber::kyber768;
use pqcrypto_traits::kem::{PublicKey, SecretKey, Ciphertext, SharedSecret};
use specter_core::{Result, SpecterError};
use zeroize::Zeroize;

/// Kyber public key wrapper
#[derive(Clone)]
pub struct KyberPublicKey(pub kyber768::PublicKey);

impl KyberPublicKey {
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }
    
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        kyber768::PublicKey::from_bytes(bytes)
            .map(KyberPublicKey)
            .map_err(|e| SpecterError::CryptoError(format!("Invalid public key: {:?}", e)))
    }
}

/// Kyber secret key wrapper (auto-zeroized on drop)
pub struct KyberSecretKey(pub kyber768::SecretKey);

impl Drop for KyberSecretKey {
    fn drop(&mut self) {
        // Zeroize secret key material
        unsafe {
            std::ptr::write_volatile(
                self.0.as_bytes().as_ptr() as *mut u8,
                0,
            );
        }
    }
}

impl KyberSecretKey {
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }
    
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        kyber768::SecretKey::from_bytes(bytes)
            .map(KyberSecretKey)
            .map_err(|e| SpecterError::CryptoError(format!("Invalid secret key: {:?}", e)))
    }
}

/// Kyber keypair
pub struct KyberKeyPair {
    pub public: KyberPublicKey,
    pub secret: KyberSecretKey,
}

/// Generate a new Kyber768 keypair
pub fn generate_keypair() -> KyberKeyPair {
    let (pk, sk) = kyber768::keypair();
    KyberKeyPair {
        public: KyberPublicKey(pk),
        secret: KyberSecretKey(sk),
    }
}

/// Encapsulate: Generate shared secret and ciphertext
/// 
/// Returns: (ciphertext, shared_secret)
pub fn encapsulate(public_key: &KyberPublicKey) -> (Vec<u8>, Vec<u8>) {
    let (ss, ct) = kyber768::encapsulate(&public_key.0);
    (ct.as_bytes().to_vec(), ss.as_bytes().to_vec())
}

/// Decapsulate: Recover shared secret from ciphertext
/// 
/// Returns: shared_secret
pub fn decapsulate(ciphertext: &[u8], secret_key: &KyberSecretKey) -> Result<Vec<u8>> {
    let ct = kyber768::Ciphertext::from_bytes(ciphertext)
        .map_err(|e| SpecterError::CryptoError(format!("Invalid ciphertext: {:?}", e)))?;
    
    let ss = kyber768::decapsulate(&ct, &secret_key.0);
    Ok(ss.as_bytes().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_kyber_roundtrip() {
        // Generate keypair
        let keypair = generate_keypair();
        
        // Encapsulate
        let (ciphertext, ss1) = encapsulate(&keypair.public);
        
        // Decapsulate
        let ss2 = decapsulate(&ciphertext, &keypair.secret).unwrap();
        
        // Shared secrets should match
        assert_eq!(ss1, ss2);
    }
    
    #[test]
    fn test_key_serialization() {
        let keypair = generate_keypair();
        
        // Serialize public key
        let pk_bytes = keypair.public.as_bytes();
        
        // Deserialize
        let pk2 = KyberPublicKey::from_bytes(pk_bytes).unwrap();
        
        assert_eq!(pk_bytes, pk2.as_bytes());
    }
}