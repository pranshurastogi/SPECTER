//! Recovers the ML-KEM ciphertext from `announce()` calldata and verifies it
//! against the event's keccak256 hash. Used by scanners on view-tag match.

use alloy::network::TransactionResponse;
use alloy::primitives::{keccak256, TxHash};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::sol_types::SolCall;
use async_trait::async_trait;
use specter_core::error::{Result, SpecterError};
use specter_core::resolver::EphemeralKeyResolver;

use crate::contract::SPECTERAnnouncer;

/// Decodes `announce()` (or its `(schemeId,…)` overload) calldata into the
/// 1088-byte `ephemeralPubKey`.
pub fn decode_announce_ciphertext(input: &[u8]) -> Result<Vec<u8>> {
    if let Ok(c) = SPECTERAnnouncer::announce_0Call::abi_decode(input, true) {
        return Ok(c.ephemeralPubKey.to_vec());
    }
    if let Ok(c) = SPECTERAnnouncer::announce_1Call::abi_decode(input, true) {
        return Ok(c.ephemeralPubKey.to_vec());
    }
    Err(SpecterError::ValidationError(
        "calldata is not a recognized announce() call".into(),
    ))
}

/// Verifies keccak256(ciphertext) == expected and returns it on success.
pub fn verify_ciphertext(ciphertext: Vec<u8>, expected_hash: &[u8]) -> Result<Vec<u8>> {
    let got = keccak256(&ciphertext);
    if got.as_slice() != expected_hash {
        return Err(SpecterError::ValidationError(
            "ciphertext keccak256 does not match event ephemeralKeyHash".into(),
        ));
    }
    Ok(ciphertext)
}

/// RPC-backed resolver: fetch tx by hash → decode calldata → verify hash.
pub struct RpcEphemeralKeyResolver {
    rpc_url: String,
}

impl RpcEphemeralKeyResolver {
    pub fn new(rpc_url: impl Into<String>) -> Self {
        Self {
            rpc_url: rpc_url.into(),
        }
    }
}

#[async_trait]
impl EphemeralKeyResolver for RpcEphemeralKeyResolver {
    async fn resolve(&self, announce_tx_hash: &str, expected_hash: &[u8]) -> Result<Vec<u8>> {
        let url = self
            .rpc_url
            .parse()
            .map_err(|_| SpecterError::RegistryError("invalid RPC url".into()))?;
        let tx_hash: TxHash = announce_tx_hash
            .trim()
            .parse()
            .map_err(|_| SpecterError::ValidationError("invalid announce tx hash".into()))?;
        let provider = ProviderBuilder::new().on_http(url);
        let tx = provider
            .get_transaction_by_hash(tx_hash)
            .await
            .map_err(|e| SpecterError::RegistryError(format!("eth_getTransactionByHash: {e}")))?
            .ok_or_else(|| SpecterError::RegistryError("announce tx not found".into()))?;
        let ciphertext = decode_announce_ciphertext(tx.input())?;
        verify_ciphertext(ciphertext, expected_hash)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{keccak256, Address};

    fn encode_announce(ct: &[u8]) -> Vec<u8> {
        SPECTERAnnouncer::announce_0Call {
            stealthAddress: Address::ZERO,
            ephemeralPubKey: ct.to_vec().into(),
            metadata: vec![0x7Fu8].into(),
        }
        .abi_encode()
    }

    #[test]
    fn decode_then_verify_roundtrip() {
        let ct = vec![0xABu8; 1088];
        let input = encode_announce(&ct);
        let decoded = decode_announce_ciphertext(&input).unwrap();
        assert_eq!(decoded, ct);
        let expected = keccak256(&ct);
        assert!(verify_ciphertext(decoded, expected.as_slice()).is_ok());
    }

    #[test]
    fn wrong_hash_is_rejected() {
        let ct = vec![0xABu8; 1088];
        let input = encode_announce(&ct);
        let decoded = decode_announce_ciphertext(&input).unwrap();
        assert!(verify_ciphertext(decoded, &[0u8; 32]).is_err());
    }

    #[test]
    fn garbage_calldata_rejected() {
        assert!(decode_announce_ciphertext(&[0x00, 0x01, 0x02]).is_err());
    }
}
