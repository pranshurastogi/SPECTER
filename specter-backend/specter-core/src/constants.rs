//! Protocol constants

/// Protocol version
pub const PROTOCOL_VERSION: u8 = 1;

/// ML-KEM-768 key sizes
pub const KYBER_PUBLIC_KEY_SIZE: usize = 1184;
pub const KYBER_SECRET_KEY_SIZE: usize = 2400;
pub const KYBER_CIPHERTEXT_SIZE: usize = 1088;
pub const KYBER_SHARED_SECRET_SIZE: usize = 32;

/// View tag size (1 byte = 256 possible values)
pub const VIEW_TAG_SIZE: usize = 1;

/// SHAKE256 output sizes
pub const SHAKE256_VIEW_TAG_OUTPUT: usize = 1;
pub const SHAKE256_STEALTH_OUTPUT: usize = 32;

/// Domain separators for SHAKE256
pub const DOMAIN_VIEW_TAG: &[u8] = b"SPECTER_VIEW_TAG";
pub const DOMAIN_STEALTH_PK: &[u8] = b"SPECTER_STEALTH_PK";
pub const DOMAIN_STEALTH_SK: &[u8] = b"SPECTER_STEALTH_SK";
pub const DOMAIN_USER_TAG: &[u8] = b"SPECTER_USER_TAG";