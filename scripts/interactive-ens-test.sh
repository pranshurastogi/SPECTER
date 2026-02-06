#!/usr/bin/env bash
# Interactive ENS + IPFS test for SPECTER.
# 1. Generate keys, upload meta-address to IPFS
# 2. You set the ENS record on Sepolia manually
# 3. Provide your ENS name; script verifies and reports your meta-address
#
# Prereqs: API server running with USE_TESTNET=true, PINATA_* env vars set.
# Start: cd specter && USE_TESTNET=true cargo run --bin specter -- serve --port 3001
set -e

BASE_URL="${BASE_URL:-http://localhost:3001}"

echo "==> SPECTER interactive ENS test"
echo "    API: $BASE_URL"
echo ""

# Check server
HEALTH=$(curl -sf "$BASE_URL/health" 2>/dev/null || true)
if [ -z "$HEALTH" ]; then
    echo "Error: Server not reachable at $BASE_URL"
    echo "Start with: cd specter && USE_TESTNET=true cargo run --bin specter -- serve --port 3001"
    exit 1
fi
USE_TESTNET=$(echo "$HEALTH" | python3 -c "import sys,json; print(str(json.load(sys.stdin).get('use_testnet', False)).lower())" 2>/dev/null || echo "false")
echo "    use_testnet: $USE_TESTNET (must be true for Sepolia)"
if [ "$USE_TESTNET" != "true" ]; then
    echo "    Warning: For Sepolia, restart with USE_TESTNET=true"
fi
echo ""

echo "==> Step 1: Generate keys"
KEYS=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/keys/generate")
META=$(echo "$KEYS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('meta_address',''))" 2>/dev/null || echo "$KEYS" | grep -o '"meta_address":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$META" ]; then
    echo "    Error: Failed to generate keys. Response: $KEYS"
    exit 1
fi
echo "    Meta-address: ${META:0:32}..."
echo ""

echo "==> Step 2: Upload meta-address to IPFS"
UPLOAD=$(curl -s -w "\n%{http_code}" --max-time 60 -X POST "$BASE_URL/api/v1/ipfs/upload" \
  -H "Content-Type: application/json" \
  -d "{\"meta_address\": \"$META\", \"name\": \"test-specter-profile\"}")
HTTP_CODE=$(echo "$UPLOAD" | tail -1)
UPLOAD_BODY=$(echo "$UPLOAD" | sed '$d')
if [ "$HTTP_CODE" != "200" ]; then
    echo "    Error: IPFS upload failed (HTTP $HTTP_CODE)"
    echo "    Response: $UPLOAD_BODY"
    echo "    Ensure PINATA_JWT is set when starting the server."
    exit 1
fi
CID=$(echo "$UPLOAD_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cid',''))" 2>/dev/null || echo "$UPLOAD_BODY" | grep -o '"cid":"[^"]*"' | cut -d'"' -f4)
TEXT_RECORD=$(echo "$UPLOAD_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('text_record',''))" 2>/dev/null || echo "$UPLOAD_BODY" | grep -o '"text_record":"[^"]*"' | cut -d'"' -f4)
if [ -z "$TEXT_RECORD" ]; then
    echo "    Error: No CID/text_record in response. Body: $UPLOAD_BODY"
    exit 1
fi
echo "    CID: $CID"
echo "    Text record value: $TEXT_RECORD"
echo ""
echo "    Verifying IPFS retrieval..."
RETRIEVE=$(curl -s -w "\n%{http_code}" --max-time 15 "$BASE_URL/api/v1/ipfs/$CID")
RETRIEVE_CODE=$(echo "$RETRIEVE" | tail -1)
if [ "$RETRIEVE_CODE" = "200" ]; then
    echo "    IPFS OK (meta-address retrievable)"
else
    echo "    IPFS retrieve failed (HTTP $RETRIEVE_CODE) - check PINATA_GATEWAY_*"
fi
echo ""
echo "--------------------------------------------------------------------------------"
echo "  SET THIS ON SEPOLIA ENS (app.ens.domains or similar):"
echo ""
echo "  Record type:  Text"
echo "  Key:          specter"
echo "  Value:        $TEXT_RECORD"
echo ""
echo "  (Use Sepolia testnet. After setting, wait for tx confirmation.)"
echo "--------------------------------------------------------------------------------"
echo ""
read -rp "Press Enter after you have set the ENS record..."
echo ""

read -rp "Enter your ENS name (e.g. alice.eth): " ENS_NAME
if [ -z "$ENS_NAME" ]; then
    echo "No ENS name provided."
    exit 1
fi

echo ""
echo "==> Step 3: Resolve ENS name (ENS + IPFS → meta-address)"
ENS_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$ENS_NAME', safe=''))")
RESOLVE=$(curl -s -w "\n%{http_code}" --max-time 30 "$BASE_URL/api/v1/ens/resolve/$ENS_ENCODED")
HTTP_CODE=$(echo "$RESOLVE" | tail -1)
RESOLVE_BODY=$(echo "$RESOLVE" | sed '$d')
if [ -z "$RESOLVE_BODY" ]; then
    echo "    Failed to resolve (no response)"
    exit 1
fi
if [ "$HTTP_CODE" != "200" ]; then
    echo "    Error: Resolve failed (HTTP $HTTP_CODE)"
    echo "    Response: $RESOLVE_BODY"
    echo ""
    echo "    Checklist:"
    echo "    1. Server started with USE_TESTNET=true (see above)"
    echo "    2. In ENS app: Records tab → Add record → Key: specter, Value: ipfs://<cid>"
    echo "    3. Tx confirmed on Sepolia"
    echo "    4. In ENS app, verify the 'specter' record is visible"
    exit 1
fi
RESOLVE="$RESOLVE_BODY"

if echo "$RESOLVE" | grep -q '"meta_address"'; then
    RESOLVED_NAME=$(echo "$RESOLVE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ens_name',''))" 2>/dev/null)
    RESOLVED_META=$(echo "$RESOLVE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('meta_address',''))" 2>/dev/null || echo "$RESOLVE" | grep -o '"meta_address":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "    Success!"
    echo ""
    echo "--------------------------------------------------------------------------------"
    echo "  Resolved ENS name: ${RESOLVED_NAME:-$ENS_NAME}"
    echo ""
    echo "  Meta-address (from ENS + IPFS):"
    echo "  $RESOLVED_META"
    echo ""
    echo "  Match check: ${META:0:20}... vs ${RESOLVED_META:0:20}..."
    if [ "$META" = "$RESOLVED_META" ]; then
        echo "  ✓ MATCH - ENS + IPFS flow verified!"
    else
        echo "  (Different - you may have set a different meta-address on ENS)"
    fi
    echo "--------------------------------------------------------------------------------"
else
    echo "    Resolution failed. Response:"
    echo "$RESOLVE" | head -5
    exit 1
fi
