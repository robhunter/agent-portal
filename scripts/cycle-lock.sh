#!/bin/bash
# scripts/cycle-lock.sh — the cycle lock, sourced by wake.sh.
#
# A failed `flock -n` always means a live holder. The kernel releases an flock
# when the open file description holding it is closed, which includes every way
# a process can die — so there is no such thing as an orphaned flock, and a lock
# we cannot acquire is never ours to break by unlinking the file. Unlinking it
# gives the newcomer a fresh inode and an uncontended lock, which is two cycles
# in one working tree (issue #299).
#
# The holder's PID comes from the lock file, which wake.sh writes after it
# acquires. If it cannot be read, the holder is unknown, and an unknown holder
# is a reason to skip rather than a reason to break in: a missed wake costs one
# interval, a concurrent wake costs a shared working tree.
#
# acquire_cycle_lock <lock-file> <stale-timeout-seconds>
#   0 — acquired, fd 200 holds it
#   1 — held by another cycle; skip this wake
#   2 — acquired after killing a holder older than the timeout
# Sets LOCK_HOLDER_PID and LOCK_HOLDER_AGE for the caller's log line.

acquire_cycle_lock() {
  local lock_file="$1"
  local stale_timeout="$2"

  LOCK_HOLDER_PID=""
  LOCK_HOLDER_AGE=""

  # <> rather than >, which would truncate away the PID the holder wrote.
  exec 200<>"$lock_file"
  if flock -n 200; then
    return 0
  fi

  LOCK_HOLDER_PID=$(head -1 "$lock_file" 2>/dev/null | tr -dc '0-9')
  if [ -n "$LOCK_HOLDER_PID" ]; then
    LOCK_HOLDER_AGE=$(ps -o etimes= -p "$LOCK_HOLDER_PID" 2>/dev/null | tr -d ' ')
  fi

  if [ -z "$LOCK_HOLDER_AGE" ]; then
    return 1
  fi
  if [ "$LOCK_HOLDER_AGE" -le "$stale_timeout" ]; then
    return 1
  fi

  kill "$LOCK_HOLDER_PID" 2>/dev/null || true
  sleep 2
  if kill -0 "$LOCK_HOLDER_PID" 2>/dev/null; then
    kill -9 "$LOCK_HOLDER_PID" 2>/dev/null || true
    sleep 1
  fi

  if flock -n 200; then
    return 2
  fi
  return 1
}
