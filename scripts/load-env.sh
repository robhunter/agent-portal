#!/bin/bash
# scripts/load-env.sh — source an agent's .env WITHOUT letting it redefine the
# shell's own variables.
#
# Why this exists, in full, because the symptom pointed nowhere near the cause:
#
# An agent's .env contained `PWD=<a password>`. `set -a; . .env; set +a` duly
# set PWD — the shell's current-working-directory variable — to a string with no
# '/' in it. Everything kept working until vm-setup.sh sourced nvm.sh, whose
# nvm_find_up walks up the tree looking for .nvmrc:
#
#     path_="${PWD}"
#     while [ "$path_" != "" ] && [ "$path_" != '.' ] && [ ! -f "$path_/.nvmrc" ]; do
#       path_=${path_%/*}
#     done
#
# With no '/' in PWD, `${path_%/*}` strips nothing, the loop never advances, and
# it spins forever. No error, no output, no CPU spike — a container create that
# hangs until something kills it. Two agents were down for an afternoon, and the
# investigation went to the network, the proxy and the download timeout first,
# because a hang inside nvm looks like a problem with nvm.
#
# The lesson is not "do not name a variable PWD". It is that a config file must
# not be able to redefine the interpreter's own state, because the resulting
# failure surfaces arbitrarily far from the file that caused it.
#
# Approach: snapshot, source normally, compare, restore what the file changed
# and say so loudly. Restoring rather than pre-filtering keeps the real shell
# parser in charge, so quoting, multi-line values and `export` prefixes behave
# exactly as they always did — a grep-based filter cannot promise that. Nothing
# executes between the source and the restore, so the window in which a value is
# wrong contains no code that could observe it.
#
# Usage:
#   . "$FRAMEWORK_DIR/scripts/load-env.sh"
#   load_agent_env "$AGENT_DIR/.env"     # no-op when the file is absent

# Names whose meaning belongs to the shell AND which a .env could plausibly set.
#
# Deliberately excludes UID/EUID/PPID/BASHOPTS/SHELLOPTS (readonly — bash already
# refuses the assignment) and LINENO/RANDOM/SECONDS/FUNCNAME (dynamic — they
# change between the snapshot and the comparison, so guarding them reports a
# clobber on every single load). Guarding a name bash already protects buys
# nothing and costs a false alarm on every cycle.
LOAD_ENV_RESERVED="PWD OLDPWD HOME PATH IFS SHELL BASH_ENV ENV CDPATH"

load_agent_env() {
  local envfile="${1:?load_agent_env: no .env path given}"
  [ -f "$envfile" ] || return 0

  # Snapshot. Set-vs-unset is tracked separately from the value: a name the file
  # INTRODUCES must end up unset again, not set to empty string.
  local _n
  for _n in $LOAD_ENV_RESERVED; do
    if [ -n "${!_n+x}" ]; then
      eval "_LE_HAD_${_n}=1; _LE_VAL_${_n}=\${${_n}}"
    else
      eval "_LE_HAD_${_n}=0; _LE_VAL_${_n}="
    fi
  done

  set -a
  # shellcheck disable=SC1090
  . "$envfile"
  set +a

  local _clobbered="" _had _val _now
  for _n in $LOAD_ENV_RESERVED; do
    eval "_had=\${_LE_HAD_${_n}}; _val=\${_LE_VAL_${_n}}"
    if [ -n "${!_n+x}" ]; then _now="1:${!_n}"; else _now="0:"; fi
    if [ "$_now" != "${_had}:${_val}" ]; then
      _clobbered="$_clobbered $_n"
      # Plain assignment, NOT `declare` — inside a function `declare` creates a
      # local and the global stays clobbered, which is exactly how the first
      # version of this guard failed its own test.
      if [ "$_had" = "1" ]; then eval "${_n}=\${_LE_VAL_${_n}}"; else unset "$_n"; fi
    fi
    unset "_LE_HAD_${_n}" "_LE_VAL_${_n}"
  done

  if [ -n "$_clobbered" ]; then
    echo "WARNING: $envfile assigns shell-reserved variable(s):$_clobbered" >&2
    echo "  Those names belong to the shell. Reassigning them breaks things far" >&2
    echo "  from this file — a PWD with no '/' in it makes nvm's .nvmrc search" >&2
    echo "  loop forever, which stalls a container build with no error at all." >&2
    echo "  The assignment(s) were IGNORED. Rename them in $envfile." >&2
  fi

  return 0
}
