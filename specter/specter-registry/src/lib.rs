//! # SPECTER Registry
//!
//! Announcement storage and retrieval for the SPECTER protocol.
//!
//! This crate provides multiple storage backends:
//!
//! - **Memory**: Fast in-memory storage for development and testing
//! - **File**: Persistent file-based storage for single-node deployments
//!
//! ## Example
//!
//! ```rust,ignore
//! use specter_registry::{MemoryRegistry, Registry};
//!
//! // Create in-memory registry
//! let registry = MemoryRegistry::new();
//!
//! // Publish an announcement
//! let id = registry.publish(announcement).await?;
//!
//! // Query by view tag (efficient!)
//! let matching = registry.get_by_view_tag(0x42).await?;
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs, rust_2018_idioms)]

mod file;
mod memory;

pub use file::FileRegistry;
pub use memory::MemoryRegistry;

// Re-export the trait from core
pub use specter_core::traits::AnnouncementRegistry as Registry;
