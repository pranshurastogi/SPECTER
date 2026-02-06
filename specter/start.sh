#!/usr/bin/env sh
# Start SPECTER API server for Railway. Tries common binary locations.
set -e
PORT="${PORT:-3001}"
if [ -x "./target/release/specter" ]; then
  exec ./target/release/specter serve --port "$PORT"
fi
if [ -x "./bin/specter" ]; then
  exec ./bin/specter serve --port "$PORT"
fi
if command -v specter >/dev/null 2>&1; then
  exec specter serve --port "$PORT"
fi
echo "error: specter binary not found (tried ./target/release/specter, ./bin/specter, PATH)" >&2
exit 1
