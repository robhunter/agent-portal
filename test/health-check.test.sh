#!/bin/bash
# Test scripts/health-check.sh end-to-end against a local HTTP fixture.
set -e

PASS=0
FAIL=0
TESTS=0

assert_eq() {
  TESTS=$((TESTS + 1))
  if [ "$1" = "$2" ]; then
    PASS=$((PASS + 1))
    echo "  ok - $3"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL - $3 (expected '$1', got '$2')"
  fi
}

assert_contains() {
  TESTS=$((TESTS + 1))
  if echo "$1" | grep -qE "$2"; then
    PASS=$((PASS + 1))
    echo "  ok - $3"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL - $3 (pattern '$2' not in '$1')"
  fi
}

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HEALTH="$SCRIPT_DIR/scripts/health-check.sh"

echo "# health-check.sh tests"

# ---- Spawn a configurable HTTP fixture ----
# Routes:
#   /200 → 200 OK
#   /500 → 500 Internal Server Error
#   /slow → 200 OK with 300ms delay
PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")
SERVER_PID_FILE=$(mktemp)
python3 - <<PYEOF >/dev/null 2>&1 &
from http.server import BaseHTTPRequestHandler, HTTPServer
import time
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path
        if path == '/500':
            self.send_response(500); self.end_headers(); return
        if path == '/slow':
            time.sleep(0.3)
            self.send_response(200); self.end_headers(); return
        self.send_response(200); self.end_headers()
    def log_message(self, *args, **kwargs): pass
HTTPServer(('127.0.0.1', $PORT), H).serve_forever()
PYEOF
SERVER_PID=$!
echo "$SERVER_PID" > "$SERVER_PID_FILE"

cleanup() {
  if [ -f "$SERVER_PID_FILE" ]; then
    kill "$(cat "$SERVER_PID_FILE")" 2>/dev/null || true
    rm -f "$SERVER_PID_FILE"
  fi
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

# Wait for the server to come up (loop a curl against /200 with short timeout).
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/200" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

TMPDIR=$(mktemp -d)

write_yaml() {
  cat > "$TMPDIR/agent.yaml"
}

reset_logs() {
  rm -rf "$TMPDIR/logs"
  mkdir -p "$TMPDIR/logs"
}

# --- Test 1: Happy path — two 2xx endpoints, exit 0, two log lines ---
echo "## Test 1: Two 2xx endpoints — exit 0, schema correct"
reset_logs
write_yaml <<EOF
name: testagent
endpoints:
  - url: http://127.0.0.1:$PORT/200
    type: http
  - url: http://127.0.0.1:$PORT/200
    type: mcp
EOF
EXIT=0
"$HEALTH" "$TMPDIR" >/dev/null 2>&1 || EXIT=$?
assert_eq "0" "$EXIT" "exit 0 when all endpoints 2xx"
LINES=$(wc -l < "$TMPDIR/logs/health.jsonl" | tr -d ' ')
assert_eq "2" "$LINES" "two JSONL lines written"
LINE1=$(head -n 1 "$TMPDIR/logs/health.jsonl")
assert_eq "testagent" "$(echo "$LINE1" | jq -r '.project')" "project field set from agent.yaml name"
assert_eq "200" "$(echo "$LINE1" | jq -r '.status')" "status 200 recorded"
assert_eq "true" "$(echo "$LINE1" | jq -r '.ok')" "ok:true on 200"
assert_contains "$LINE1" '"latency_ms":[0-9]+' "latency_ms field is integer"
assert_contains "$LINE1" '"ts":"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z"' "ts is ISO-8601 UTC with Z suffix"
assert_contains "$LINE1" "\"endpoint\":\"http://127.0.0.1:$PORT/200\"" "endpoint URL recorded"

# --- Test 2: One endpoint 5xx — exit 1, ok:false on the bad one ---
echo "## Test 2: One endpoint 5xx — exit 1, ok:false on bad endpoint"
reset_logs
write_yaml <<EOF
name: testagent
endpoints:
  - url: http://127.0.0.1:$PORT/200
    type: http
  - url: http://127.0.0.1:$PORT/500
    type: http
EOF
EXIT=0
"$HEALTH" "$TMPDIR" >/dev/null 2>&1 || EXIT=$?
assert_eq "1" "$EXIT" "exit 1 when one endpoint fails"
OK_COUNT=$(jq -s '[.[] | select(.ok==true)] | length' "$TMPDIR/logs/health.jsonl")
FAIL_COUNT=$(jq -s '[.[] | select(.ok==false)] | length' "$TMPDIR/logs/health.jsonl")
assert_eq "1" "$OK_COUNT" "one ok:true line"
assert_eq "1" "$FAIL_COUNT" "one ok:false line"
BAD_STATUS=$(jq -s '[.[] | select(.ok==false)][0].status' "$TMPDIR/logs/health.jsonl")
assert_eq "500" "$BAD_STATUS" "500 status recorded on bad endpoint"

# --- Test 3: No endpoints field — exit 0 with stderr warning ---
echo "## Test 3: Missing endpoints field — exit 0 with warning"
reset_logs
write_yaml <<EOF
name: testagent
EOF
EXIT=0
STDERR=$("$HEALTH" "$TMPDIR" 2>&1 >/dev/null) || EXIT=$?
assert_eq "0" "$EXIT" "exit 0 when no endpoints field"
assert_contains "$STDERR" "No endpoints" "warning printed to stderr"
if [ -f "$TMPDIR/logs/health.jsonl" ]; then
  LINES=$(wc -l < "$TMPDIR/logs/health.jsonl" | tr -d ' ')
else
  LINES=0
fi
assert_eq "0" "$LINES" "no log lines written when nothing to probe"

# --- Test 4: Empty endpoints field — exit 0 with stderr warning ---
echo "## Test 4: Empty endpoints field — exit 0 with warning"
reset_logs
write_yaml <<EOF
name: testagent
endpoints: []
EOF
EXIT=0
STDERR=$("$HEALTH" "$TMPDIR" 2>&1 >/dev/null) || EXIT=$?
assert_eq "0" "$EXIT" "exit 0 when endpoints is empty"
assert_contains "$STDERR" "No endpoints" "warning printed to stderr"

# --- Test 5: --threshold flag — slow endpoint flagged ok:false ---
echo "## Test 5: --threshold flag flags slow endpoint as ok:false"
reset_logs
write_yaml <<EOF
name: testagent
endpoints:
  - url: http://127.0.0.1:$PORT/slow
    type: http
EOF
# Slow endpoint has ~300ms delay; threshold of 50ms should flag it.
EXIT=0
"$HEALTH" "$TMPDIR" --threshold 50 >/dev/null 2>&1 || EXIT=$?
assert_eq "1" "$EXIT" "exit 1 when slow endpoint exceeds threshold"
LINE=$(head -n 1 "$TMPDIR/logs/health.jsonl")
assert_eq "200" "$(echo "$LINE" | jq -r '.status')" "status still 200 even when slow"
assert_eq "false" "$(echo "$LINE" | jq -r '.ok')" "ok:false when latency > threshold"

# --- Test 6: --threshold flag — fast endpoint stays ok:true ---
echo "## Test 6: --threshold flag does not flag fast endpoint"
reset_logs
write_yaml <<EOF
name: testagent
endpoints:
  - url: http://127.0.0.1:$PORT/200
    type: http
EOF
# Threshold well above local fast response.
EXIT=0
"$HEALTH" "$TMPDIR" --threshold 5000 >/dev/null 2>&1 || EXIT=$?
assert_eq "0" "$EXIT" "exit 0 when fast endpoint under threshold"
assert_eq "true" "$(jq -r '.ok' "$TMPDIR/logs/health.jsonl")" "ok:true when latency < threshold"

# --- Test 7: Connection refused — exit 1, ok:false logged ---
echo "## Test 7: Unreachable endpoint — exit 1, status 0 logged"
reset_logs
DEAD_PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); p=s.getsockname()[1]; s.close(); print(p)")
write_yaml <<EOF
name: testagent
endpoints:
  - url: http://127.0.0.1:$DEAD_PORT/
    type: http
EOF
EXIT=0
"$HEALTH" "$TMPDIR" >/dev/null 2>&1 || EXIT=$?
assert_eq "1" "$EXIT" "exit 1 when endpoint unreachable"
LINE=$(head -n 1 "$TMPDIR/logs/health.jsonl")
assert_eq "0" "$(echo "$LINE" | jq -r '.status')" "status 0 recorded on connection failure"
assert_eq "false" "$(echo "$LINE" | jq -r '.ok')" "ok:false on connection failure"

# --- Test 8: Missing agent.yaml — exit 1 ---
echo "## Test 8: Missing agent.yaml — exit 1 with clear error"
EMPTY=$(mktemp -d)
mkdir -p "$EMPTY/logs"
EXIT=0
STDERR=$("$HEALTH" "$EMPTY" 2>&1 >/dev/null) || EXIT=$?
assert_eq "1" "$EXIT" "exit 1 when agent.yaml absent"
assert_contains "$STDERR" "agent.yaml not found" "error message names missing file"
rm -rf "$EMPTY"

# --- Test 9: Missing logs dir — exit 1 (no auto-create per spec) ---
echo "## Test 9: Missing logs dir — exit 1, do not auto-create"
NO_LOGS=$(mktemp -d)
cat > "$NO_LOGS/agent.yaml" <<EOF
name: testagent
endpoints:
  - url: http://127.0.0.1:$PORT/200
    type: http
EOF
EXIT=0
STDERR=$("$HEALTH" "$NO_LOGS" 2>&1 >/dev/null) || EXIT=$?
assert_eq "1" "$EXIT" "exit 1 when logs/ missing"
assert_contains "$STDERR" "Log dir not found" "error message names missing logs dir"
[ ! -d "$NO_LOGS/logs" ]
assert_eq "0" "$?" "logs/ not auto-created"
rm -rf "$NO_LOGS"

# --- Test 10: --threshold rejects non-integer values ---
echo "## Test 10: Invalid --threshold value rejected"
reset_logs
write_yaml <<EOF
name: testagent
endpoints:
  - url: http://127.0.0.1:$PORT/200
    type: http
EOF
EXIT=0
STDERR=$("$HEALTH" "$TMPDIR" --threshold abc 2>&1 >/dev/null) || EXIT=$?
assert_eq "1" "$EXIT" "exit 1 on non-integer threshold"
assert_contains "$STDERR" "must be a positive integer" "error message describes valid format"

# --- Test 11: Missing url field on an endpoint — exit 1 with stderr warning ---
echo "## Test 11: Endpoint missing url field — exit 1"
reset_logs
write_yaml <<EOF
name: testagent
endpoints:
  - type: http
  - url: http://127.0.0.1:$PORT/200
    type: http
EOF
EXIT=0
STDERR=$("$HEALTH" "$TMPDIR" 2>&1 >/dev/null) || EXIT=$?
assert_eq "1" "$EXIT" "exit 1 when an endpoint lacks url"
assert_contains "$STDERR" "missing url field" "warning identifies bad endpoint"
# The good endpoint still got logged.
GOOD_COUNT=$(jq -s '[.[] | select(.ok==true)] | length' "$TMPDIR/logs/health.jsonl")
assert_eq "1" "$GOOD_COUNT" "valid endpoint still logged ok:true"

# --- Test 12: --source happy path — two projects each with one endpoint ---
echo "## Test 12: --source projects.yaml with two projects — project field uses project name"
reset_logs
# Use a benign minimal agent.yaml to keep the dir realistic; --source mode shouldn't read it.
write_yaml <<EOF
name: orchestrator
EOF
mkdir -p "$TMPDIR/memory"
cat > "$TMPDIR/memory/projects.yaml" <<EOF
projects:
  - name: ProjectA
    endpoints:
      - url: http://127.0.0.1:$PORT/200
        type: http
  - name: ProjectB
    endpoints:
      - url: http://127.0.0.1:$PORT/200
        type: mcp
EOF
EXIT=0
"$HEALTH" "$TMPDIR" --source memory/projects.yaml >/dev/null 2>&1 || EXIT=$?
assert_eq "0" "$EXIT" "exit 0 when all source endpoints 2xx"
LINES=$(wc -l < "$TMPDIR/logs/health.jsonl" | tr -d ' ')
assert_eq "2" "$LINES" "two JSONL lines from two projects"
PROJECTS=$(jq -s '[.[].project] | sort | join(",")' "$TMPDIR/logs/health.jsonl")
assert_eq "\"ProjectA,ProjectB\"" "$PROJECTS" "project field uses project name (not agent name)"
NOT_ORCHESTRATOR=$(jq -s '[.[] | select(.project=="orchestrator")] | length' "$TMPDIR/logs/health.jsonl")
assert_eq "0" "$NOT_ORCHESTRATOR" "agent.yaml name not leaked into project field"

# --- Test 13: --source skips projects with no endpoints silently ---
echo "## Test 13: --source skips no-endpoints projects without warning"
reset_logs
cat > "$TMPDIR/memory/projects.yaml" <<EOF
projects:
  - name: WithEndpoints
    endpoints:
      - url: http://127.0.0.1:$PORT/200
        type: http
  - name: NoEndpoints
  - name: EmptyEndpoints
    endpoints: []
EOF
EXIT=0
STDERR=$("$HEALTH" "$TMPDIR" --source memory/projects.yaml 2>&1 >/dev/null) || EXIT=$?
assert_eq "0" "$EXIT" "exit 0 when one project endpointed and others not"
LINES=$(wc -l < "$TMPDIR/logs/health.jsonl" | tr -d ' ')
assert_eq "1" "$LINES" "only the endpointed project is probed"
ONLY=$(jq -r '.project' "$TMPDIR/logs/health.jsonl")
assert_eq "WithEndpoints" "$ONLY" "logged project is the one with endpoints"
# Stderr must be silent for skipped projects (no warning per AC #3).
SKIPPED_WARN=$(echo "$STDERR" | grep -ic "noendpoints\|skipped\|skipping" || true)
assert_eq "0" "$SKIPPED_WARN" "no warning for projects without endpoints"

# --- Test 14: --source malformed YAML — exit 1 with clear error ---
echo "## Test 14: --source malformed projects.yaml — exit 1, clear error"
reset_logs
cat > "$TMPDIR/memory/projects.yaml" <<'EOF'
projects:
  - name: Bad
  -- this is not valid yaml :: at all
EOF
EXIT=0
STDERR=$("$HEALTH" "$TMPDIR" --source memory/projects.yaml 2>&1 >/dev/null) || EXIT=$?
assert_eq "1" "$EXIT" "exit 1 on malformed source yaml"
assert_contains "$STDERR" "Failed to parse|PARSE_ERROR" "error message indicates parse failure"

# --- Test 14b: --source where projects entries have wrong shape ---
echo "## Test 14b: --source with non-mapping project entries — exit 1"
reset_logs
cat > "$TMPDIR/memory/projects.yaml" <<EOF
projects:
  - just-a-string
EOF
EXIT=0
STDERR=$("$HEALTH" "$TMPDIR" --source memory/projects.yaml 2>&1 >/dev/null) || EXIT=$?
assert_eq "1" "$EXIT" "exit 1 when projects entry is not a mapping"
assert_contains "$STDERR" "Failed to parse|each project must be a mapping" "error names the structural problem"

# --- Test 15: --source nonexistent file — exit 2 ---
echo "## Test 15: --source nonexistent file — exit 2"
reset_logs
EXIT=0
STDERR=$("$HEALTH" "$TMPDIR" --source memory/missing.yaml 2>&1 >/dev/null) || EXIT=$?
assert_eq "2" "$EXIT" "exit 2 on nonexistent source file (config error)"
assert_contains "$STDERR" "Source file not found" "error message names the missing file"

# --- Test 16: --source + --threshold compose ---
echo "## Test 16: --source + --threshold flags slow endpoint"
reset_logs
cat > "$TMPDIR/memory/projects.yaml" <<EOF
projects:
  - name: SlowProject
    endpoints:
      - url: http://127.0.0.1:$PORT/slow
        type: http
EOF
EXIT=0
"$HEALTH" "$TMPDIR" --source memory/projects.yaml --threshold 50 >/dev/null 2>&1 || EXIT=$?
assert_eq "1" "$EXIT" "exit 1 when source endpoint exceeds threshold"
LINE=$(head -n 1 "$TMPDIR/logs/health.jsonl")
assert_eq "SlowProject" "$(echo "$LINE" | jq -r '.project')" "project field still uses project name with --threshold"
assert_eq "false" "$(echo "$LINE" | jq -r '.ok')" "ok:false when slow endpoint exceeds threshold"

# --- Test 17: --source with empty/missing projects key — exit 0 with warning ---
echo "## Test 17: --source with no projects — exit 0 with warning"
reset_logs
cat > "$TMPDIR/memory/projects.yaml" <<EOF
# no projects key
some_other_field: irrelevant
EOF
EXIT=0
STDERR=$("$HEALTH" "$TMPDIR" --source memory/projects.yaml 2>&1 >/dev/null) || EXIT=$?
assert_eq "0" "$EXIT" "exit 0 when source has no projects"
assert_contains "$STDERR" "No project endpoints" "warning printed when source has no project endpoints"

# --- Test 18: --source path is relative to <agent-dir> ---
echo "## Test 18: --source path resolved relative to agent-dir"
reset_logs
mkdir -p "$TMPDIR/custom-layout"
cat > "$TMPDIR/custom-layout/services.yaml" <<EOF
projects:
  - name: Custom
    endpoints:
      - url: http://127.0.0.1:$PORT/200
        type: http
EOF
EXIT=0
"$HEALTH" "$TMPDIR" --source custom-layout/services.yaml >/dev/null 2>&1 || EXIT=$?
assert_eq "0" "$EXIT" "exit 0 when --source points to non-default layout"
LINES=$(wc -l < "$TMPDIR/logs/health.jsonl" | tr -d ' ')
assert_eq "1" "$LINES" "single endpoint probed from custom layout"

# --- Test 19: --source mode does not require agent.yaml ---
echo "## Test 19: --source works even without agent.yaml"
reset_logs
NO_AGENT=$(mktemp -d)
mkdir -p "$NO_AGENT/logs"
mkdir -p "$NO_AGENT/memory"
cat > "$NO_AGENT/memory/projects.yaml" <<EOF
projects:
  - name: Standalone
    endpoints:
      - url: http://127.0.0.1:$PORT/200
        type: http
EOF
EXIT=0
"$HEALTH" "$NO_AGENT" --source memory/projects.yaml >/dev/null 2>&1 || EXIT=$?
assert_eq "0" "$EXIT" "exit 0 in --source mode without agent.yaml"
ONLY=$(jq -r '.project' "$NO_AGENT/logs/health.jsonl")
assert_eq "Standalone" "$ONLY" "project name correctly recorded"
rm -rf "$NO_AGENT"

# --- Test 20: dataDir layout — writes under <agent>/<DATA_DIR>/logs (#247 F4) ---
# A dataDir:"data" agent reads its Health tab from data/logs/health.jsonl
# (lib/routes/health.js -> dataPath(config,'logs','health.jsonl')). The script
# must resolve DATA_DIR from portal.config.json and write to the same place,
# not to the legacy ./logs. DATA_DIR= prefix keeps the test hermetic regardless
# of the caller's environment.
echo "## Test 20: dataDir:\"data\" — health.jsonl lands under data/logs, not ./logs"
DD_AGENT=$(mktemp -d)
echo '{"dataDir":"data"}' > "$DD_AGENT/portal.config.json"
mkdir -p "$DD_AGENT/data/logs"
cat > "$DD_AGENT/agent.yaml" <<EOF
name: ddagent
endpoints:
  - url: http://127.0.0.1:$PORT/200
    type: http
EOF
EXIT=0
DATA_DIR= "$HEALTH" "$DD_AGENT" >/dev/null 2>&1 || EXIT=$?
assert_eq "0" "$EXIT" "exit 0 under dataDir layout"
if [ -f "$DD_AGENT/data/logs/health.jsonl" ]; then DATA_LOG=yes; else DATA_LOG=no; fi
assert_eq "yes" "$DATA_LOG" "health.jsonl written under data/logs (DATA_DIR-aware)"
if [ -f "$DD_AGENT/logs/health.jsonl" ]; then LEGACY_LOG=yes; else LEGACY_LOG=no; fi
assert_eq "no" "$LEGACY_LOG" "nothing written to legacy ./logs path"
if [ "$DATA_LOG" = "yes" ]; then
  assert_eq "ddagent" "$(jq -r '.project' "$DD_AGENT/data/logs/health.jsonl")" "project recorded under dataDir layout"
fi
rm -rf "$DD_AGENT"

echo ""
echo "# Results: $PASS/$TESTS passed, $FAIL failed"
[ $FAIL -eq 0 ]
