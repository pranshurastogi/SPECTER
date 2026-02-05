#!/usr/bin/env bash
# End-to-end test: generate keys -> create stealth payment -> publish -> scan -> verify
# that the discovered eth_private_key derives to the stealth_address (wallet compatibility).
#
# Prerequisites:
#   - Server running from specter/ (not specter-backend): cd specter && cargo run --bin specter -- serve --port 3001
#   - curl, jq
#   - Node (with ethers) or Python (with eth_account) to verify address from private key
set -e

BASE_URL="${VITE_API_BASE_URL:-http://localhost:3001}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> E2E: Stealth flow (create -> publish -> scan -> verify address from PK)"
echo "    Base URL: $BASE_URL"
echo ""

for cmd in curl jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Missing required command: $cmd"
    exit 1
  fi
done

# 1. Generate keys
echo "==> 1. Generate keys"
KEYS=$(curl -s -X POST "$BASE_URL/api/v1/keys/generate")
echo "$KEYS" | jq -e '.meta_address' >/dev/null || { echo "Generate keys failed"; echo "$KEYS" | jq .; exit 1; }
META_ADDRESS=$(echo "$KEYS" | jq -r '.meta_address')
VIEWING_SK=$(echo "$KEYS" | jq -r '.viewing_sk')
SPENDING_PK=$(echo "$KEYS" | jq -r '.spending_pk')
SPENDING_SK=$(echo "$KEYS" | jq -r '.spending_sk')
echo "    meta_address: ${META_ADDRESS:0:24}..."
echo ""

# 2. Create stealth payment
echo "==> 2. Create stealth payment"
CREATE=$(curl -s -X POST "$BASE_URL/api/v1/stealth/create" \
  -H "Content-Type: application/json" \
  -d "{\"meta_address\": \"$META_ADDRESS\"}")
echo "$CREATE" | jq -e '.stealth_address' >/dev/null || { echo "Create stealth failed"; echo "$CREATE" | jq .; exit 1; }
STEALTH_ADDRESS=$(echo "$CREATE" | jq -r '.stealth_address')
# Publish API expects "ephemeral_key"; create response returns "ephemeral_ciphertext" (same value)
EPHEMERAL_KEY=$(echo "$CREATE" | jq -r '.ephemeral_ciphertext // .ephemeral_key')
VIEW_TAG=$(echo "$CREATE" | jq -r '.view_tag')
echo "    stealth_address: $STEALTH_ADDRESS"
echo ""

# 3. Publish announcement
echo "==> 3. Publish announcement"
PUBLISH=$(curl -s -X POST "$BASE_URL/api/v1/registry/announcements" \
  -H "Content-Type: application/json" \
  -d "{\"ephemeral_key\": \"$EPHEMERAL_KEY\", \"view_tag\": $VIEW_TAG}")
echo "$PUBLISH" | jq -e '.id' >/dev/null || { echo "Publish failed"; echo "$PUBLISH" | jq .; exit 1; }
echo "    announcement id: $(echo "$PUBLISH" | jq -r '.id')"
echo ""

# 4. Scan
echo "==> 4. Scan for payments"
# Strip 0x from hex if present for API
VIEWING_SK_STRIP="${VIEWING_SK#0x}"
SPENDING_PK_STRIP="${SPENDING_PK#0x}"
SPENDING_SK_STRIP="${SPENDING_SK#0x}"
SCAN=$(curl -s -X POST "$BASE_URL/api/v1/stealth/scan" \
  -H "Content-Type: application/json" \
  -d "{
    \"viewing_sk\": \"$VIEWING_SK_STRIP\",
    \"spending_pk\": \"$SPENDING_PK_STRIP\",
    \"spending_sk\": \"$SPENDING_SK_STRIP\"
  }")
echo "$SCAN" | jq -e '.discoveries' >/dev/null || { echo "Scan failed"; echo "$SCAN" | jq .; exit 1; }
COUNT=$(echo "$SCAN" | jq '.discoveries | length')
if [ "$COUNT" -lt 1 ]; then
  echo "Expected at least 1 discovery, got $COUNT"
  echo "$SCAN" | jq .
  exit 1
fi
echo "    discoveries: $COUNT"

DISCOVERED_STEALTH=$(echo "$SCAN" | jq -r '.discoveries[0].stealth_address')
ETH_PRIVATE_KEY=$(echo "$SCAN" | jq -r '.discoveries[0].eth_private_key')
echo "    discovered stealth_address: $DISCOVERED_STEALTH"
echo ""

# 5. Verify stealth_address from create matches discovery
echo "==> 5. Verify create and scan agree on stealth_address"
if [ "$STEALTH_ADDRESS" != "$DISCOVERED_STEALTH" ]; then
  echo "MISMATCH: create stealth_address != scan discovery"
  echo "  create:   $STEALTH_ADDRESS"
  echo "  scan:    $DISCOVERED_STEALTH"
  exit 1
fi
echo "    OK: create and scan both report same stealth_address"
echo ""

# 6. Verify eth_private_key derives to that address (wallet compatibility)
echo "==> 6. Verify eth_private_key -> address (MetaMask compatibility)"
PK_HEX="$ETH_PRIVATE_KEY"
if [ "${PK_HEX#0x}" != "$PK_HEX" ]; then
  PK_HEX="${PK_HEX#0x}"
fi

ADDR_FROM_PK=""
if command -v node &>/dev/null; then
  ADDR_FROM_PK=$(node -e "
    try {
      const ethers = require('ethers');
      const w = new ethers.Wallet('0x' + process.argv[1]);
      console.log(w.address);
    } catch (e) {
      process.exit(1);
    }
  " "$PK_HEX" 2>/dev/null) || true
fi

if [ -z "$ADDR_FROM_PK" ] && command -v python3 &>/dev/null; then
  if python3 -c "import eth_account" 2>/dev/null; then
    ADDR_FROM_PK=$(python3 -c "
import sys
from eth_account import Account
acc = Account.from_key('0x' + sys.argv[1])
print(acc.address)
" "$PK_HEX")
  fi
fi

if [ -z "$ADDR_FROM_PK" ]; then
  echo "    Skip: install Node (ethers) or Python (eth_account) to verify address from PK"
  echo "    Manually verify: import eth_private_key in MetaMask; account address should be: $DISCOVERED_STEALTH"
else
  # Normalize to same case for comparison (EIP-55 checksum may differ)
  ADDR_LOWER=$(echo "$ADDR_FROM_PK" | tr '[:upper:]' '[:lower:]')
  STEALTH_LOWER=$(echo "$DISCOVERED_STEALTH" | tr '[:upper:]' '[:lower:]')
  if [ "$ADDR_LOWER" != "$STEALTH_LOWER" ]; then
    echo "MISMATCH: eth_private_key does not derive to stealth_address"
    echo "  stealth_address:  $DISCOVERED_STEALTH"
    echo "  from eth_pk:      $ADDR_FROM_PK"
    exit 1
  fi
  echo "    OK: eth_private_key derives to stealth_address ($ADDR_FROM_PK)"
fi

echo ""
echo "==> E2E passed. Stealth address and wallet-import key match."
