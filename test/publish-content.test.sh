#!/bin/bash
# publish-content.test.sh — shell smoke tests for the publish-content gate.
# Spins a tiny HTTP server, builds a synthetic agent dir with dataDir: "data",
# drives publish-content.sh through pass/fail/quarantine scenarios.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$FRAMEWORK_DIR/scripts/publish-content.sh"

OK=0; FAIL=0
ok()   { echo "  ok - $*"; OK=$((OK+1)); }
fail() { echo "  not ok - $*"; FAIL=$((FAIL+1)); }

# ── Spin a tiny HTTP server (Node) ──
PORT=$(node -e "const s=require('net').createServer().listen(0,()=>{console.log(s.address().port);s.close();});" 2>/dev/null)
node -e "
const http = require('http');
const s = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname;
  if (p === '/200') { res.writeHead(200); res.end('ok'); return; }
  if (p === '/404') { res.writeHead(404); res.end(); return; }
  res.writeHead(200); res.end();
});
s.listen($PORT, '127.0.0.1', () => process.send && process.send('ready'));
" > /tmp/publish-content-server.log 2>&1 &
SERVER_PID=$!
sleep 0.3
trap "kill $SERVER_PID 2>/dev/null" EXIT

# ── Build a synthetic agent dir ──
TMP=$(mktemp -d -t pub-content-XXXXXX)
mkdir -p "$TMP/data/config" "$TMP/data/content"

cat > "$TMP/portal.config.json" <<EOF
{"name":"T","port":0,"agentDir":"$TMP","dataDir":"data","cronFile":"/none","lockFile":"$TMP/lock"}
EOF

cat > "$TMP/data/config/sources.yaml" <<EOF
sources:
  - id: test-source
    name: Test Source
    url: http://127.0.0.1:$PORT
    status: approved
    hosts: [127.0.0.1]
    categories: [comics]
  - id: pending-source
    name: Pending Source
    url: http://127.0.0.1:$PORT
    status: pending
    hosts: [127.0.0.1]
    categories: [comics]
EOF

draft() {
  local path="$1"; shift
  cat > "$path" <<EOF
id: $1
title: Test
category: comics
format: cbz
source: $2
source_url: $3
status: linked
sources:
  - name: Test
    url: $3
    type: downloadable
EOF
}

echo "# publish-content.sh smoke tests"

echo "## Test 1: good item → publishes into data/content/items/"
draft "$TMP/draft.yaml" "good-item" "test-source" "http://127.0.0.1:$PORT/200"
if bash "$SCRIPT" "$TMP" "$TMP/draft.yaml" > /tmp/pc-1.out 2> /tmp/pc-1.err; then
  ok "exit 0 on pass"
else
  fail "exit nonzero on pass: $(cat /tmp/pc-1.err)"
fi
[ -f "$TMP/data/content/items/good-item.yaml" ] && ok "item landed in items/" || fail "item missing from items/"
[ ! -e "$TMP/draft.yaml" ] && ok "draft consumed (removed from source path)" || fail "draft not removed"

echo "## Test 2: bad host → quarantined"
draft "$TMP/draft2.yaml" "bad-host" "test-source" "https://aggregator-fakehulu.example/show"
if bash "$SCRIPT" "$TMP" "$TMP/draft2.yaml" > /tmp/pc-2.out 2> /tmp/pc-2.err; then
  fail "exit 0 on bad-host (should have failed)"
else
  ok "exit nonzero on bad-host"
fi
[ -f "$TMP/data/content/rejected/bad-host.yaml" ] && ok "quarantined under rejected/" || fail "missing from rejected/"
grep -q "host" "$TMP/data/content/rejected/bad-host.yaml" && ok "_validation block mentions host failure" || fail "_validation missing host reason"
grep -q "_validation" "$TMP/data/content/rejected/bad-host.yaml" && ok "_validation block present" || fail "_validation block missing"
[ ! -e "$TMP/draft2.yaml" ] && ok "draft consumed on failure" || fail "draft not removed on failure"

echo "## Test 3: dead URL (404) → quarantined with HTTP status in reason"
draft "$TMP/draft3.yaml" "dead-url" "test-source" "http://127.0.0.1:$PORT/404"
if bash "$SCRIPT" "$TMP" "$TMP/draft3.yaml" > /tmp/pc-3.out 2> /tmp/pc-3.err; then
  fail "exit 0 on dead URL (should have failed)"
else
  ok "exit nonzero on dead URL"
fi
[ -f "$TMP/data/content/rejected/dead-url.yaml" ] && ok "quarantined under rejected/" || fail "missing from rejected/"
grep -q "HTTP 404" "$TMP/data/content/rejected/dead-url.yaml" && ok "_validation block names HTTP 404" || fail "_validation missing 404"

echo "## Test 4: pending source rejected (strict)"
draft "$TMP/draft4.yaml" "pending" "pending-source" "http://127.0.0.1:$PORT/200"
if bash "$SCRIPT" "$TMP" "$TMP/draft4.yaml" --skip-fetch > /tmp/pc-4.out 2> /tmp/pc-4.err; then
  fail "exit 0 on pending source (should have failed)"
else
  ok "exit nonzero on pending source"
fi
grep -q "source" "$TMP/data/content/rejected/pending.yaml" && ok "rejected for source field" || fail "source rejection missing"

echo "## Test 5: --dry-run leaves filesystem alone"
draft "$TMP/draft5.yaml" "dry-test" "test-source" "http://127.0.0.1:$PORT/200"
bash "$SCRIPT" "$TMP" "$TMP/draft5.yaml" --dry-run > /tmp/pc-5.out 2> /tmp/pc-5.err
[ -f "$TMP/draft5.yaml" ] && ok "draft NOT removed on --dry-run" || fail "draft removed on dry-run"
[ ! -e "$TMP/data/content/items/dry-test.yaml" ] && ok "no item written on dry-run pass" || fail "item written on dry-run"
rm "$TMP/draft5.yaml"

echo "## Test 6: --skip-fetch bypasses fetch but still enforces host"
draft "$TMP/draft6.yaml" "skip-fetch-good" "test-source" "http://127.0.0.1:$PORT/404"
if bash "$SCRIPT" "$TMP" "$TMP/draft6.yaml" --skip-fetch > /tmp/pc-6.out 2> /tmp/pc-6.err; then
  ok "--skip-fetch passes 404 URL (host check only)"
else
  fail "--skip-fetch incorrectly rejected: $(cat /tmp/pc-6.err)"
fi

echo "## Test 7: missing sources.yaml → graceful error (exit 2)"
TMP2=$(mktemp -d -t pub-content-no-sources-XXXXXX)
mkdir -p "$TMP2/data"
cat > "$TMP2/portal.config.json" <<EOF
{"name":"T2","port":0,"agentDir":"$TMP2","dataDir":"data"}
EOF
draft "$TMP2/draft.yaml" "no-sources" "test-source" "http://127.0.0.1:$PORT/200"
set +e
bash "$SCRIPT" "$TMP2" "$TMP2/draft.yaml" > /tmp/pc-7.out 2> /tmp/pc-7.err
RC=$?
set -e
[ "$RC" = "2" ] && ok "exit code 2 on missing sources.yaml" || fail "exit was $RC, expected 2"
grep -q "sources" /tmp/pc-7.err && ok "stderr mentions sources" || fail "no sources mention in stderr"
rm -rf "$TMP2"

echo "## Test 8: honors DATA_DIR env override"
DATA_DIR=data bash "$SCRIPT" "$TMP" "$TMP/draft7-missing.yaml" 2>/tmp/pc-8.err && true
grep -q "Failed to read draft" /tmp/pc-8.err && ok "DATA_DIR env propagates to the node script" || fail "DATA_DIR not honored"

# Cleanup
rm -rf "$TMP"
echo ""
echo "# Results: $((OK+FAIL)) tests, $OK passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
