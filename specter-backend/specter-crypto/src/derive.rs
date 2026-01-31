//! Key derivation functions for stealth addresses

use specter_core::{DOMAIN_STEALTH_PK, DOMAIN_STEALTH_SK, KYBER_PUBLIC_KEY_SIZE};
use crate::hash::shake256;

/// Derive stealth public key from spending public key and shared secret
pub fn derive_stealth_pk(spending_pk: &[u8], shared_secret: &[u8]) -> Vec<u8> {
    let factor = shake256(DOMAIN_STEALTH_PK, shared_secret, KYBER_PUBLIC_KEY_SIZE);
    
    // XOR operation: stealth_pk = spending_pk ⊕ factor
    spending_pk.iter()
        .zip(factor.iter())
        .map(|(a, b)| a ^ b)
        .collect()
}

/// Derive stealth secret key from spending secret key and shared secret
pub fn derive_stealth_sk(spending_sk: &[u8], shared_secret: &[u8]) -> Vec<u8> {
    let factor = shake256(DOMAIN_STEALTH_SK, shared_secret, spending_sk.len());
    
    // XOR operation: stealth_sk = spending_sk ⊕ factor
    spending_sk.iter()
        .zip(factor.iter())
        .map(|(a, b)| a ^ b)
        .collect()
}

/// Convert public key to Ethereum address (last 20 bytes of keccak256)
pub fn pk_to_address(pk: &[u8]) -> [u8; 20] {
    use sha3::{Keccak256, Digest};
    
    let hash = Keccak256::digest(pk);
    let mut address = [0u8; 20];
    address.copy_from_slice(&hash[12..32]);
    address
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_derive_stealth_deterministic() {
        let spending_pk = vec![1u8; 1184];
        let shared_secret = b"test_secret";
        
        let stealth1 = derive_stealth_pk(&spending_pk, shared_secret);
        let stealth2 = derive_stealth_pk(&spending_pk, shared_secret);
        
        assert_eq!(stealth1, stealth2);
    }
    
    #[test]
    fn test_xor_reversible() {
        let spending_pk = vec![42u8; 1184];
        let shared_secret = b"test";
        
        let stealth_pk = derive_stealth_pk(&spending_pk, shared_secret);
        
        // Applying same operation twice should give original
        let factor = shake256(DOMAIN_STEALTH_PK, shared_secret, 1184);
        let recovered: Vec<u8> = stealth_pk.iter()
            .zip(factor.iter())
            .map(|(a, b)| a ^ b)
            .collect();
        
        assert_eq!(spending_pk, recovered);
    }
}