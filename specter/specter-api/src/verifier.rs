use alloy::network::TransactionResponse;
use alloy::primitives::{Address, TxHash, B256, U256};
use alloy::providers::{Provider, ProviderBuilder};
use axum::http::StatusCode;
use std::sync::OnceLock;
use std::time::Duration;
use tracing::warn;

use crate::error::ApiError;

/// Number of times a single RPC read is attempted before giving up.
const RPC_MAX_ATTEMPTS: u32 = 6;
/// Base backoff; doubles each retry and is capped at [`RPC_BACKOFF_CAP_MS`].
const RPC_BACKOFF_BASE_MS: u64 = 400;
const RPC_BACKOFF_CAP_MS: u64 = 4_000;

/// True for RPC errors that are transient — the provider is busy or throttling,
/// not that the transaction is genuinely absent. These are worth retrying and
/// must NOT be surfaced to the user as "transaction not found", which sends
/// them chasing a problem that isn't theirs.
fn is_transient_rpc_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("429")
        || m.contains("rate limit")
        || m.contains("rate-limited")
        || m.contains("too many requests")
        || m.contains("timeout")
        || m.contains("timed out")
        || m.contains("connection")
        || m.contains("connect error")
        || m.contains("502")
        || m.contains("503")
        || m.contains("504")
        || m.contains("bad gateway")
        || m.contains("service unavailable")
        || m.contains("temporarily")
}

/// Backoff before attempt `n` (0-indexed): 0 for the first try, then
/// exponential from [`RPC_BACKOFF_BASE_MS`] capped at [`RPC_BACKOFF_CAP_MS`].
fn backoff_for(attempt: u32) -> Duration {
    if attempt == 0 {
        return Duration::ZERO;
    }
    let ms = RPC_BACKOFF_BASE_MS
        .saturating_mul(1u64 << (attempt - 1).min(5))
        .min(RPC_BACKOFF_CAP_MS);
    Duration::from_millis(ms)
}

/// 503 error telling the user the chain RPC is throttled, not that anything is
/// wrong with their payment. Paired with the `RPC_RATE_LIMITED` code so the
/// client can special-case it (keep the "retry" affordance, drop the alarm).
fn rate_limited_error() -> ApiError {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "The source chain's RPC is rate-limited right now, so we couldn't confirm the payment yet. \
         Your funds are safe on-chain — wait a few seconds and retry.",
        "RPC_RATE_LIMITED",
    )
}

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
/// Each RPC read is retried up to [`RPC_MAX_ATTEMPTS`] times with exponential
/// backoff. Throttled/transient failures (HTTP 429, timeouts, 5xx) are told
/// apart from a genuinely-absent transaction so a rate-limited provider is
/// reported as such instead of a scary "transaction not found".
///
/// # Errors
/// - `400 Bad Request` if the tx is genuinely absent after retries, or reverted.
/// - `503 Service Unavailable` (code `RPC_RATE_LIMITED`) if the RPC only ever
///   throttled us, so the caller can retry without alarming the user.
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

    // ── Fetch the receipt, retrying transient/throttled RPC errors ──────────
    // `saw_transient` records whether the *reason* we're still empty is the RPC
    // throttling us, so a rate-limit is never mislabeled "transaction not found".
    let mut last_err: Option<String> = None;
    let mut saw_transient = false;
    let mut receipt_opt = None;

    for attempt in 0..RPC_MAX_ATTEMPTS {
        tokio::time::sleep(backoff_for(attempt)).await;

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
                // Genuinely not indexed yet — keep waiting (propagation lag).
                last_err = Some("transaction not yet indexed by the RPC".into());
            }
            Err(e) => {
                let es = e.to_string();
                let transient = is_transient_rpc_error(&es);
                saw_transient |= transient;
                warn!(tx_hash = %tx_hash_str, attempt, transient, error = %es, "RPC call failed during payment verification");
                last_err = Some(format!("RPC error: {es}"));
                // A hard (non-transient) RPC failure won't fix itself by
                // retrying against the same endpoint — stop early.
                if !transient {
                    break;
                }
            }
        }
    }

    let receipt = match receipt_opt {
        Some(r) => r,
        None if saw_transient => return Err(rate_limited_error()),
        None => {
            return Err(ApiError::bad_request(format!(
                "Payment transaction isn't visible on the source chain yet — it may still be \
                 confirming. Wait a moment and retry. ({})",
                last_err.unwrap_or_default()
            )));
        }
    };

    // Fetch the full tx to inspect the native recipient + value — same retry
    // discipline, since this call is just as exposed to throttling.
    let mut tx_opt = None;
    let mut tx_transient = false;
    let mut tx_last_err: Option<String> = None;
    for attempt in 0..RPC_MAX_ATTEMPTS {
        tokio::time::sleep(backoff_for(attempt)).await;
        match provider.get_transaction_by_hash(tx_hash).await {
            Ok(Some(tx)) => {
                tx_opt = Some(tx);
                break;
            }
            Ok(None) => {
                tx_last_err = Some("transaction body not yet available".into());
            }
            Err(e) => {
                let es = e.to_string();
                let transient = is_transient_rpc_error(&es);
                tx_transient |= transient;
                warn!(tx_hash = %tx_hash_str, attempt, transient, error = %es, "RPC error fetching tx for payment verification");
                tx_last_err = Some(es);
                if !transient {
                    break;
                }
            }
        }
    }
    let tx = match tx_opt {
        Some(t) => t,
        None if tx_transient => return Err(rate_limited_error()),
        None => {
            return Err(ApiError::bad_request(format!(
                "Couldn't read the payment transaction from the source chain — wait a moment and \
                 retry. ({})",
                tx_last_err.unwrap_or_default()
            )));
        }
    };

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
    fn classifies_throttle_and_transport_errors_as_transient() {
        for msg in [
            "HTTP error 429 with body: {\"error\":{\"code\":429}}",
            "Your app has been rate-limited due to unusually high traffic",
            "error sending request: operation timed out",
            "connection reset by peer",
            "502 Bad Gateway",
            "503 Service Unavailable",
        ] {
            assert!(is_transient_rpc_error(msg), "should be transient: {msg}");
        }
    }

    #[test]
    fn does_not_treat_real_failures_as_transient() {
        for msg in [
            "execution reverted",
            "invalid transaction hash",
            "nonce too low",
        ] {
            assert!(
                !is_transient_rpc_error(msg),
                "should not be transient: {msg}"
            );
        }
    }

    #[test]
    fn backoff_grows_then_caps() {
        assert_eq!(backoff_for(0), Duration::ZERO);
        assert_eq!(backoff_for(1), Duration::from_millis(RPC_BACKOFF_BASE_MS));
        assert_eq!(
            backoff_for(2),
            Duration::from_millis(RPC_BACKOFF_BASE_MS * 2)
        );
        // Later attempts are clamped to the cap, never unbounded.
        assert_eq!(backoff_for(20), Duration::from_millis(RPC_BACKOFF_CAP_MS));
    }

    #[test]
    fn rate_limited_error_is_503_with_code() {
        let err = rate_limited_error();
        let dbg = format!("{err:?}");
        assert!(dbg.contains("RPC_RATE_LIMITED"), "carries the code: {dbg}");
    }

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
