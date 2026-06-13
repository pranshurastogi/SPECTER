use alloy::network::TransactionResponse;
use alloy::primitives::{Address, TxHash, B256, U256};
use alloy::providers::{Provider, ProviderBuilder};
use std::sync::OnceLock;
use std::time::Duration;
use tracing::warn;

use crate::error::ApiError;

/// keccak256("Transfer(address,address,uint256)") — the ERC-20 Transfer topic0.
fn erc20_transfer_topic() -> B256 {
    static T: OnceLock<B256> = OnceLock::new();
    *T.get_or_init(|| alloy::primitives::keccak256("Transfer(address,address,uint256)"))
}

/// Native transfer match: tx went to `stealth` for at least `amount`.
pub(crate) fn native_payment_ok(
    stealth: Address,
    tx_to: Option<Address>,
    value: U256,
    amount: U256,
) -> bool {
    tx_to == Some(stealth) && value >= amount
}

/// One ERC-20 Transfer log matches: recipient topic == stealth, value >= amount,
/// and (if `expected_token` is Some) the emitting contract == that token.
pub(crate) fn erc20_transfer_ok(
    stealth: Address,
    expected_token: Option<Address>,
    amount: U256,
    log_address: Address,
    to_topic: &B256,
    amount_data: &[u8],
) -> bool {
    if let Some(t) = expected_token {
        if log_address != t {
            return false;
        }
    }
    if *to_topic != B256::left_padding_from(stealth.as_slice()) {
        return false;
    }
    let v = U256::from_be_slice(amount_data);
    v >= amount
}

/// Verifies that a payment transaction exists and succeeded on the given RPC.
///
/// Retries up to 3 times with a 2-second delay to handle propagation lag.
///
/// # Errors
/// - `400 Bad Request` if the tx does not exist after retries, or reverted.
/// - `500 Internal Server Error` if the RPC call itself fails.
pub async fn verify_payment_tx(
    rpc_url: &str,
    tx_hash_str: &str,
    stealth_address: &str,
    expected_amount: U256,
    expected_token: Option<Address>,
) -> Result<(), ApiError> {
    let url: url::Url = rpc_url.parse().map_err(|_| {
        ApiError::internal("Invalid source chain RPC URL — check CHAIN_RPC_* env vars")
    })?;

    let tx_hash: TxHash = tx_hash_str
        .trim()
        .parse()
        .map_err(|_| ApiError::bad_request("payment_tx_hash is not a valid transaction hash"))?;

    let stealth: Address = stealth_address
        .parse()
        .map_err(|_| ApiError::bad_request("invalid stealth address for verification"))?;

    let provider = ProviderBuilder::new().on_http(url);

    let mut last_err: Option<String> = None;
    let mut receipt_opt = None;

    for attempt in 0u8..3 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        match provider.get_transaction_receipt(tx_hash).await {
            Ok(Some(receipt)) => {
                if !receipt.status() {
                    return Err(ApiError::bad_request(
                        "Payment transaction was reverted. Cannot create announcement for a failed payment.",
                    ));
                }
                receipt_opt = Some(receipt);
                break;
            }
            Ok(None) => {
                last_err = Some("Transaction not found".into());
            }
            Err(e) => {
                warn!(tx_hash = %tx_hash_str, attempt, error = %e, "RPC call failed during payment verification");
                last_err = Some(format!("RPC error: {e}"));
            }
        }
    }

    let receipt = match receipt_opt {
        Some(r) => r,
        None => {
            return Err(ApiError::bad_request(format!(
                "Payment transaction not found on source chain after 3 attempts ({}). \
                 Wait for confirmation and retry.",
                last_err.unwrap_or_default()
            )));
        }
    };

    // Fetch the full tx to inspect the native recipient + value.
    let tx = provider
        .get_transaction_by_hash(tx_hash)
        .await
        .map_err(|e| {
            warn!(tx_hash = %tx_hash_str, error = %e, "RPC error fetching tx for payment verification");
            ApiError::internal("RPC error fetching payment transaction")
        })?
        .ok_or_else(|| ApiError::bad_request("payment tx not found"))?;

    // 1. Native transfer: tx.to == stealth && value >= amount.
    //    Only treated as native when no specific ERC-20 token was requested.
    if expected_token.is_none() && native_payment_ok(stealth, tx.to(), tx.value(), expected_amount)
    {
        return Ok(());
    }

    // 2. ERC-20 Transfer log to the stealth address for >= amount.
    let transfer_topic = erc20_transfer_topic();
    for log in receipt.inner.logs() {
        let topics = log.topics();
        if topics.len() >= 3
            && topics[0] == transfer_topic
            && erc20_transfer_ok(
                stealth,
                expected_token,
                expected_amount,
                log.address(),
                &topics[2],
                log.data().data.as_ref(),
            )
        {
            return Ok(());
        }
    }

    // 3. Nothing matched — reject generically (don't leak which check failed).
    Err(ApiError::bad_request(
        "payment could not be verified to the stealth address",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{Address, U256};

    #[test]
    fn invalid_tx_hash_returns_bad_request() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(verify_payment_tx(
            "https://example.com",
            "not-a-tx-hash",
            "0x1111111111111111111111111111111111111111",
            U256::ZERO,
            None::<Address>,
        ));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(format!("{:?}", err).contains("payment_tx_hash"));
    }

    #[test]
    fn invalid_rpc_url_returns_internal_error() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(verify_payment_tx(
            "not a url !!!",
            "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
            "0x1111111111111111111111111111111111111111",
            U256::ZERO,
            None::<Address>,
        ));
        assert!(result.is_err());
    }
}

#[cfg(test)]
mod match_tests {
    use super::*;
    use alloy::primitives::{address, B256, U256};

    const STEALTH: Address = address!("1111111111111111111111111111111111111111");
    const OTHER: Address = address!("2222222222222222222222222222222222222222");

    #[test]
    fn native_match_requires_recipient_and_amount() {
        assert!(native_payment_ok(
            STEALTH,
            Some(STEALTH),
            U256::from(1000u64),
            U256::from(1000u64)
        ));
        assert!(native_payment_ok(
            STEALTH,
            Some(STEALTH),
            U256::from(1500u64),
            U256::from(1000u64)
        )); // overpay ok
        assert!(!native_payment_ok(
            STEALTH,
            Some(OTHER),
            U256::from(1000u64),
            U256::from(1000u64)
        )); // wrong recipient
        assert!(!native_payment_ok(
            STEALTH,
            Some(STEALTH),
            U256::from(999u64),
            U256::from(1000u64)
        )); // underpay
        assert!(!native_payment_ok(
            STEALTH,
            None,
            U256::from(1000u64),
            U256::from(1000u64)
        )); // contract creation
    }

    #[test]
    fn erc20_log_match_checks_recipient_amount_and_optional_token() {
        let token = STEALTH; // any addr
                             // topics: [Transfer, from(padded), to(padded)]; data = amount (32B big-endian)
        let to_topic = B256::left_padding_from(STEALTH.as_slice());
        let amount_data = U256::from(1000u64).to_be_bytes::<32>();
        assert!(erc20_transfer_ok(
            STEALTH,
            None,
            U256::from(1000u64),
            token,
            &to_topic,
            &amount_data
        ));
        assert!(erc20_transfer_ok(
            STEALTH,
            Some(token),
            U256::from(1000u64),
            token,
            &to_topic,
            &amount_data
        ));
        // wrong token filter
        assert!(!erc20_transfer_ok(
            STEALTH,
            Some(OTHER),
            U256::from(1000u64),
            token,
            &to_topic,
            &amount_data
        ));
        // underpay
        assert!(!erc20_transfer_ok(
            STEALTH,
            None,
            U256::from(2000u64),
            token,
            &to_topic,
            &amount_data
        ));
        // wrong recipient
        let other_topic = B256::left_padding_from(OTHER.as_slice());
        assert!(!erc20_transfer_ok(
            STEALTH,
            None,
            U256::from(1000u64),
            token,
            &other_topic,
            &amount_data
        ));
    }
}
