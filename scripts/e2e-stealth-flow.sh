#!/usr/bin/env bash
# End-to-end test: generate keys -> create stealth payment -> publish -> scan -> verify
# Includes: address derivation check, wallet import check, event-poller health check.
#
# Prerequisites:
#   Server: cd specter && cargo run --bin specter -- serve --port 3001
#   Commands: curl, jq
#   Optional: node (ethers v6) or python3 (eth_account) for PK→address verification
set -euo pipefail

BASE_URL="${VITE_API_BASE_URL:-http://localhost:3001}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
fail() { echo -e "  ${RED}✗${RESET} $*"; }
info() { echo -e "  ${CYAN}→${RESET} $*"; }
step() { echo -e "\n${BOLD}==> $*${RESET}"; }

echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║       SPECTER E2E Stealth Flow (bash)               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo "  Base URL: $BASE_URL"

# ── dependency check ─────────────────────────────────────────────────────────
for cmd in curl jq; do
  command -v "$cmd" &>/dev/null || { echo "Missing required command: $cmd"; exit 1; }
done

# ── 1. Generate keys ─────────────────────────────────────────────────────────
step "1/7  Generate SPECTER keys"
KEYS=$(curl -sf -X POST "$BASE_URL/api/v1/keys/generate" \
  -H "Content-Type: application/json") \
  || { fail "HTTP request failed — is the server running at $BASE_URL?"; exit 1; }

echo "$KEYS" | jq -e '.meta_address' >/dev/null \
  || { fail "Unexpected response:"; echo "$KEYS" | jq .; exit 1; }

META_ADDRESS=$(echo "$KEYS" | jq -r '.meta_address')
VIEWING_SK=$(echo   "$KEYS" | jq -r '.viewing_sk')
SPENDING_PK=$(echo  "$KEYS" | jq -r '.spending_pk')
SPENDING_SK=$(echo  "$KEYS" | jq -r '.spending_sk')
ok "meta_address: ${META_ADDRESS:0:24}..."

# ── 2. Create stealth payment ─────────────────────────────────────────────────
step "2/7  Create stealth payment"
CREATE=$(curl -sf -X POST "$BASE_URL/api/v1/stealth/create" \
  -H "Content-Type: application/json" \
  -d "{\"meta_address\": \"$META_ADDRESS\"}")

echo "$CREATE" | jq -e '.stealth_address' >/dev/null \
  || { fail "Create stealth failed:"; echo "$CREATE" | jq .; exit 1; }

STEALTH_ADDRESS=$(echo "$CREATE" | jq -r '.stealth_address')
PAYMENT_ID=$(echo      "$CREATE" | jq -r '.payment_id')
VIEW_TAG=$(echo        "$CREATE" | jq -r '.view_tag')
ok "stealth_address : $STEALTH_ADDRESS"
ok "payment_id      : $PAYMENT_ID"
ok "view_tag        : $VIEW_TAG"

# ── 3. Publish announcement ───────────────────────────────────────────────────
step "3/7  Publish announcement (dev mode — no relayer)"
# In dev mode the server requires a client-supplied tx_hash.
# In production (RELAYER_PRIVATE_KEY set) the server broadcasts on Monad and
# returns monad_tx_hash; no tx_hash input needed.
PUBLISH=$(curl -sf -X POST "$BASE_URL/api/v1/registry/announcements" \
  -H "Content-Type: application/json" \
  -d "{
    \"payment_id\": \"$PAYMENT_ID\",
    \"tx_hash\":    \"0xe2e000000000000000000000000000000000000000000000000000000000dead\",
    \"chain\":      \"sepolia\",
    \"payment_tx_hash\": \"0xe2e000000000000000000000000000000000000000000000000000000000cafe\",
    \"source_chain_id\": 11155111,
    \"amount\":     \"1000000000000000\"
  }")

echo "$PUBLISH" | jq -e '.id' >/dev/null \
  || { fail "Publish failed:"; echo "$PUBLISH" | jq .; exit 1; }

ANN_ID=$(echo "$PUBLISH" | jq -r '.id')
MONAD_TX=$(echo "$PUBLISH" | jq -r '.monad_tx_hash // "none (dev mode)"')
ok "announcement id : $ANN_ID"
ok "monad_tx_hash   : $MONAD_TX"

# ── 4. Scan ───────────────────────────────────────────────────────────────────
step "4/7  Scan for payments"
VIEWING_SK_STRIP="${VIEWING_SK#0x}"
SPENDING_PK_STRIP="${SPENDING_PK#0x}"
SPENDING_SK_STRIP="${SPENDING_SK#0x}"

SCAN=$(curl -sf -X POST "$BASE_URL/api/v1/stealth/scan" \
  -H "Content-Type: application/json" \
  -d "{
    \"viewing_sk\": \"$VIEWING_SK_STRIP\",
    \"spending_pk\": \"$SPENDING_PK_STRIP\",
    \"spending_sk\": \"$SPENDING_SK_STRIP\"
  }")

echo "$SCAN" | jq -e '.discoveries' >/dev/null \
  || { fail "Scan failed:"; echo "$SCAN" | jq .; exit 1; }

COUNT=$(echo "$SCAN" | jq '.discoveries | length')
SCANNED=$(echo "$SCAN" | jq '.stats.total_scanned')
DURATION=$(echo "$SCAN" | jq '.stats.duration_ms')
ok "discovered: $COUNT / $SCANNED scanned in ${DURATION}ms"

if [ "$COUNT" -lt 1 ]; then
  fail "Expected at least 1 discovery, got $COUNT"
  echo "$SCAN" | jq .
  exit 1
fi

DISCOVERED_STEALTH=$(echo "$SCAN" | jq -r '.discoveries[0].stealth_address')
ETH_PRIVATE_KEY=$(echo    "$SCAN" | jq -r '.discoveries[0].eth_private_key')

# ── 5. Stealth address agreement ──────────────────────────────────────────────
step "5/7  Verify create and scan agree on stealth_address"
if [ "$STEALTH_ADDRESS" != "$DISCOVERED_STEALTH" ]; then
  fail "MISMATCH — create: $STEALTH_ADDRESS | scan: $DISCOVERED_STEALTH"
  exit 1
fi
ok "create and scan report the same stealth_address: $STEALTH_ADDRESS"

# ── 6. Wallet import (PK → address) ──────────────────────────────────────────
step "6/7  Verify eth_private_key → stealth_address (MetaMask compatibility)"
PK_HEX="${ETH_PRIVATE_KEY#0x}"
ADDR_FROM_PK=""

if command -v node &>/dev/null; then
  ADDR_FROM_PK=$(node -e "
    const { Wallet } = require('ethers');
    try {
      const w = new Wallet('0x' + process.argv[1]);
      console.log(w.address);
    } catch (e) {
      // ethers v5 fallback
      try {
        const { ethers } = require('ethers');
        console.log(new ethers.Wallet('0x' + process.argv[1]).address);
      } catch (_) { process.exit(1); }
    }
  " "$PK_HEX" 2>/dev/null) || ADDR_FROM_PK=""
fi

if [ -z "$ADDR_FROM_PK" ] && command -v python3 &>/dev/null; then
  if python3 -c "import eth_account" 2>/dev/null; then
    ADDR_FROM_PK=$(python3 -c "
import sys
from eth_account import Account
print(Account.from_key('0x' + sys.argv[1]).address)
" "$PK_HEX" 2>/dev/null) || ADDR_FROM_PK=""
  fi
fi

if [ -z "$ADDR_FROM_PK" ]; then
  info "Skipping PK→address check (install node/ethers or python3/eth_account)"
  info "Manual check: import eth_private_key in MetaMask → address should be $DISCOVERED_STEALTH"
else
  ADDR_LOWER=$(echo "$ADDR_FROM_PK"       | tr '[:upper:]' '[:lower:]')
  STEALTH_LOWER=$(echo "$DISCOVERED_STEALTH" | tr '[:upper:]' '[:lower:]')
  if [ "$ADDR_LOWER" != "$STEALTH_LOWER" ]; then
    fail "PK mismatch: expected $DISCOVERED_STEALTH, derived $ADDR_FROM_PK"
    exit 1
  fi
  ok "eth_private_key derives to $ADDR_FROM_PK"
fi

# ── 7. Health check (including event-poller status) ──────────────────────────
step "7/7  Health check — API + event-poller status"
HEALTH=$(curl -sf "$BASE_URL/health") \
  || { fail "Health endpoint unreachable"; exit 1; }

STATUS=$(echo         "$HEALTH" | jq -r '.status')
RELAYER_OK=$(echo     "$HEALTH" | jq -r '.relayer_ok')
TURSO_OK=$(echo       "$HEALTH" | jq -r '.turso_ok')
POLLER_OK=$(echo      "$HEALTH" | jq -r '.poller_ok')
POLLER_BLOCK=$(echo   "$HEALTH" | jq -r '.poller_last_block // "null"')
VERSION=$(echo        "$HEALTH" | jq -r '.version')
UPTIME=$(echo         "$HEALTH" | jq -r '.uptime_seconds')

ok "status         : $STATUS (v$VERSION, up ${UPTIME}s)"

if [ "$TURSO_OK" = "true" ]; then
  ok "turso          : connected"
else
  fail "turso          : UNREACHABLE"
fi

if [ "$RELAYER_OK" = "true" ]; then
  ok "relayer        : active (server-side relay enabled)"
else
  info "relayer        : not configured (dev mode — client supplies tx_hash)"
fi

if [ "$POLLER_OK" = "true" ]; then
  ok "event-poller   : running (last block: $POLLER_BLOCK)"
elif [ "$POLLER_BLOCK" = "null" ]; then
  info "event-poller   : not started yet (no checkpoint in DB)"
  info "  → Start it: cd event-poller && npm start"
else
  info "event-poller   : seen block $POLLER_BLOCK (may not be running)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "\n  ${GREEN}${BOLD}✅  E2E PASSED${RESET}\n"
echo "  stealth_address : $STEALTH_ADDRESS"
echo "  announcement_id : $ANN_ID"
echo "  view_tag        : $VIEW_TAG"
echo "  monad_tx_hash   : $MONAD_TX"
echo ""
echo "  Verify via API:"
echo "    GET $BASE_URL/api/v1/registry/announcements?view_tag=$VIEW_TAG"
echo "    GET $BASE_URL/health"
echo ""
