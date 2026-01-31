//! Core data types

use serde::{Deserialize, Serialize};
use crate::constants::*;

/// Ethereum address (20 bytes)
pub type Address = [u8; 20];

/// Stealth meta-address containing public keys for generating stealth addresses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StealthMetaAddress {
    /// Protocol version
    pub version: u8,
    
    /// Spending public key (1184 bytes for Kyber768)
    pub spending_pk: Vec<u8>,
    
    /// Viewing public key (1184 bytes for Kyber768)
    pub viewing_pk: Vec<u8>,
    
    /// Creation timestamp (Unix)
    pub created_at: u64,
    
    /// Optional metadata
    pub metadata: Option<Metadata>,
}

impl StealthMetaAddress {
    /// Validate key sizes
    pub fn validate(&self) -> crate::Result<()> {
        if self.spending_pk.len() != KYBER_PUBLIC_KEY_SIZE {
            return Err(crate::SpecterError::InvalidKeySize {
                expected: KYBER_PUBLIC_KEY_SIZE,
                actual: self.spending_pk.len(),
            });
        }
        
        if self.viewing_pk.len() != KYBER_PUBLIC_KEY_SIZE {
            return Err(crate::SpecterError::InvalidKeySize {
                expected: KYBER_PUBLIC_KEY_SIZE,
                actual: self.viewing_pk.len(),
            });
        }
        
        Ok(())
    }
    
    /// Serialize to bytes
    pub fn to_bytes(&self) -> crate::Result<Vec<u8>> {
        bincode::serialize(self)
            .map_err(|e| crate::SpecterError::SerializationError(e.to_string()))
    }
    
    /// Deserialize from bytes
    pub fn from_bytes(bytes: &[u8]) -> crate::Result<Self> {
        let meta: Self = bincode::deserialize(bytes)
            .map_err(|e| crate::SpecterError::SerializationError(e.to_string()))?;
        meta.validate()?;
        Ok(meta)
    }
}

/// Optional metadata for stealth meta-address
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metadata {
    pub description: Option<String>,
    pub avatar: Option<String>,
}

/// Announcement published to registry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Announcement {
    /// Unique ID
    pub id: u64,
    
    /// Kyber ciphertext (ephemeral key) - 1088 bytes
    pub ephemeral_key: Vec<u8>,
    
    /// View tag for efficient scanning (0-255)
    pub view_tag: u8,
    
    /// Publication timestamp
    pub timestamp: u64,
    
    /// Optional: Yellow channel ID
    pub channel_id: Option<String>,
}

impl Announcement {
    /// Validate ephemeral key size
    pub fn validate(&self) -> crate::Result<()> {
        if self.ephemeral_key.len() != KYBER_CIPHERTEXT_SIZE {
            return Err(crate::SpecterError::InvalidKeySize {
                expected: KYBER_CIPHERTEXT_SIZE,
                actual: self.ephemeral_key.len(),
            });
        }
        Ok(())
    }
}

/// Discovery result when scanning
#[derive(Debug, Clone)]
pub struct Discovery {
    /// The stealth address (Ethereum address format)
    pub stealth_address: Address,
    
    /// Stealth private key (for spending)
    pub stealth_sk: Vec<u8>,
    
    /// Announcement ID
    pub announcement_id: u64,
    
    /// Timestamp
    pub timestamp: u64,
    
    /// Optional channel ID
    pub channel_id: Option<String>,
}