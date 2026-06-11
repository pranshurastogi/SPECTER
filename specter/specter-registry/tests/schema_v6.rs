//! v6 schema advances the version and is purely additive.

use specter_registry::turso::schema::SCHEMA_VERSION;

#[test]
fn schema_version_is_6() {
    assert_eq!(SCHEMA_VERSION, 6);
}
