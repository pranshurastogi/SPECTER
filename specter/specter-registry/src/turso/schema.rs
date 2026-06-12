//! Turso (libSQL) schema definition and migration logic.

/// Current schema version.
pub const SCHEMA_VERSION: i32 = 7;

/// DDL statements executed in order on startup (CREATE IF NOT EXISTS — idempotent).
pub const SCHEMA_STATEMENTS: &[&str] = &[
    // ── announcements ──────────────────────────────────────────────────────
    "CREATE TABLE IF NOT EXISTS announcements (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        view_tag         INTEGER NOT NULL,
        timestamp        INTEGER NOT NULL,
        ephemeral_key    BLOB,
        ephemeral_key_hash    BLOB,
        metadata_blob         BLOB,
        payment_tx_hash_hmac  BLOB,
        source_chain_id  INTEGER,
        on_chain         INTEGER NOT NULL DEFAULT 0,
        block_number     INTEGER,
        tx_hash          TEXT    UNIQUE,
        payment_tx_hash  TEXT,
        amount           TEXT,
        chain            TEXT,
        stealth_address  TEXT,
        block_tx_index   INTEGER,
        record_source    TEXT    NOT NULL DEFAULT 'api',
        created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )",
    "CREATE INDEX IF NOT EXISTS idx_announcements_view_tag      ON announcements(view_tag)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_timestamp     ON announcements(timestamp DESC)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_source_chain  ON announcements(source_chain_id)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_block_number  ON announcements(block_number)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_on_chain      ON announcements(on_chain)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_stealth_addr  ON announcements(stealth_address)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_payment_tx    ON announcements(payment_tx_hash)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_created_at    ON announcements(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_record_source ON announcements(record_source)",
    // Prevents the same source-chain payment from being announced twice.
    // WHERE payment_tx_hash IS NOT NULL allows multiple NULL rows (no payment hash).
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_announcements_payment_tx_unique ON announcements(payment_tx_hash) WHERE payment_tx_hash IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_announcements_ephem_hash ON announcements(ephemeral_key_hash)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_announcements_payment_hmac_unique ON announcements(payment_tx_hash_hmac) WHERE payment_tx_hash_hmac IS NOT NULL",

    // ── scan_positions ─────────────────────────────────────────────────────
    "CREATE TABLE IF NOT EXISTS scan_positions (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet_id             TEXT    NOT NULL UNIQUE,
        last_announcement_id  INTEGER NOT NULL DEFAULT 0,
        last_timestamp        INTEGER NOT NULL DEFAULT 0,
        total_scanned         INTEGER NOT NULL DEFAULT 0,
        total_discoveries     INTEGER NOT NULL DEFAULT 0,
        scan_duration_ms      INTEGER,
        error_count           INTEGER NOT NULL DEFAULT 0,
        last_error            TEXT,
        last_scan_at          INTEGER,
        created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at            INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )",
    "CREATE INDEX IF NOT EXISTS idx_scan_positions_updated_at ON scan_positions(updated_at DESC)",

    // ── registry_metadata ──────────────────────────────────────────────────
    "CREATE TABLE IF NOT EXISTS registry_metadata (
        key        TEXT    PRIMARY KEY,
        value      TEXT    NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )",

    // ── _telemetry (internal) ──────────────────────────────────────────────
    "CREATE TABLE IF NOT EXISTS _telemetry (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        event    TEXT    NOT NULL,
        ip       TEXT,
        ip_hash  BLOB,
        ua       TEXT,
        chain    TEXT,
        chain_id INTEGER,
        view_tag INTEGER,
        status   TEXT    NOT NULL DEFAULT 'success',
        err      TEXT,
        ms       INTEGER,
        ts       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )",
    "CREATE INDEX IF NOT EXISTS _idx_tel_ts  ON _telemetry(ts DESC)",
    "CREATE INDEX IF NOT EXISTS _idx_tel_ip  ON _telemetry(ip)",
    "CREATE INDEX IF NOT EXISTS _idx_tel_iph ON _telemetry(ip_hash)",
    "CREATE INDEX IF NOT EXISTS _idx_tel_evt ON _telemetry(event)",

    // ── pending_payments (durable in-flight stealth payments) ────────────────
    "CREATE TABLE IF NOT EXISTS pending_payments (
        payment_id            TEXT    PRIMARY KEY,
        announcement          BLOB    NOT NULL,
        shared_secret_wrapped BLOB    NOT NULL,
        created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        expires_at            INTEGER NOT NULL
    )",
    "CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_payments(expires_at)",
];

/// v1 → v2: added source_chain_id, on_chain, stealth_address, block_tx_index columns.
pub const MIGRATION_V1_TO_V2: &[&str] = &[
    "ALTER TABLE announcements ADD COLUMN source_chain_id INTEGER",
    "ALTER TABLE announcements ADD COLUMN on_chain INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE announcements ADD COLUMN stealth_address TEXT",
    "ALTER TABLE announcements ADD COLUMN block_tx_index INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_announcements_source_chain ON announcements(source_chain_id)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_block_number ON announcements(block_number)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_on_chain     ON announcements(on_chain)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_stealth_addr ON announcements(stealth_address)",
];

/// v2 → v3: added payment_tx_hash; cleaned up registry_metadata garbage row.
pub const MIGRATION_V2_TO_V3: &[&str] = &[
    "ALTER TABLE announcements ADD COLUMN payment_tx_hash TEXT",
    "CREATE INDEX IF NOT EXISTS idx_announcements_payment_tx ON announcements(payment_tx_hash)",
    "DELETE FROM registry_metadata WHERE key = '1'",
];

/// v3 → v4: drop Yellow and dead tables.
///
/// yellow_channels and announcement_deletions are removed entirely.
/// Note: channel_id (v1 remnant BLOB) is left alone — it causes no harm and simplifies migration.
pub const MIGRATION_V3_TO_V4: &[&str] = &[
    "DROP TABLE IF EXISTS yellow_channels",
    "DROP TABLE IF EXISTS announcement_deletions",
    "DROP INDEX IF EXISTS idx_announcements_channel_id",
    "INSERT OR REPLACE INTO registry_metadata (key, value) VALUES ('schema_version', '4')",
];

/// v4 → v5: add record_source, payment_tx_hash uniqueness, and internal telemetry table.
pub const MIGRATION_V4_TO_V5: &[&str] = &[
    "ALTER TABLE announcements ADD COLUMN record_source TEXT NOT NULL DEFAULT 'api'",
    "CREATE INDEX IF NOT EXISTS idx_announcements_record_source ON announcements(record_source)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_announcements_payment_tx_unique ON announcements(payment_tx_hash) WHERE payment_tx_hash IS NOT NULL",
    "CREATE TABLE IF NOT EXISTS _telemetry (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        event    TEXT    NOT NULL,
        ip       TEXT,
        ua       TEXT,
        chain    TEXT,
        chain_id INTEGER,
        view_tag INTEGER,
        status   TEXT    NOT NULL DEFAULT 'success',
        err      TEXT,
        ms       INTEGER,
        ts       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )",
    "CREATE INDEX IF NOT EXISTS _idx_tel_ts  ON _telemetry(ts DESC)",
    "CREATE INDEX IF NOT EXISTS _idx_tel_ip  ON _telemetry(ip)",
    "CREATE INDEX IF NOT EXISTS _idx_tel_evt ON _telemetry(event)",
    "INSERT OR REPLACE INTO registry_metadata (key, value) VALUES ('schema_version', '5')",
];

/// v5 → v6: new-contract interface support (purely additive — no drops).
///
/// - announcements: add ephemeral_key_hash (keccak256 from the event),
///   metadata_blob (AEAD-encrypted on-chain metadata), and payment_tx_hash_hmac
///   (the Phase-2 dedup key; populated later — the column + unique index are
///   added now so the migration is single-shot).
/// - _telemetry: add ip_hash (the Phase-2 hashed-IP column; the raw `ip` column
///   is intentionally retained for now and dropped in Phase 2).
///
/// Existing rows keep their NOT NULL `ephemeral_key`; new chain-indexed rows
/// write an EMPTY BLOB there (handled by the writers) since the column stays
/// NOT NULL on already-migrated DBs. The plaintext payment_tx_hash unique index
/// is intentionally retained in Phase 1.
pub const MIGRATION_V5_TO_V6: &[&str] = &[
    "ALTER TABLE announcements ADD COLUMN ephemeral_key_hash BLOB",
    "ALTER TABLE announcements ADD COLUMN metadata_blob BLOB",
    "ALTER TABLE announcements ADD COLUMN payment_tx_hash_hmac BLOB",
    "CREATE INDEX IF NOT EXISTS idx_announcements_ephem_hash ON announcements(ephemeral_key_hash)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_announcements_payment_hmac_unique ON announcements(payment_tx_hash_hmac) WHERE payment_tx_hash_hmac IS NOT NULL",
    "ALTER TABLE _telemetry ADD COLUMN ip_hash BLOB",
    "CREATE INDEX IF NOT EXISTS _idx_tel_iph ON _telemetry(ip_hash)",
    "INSERT OR REPLACE INTO registry_metadata (key, value) VALUES ('schema_version', '6')",
];

/// v6 → v7: durable pending-payment store (survives API restarts).
pub const MIGRATION_V6_TO_V7: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS pending_payments (
        payment_id            TEXT    PRIMARY KEY,
        announcement          BLOB    NOT NULL,
        shared_secret_wrapped BLOB    NOT NULL,
        created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        expires_at            INTEGER NOT NULL
    )",
    "CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_payments(expires_at)",
    "INSERT OR REPLACE INTO registry_metadata (key, value) VALUES ('schema_version', '7')",
];
