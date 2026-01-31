#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_stealth_meta_address_serialization() {
        let meta = StealthMetaAddress {
            version: PROTOCOL_VERSION,
            spending_pk: vec![0u8; KYBER_PUBLIC_KEY_SIZE],
            viewing_pk: vec![0u8; KYBER_PUBLIC_KEY_SIZE],
            created_at: 1234567890,
            metadata: None,
        };
        
        // Validate
        assert!(meta.validate().is_ok());
        
        // Serialize
        let bytes = meta.to_bytes().unwrap();
        
        // Deserialize
        let meta2 = StealthMetaAddress::from_bytes(&bytes).unwrap();
        
        assert_eq!(meta.version, meta2.version);
        assert_eq!(meta.spending_pk, meta2.spending_pk);
        assert_eq!(meta.viewing_pk, meta2.viewing_pk);
    }
    
    #[test]
    fn test_announcement_validation() {
        let announcement = Announcement {
            id: 1,
            ephemeral_key: vec![0u8; KYBER_CIPHERTEXT_SIZE],
            view_tag: 42,
            timestamp: 1234567890,
            channel_id: None,
        };
        
        assert!(announcement.validate().is_ok());
        
        // Invalid size should fail
        let bad_announcement = Announcement {
            id: 1,
            ephemeral_key: vec![0u8; 100], // Wrong size
            view_tag: 42,
            timestamp: 1234567890,
            channel_id: None,
        };
        
        assert!(bad_announcement.validate().is_err());
    }
}