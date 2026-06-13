//! Alloy contract bindings for SPECTERAnnouncer (new deployment).
//!
//! Event change vs. the previous deploy:
//!   - `schemeId` is no longer indexed.
//!   - The log carries `bytes32 ephemeralKeyHash = keccak256(ciphertext)`
//!     instead of the full 1088-byte `bytes ephemeralPubKey`. The ciphertext
//!     lives in `announce()` calldata and is fetched on view-tag match.

use alloy::sol;

sol! {
    #[sol(rpc)]
    contract SPECTERAnnouncer {
        /// Emitted when an announcement is published.
        /// `ephemeralKeyHash` = keccak256(ML-KEM-768 ciphertext); the ciphertext
        /// itself is recoverable from the `announce()` calldata of this tx.
        event Announcement(
            uint256 schemeId,
            address indexed stealthAddress,
            address indexed caller,
            bytes32 ephemeralKeyHash,
            bytes metadata
        );

        /// Publishes a single announcement (ciphertext passed in calldata).
        #[derive(Debug)]
        function announce(
            address stealthAddress,
            bytes calldata ephemeralPubKey,
            bytes calldata metadata
        ) external;

        /// Overload taking an explicit schemeId (must equal SCHEME_ID = 1000).
        #[derive(Debug)]
        function announce(
            uint256 schemeId,
            address stealthAddress,
            bytes calldata ephemeralPubKey,
            bytes calldata metadata
        ) external;

        /// Batch announce — up to MAX_BATCH (50) entries.
        #[derive(Debug)]
        function announceMany(
            address[] calldata stealthAddresses,
            bytes[] calldata ephemeralPubKeys,
            bytes[] calldata metadatas
        ) external;

        /// Block at which the contract was deployed (immutable getter).
        #[derive(Debug)]
        function deployBlock() external view returns (uint256);

        // Custom errors — decode reverts into readable messages.
        error ZeroStealthAddress();
        error EphemeralKeyLength(uint256 actual, uint256 expected);
        error MetadataRequired();
        error SchemeMismatch(uint256 given, uint256 expected);
        error BatchEmpty();
        error BatchTooLarge(uint256 length, uint256 max);
        error BatchLengthMismatch();
    }
}
