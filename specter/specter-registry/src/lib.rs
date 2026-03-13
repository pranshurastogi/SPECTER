//! # SPECTER Registry
//!
//! Announcement storage and retrieval for the SPECTER protocol.
//!
//! Storage backends:
//! - **Memory**: Fast in-memory storage for development and testing (always available)
//! - **File**: File-based storage for single-node deployments
//! - **Turso**: Production-grade durable cloud storage (enable `turso` feature)
//!
//! ## Example
//!
//! ```rust,ignore
//! use specter_registry::{MemoryRegistry, Registry};
//!
//! let registry = MemoryRegistry::new();
//! let id = registry.publish(announcement).await?;
//! let matching = registry.get_by_view_tag(0x42).await?;
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs, rust_2018_idioms)]

mod file;
mod memory;

#[cfg(feature = "turso")]
pub mod turso;

pub use file::FileRegistry;
pub use memory::MemoryRegistry;

// Re-export the trait from core
pub use specter_core::traits::AnnouncementRegistry as Registry;
