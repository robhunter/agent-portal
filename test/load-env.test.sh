#!/bin/bash
# test/load-env.test.sh — the .env guard that keeps a config file from
# redefining the shell's own variables.
#
# The case that motivated it: an agent's .env carried `PWD=<a password>`, and
# sourcing it sent nvm's .nvmrc search into an infinite loop, stalling container
# builds with no error output at all.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()   { echo "  ok - $1"; pass=$((pass+1)); }
notok() { echo "  not ok - $1"; fail=$((fail+1)); }
check() { [ "$2" = "$3" ] && ok "$1" || notok "$1 (got '$2', want '$3')"; }

# shellcheck disable=SC1090
. "$FRAMEWORK_DIR/scripts/load-env.sh"

echo "# load_agent_env"

# Test-only variable names. Never GH_TOKEN or anything else that carries a real
# secret in a developer's environment: a failing assertion prints the value it
# got, and the first draft of this file printed a live GitHub token to the
# terminal for exactly that reason.
unset LOAD_ENV_TEST_VAR LOAD_ENV_TEST_NAME CDPATH

printf 'PWD=EoVFt*9!Dmj1eop#\nLOAD_ENV_TEST_VAR=abc123\n' > "$TMP/bad.env"
printf 'LOAD_ENV_TEST_NAME=Rob\n'                          > "$TMP/good.env"
printf 'HOME=/nowhere\nPATH=/bin\n'                        > "$TMP/worse.env"

# Capture stderr through a FILE, never `$(...)`: command substitution runs the
# function in a subshell, so every variable it sets is discarded and the
# assertions below silently test the parent's environment instead.
run_load() { load_agent_env "$1" 2>"$TMP/err"; }

## Test 1: a PWD assignment is ignored, and the rest of the file still loads
BEFORE_PWD="$PWD"
run_load "$TMP/bad.env"
check "PWD survives a .env that assigns it" "$PWD" "$BEFORE_PWD"
check "non-reserved vars still import"      "${LOAD_ENV_TEST_VAR:-}" "abc123"
if grep -q "shell-reserved" "$TMP/err" && grep -q "PWD" "$TMP/err"; then
  ok "warns, naming PWD"
else
  notok "warns, naming PWD"
fi

## Test 2: the actual hang — nvm_find_up's walk must terminate
p="$PWD"; n=0
while [ "$p" != "" ] && [ "$p" != '.' ] && [ ! -f "$p/.nvmrc" ] && [ "$n" -lt 200 ]; do
  p=${p%/*}; n=$((n+1))
done
[ "$n" -lt 200 ] && ok "nvm_find_up-style walk terminates ($n steps)" \
                 || notok "nvm_find_up-style walk still loops forever"

## Test 3: a clean .env is silent and exports normally
run_load "$TMP/good.env"
check "clean .env produces no warning" "$(cat "$TMP/err")" ""
check "clean .env imports"             "${LOAD_ENV_TEST_NAME:-}" "Rob"
check "set -a export is preserved"     "$(env | grep -c '^LOAD_ENV_TEST_NAME=')" "1"

## Test 4: HOME and PATH are protected too
H="$HOME"; P="$PATH"
run_load "$TMP/worse.env"
check "HOME survives" "$HOME" "$H"
check "PATH survives" "$PATH" "$P"

## Test 5: a reserved name the file INTRODUCES ends up unset, not empty
unset CDPATH
printf 'CDPATH=/tmp\n' > "$TMP/intro.env"
run_load "$TMP/intro.env"
[ -z "${CDPATH+x}" ] && ok "an introduced reserved name is unset, not empty" \
                     || notok "CDPATH leaked as '${CDPATH:-}'"

## Test 6: dynamic and readonly names must not produce false warnings.
## LINENO/RANDOM change on their own and UID/PPID are readonly; guarding them
## would fire on every single load and train everyone to ignore the warning.
run_load "$TMP/good.env"
check "no false warning from dynamic/readonly names" "$(cat "$TMP/err")" ""

## Test 7: a missing .env is a silent no-op
load_agent_env "$TMP/nonexistent.env"; rc=$?
check "missing .env returns 0" "$rc" "0"

echo ""
echo "# Results: $pass/$((pass+fail)) passed, $fail failed"
[ "$fail" -eq 0 ]
