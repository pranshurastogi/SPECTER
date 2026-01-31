//! Error types

use thiserror::Error;

#[derive(Error, Debug)]
pub enum SpecterError {
    #[error("Cryptographic operation failed: {0}")]
    CryptoError(String),
    
    #[error("Invalid key size: expected {expected}, got {actual}")]
    InvalidKeySize { expected: usize, actual: usize },
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
    
    #[error("View tag mismatch")]
    ViewTagMismatch,
    
    #[error("Invalid announcement")]
    InvalidAnnouncement,
    
    #[error("ENS resolution failed: {0}")]
    EnsError(String),
    
    #[error("IPFS operation failed: {0}")]
    IpfsError(String),
    
    #[error("Yellow protocol error: {0}")]
    YellowError(String),
    
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, SpecterError>;