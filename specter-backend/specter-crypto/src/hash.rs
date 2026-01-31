//! SHAKE256 hashing operations

use sha3::{Shake256, digest::{Update, ExtendableOutput, XofReader}};

/// Compute SHAKE256 hash with domain separation
pub fn shake256(domain: &[u8], data: &[u8], output_len: usize) -> Vec<u8> {
    let mut hasher = Shake256::default();
    hasher.update(domain);
    hasher.update(data);
    
    let mut reader = hasher.finalize_xof();
    let mut output = vec![0u8; output_len];
    reader.read(&mut output);
    
    output
}

/// Compute SHAKE256 hash without domain separation
pub fn shake256_simple(data: &[u8], output_len: usize) -> Vec<u8> {
    let mut hasher = Shake256::default();
    hasher.update(data);
    
    let mut reader = hasher.finalize_xof();
    let mut output = vec![0u8; output_len];
    reader.read(&mut output);
    
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_shake256() {
        let data = b"hello world";
        let hash1 = shake256(b"DOMAIN", data, 32);
        let hash2 = shake256(b"DOMAIN", data, 32);
        
        // Same input should produce same output
        assert_eq!(hash1, hash2);
        
        // Different domain should produce different output
        let hash3 = shake256(b"OTHER", data, 32);
        assert_ne!(hash1, hash3);
    }
}