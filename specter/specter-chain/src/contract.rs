//! Alloy contract bindings for SPECTERAnnouncer.
//!
//! This module provides the typed contract interface for interacting with
//! the SPECTERAnnouncer contract deployed on-chain.

use alloy::sol;

sol! {
    #[sol(rpc)]
    contract SPECTERAnnouncer {
        /// Emitted when an announcement is published.
        ///
        /// # Parameters
        /// * `schemeId` - SPECTER scheme identifier (e.g., 1000 for ML-KEM)
        /// * `stealthAddress` - The stealth address for this announcement
        /// * `caller` - Address that published the announcement
        /// * `ephemeralPubKey` - Kyber ephemeral public key (1088 bytes)
        /// * `metadata` - Fixed 77-byte metadata layout
        event Announcement(
            uint256 indexed schemeId,
            address indexed stealthAddress,
            address indexed caller,
            bytes ephemeralPubKey,
            bytes metadata
        );

        /// Publishes an announcement to the registry.
        ///
        /// # Parameters
        /// * `stealthAddress` - The stealth address for this announcement
        /// * `ephemeralPubKey` - Kyber ephemeral public key (1088 bytes)
        /// * `metadata` - Fixed 77-byte metadata layout
        #[derive(Debug)]
        function announce(
            address stealthAddress,
            bytes calldata ephemeralPubKey,
            bytes calldata metadata
        ) external;

        /// Returns the block number at which the contract was deployed.
        #[derive(Debug)]
        function deployBlock() external view returns (uint256);
    }
}
