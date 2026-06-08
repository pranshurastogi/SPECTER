//! Turso (libSQL) schema definition and migration logic.

/// Current schema version. Increment on breaking schema changes.
pub const SCHEMA_VERSION: i32 = 2;

/// DDL statements executed in order on startup (CREATE IF NOT EXISTS — idempotent).
pub const SCHEMA_STATEMENTS: &[&str] = &[
    // ── announcements ──────────────────────────────────────────────────────
    "CREATE TABLE IF NOT EXISTS announcements (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        view_tag         INTEGER NOT NULL,
        timestamp        INTEGER NOT NULL,
        ephemeral_key    BLOB    NOT NULL,
        source_chain_id  INTEGER,
        on_chain         INTEGER NOT NULL DEFAULT 0,
        block_number     INTEGER,
        tx_hash          TEXT    UNIQUE,
        amount           TEXT,
        chain            TEXT,
        stealth_address  TEXT,
        block_tx_index   INTEGER,
        created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )",
    "CREATE INDEX IF NOT EXISTS idx_announcements_view_tag     ON announcements(view_tag)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_timestamp    ON announcements(timestamp DESC)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_source_chain ON announcements(source_chain_id)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_block_number ON announcements(block_number)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_on_chain     ON announcements(on_chain)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_stealth_addr ON announcements(stealth_address)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_created_at   ON announcements(created_at DESC)",

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

    // ── yellow_channels ────────────────────────────────────────────────────
    "CREATE TABLE IF NOT EXISTS yellow_channels (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id        BLOB    NOT NULL UNIQUE,
        status            TEXT    NOT NULL DEFAULT 'open',
        created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        closed_at         INTEGER,
        creator_wallet    TEXT,
        chain             TEXT,
        asset_address     TEXT,
        asset_symbol      TEXT,
        amount            TEXT    NOT NULL,
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

    // ── registry_metadata ──────────────────────────────────────────────────
    "CREATE TABLE IF NOT EXISTS registry_metadata (
        key        TEXT    PRIMARY KEY,
        value      TEXT    NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )",

    // ── announcement_deletions (compliance audit log) ──────────────────────
    "CREATE TABLE IF NOT EXISTS announcement_deletions (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id  INTEGER NOT NULL,
        reason           TEXT,
        deleted_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        deleted_by       TEXT
    )",
    "CREATE INDEX IF NOT EXISTS idx_announcement_deletions_aid ON announcement_deletions(announcement_id)",
];

/// Migration statements for upgrading from schema v1 → v2.
///
/// These are run after SCHEMA_STATEMENTS. "duplicate column" errors are caught
/// and silently ignored — meaning a column was already added in a previous run.
/// All other errors are fatal.
pub const MIGRATION_V1_TO_V2: &[&str] = &[
    // Replace Yellow's channel_id BLOB with source_chain_id INTEGER
    "ALTER TABLE announcements ADD COLUMN source_chain_id INTEGER",
    "ALTER TABLE announcements ADD COLUMN on_chain INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE announcements ADD COLUMN stealth_address TEXT",
    "ALTER TABLE announcements ADD COLUMN block_tx_index INTEGER",
    // New indices for migration columns
    "CREATE INDEX IF NOT EXISTS idx_announcements_source_chain ON announcements(source_chain_id)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_block_number ON announcements(block_number)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_on_chain     ON announcements(on_chain)",
    "CREATE INDEX IF NOT EXISTS idx_announcements_stealth_addr ON announcements(stealth_address)",
];
