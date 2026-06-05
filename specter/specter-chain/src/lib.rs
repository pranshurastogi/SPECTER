//! SPECTER chain integration — indexing and announcing on-chain.
//!
//! This crate provides:
//! - **Indexer**: Background polling of SPECTERAnnouncer events with reorg protection
//! - **Announcer**: Server-side publishing of announcements for sponsored flows
//! - **Contract bindings**: Typed Alloy interface to SPECTERAnnouncer

pub mod contract;
pub mod indexer;
pub mod announcer;

// Re-export commonly-used items
pub use indexer::announcement_from_event;
pub use announcer::publish_announcement;
