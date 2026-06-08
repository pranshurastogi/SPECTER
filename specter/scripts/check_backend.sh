#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SPECTER Backend Pre-flight Checker
# Validates everything needed to run the backend before cargo run.
#
# Usage:
#   ./scripts/check_backend.sh              # checks against .env
#   ./scripts/check_backend.sh .env.staging # checks against a specific env file
#   ENV_FILE=.env.production ./scripts/check_backend.sh
#
# Exit codes:
#   0 = all checks passed (warnings allowed)
#   1 = one or more ERRORS found (backend will not start correctly)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECTER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ── Counters ─────────────────────────────────────────────────────────────────
ERRORS=0; WARNINGS=0; PASSES=0

pass()  { echo -e "  ${GREEN}✓${NC} $1"; PASSES=$((PASSES+1)); }
fail()  { echo -e "  ${RED}✗${NC} $1"; ERRORS=$((ERRORS+1)); }
warn()  { echo -e "  ${YELLOW}⚠${NC} $1"; WARNINGS=$((WARNINGS+1)); }
info()  { echo -e "  ${BLUE}→${NC} $1"; }
skip()  { echo -e "  ${CYAN}↷${NC} $1 (skipped)"; }
header(){ echo -e "\n${BOLD}${BLUE}[$1/${TOTAL_STEPS}] $2${NC}"; }

# ── Load .env ────────────────────────────────────────────────────────────────
ENV_FILE="${1:-${ENV_FILE:-.env}}"
cd "${SPECTER_DIR}"

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║          SPECTER Backend Pre-flight Checker             ║"
echo "║          $(date '+%Y-%m-%d %H:%M:%S %Z')                        ║"
echo "╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
info "Workspace: ${SPECTER_DIR}"
info "Env file:  ${ENV_FILE}"

if [[ -f "${ENV_FILE}" ]]; then
    # shellcheck disable=SC1090
    set -a; source "${ENV_FILE}"; set +a
    pass "Loaded ${ENV_FILE}"
else
    warn "${ENV_FILE} not found — relying on existing environment variables"
fi

TOTAL_STEPS=7

# ═════════════════════════════════════════════════════════════════════════════
# [1/7] PREREQUISITES
# ═════════════════════════════════════════════════════════════════════════════
header 1 "Prerequisites"

# Rust / Cargo
if command -v cargo &>/dev/null; then
    RUST_VER=$(rustc --version 2>/dev/null | awk '{print $2}')
    RUST_MIN="1.75.0"
    if [[ "$(printf '%s\n' "$RUST_MIN" "$RUST_VER" | sort -V | head -n1)" == "$RUST_MIN" ]]; then
        pass "Rust ${RUST_VER} (≥ ${RUST_MIN})"
    else
        fail "Rust ${RUST_VER} is too old — need ≥ ${RUST_MIN}"
    fi
else
    fail "cargo not found — install Rust via https://rustup.rs"
fi

# curl (for Turso connectivity check)
if command -v curl &>/dev/null; then
    pass "curl $(curl --version | head -1 | awk '{print $2}')"
else
    warn "curl not found — Turso connectivity check will be skipped"
fi

# python3 (for JSON parsing in schema check)
if command -v python3 &>/dev/null; then
    pass "python3 $(python3 --version 2>&1 | awk '{print $2}')"
else
    warn "python3 not found — Turso schema validation will be skipped"
fi

# ═════════════════════════════════════════════════════════════════════════════
# [2/7] ENVIRONMENT VARIABLES
# ═════════════════════════════════════════════════════════════════════════════
header 2 "Environment Variables"

check_var() {
    local name="$1" required="${2:-true}" format_re="${3:-}"
    local val="${!name:-}"

    if [[ -z "$val" ]]; then
        if [[ "$required" == "true" ]]; then
            fail "${name} is NOT SET (required)"
        else
            warn "${name} is not set (optional)"
        fi
        return
    fi

    if [[ -n "$format_re" ]] && ! echo "$val" | grep -qE "$format_re"; then
        fail "${name} has unexpected format: '${val}'"
        return
    fi

    # Redact secrets in output
    case "$name" in
        *TOKEN*|*KEY*|*SECRET*|*PASSWORD*|*AUTH*)
            local display="${val:0:6}...${val: -4}"
            pass "${name}=${display} (redacted)"
            ;;
        *)
            pass "${name}=${val}"
            ;;
    esac
}

# Registry backend
REGISTRY_BACKEND="${REGISTRY_BACKEND:-memory}"
check_var "REGISTRY_BACKEND" false "^(turso|memory)$"

if [[ "${REGISTRY_BACKEND:-}" == "turso" ]]; then
    check_var "TURSO_DATABASE_URL" true  "^libsql://"
    check_var "TURSO_AUTH_TOKEN"   true  ".{10,}"
else
    warn "REGISTRY_BACKEND is not 'turso' — using in-memory registry (data is ephemeral)"
fi

# Ethereum / ENS
check_var "ETH_RPC_URL" false "^https?://"

# Monad chain indexing
ANNOUNCEMENT_SOURCE="${ANNOUNCEMENT_SOURCE:-api}"
if [[ "$ANNOUNCEMENT_SOURCE" == "chain" ]]; then
    check_var "MONAD_RPC_URL"                 true  "^https?://"
    check_var "SPECTER_ANNOUNCER_ADDRESS"     true  "^0x[0-9a-fA-F]{40}$"
    check_var "SPECTER_ANNOUNCER_DEPLOY_BLOCK" true "^[0-9]+$"
else
    info "ANNOUNCEMENT_SOURCE=${ANNOUNCEMENT_SOURCE} (on-chain indexing disabled)"
    check_var "MONAD_TESTNET_RPC_URL"         false "^https?://"
    check_var "SPECTER_ANNOUNCER_ADDRESS"     false "^0x[0-9a-fA-F]{40}$"
fi

# IPFS / Pinata
check_var "PINATA_GATEWAY_URL"   false ".{5,}"
check_var "PINATA_GATEWAY_TOKEN" false ".{10,}"
check_var "PINATA_JWT"           false ".{10,}"

# Sui
check_var "SUI_RPC_URL" false "^https?://"

# ═════════════════════════════════════════════════════════════════════════════
# [3/7] SECURITY AUDIT
# ═════════════════════════════════════════════════════════════════════════════
header 3 "Security Audit"

# API Key
API_KEY="${API_KEY:-}"
if [[ -z "$API_KEY" ]]; then
    warn "API_KEY is not set — POST endpoints are UNPROTECTED (dev-mode only)"
elif [[ "${#API_KEY}" -lt 32 ]]; then
    warn "API_KEY is shorter than 32 characters — consider a longer key"
else
    pass "API_KEY is set (${#API_KEY} chars)"
fi

# CORS
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-*}"
if [[ "$ALLOWED_ORIGINS" == "*" ]]; then
    warn "ALLOWED_ORIGINS=* — all origins allowed (OK for dev, not for production)"
else
    pass "ALLOWED_ORIGINS is restricted: ${ALLOWED_ORIGINS}"
fi

# Rate limits
RATE_LIMIT_RPS="${RATE_LIMIT_RPS:-10}"
RATE_LIMIT_BURST="${RATE_LIMIT_BURST:-30}"
if [[ "$RATE_LIMIT_RPS" -le 0 ]]; then
    fail "RATE_LIMIT_RPS=${RATE_LIMIT_RPS} — must be > 0"
elif [[ "$RATE_LIMIT_RPS" -gt 1000 ]]; then
    warn "RATE_LIMIT_RPS=${RATE_LIMIT_RPS} — unusually high rate limit"
else
    pass "Rate limit: ${RATE_LIMIT_RPS} rps, burst ${RATE_LIMIT_BURST}"
fi

# Body size
MAX_BODY_SIZE="${MAX_BODY_SIZE:-1048576}"
if [[ "$MAX_BODY_SIZE" -gt 10485760 ]]; then
    warn "MAX_BODY_SIZE=${MAX_BODY_SIZE} bytes (> 10 MB) — consider reducing"
else
    pass "MAX_BODY_SIZE=${MAX_BODY_SIZE} bytes ($(( MAX_BODY_SIZE / 1024 )) KB)"
fi

# Private key leak guard — must NOT be in the env file for the backend
if [[ -n "${PRIVATE_KEY:-}" ]]; then
    warn "PRIVATE_KEY is set in environment — this is a signing key and should not be in the backend .env"
    warn "  Use PRIVATE_KEY only in the e2e test script, never in backend deployments"
fi

# .env permissions
if [[ -f "${ENV_FILE}" ]]; then
    PERMS=$(stat -f "%OLp" "${ENV_FILE}" 2>/dev/null || stat -c "%a" "${ENV_FILE}" 2>/dev/null || echo "unknown")
    if [[ "$PERMS" == "600" || "$PERMS" == "400" ]]; then
        pass "${ENV_FILE} permissions: ${PERMS} (owner-only)"
    else
        warn "${ENV_FILE} permissions: ${PERMS} — should be 600 (chmod 600 ${ENV_FILE})"
    fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# [4/7] TURSO CONNECTIVITY & SCHEMA
# ═════════════════════════════════════════════════════════════════════════════
header 4 "Turso Connectivity & Schema"

TURSO_DATABASE_URL="${TURSO_DATABASE_URL:-}"
TURSO_AUTH_TOKEN="${TURSO_AUTH_TOKEN:-}"
HTTP_RESPONSE=""   # set by Turso connectivity check; used by count query below
TURSO_HTTP=""

if [[ -z "$TURSO_DATABASE_URL" || -z "$TURSO_AUTH_TOKEN" ]]; then
    skip "Turso not configured — set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN"
elif ! command -v curl &>/dev/null; then
    skip "curl not available — cannot check Turso"
else
    # Convert libsql:// → https://
    TURSO_HTTP="${TURSO_DATABASE_URL/libsql:\/\//https://}"

    # ── Connectivity test ─────────────────────────────────────────────────
    info "Connecting to ${TURSO_HTTP}..."

    HTTP_RESPONSE=$(curl -s -o /tmp/turso_resp.json -w "%{http_code}" \
        -X POST "${TURSO_HTTP}/v2/pipeline" \
        -H "Authorization: Bearer ${TURSO_AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        --connect-timeout 10 \
        --max-time 15 \
        -d '{
            "requests": [
                {"type":"execute","stmt":{"sql":"SELECT 1 AS ok"}},
                {"type":"execute","stmt":{"sql":"SELECT name FROM sqlite_master WHERE type='\''table'\'' ORDER BY name"}},
                {"type":"execute","stmt":{"sql":"PRAGMA table_info(announcements)"}},
                {"type":"execute","stmt":{"sql":"SELECT value FROM registry_metadata WHERE key='\''schema_version'\'' LIMIT 1"}},
                {"type":"close"}
            ]
        }' 2>/dev/null || echo "000")

    if [[ "$HTTP_RESPONSE" == "200" ]]; then
        pass "Turso connected (HTTP 200)"
    elif [[ "$HTTP_RESPONSE" == "401" ]]; then
        fail "Turso auth failed (HTTP 401) — check TURSO_AUTH_TOKEN"
    elif [[ "$HTTP_RESPONSE" == "000" ]]; then
        fail "Turso connection refused — check TURSO_DATABASE_URL and network"
    else
        fail "Turso returned HTTP ${HTTP_RESPONSE}"
    fi

    if [[ "$HTTP_RESPONSE" == "200" ]] && command -v python3 &>/dev/null; then
        # ── Schema validation ─────────────────────────────────────────────
        python3 << 'PYEOF'
import json, sys

try:
    with open('/tmp/turso_resp.json') as f:
        data = json.load(f)
except Exception as e:
    print(f"  \033[0;31m✗\033[0m Cannot parse Turso response: {e}")
    sys.exit(0)

results = data.get('results', [])

# ── Tables present ────────────────────────────────────────────────────────
REQUIRED_TABLES = {
    'announcements', 'scan_positions', 'yellow_channels',
    'registry_metadata', 'announcement_deletions'
}

tables_result = results[1] if len(results) > 1 else {}
rows = tables_result.get('response', {}).get('result', {}).get('rows', [])
found_tables = {row[0]['value'] for row in rows if row}

missing = REQUIRED_TABLES - found_tables
extra = found_tables - REQUIRED_TABLES - {'sqlite_sequence'}

for t in sorted(found_tables - {'sqlite_sequence'}):
    print(f"  \033[0;32m✓\033[0m Table: {t}")
for t in sorted(missing):
    print(f"  \033[0;31m✗\033[0m Missing table: {t}  (run the API once to auto-migrate)")

if extra:
    for t in sorted(extra):
        print(f"  \033[1;33m⚠\033[0m Unknown table: {t}")

# ── announcements columns ─────────────────────────────────────────────────
REQUIRED_COLS = {
    'id', 'view_tag', 'timestamp', 'ephemeral_key',
    'source_chain_id', 'on_chain', 'block_number', 'tx_hash',
    'amount', 'chain', 'stealth_address', 'block_tx_index', 'created_at'
}
OLD_COLS = {'channel_id'}  # removed in schema v2

col_result = results[2] if len(results) > 2 else {}
col_rows = col_result.get('response', {}).get('result', {}).get('rows', [])
found_cols = {row[1]['value'] for row in col_rows if len(row) > 1}

missing_cols = REQUIRED_COLS - found_cols
old_cols_present = OLD_COLS & found_cols

if found_cols:
    missing_c = REQUIRED_COLS - found_cols
    if not missing_c:
        print(f"  \033[0;32m✓\033[0m announcements schema: all {len(REQUIRED_COLS)} columns present")
    else:
        for c in sorted(missing_c):
            print(f"  \033[0;31m✗\033[0m announcements.{c} column missing (run migration)")

    for c in sorted(old_cols_present):
        print(f"  \033[1;33m⚠\033[0m announcements.{c} is a deprecated column (schema v1 remnant)")

# ── schema_version ────────────────────────────────────────────────────────
ver_result = results[3] if len(results) > 3 else {}
ver_rows = ver_result.get('response', {}).get('result', {}).get('rows', [])
if ver_rows and ver_rows[0]:
    schema_ver = ver_rows[0][0]['value']
    expected = '2'
    if str(schema_ver) == expected:
        print(f"  \033[0;32m✓\033[0m Schema version: {schema_ver}")
    else:
        print(f"  \033[1;33m⚠\033[0m Schema version is {schema_ver}, expected {expected} — migration may be needed")
else:
    print(f"  \033[1;33m⚠\033[0m registry_metadata has no schema_version row (DB not yet initialized)")

PYEOF
    fi
fi

# ── Announcement count ─────────────────────────────────────────────────────
if [[ "$HTTP_RESPONSE" == "200" ]] && command -v python3 &>/dev/null; then
    COUNT_RESP=$(curl -s -o /tmp/turso_count.json -w "%{http_code}" \
        -X POST "${TURSO_HTTP}/v2/pipeline" \
        -H "Authorization: Bearer ${TURSO_AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        --connect-timeout 10 --max-time 10 \
        -d '{"requests":[
            {"type":"execute","stmt":{"sql":"SELECT COUNT(*) FROM announcements"}},
            {"type":"execute","stmt":{"sql":"SELECT COUNT(*) FROM announcements WHERE on_chain=1"}},
            {"type":"close"}
        ]}' 2>/dev/null || echo "000")

    if [[ "$COUNT_RESP" == "200" ]]; then
        python3 << 'PYEOF2'
import json
try:
    with open('/tmp/turso_count.json') as f:
        data = json.load(f)
    results = data.get('results', [])
    total = results[0]['response']['result']['rows'][0][0]['value'] if results else '?'
    onchain = results[1]['response']['result']['rows'][0][0]['value'] if len(results) > 1 else '?'
    print(f"  \033[0;34m→\033[0m Registry: {total} total announcements ({onchain} on-chain indexed)")
except:
    pass
PYEOF2
    fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# [5/7] MONAD RPC CONNECTIVITY
# ═════════════════════════════════════════════════════════════════════════════
header 5 "Monad RPC Connectivity"

MONAD_RPC="${MONAD_RPC_URL:-${MONAD_TESTNET_RPC_URL:-https://testnet-rpc.monad.xyz}}"

if ! command -v curl &>/dev/null; then
    skip "curl not available"
else
    info "Testing ${MONAD_RPC}..."
    RPC_RESP=$(curl -s -o /tmp/rpc_resp.json -w "%{http_code}" \
        -X POST "${MONAD_RPC}" \
        -H "Content-Type: application/json" \
        --connect-timeout 8 --max-time 12 \
        -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        2>/dev/null || echo "000")

    if [[ "$RPC_RESP" == "200" ]] && command -v python3 &>/dev/null; then
        python3 << 'PYEOF3'
import json
try:
    with open('/tmp/rpc_resp.json') as f:
        data = json.load(f)
    block_hex = data.get('result', '0x0')
    block_num = int(block_hex, 16)
    print(f"  \033[0;32m✓\033[0m Monad testnet reachable — latest block: {block_num:,}")
except Exception as e:
    print(f"  \033[1;33m⚠\033[0m Monad RPC responded but response unexpected: {e}")
PYEOF3
    elif [[ "$RPC_RESP" == "200" ]]; then
        pass "Monad RPC reachable (HTTP 200)"
    elif [[ "$RPC_RESP" == "000" ]]; then
        warn "Monad RPC not reachable — check network or MONAD_TESTNET_RPC_URL"
    else
        warn "Monad RPC returned HTTP ${RPC_RESP}"
    fi

    # Check SPECTERAnnouncer contract exists
    ANNOUNCER_ADDR="${SPECTER_ANNOUNCER_ADDRESS:-0xCc322132261cE3a1c9c85a6ef69779Ce2D61CA5a}"
    if [[ -n "$ANNOUNCER_ADDR" && "$RPC_RESP" == "200" ]]; then
        CODE_RESP=$(curl -s \
            -X POST "${MONAD_RPC}" \
            -H "Content-Type: application/json" \
            --connect-timeout 8 --max-time 12 \
            -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"${ANNOUNCER_ADDR}\",\"latest\"],\"id\":2}" \
            2>/dev/null || echo "{}")

        CODE=$(echo "$CODE_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('result','0x'))" 2>/dev/null || echo "0x")
        if [[ "$CODE" != "0x" && "$CODE" != "0x0" && "${#CODE}" -gt 4 ]]; then
            pass "SPECTERAnnouncer at ${ANNOUNCER_ADDR} has bytecode (${#CODE} bytes)"
        else
            warn "SPECTERAnnouncer at ${ANNOUNCER_ADDR} has no bytecode — check SPECTER_ANNOUNCER_ADDRESS"
        fi
    fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# [6/7] CARGO BUILD & TESTS
# ═════════════════════════════════════════════════════════════════════════════
header 6 "Cargo Build & Tests"

if ! command -v cargo &>/dev/null; then
    skip "cargo not available"
else
    info "Running cargo check..."
    if cargo check --quiet 2>&1 | grep -q "^error"; then
        fail "cargo check failed — fix compile errors before starting backend"
        cargo check 2>&1 | grep "^error" | head -5 | while IFS= read -r line; do
            echo "       ${RED}${line}${NC}"
        done
    else
        pass "cargo check passed"
    fi

    info "Running cargo test (unit tests only, fast)..."
    TEST_OUTPUT=$(cargo test --lib --quiet 2>&1)
    TEST_EXIT=$?
    if [[ $TEST_EXIT -eq 0 ]]; then
        PASSED=$(echo "$TEST_OUTPUT" | grep -Eo '[0-9]+ passed' | head -1 || echo "? passed")
        pass "cargo test: ${PASSED}"
    else
        FAILED=$(echo "$TEST_OUTPUT" | grep -Eo '[0-9]+ failed' | head -1 || echo "? failed")
        fail "cargo test: ${FAILED} — fix test failures before deploying"
        echo "$TEST_OUTPUT" | grep "^FAILED" | head -5 | while IFS= read -r line; do
            echo "       ${RED}${line}${NC}"
        done
    fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# [7/7] SUMMARY
# ═════════════════════════════════════════════════════════════════════════════
header 7 "Summary"
echo ""

TOTAL=$((ERRORS + WARNINGS + PASSES))
echo -e "  Checks run:   ${TOTAL}"
echo -e "  ${GREEN}Passed:       ${PASSES}${NC}"
echo -e "  ${YELLOW}Warnings:     ${WARNINGS}${NC}"
echo -e "  ${RED}Errors:       ${ERRORS}${NC}"
echo ""

if [[ $ERRORS -eq 0 && $WARNINGS -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}  ✅  All checks passed — backend is ready to start.${NC}"
    echo ""
    echo -e "  ${CYAN}Run:${NC} cargo run --package specter-cli -- serve"
elif [[ $ERRORS -eq 0 ]]; then
    echo -e "${YELLOW}${BOLD}  ⚠   ${WARNINGS} warning(s) — backend can start but review warnings above.${NC}"
    echo ""
    echo -e "  ${CYAN}Run:${NC} cargo run --package specter-cli -- serve"
else
    echo -e "${RED}${BOLD}  ✗   ${ERRORS} error(s) found — DO NOT start backend until resolved.${NC}"
    echo ""
    echo -e "  Fix the errors above, then re-run: ${CYAN}./scripts/check_backend.sh${NC}"
fi

echo ""

# Clean up temp files
rm -f /tmp/turso_resp.json /tmp/turso_count.json /tmp/rpc_resp.json

exit $((ERRORS > 0 ? 1 : 0))
