use alloy::{
    primitives::TxHash,
    providers::{Provider, ProviderBuilder},
};
use std::time::Duration;
use tracing::warn;

use crate::error::ApiError;

/// Verifies that a payment transaction exists and succeeded on the given RPC.
///
/// Retries up to 3 times with a 2-second delay to handle propagation lag.
///
/// # Errors
/// - `400 Bad Request` if the tx does not exist after retries, or reverted.
/// - `500 Internal Server Error` if the RPC call itself fails.
pub async fn verify_payment_tx(rpc_url: &str, tx_hash_str: &str) -> Result<(), ApiError> {
    let url: url::Url = rpc_url
        .parse()
        .map_err(|_| ApiError::internal("Invalid source chain RPC URL — check CHAIN_RPC_* env vars"))?;

    let tx_hash: TxHash = tx_hash_str
        .trim()
        .parse()
        .map_err(|_| ApiError::bad_request("payment_tx_hash is not a valid transaction hash"))?;

    let provider = ProviderBuilder::new().on_http(url);

    let mut last_err: Option<String> = None;

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
                return Ok(());
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

    Err(ApiError::bad_request(format!(
        "Payment transaction not found on source chain after 3 attempts ({}). \
         Wait for confirmation and retry.",
        last_err.unwrap_or_default()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_tx_hash_returns_bad_request() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(verify_payment_tx(
            "https://example.com",
            "not-a-tx-hash",
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
        ));
        assert!(result.is_err());
    }
}
