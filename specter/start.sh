#!/usr/bin/env sh
# Start SPECTER API server for Railway. Tries common binary locations.
# PORT is read from env by the binary via clap (defaults to 3001).
set -e
if [ -x "./target/release/specter" ]; then
  exec ./target/release/specter serve
fi
if [ -x "./bin/specter" ]; then
  exec ./bin/specter serve
fi
if command -v specter >/dev/null 2>&1; then
  exec specter serve
fi
echo "error: specter binary not found (tried ./target/release/specter, ./bin/specter, PATH)" >&2
exit 1
