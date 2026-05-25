#!/bin/bash
# scripts/reconcile-cost.sh — Settlement-aware cost reconciliation for a
# single completed cycle.
#
# Usage: reconcile-cost.sh <cost.yaml path> <openrouter key> <delay seconds>
#
# wake.sh spawns this script detached after a cycle completes. After the
# delay (default 900s = 15 min), it re-queries OpenRouter's /credits
# ledger and writes the SETTLED delta into the cost.yaml file. This is
# needed because OpenRouter's billing posts asynchronously — a snapshot
# taken immediately at cycle-end under-counts by the settlement-window's
# worth of spend (see contentbot Eval B finding, post-stage2-evals.md).
#
# Why a separate script rather than inline in wake.sh:
#   - wake.sh releases its lock on exit. The reconciliation runs after,
#     potentially while another cycle is starting; using a separate
#     process avoids lock-fd inheritance issues.
#   - Detaching cleanly means wake.sh can return promptly after the
#     cycle's harness exits without blocking on reconciliation.
#   - Failures here are non-fatal; cost.yaml retains its unsettled value
#     and a `reconciled_at: null` field flags that it's provisional.

set -u

COST_FILE="${1:?cost.yaml path required}"
OR_KEY="${2:?openrouter key required}"
DELAY="${3:-900}"

if [ ! -f "$COST_FILE" ]; then
  echo "reconcile-cost: cost file not found: $COST_FILE" >&2
  exit 1
fi

# Wait for settlement window
sleep "$DELAY"

# Pull current ledger value
USAGE_SETTLED=$(curl -s -H "Authorization: Bearer $OR_KEY" \
  --max-time 15 \
  https://openrouter.ai/api/v1/credits 2>/dev/null \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data']['total_usage'])" 2>/dev/null)

if [ -z "$USAGE_SETTLED" ]; then
  echo "reconcile-cost: failed to fetch OR ledger; leaving cost.yaml unreconciled" >&2
  exit 1
fi

# Update cost.yaml in-place. Pyyaml not guaranteed available; fall back
# to literal sed for the four fields we need to flip.
python3 - "$COST_FILE" "$USAGE_SETTLED" <<'PYEOF'
import sys, yaml, datetime
path, settled_str = sys.argv[1], sys.argv[2]
settled = float(settled_str)
d = yaml.safe_load(open(path))
delta_settled = round(settled - float(d['usage_at_start_usd']), 6)
d['settlement_reconciled'] = True
d['reconciled_at'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')
d['usage_at_end_settled_usd'] = settled
d['delta_settled_usd'] = delta_settled
# Keep fields in a stable order for readability
ordered_keys = [
    'cycle_id', 'started_at', 'ended_at', 'provider',
    'usage_at_start_usd',
    'usage_at_end_immediate_usd', 'delta_unsettled_usd',
    'usage_at_end_settled_usd', 'delta_settled_usd',
    'settlement_reconciled', 'reconciled_at',
]
ordered = {k: d[k] for k in ordered_keys if k in d}
for k in d:
    if k not in ordered:
        ordered[k] = d[k]
open(path, 'w').write(yaml.safe_dump(ordered, sort_keys=False))
PYEOF
