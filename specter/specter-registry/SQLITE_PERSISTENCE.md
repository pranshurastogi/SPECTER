# SPECTER SQLite Persistence Layer

Production-grade durable storage for the SPECTER announcement registry, scanner checkpoints, and Yellow channel lifecycle.

## Overview

Replaces the ephemeral in-memory backend with a single-file SQLite database that survives process restarts, supports efficient incremental scans, and provides operational visibility.

### Components

| Module | Purpose |
|--------|---------|
| `SqliteRegistry` | `AnnouncementRegistry` trait impl — publish, query, stats |
| `ScanPositionStore` | Per-wallet scanner checkpoints for incremental scan resumption |
| `YellowChannelStore` | Yellow channel lifecycle (create, fund, close, status) |

## Schema

5 tables with appropriate indexes:

- **`announcements`** — Primary registry (indexed by view_tag, timestamp, channel_id, tx_hash)
- **`scan_positions`** — Per-wallet scanner progress (upsert on each scan)
- **`yellow_channels`** — Channel lifecycle with FK to announcements
- **`registry_metadata`** — Key-value store for schema version, init time
- **`announcement_deletions`** — Compliance audit log for removed entries

## Quick Start

### Environment Variables

```bash
# Switch to SQLite backend (default: in-memory)
REGISTRY_BACKEND=sqlite
REGISTRY_SQLITE_PATH=/data/specter.db
```

### Programmatic Usage

```rust
use specter_registry::sqlite::{SqliteRegistry, ScanPositionStore, YellowChannelStore};
use specter_core::traits::AnnouncementRegistry;

// Open (or create) database
let registry = SqliteRegistry::new("/data/specter.db").await?;

// Use the trait
let id = registry.publish(announcement).await?;
let results = registry.get_by_view_tag(0x42).await?;

// Scanner checkpoints
let scan_store = ScanPositionStore::new(registry.pool());
scan_store.save("wallet_abc", &position).await?;
let checkpoint = scan_store.load("wallet_abc").await?;

// Yellow channels
let yellow_store = YellowChannelStore::new(registry.pool());
yellow_store.create(&channel_id, "0xwallet", "ethereum", None, None, "1000", Some(ann_id)).await?;
```

### API Integration

The `AppState` in `specter-api` auto-selects the backend based on `REGISTRY_BACKEND`:

```bash
# Production
REGISTRY_BACKEND=sqlite REGISTRY_SQLITE_PATH=/data/specter.db cargo run -p specter-api

# Development (default: ephemeral in-memory)
cargo run -p specter-api
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REGISTRY_BACKEND` | `memory` | `"sqlite"` for durable storage |
| `REGISTRY_SQLITE_PATH` | — | Path to `.db` file (required when backend=sqlite) |

### SQLite Tuning

The database is configured with:
- **WAL mode** — concurrent reads during writes
- **NORMAL synchronous** — good durability/performance tradeoff
- **5s busy timeout** — handles brief lock contention
- **Connection pool** — 10 connections for file-backed, 2 for in-memory
- **Foreign keys** enabled

## Testing

```bash
# Run all SQLite tests (25 tests)
cargo test -p specter-registry --features sqlite -- sqlite

# Run specific module tests
cargo test -p specter-registry --features sqlite -- sqlite::registry
cargo test -p specter-registry --features sqlite -- sqlite::scan
cargo test -p specter-registry --features sqlite -- sqlite::yellow

# Run with existing memory/file tests (no feature flag needed)
cargo test -p specter-registry
```

Tests use isolated in-memory databases via SQLite shared-cache URIs — no temp files needed.

## Migration from Memory/File Registry

```rust
// Export from existing registry
let announcements = memory_registry.all_announcements();

// Import into SQLite
let sqlite = SqliteRegistry::new("/data/specter.db").await?;
let imported = sqlite.import(announcements).await?;
println!("Imported {imported} announcements");
```

## Production Deployment

### Docker

```dockerfile
FROM rust:1.83 AS builder
WORKDIR /app
COPY . .
RUN cargo build --release -p specter-api

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/specter-api /usr/local/bin/
VOLUME ["/data"]
ENV REGISTRY_BACKEND=sqlite
ENV REGISTRY_SQLITE_PATH=/data/specter.db
EXPOSE 8080
CMD ["specter-api"]
```

### Kubernetes

Use a **StatefulSet** with a PersistentVolumeClaim (SQLite is single-writer):

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: specter-api
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: api
        env:
        - name: REGISTRY_BACKEND
          value: "sqlite"
        - name: REGISTRY_SQLITE_PATH
          value: "/data/specter.db"
        volumeMounts:
        - name: data
          mountPath: /data
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 10Gi
```

### Backup

```bash
# Hot backup (SQLite WAL mode allows reads during backup)
sqlite3 /data/specter.db ".backup /data/specter.db.backup"
```

## Architecture

```
specter-registry/src/sqlite/
  mod.rs       — Module exports
  schema.rs    — DDL statements (CREATE TABLE/INDEX)
  registry.rs  — SqliteRegistry + AnnouncementRegistry impl + LRU cache
  scan.rs      — ScanPositionStore (checkpoint CRUD)
  yellow.rs    — YellowChannelStore (channel lifecycle)
```

The `RegistryBackend` enum in `specter-api/src/state.rs` provides polymorphic dispatch between Memory and SQLite backends, exposing both trait methods and backend-specific helpers (`all_announcements`, `stats`).
