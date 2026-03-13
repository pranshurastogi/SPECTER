//! Turso (libSQL) persistence for the SPECTER registry.
//!
//! All data is stored in a remote Turso cloud database over HTTP —
//! fully durable across Cloud Run restarts, redeploys, and scale-to-zero.

pub mod registry;
pub mod scan;
pub mod schema;
pub mod yellow;

pub use registry::TursoRegistry;
pub use scan::ScanPositionStore;
pub use yellow::YellowChannelStore;
