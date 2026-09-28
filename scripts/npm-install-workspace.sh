#!/bin/bash
# scripts/npm-install-workspace.sh — install a workspace's npm dependencies the
# way its agent.yaml `npm-install` value asks. Sourced by wake.sh and respond.sh
# so both cycles install a workspace the same way.
#
#   true  production dependencies only (`npm install --production`), for agents
#         that run a workspace's code
#   dev   devDependencies too (`npm install`), for agents that build or test
#         the workspace; --production would delete tsc and the test runner
#
# Any other value installs nothing. Returns npm's exit status.

npm_install_mode_installs() {
  [ "$1" = "true" ] || [ "$1" = "dev" ]
}

npm_install_workspace() {
  local ws_path="$1" mode="$2"
  case "$mode" in
    true) (cd "$ws_path" && npm install --production 200>&- 2>&1) ;;
    dev)  (cd "$ws_path" && npm install 200>&- 2>&1) ;;
    *)    return 0 ;;
  esac
}
