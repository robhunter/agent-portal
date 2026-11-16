#!/usr/bin/env python3
"""
harness-auth.py — remember when a harness's login stopped working.

A credentials file that exists is not a login that works: on 2026-11-16 Codex
answered every run with `401 … token_revoked` while ~/.codex/auth.json sat
untouched, so every portal kept saying "authenticated". This records what the
harness actually reported, and the portal reads it.

  scan [--strict] <data-dir> <cycle-log>...
                                   record auth failures found in a cycle's logs.
                                   wake.sh uses --strict for a cycle that
                                   succeeded: only Codex's own timestamped
                                   `ERROR codex…` log lines count there, which
                                   a review quoting these messages cannot
                                   produce. A failed cycle is scanned in full.
  status <data-dir> <harness>      JSON: {"failed": bool, "at": ..., "error": ...}
  selftest

A recorded failure clears itself once that harness's credentials file is
written after it — a new login, or any successful token refresh. State lives
in <data-dir>/state/harness-auth.json.
"""
import datetime
import json
import os
import re
import sys
import tempfile

# Codex logs its own auth errors as `<ts>Z ERROR codex_<module>: … 401 …`, and
# does so even in a run that still succeeds on a not-yet-expired access token —
# on 2026-11-16 that line appeared at 09:42, 45 minutes before the first failed
# review. A successful cycle is scanned for this shape only.
STRICT = {
    "codex": re.compile(r"^\S+Z\s+ERROR codex\S*:.*(token_revoked|invalidated oauth token)", re.I),
}

SIGNATURES = {
    "codex": re.compile(
        r"token_revoked|invalidated oauth token|refresh token was revoked"
        r"|access token could not be refreshed", re.I),
    "claude-code": re.compile(
        r"OAuth token has expired|Invalid API key|Please run /login"
        r"|\"type\"\s*:\s*\"authentication_error\"", re.I),
}


def credentials_path(harness):
    home = os.environ.get("HOME", "/root")
    if harness == "codex":
        return os.path.join(os.environ.get("CODEX_HOME") or os.path.join(home, ".codex"),
                            "auth.json")
    if harness == "claude-code":
        return os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(home, ".claude"),
                            ".credentials.json")
    return None


def _state_file(data_dir):
    return os.path.join(data_dir, "state", "harness-auth.json")


def load(data_dir):
    try:
        with open(_state_file(data_dir)) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save(data_dir, state):
    path = _state_file(data_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
    with os.fdopen(fd, "w") as fh:
        json.dump(state, fh, indent=2)
    os.replace(tmp, path)


def find_failures(text, strict=False):
    """{harness: matching line} for every harness whose auth failure appears."""
    found = {}
    for harness, pattern in (STRICT if strict else SIGNATURES).items():
        for line in text.splitlines():
            if pattern.search(line):
                found[harness] = line.strip()[:300]
                break
    return found


def scan(data_dir, logs, now=None, strict=False):
    text = ""
    for p in logs:
        try:
            with open(p, errors="replace") as fh:
                text += fh.read() + "\n"
        except OSError:
            pass
    found = find_failures(text, strict)
    if not found:
        return {}
    now = now or datetime.datetime.now(datetime.timezone.utc).timestamp()
    state = load(data_dir)
    new = {}
    for harness, line in found.items():
        if not state.get(harness) or not current(state[harness], harness):
            new[harness] = line
        state[harness] = {"failedAt": now, "error": line}
    save(data_dir, state)
    return new


def current(entry, harness, cred_mtime=None):
    """Is this recorded failure still in force?"""
    if not entry or "failedAt" not in entry:
        return False
    if cred_mtime is None:
        try:
            cred_mtime = os.path.getmtime(credentials_path(harness))
        except (OSError, TypeError):
            return True        # nothing to compare against: keep reporting it
    return cred_mtime <= entry["failedAt"]


def status(data_dir, harness):
    entry = load(data_dir).get(harness)
    if not current(entry, harness):
        return {"failed": False}
    at = datetime.datetime.fromtimestamp(entry["failedAt"], datetime.timezone.utc)
    return {"failed": True, "at": at.isoformat(timespec="seconds"), "error": entry["error"]}


def selftest():
    ok = 0
    codex_401 = ("ERROR: unexpected status 401 Unauthorized: Encountered invalidated oauth "
                 "token for user, failing request, auth error code: token_revoked")
    assert set(find_failures(codex_401)) == {"codex"}; ok += 1
    assert set(find_failures("Your access token could not be refreshed because your refresh "
                             "token was revoked. Please log out and sign in again.")) == {"codex"}; ok += 1
    assert set(find_failures('API Error: 401 {"type":"error","error":{"type":"authentication_error",'
                             '"message":"OAuth token has expired."}}')) == {"claude-code"}; ok += 1
    assert find_failures("curl: HTTP 401 from dev.azure.com") == {}; ok += 1      # other 401s don't count
    assert find_failures("all good") == {}; ok += 1
    codex_log = ("2026-11-16T17:42:33.245078Z ERROR codex_models_manager::manager: failed to refresh "
                 "available models: unexpected status 401 Unauthorized: Encountered invalidated oauth token")
    assert set(find_failures(codex_log, strict=True)) == {"codex"}; ok += 1
    assert find_failures("    assert 'token_revoked' in reply  # a reviewed test", strict=True) == {}; ok += 1
    assert find_failures('API Error: 401 {"type":"authentication_error"}', strict=True) == {}; ok += 1

    d = tempfile.mkdtemp()
    log = os.path.join(d, "cycle.log")
    with open(log, "w") as fh:
        fh.write("[review-wrapper] running codex\n" + codex_401 + "\n")
    assert scan(d, [log], now=1000.0) == {"codex": codex_401}; ok += 1      # newly failed
    assert scan(d, [log], now=1060.0) == {}; ok += 1                        # already known: not "new"
    entry = load(d)["codex"]
    assert current(entry, "codex", cred_mtime=900.0); ok += 1               # login older than failure
    assert not current(entry, "codex", cred_mtime=2000.0); ok += 1          # re-login / refresh clears it
    assert not current(None, "codex"); ok += 1
    print(f"selftest: {ok} passed")


def main(argv):
    strict = "--strict" in argv
    argv = [a for a in argv if a != "--strict"]
    if argv[:1] == ["scan"] and len(argv) >= 3:
        for harness, line in scan(argv[1], argv[2:], strict=strict).items():
            print(f"{harness}: {line}")
    elif argv[:1] == ["status"] and len(argv) == 3:
        print(json.dumps(status(argv[1], argv[2])))
    elif argv[:1] == ["selftest"]:
        selftest()
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
