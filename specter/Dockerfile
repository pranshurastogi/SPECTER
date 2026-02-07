# Build stage
FROM rust:1.83-bookworm AS builder
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
ENV PORT=3001

# Railway sets PORT at runtime
CMD ["sh", "-c", "/app/specter serve --port ${PORT:-3001}"]
