//! SQLite-backed persistence for the SPECTER registry.
//!
//! Provides durable storage that survives process restarts, with efficient
//! indexing for view-tag lookups, time-range queries, and scanner checkpoints.

pub mod registry;
pub mod scan;
pub mod schema;
pub mod yellow;

pub use registry::SqliteRegistry;
pub use scan::ScanPositionStore;
pub use yellow::YellowChannelStore;
