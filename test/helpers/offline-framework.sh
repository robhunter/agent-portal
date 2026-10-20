#!/bin/bash
# Run real cycle scripts without importing host credentials or NVM. Only the
# host integration paths change in this disposable copy, never the push logic.
make_offline_framework() {
  local source_dir="$1" target_dir="$2"
  mkdir -p "$target_dir/scripts" "$target_dir/host-profile" "$target_dir/host-nvm"
  cp "$source_dir"/scripts/*.sh "$source_dir"/scripts/*.js "$source_dir"/scripts/framework-lock.py "$target_dir/scripts/"
  ln -s "$source_dir/node_modules" "$target_dir/node_modules"
  node - "$target_dir" <<'JS'
const fs = require('fs');
const root = process.argv[2];
for (const [name, before, after] of [
  ['commit.sh', '/etc/profile.d/sandcat-*.sh', '"$FRAMEWORK_DIR/host-profile"/sandcat-*.sh'],
  ['wake.sh', '/etc/profile.d/sandcat-*.sh', '"$FRAMEWORK_DIR/host-profile"/sandcat-*.sh'],
  ['respond.sh', '$HOME/.nvm', '$FRAMEWORK_DIR/host-nvm'],
]) {
  const file = `${root}/scripts/${name}`;
  const source = fs.readFileSync(file, 'utf8');
  if (source.split(before).length !== 2) throw new Error(`Expected one host path in ${name}`);
  fs.writeFileSync(file, source.replace(before, after));
}
JS
}

# A fixture accidentally acquiring a remote must still never contact it.
export GIT_ALLOW_PROTOCOL=file GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
unset GH_TOKEN TEST_PUSH_TOKEN DATA_DIR
