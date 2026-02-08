# Build stage
# Rust 1.85+ required for dependencies using edition2024 (e.g. ruint)
FROM rust:1.85-bookworm AS builder
WORKDIR /app

# Copy workspace manifests and lockfile
COPY Cargo.toml Cargo.lock ./
# Copy all workspace member crates (needed for cargo build -p specter-cli)
COPY specter-core ./specter-core
COPY specter-cache ./specter-cache
COPY specter-crypto ./specter-crypto
COPY specter-stealth ./specter-stealth
COPY specter-registry ./specter-registry
COPY specter-scanner ./specter-scanner
COPY specter-ipfs ./specter-ipfs
COPY specter-ens ./specter-ens
COPY specter-yellow ./specter-yellow
COPY specter-suins ./specter-suins
COPY specter-api ./specter-api
COPY specter-cli ./specter-cli

RUN cargo build --release -p specter-cli

# Runtime stage
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/specter /app/specter

EXPOSE 3001

# PORT is read from env by the binary via clap (defaults to 3001)
CMD ["/app/specter", "serve"]
