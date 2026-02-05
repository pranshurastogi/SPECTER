#!/usr/bin/env bash
# Build and test SPECTER (Rust backend + optional frontend).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SPECTER_DIR="$REPO_ROOT/specter"

echo "==> SPECTER build and test"
echo "    Repo root: $REPO_ROOT"
echo "    Specter:   $SPECTER_DIR"
echo ""

# Ensure Rust is available
if ! command -v cargo &>/dev/null; then
    echo "Rust/cargo not found. Install from https://rustup.rs then run: rustup default stable"
    exit 1
fi

echo "==> Rust version"
rustc --version
cargo --version
echo ""

echo "==> Building specter (all packages)"
cd "$SPECTER_DIR"
cargo build
echo ""

echo "==> Running specter tests (all packages)"
cargo test
echo ""

echo "==> Running specter-crypto tests explicitly"
cargo test -p specter-crypto
echo ""

echo "==> Running specter-stealth round-trip test (address matches eth_private_key)"
cargo test -p specter-stealth test_stealth_address_matches_eth_private_key
echo ""

echo "==> Done. All builds and tests passed."
echo ""
echo "To run the full E2E flow against a live server (generate -> create -> publish -> scan -> verify):"
echo "  1. Start server: cd $SPECTER_DIR && cargo run --bin specter -- serve --port 3001"
echo "  2. In another terminal: $SCRIPT_DIR/e2e-stealth-flow.sh"
