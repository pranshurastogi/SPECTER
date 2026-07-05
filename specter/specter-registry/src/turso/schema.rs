//! Turso (libSQL) final schema. Single clean definition — no migration ladder
//! (no backward compatibility; cutover uses a fresh/cleared database).

/// Schema version marker stored in registry_metadata.
pub const SCHEMA_VERSION: i32 = 1;

/// DDL executed on startup (CREATE IF NOT EXISTS — idempotent).
pub const SCHEMA_STATEMENTS: &[&str] = &[
    // ── announcements ──────────────────────────────────────────────────────
    "CREATE TABLE IF NOT EXISTS announcements (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        view_tag              INTEGER NOT NULL,
        timestamp             INTEGER NOT NULL,
        ephemeral_key         BLOB,
        ephemeral_key_hash    BLOB,
        metadata_blob         BLOB,
        payment_tx_hash_hmac  BLOB,
        on_chain              INTEGER NOT NULL DEFAULT 0,
        block_number          INTEGER,
        tx_hash               TEXT    UNIQUE,
        chain                 TEXT,
        stealth_address       TEXT,
        record_source         TEXT    NOT NULL DEFAULT 'api',
        created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )",
    "CREATE INDEX IF NOT EXISTS idx_announcements_view_tag      ON announcements(view_tag)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_timestamp     ON announcements(timestamp DESC)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_block_number  ON announcements(block_number)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_on_chain      ON announcements(on_chain)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_stealth_addr  ON announcements(stealth_address)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_created_at    ON announcements(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_record_source ON announcements(record_source)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_ephem_hash    ON announcements(ephemeral_key_hash)",
    // Double-announce dedup: one row per source-chain payment (keyed HMAC).
    // Partial index → multiple NULL-hmac rows (no payment hash) are allowed.
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

    // ── _telemetry (internal; hashed IP only, never raw) ───────────────────
    "CREATE TABLE IF NOT EXISTS _telemetry (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        event    TEXT    NOT NULL,
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
    "CREATE INDEX IF NOT EXISTS _idx_tel_iph ON _telemetry(ip_hash)",
    "CREATE INDEX IF NOT EXISTS _idx_tel_evt ON _telemetry(event)",

    // ── pending_payments (durable in-flight stealth payments) ───────────────
    "CREATE TABLE IF NOT EXISTS pending_payments (
        payment_id            TEXT    PRIMARY KEY,
        announcement          BLOB    NOT NULL,
        shared_secret_wrapped BLOB    NOT NULL,
        created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        expires_at            INTEGER NOT NULL
    )",
    "CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_payments(expires_at)",

    // ── sweep_records (claim-flow history; one row per swept address) ───────
    // Public-after-broadcast data only. `identity_hash` is SHA-256 of the
    // meta-address bytes — the server cannot map it back to an identity
    // unless it already knows the meta-address.
    "CREATE TABLE IF NOT EXISTS sweep_records (
        id                 TEXT    PRIMARY KEY,
        receipt_id         TEXT    NOT NULL,
        identity_hash      TEXT    NOT NULL,
        chain              TEXT    NOT NULL,
        stealth_address    TEXT    NOT NULL,
        destination        TEXT    NOT NULL,
        destination_input  TEXT    NOT NULL,
        amount_base        TEXT    NOT NULL,
        fee_base           TEXT    NOT NULL,
        tx_hash            TEXT    NOT NULL,
        status             TEXT    NOT NULL,
        created_at         INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )",
    "CREATE INDEX IF NOT EXISTS idx_sweep_identity ON sweep_records(identity_hash, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_sweep_receipt  ON sweep_records(receipt_id)",
];
