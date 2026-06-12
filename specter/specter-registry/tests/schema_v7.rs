//! v7 schema: durable pending_payments table.
use specter_registry::turso::schema::SCHEMA_VERSION;
#[test]
fn schema_version_is_7() { assert_eq!(SCHEMA_VERSION, 7); }
