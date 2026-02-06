#!/usr/bin/env bash
# Build and test SPECTER (Rust backend).
# Note: specter-api tests may fail in sandboxed environments on macOS.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SPECTER_DIR="$REPO_ROOT/specter"

echo "==> SPECTER build and test"
echo "    Specter: $SPECTER_DIR"
echo ""

if ! command -v cargo &>/dev/null; then
    echo "Rust/cargo not found. Install from https://rustup.rs"
    exit 1
fi

echo "==> Rust version"
rustc --version
cargo --version
echo ""

cd "$SPECTER_DIR"
echo "==> Building specter (all packages)"
cargo build
echo ""
echo "==> Running specter tests (all packages)"
cargo test
echo ""
echo "==> Done. All builds and tests passed."
echo ""
echo "E2E: Start server (cd specter && cargo run --bin specter -- serve --port 3001), then run $SCRIPT_DIR/e2e-stealth-flow.sh"
