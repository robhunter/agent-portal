#!/bin/bash
# Set up Python venv for memory search scripts.
# Usage: bash scripts/memory-setup.sh
# Installs fastembed and numpy into scripts/memory-venv/

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/memory-venv"

if [ -d "$VENV_DIR" ] && [ -f "$VENV_DIR/bin/python" ]; then
    echo "Memory venv already exists at $VENV_DIR"
    exit 0
fi

echo "Creating Python venv at $VENV_DIR..."

# Ensure python3-venv is available
if ! python3 -m venv --help >/dev/null 2>&1; then
    echo "Installing python3-venv..."
    apt-get update -qq && apt-get install -y -qq python3.12-venv python3-full
fi

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet fastembed

echo "Memory venv ready. Model will be downloaded on first use."
