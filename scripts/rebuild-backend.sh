#!/usr/bin/env bash
set -e

echo "🔧 Rebuilding SPECTER backend..."
echo ""

cd "$(dirname "$0")/../specter"

# Check if rust is configured
if ! command -v cargo &> /dev/null; then
    echo "❌ Cargo not found. Please install Rust:"
    echo "   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    echo "   Then run: source ~/.cargo/env"
    exit 1
fi

# Build in release mode
echo "📦 Building release binary (this may take a few minutes)..."
cargo build --release

echo ""
echo "✅ Backend rebuilt successfully!"
echo ""
echo "🚀 To start the backend:"
echo "   cargo run --release --bin specter -- serve --port 3001"
echo ""
