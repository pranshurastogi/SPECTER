//! View tag computation

use specter_core::{DOMAIN_VIEW_TAG, DOMAIN_USER_TAG};
use crate::hash::shake256;

/// Compute view tag from shared secret
/// 
/// Returns: Single byte (0-255)
pub fn compute_view_tag(shared_secret: &[u8]) -> u8 {
    let hash = shake256(DOMAIN_VIEW_TAG, shared_secret, 1);
    hash[0]
}

/// Compute user's persistent view tag from viewing public key
/// 
/// This is used to quickly filter announcements
pub fn compute_user_tag(viewing_pk: &[u8]) -> u8 {
    let hash = shake256(DOMAIN_USER_TAG, viewing_pk, 1);
    hash[0]
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_view_tag_deterministic() {
        let shared_secret = b"test_shared_secret";
        
        let tag1 = compute_view_tag(shared_secret);
        let tag2 = compute_view_tag(shared_secret);
        
        assert_eq!(tag1, tag2);
    }
    
    #[test]
    fn test_view_tag_range() {
        let shared_secret = b"test";
        let tag = compute_view_tag(shared_secret);
        
        // Should be 0-255
        assert!(tag <= 255);
    }
}