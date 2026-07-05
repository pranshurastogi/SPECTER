//! Turso (libSQL) persistence for the SPECTER registry.
//!
//! All data is stored in a remote Turso cloud database over HTTP —
//! fully durable across Cloud Run restarts, redeploys, and scale-to-zero.

pub mod pending;
pub mod registry;
pub mod scan;
pub mod schema;
pub mod sweeps;

pub use pending::PendingStore;
pub use registry::TursoRegistry;
pub use scan::ScanPositionStore;
pub use sweeps::{SweepRecord, SweepStore};
