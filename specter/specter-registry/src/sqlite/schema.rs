//! SQLite schema definition and migration logic.

/// Current schema version. Increment on breaking changes.
pub const SCHEMA_VERSION: i32 = 1;

/// All DDL statements to execute, in order.
pub const SCHEMA_STATEMENTS: &[&str] = &[
    // ── announcements ──────────────────────────────────────────────────
    "CREATE TABLE IF NOT EXISTS announcements (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        view_tag      INTEGER NOT NULL,
        timestamp     INTEGER NOT NULL,
        ephemeral_key BLOB NOT NULL,
        channel_id    BLOB,
        block_number  INTEGER,
        tx_hash       TEXT UNIQUE,
        amount        TEXT,
        chain         TEXT,
        created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )",
    "CREATE INDEX IF NOT EXISTS idx_announcements_view_tag   ON announcements(view_tag)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_timestamp  ON announcements(timestamp DESC)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_channel_id ON announcements(channel_id)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at DESC)",

    // ── scan_positions ─────────────────────────────────────────────────
    "CREATE TABLE IF NOT EXISTS scan_positions (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet_id             TEXT NOT NULL UNIQUE,
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

    // ── yellow_channels ────────────────────────────────────────────────
    "CREATE TABLE IF NOT EXISTS yellow_channels (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id        BLOB NOT NULL UNIQUE,
        status            TEXT NOT NULL DEFAULT 'open',
        created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        closed_at         INTEGER,
        creator_wallet    TEXT,
        chain             TEXT,
        asset_address     TEXT,
        asset_symbol      TEXT,
        amount            TEXT NOT NULL,
        announcement_id   INTEGER,
        funding_tx_hash   TEXT UNIQUE,
        closing_tx_hash   TEXT UNIQUE,
        error_reason      TEXT,
        metadata          TEXT,
        updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY(announcement_id) REFERENCES announcements(id) ON DELETE SET NULL
    )",
    "CREATE INDEX IF NOT EXISTS idx_yellow_channels_status     ON yellow_channels(status)",
    "CREATE INDEX IF NOT EXISTS idx_yellow_channels_created_at ON yellow_channels(created_at DESC)",

    // ── registry_metadata ──────────────────────────────────────────────
    "CREATE TABLE IF NOT EXISTS registry_metadata (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )",

    // ── announcement_deletions (compliance audit log) ──────────────────
    "CREATE TABLE IF NOT EXISTS announcement_deletions (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id  INTEGER NOT NULL,
        reason           TEXT,
        deleted_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        deleted_by       TEXT
    )",
    "CREATE INDEX IF NOT EXISTS idx_announcement_deletions_aid ON announcement_deletions(announcement_id)",
];
