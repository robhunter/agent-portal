#!/bin/bash
# test/workspace-npm-install.test.sh — a cycle installs each workspace the way
# its agent.yaml `npm-install` asks (#306): `true` installs production
# dependencies only, `dev` keeps devDependencies (a coding agent's tsc and test
# runner), and a workspace without the key installs nothing.
#
# Runs a full respond.sh cycle with a stub `npm` on PATH that records its
# arguments. wake.sh sources the same scripts/npm-install-workspace.sh.

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESPOND="$SCRIPT_DIR/scripts/respond.sh"

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ok - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; }

echo "# workspace npm-install tests"

if ! command -v flock >/dev/null 2>&1; then
  echo "  SKIP - flock not available (non-Linux host); respond.sh lock handling is Linux-only"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
cat > "$TMP/bin/npm" <<STUB
#!/bin/bash
echo "\$(basename "\$PWD") \$*" >> "$TMP/npm-calls.log"
STUB
chmod +x "$TMP/bin/npm"

for ws in prod dev none; do
  mkdir -p "$TMP/ws/$ws"
  echo "{\"name\": \"$ws\"}" > "$TMP/ws/$ws/package.json"
  git -C "$TMP/ws/$ws" init -q
done

AGENT="$TMP/agent"
mkdir -p "$AGENT/logs"
cat > "$AGENT/agent.yaml" <<YAML
name: npminstalltest
repo: example/none
lock-file: $TMP/agent.lock
respond-prompt: |
  test respond prompt
workspaces:
  - repo: example/prod
    path: $TMP/ws/prod
    npm-install: true
  - repo: example/dev
    path: $TMP/ws/dev
    npm-install: dev
  - repo: example/none
    path: $TMP/ws/none
YAML
cat > "$AGENT/portal.config.json" <<JSON
{ "harness": { "type": "mock", "command": "bash $TMP/mock-harness.sh", "extraFlags": "" }, "dataDir": "." }
JSON
printf '#!/bin/bash\ncat >/dev/null\nexit 0\n' > "$TMP/mock-harness.sh"

git -C "$AGENT" init -q
git -C "$AGENT" config user.email test@example.com
git -C "$AGENT" config user.name test
git -C "$AGENT" add -A
git -C "$AGENT" commit -qm init

# HOME is the temp dir so respond.sh finds no nvm.sh to source; sourcing it
# would put the real npm ahead of the stub. GH_TOKEN unset keeps commit.sh offline.
( cd "$AGENT" && env -u GH_TOKEN HOME="$TMP" PATH="$TMP/bin:$PATH" bash "$RESPOND" "$AGENT" ) >"$TMP/respond.out" 2>&1

calls="$(tr '\n' ';' < "$TMP/npm-calls.log" 2>/dev/null | sed 's/;$//')"
ran() { tr ';' '\n' <<<"$calls" | grep -qx "$1"; }

if ran 'prod install --production'; then
  ok "npm-install: true installs production dependencies only"
else
  bad "npm-install: true should run 'npm install --production'; npm calls were: ${calls:-none}"
fi

if ran 'dev install'; then
  ok "npm-install: dev installs devDependencies too"
else
  bad "npm-install: dev should run 'npm install'; npm calls were: ${calls:-none}"
fi

if tr ';' '\n' <<<"$calls" | grep -q '^none '; then
  bad "a workspace without npm-install ran npm: $calls"
else
  ok "a workspace without npm-install runs no npm"
fi

if [ "$FAIL" -gt 0 ]; then
  echo "  respond.sh output:"
  sed 's/^/    /' "$TMP/respond.out" | tail -20
fi

echo "# $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
