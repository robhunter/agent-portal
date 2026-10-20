"""Exercise the real framework entry points with coordinated local Git operations."""

import fcntl
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
import uuid


REPO = Path(__file__).resolve().parent.parent
GIT = shutil.which("git")
PYTHON = sys.executable


class FrameworkUpdates(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="framework updates ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / "remote.git"
        self.author = self.root / "author"
        self.framework = self.root / "shared"
        self.sync = self.root / "sync"
        self.sync.mkdir()
        self.processes = []
        self.names = []
        self.addCleanup(self.cleanup_processes)
        self.git(self.root, "init", "--bare", "--initial-branch=main", str(self.remote))
        self.git(self.root, "clone", str(self.remote), str(self.author))
        self.git(self.author, "config", "user.name", "Fixture")
        self.git(self.author, "config", "user.email", "fixture@example.invalid")
        self.good = self.advance("initial")
        self.git(self.root, "clone", str(self.remote), str(self.framework))
        subprocess.run([
            "bash", "-c", '. "$1"; make_offline_framework "$2" "$3"', "fixture",
            str(REPO / "test/helpers/offline-framework.sh"), str(REPO), str(self.framework),
        ], check=True, capture_output=True, text=True)
        scripts = self.framework / "scripts"
        for name in ("cron-setup.sh", "run-hooks.sh"):
            (scripts / name).write_text("exit 0\n")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.write_shim("python3", f"""
case "$1" in
  */framework-lock.py) printf '%s\\n' "$TEST_CALLER" >> "$TEST_SYNC/lock-attempts" ;;
esac
exec {shlex.quote(PYTHON)} "$@"
""")
        # Only scheduling is controlled: all Git operations use the real binary.
        self.write_shim("git", f"""
operation=""
for arg in "$@"; do
  case "$arg" in pull|checkout) operation="$arg"; break ;; esac
done
if [ -z "$operation" ]; then exec {shlex.quote(GIT)} "$@"; fi
printf '%s %s\\n' "$TEST_CALLER" "$operation" >> "$TEST_SYNC/operations"
if ! mkdir "$TEST_SYNC/active" 2>/dev/null; then
  echo overlap >> "$TEST_SYNC/overlap"
  echo 'concurrent Git mutation' >&2
  exit 97
fi
trap 'rmdir "$TEST_SYNC/active"' EXIT
count_file="$TEST_SYNC/$TEST_CALLER-$operation-count"
count=$(cat "$count_file" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$count_file"
if [ "$TEST_CALLER:$operation:$count" = "first:$TEST_HOLD:$TEST_HOLD_NTH" ]; then
  touch "$TEST_SYNC/held"
  for attempt in {{1..1000}}; do
    [ -e "$TEST_SYNC/release" ] && break
    sleep 0.01
  done
  [ -e "$TEST_SYNC/release" ] || exit 98
fi
{shlex.quote(GIT)} "$@"
""")
        self.write_shim("cron", "exit 0\n")
        self.write_shim("fixture-harness", "cat >/dev/null\nprintf '{\"type\":\"work\"}\\n' >> logs/events.jsonl\n")

    def write_shim(self, name, text):
        path = self.bin / name
        path.write_text("#!/bin/bash\n" + text)
        path.chmod(0o755)

    def git(self, cwd, *args):
        return subprocess.run([GIT, "-C", str(cwd), *args], check=True,
                              text=True, capture_output=True).stdout.strip()

    def advance(self, text):
        (self.author / "version").write_text(text + "\n")
        self.git(self.author, "add", "version")
        self.git(self.author, "commit", "-m", text)
        sha = self.git(self.author, "rev-parse", "HEAD")
        self.git(self.author, "push", "origin", "main")
        return sha

    def agent(self, known_good=None):
        name = "fw-concurrency-" + uuid.uuid4().hex
        self.names.append(name)
        directory = self.root / name
        directory.mkdir()
        config = (f"name: {name}\nrepo: example/none\nlock-file: {directory}/cycle.lock\n"
                  "wake-prompt: fixture\nrespond-prompt: fixture\n")
        if known_good:
            config += f"framework-last-known-good: {known_good}\n"
        (directory / "agent.yaml").write_text(config)
        return directory

    def marker(self, agent, suffix):
        return Path("/tmp") / (agent.name + suffix)

    def run_entry(self, caller, agent, hold="pull", start=False, cycle=None):
        env = os.environ.copy()
        env.update(PATH=str(self.bin) + os.pathsep + env["PATH"],
                   HOME=str(self.root / "empty-home"), GH_TOKEN="",
                   TEST_SYNC=str(self.sync), TEST_CALLER=caller, TEST_HOLD=hold,
                   TEST_HOLD_NTH="2" if cycle == "wake" else "1",
                   GIT_ALLOW_PROTOCOL="file", GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL="/dev/null")
        for key in ("DATA_DIR", "TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID", "OPEN_ROUTER_KEY"):
            env.pop(key, None)
        args = ["bash", str(self.framework / "scripts" /
                            ((cycle + ".sh") if cycle else ("start.sh" if start else "framework-update.sh")))]
        if not start and not cycle:
            args.append(str(self.framework))
        args.append(str(agent))
        out = (self.root / (caller + ".out")).open("w+")
        err = (self.root / (caller + ".err")).open("w+")
        self.addCleanup(out.close)
        self.addCleanup(err.close)
        proc = subprocess.Popen(args, env=env, stdout=out, stderr=err,
                                start_new_session=True)
        self.processes.append(proc)
        return proc, out, err

    def cleanup_processes(self):
        for proc in self.processes:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=5)
        for name in self.names:
            for path in Path("/tmp").glob(f"*{name}*"):
                if path.is_file():
                    path.unlink()

    def contents(self, path):
        return path.read_text() if path.exists() else ""

    def wait_for(self, predicate):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.01)
        self.fail("coordinated process did not reach the expected operation")

    def finish(self, result, sha):
        proc, out, err = result
        proc.wait(timeout=10)
        out.seek(0)
        err.seek(0)
        stdout, stderr = out.read(), err.read()
        self.assertEqual(proc.returncode, 0, stderr)
        self.assertEqual(stdout, f"FRAMEWORK_COMMIT='{sha}'\n")
        self.assertNotIn("pull failed", stderr)
        self.assertNotIn("multiple branches", stderr)
        return stderr

    def coordinate(self, second):
        self.wait_for(lambda: (self.sync / "held").exists())
        second_result = second()
        self.wait_for(lambda: self.contents(self.sync / "lock-attempts").count("\n") >= 2
                      or (self.sync / "overlap").exists()
                      or second_result[0].poll() is not None)
        # An overlap marker or premature exit also lets historical code finish,
        # so the test fails on observed behavior instead of hanging on a barrier.
        with (self.framework / ".git/framework-update.lock").open("a") as lock:
            with self.assertRaises(BlockingIOError, msg="the held operation must own the checkout lock"):
                fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        (self.sync / "release").touch()
        return second_result

    def assert_serial(self):
        self.assertFalse((self.sync / "overlap").exists(), "Git mutations overlapped")
        self.assertEqual(self.contents(self.sync / "lock-attempts"), "first\nsecond\n")

    def test_two_wakes_with_advancing_remote(self):
        first_agent, second_agent = self.agent(), self.agent()
        first = self.run_entry("first", first_agent)
        self.wait_for(lambda: (self.sync / "held").exists())
        target = self.advance("new remote commit")
        second = self.coordinate(lambda: self.run_entry("second", second_agent))
        self.finish(first, target)
        self.finish(second, target)
        self.assert_serial()
        self.assertEqual(self.git(self.framework, "rev-parse", "HEAD"), target)
        self.assertEqual((self.framework / "version").read_text(), "new remote commit\n")
        for agent in (first_agent, second_agent):
            self.assertEqual(self.marker(agent, "-portal-commit").read_text().strip(), target)

    def test_rollback_finishes_before_waiting_wake(self):
        target = self.advance("broken remote commit")
        first_agent, second_agent = self.agent(self.good), self.agent()
        (Path("/tmp") / f"agent-{first_agent.name}-cycle-failed").touch()
        first = self.run_entry("first", first_agent, hold="checkout")
        second = self.coordinate(lambda: self.run_entry("second", second_agent))
        self.finish(first, self.good)
        self.finish(second, target)
        self.assert_serial()
        events = [json.loads(line) for line in
                  (first_agent / "logs/events.jsonl").read_text().splitlines()]
        self.assertEqual([event["type"] for event in events], ["rollback"])
        self.assertEqual(self.marker(first_agent, "-portal-commit").read_text().strip(), self.good)
        self.assertEqual(self.git(self.framework, "rev-parse", "HEAD"), target)

    def test_startup_pull_waits_for_wake(self):
        target = self.advance("startup target")
        first = self.run_entry("first", self.agent())
        startup_agent = self.agent()
        second = self.coordinate(lambda: self.run_entry("second", startup_agent, start=True))
        self.finish(first, target)
        self.wait_for(lambda: "Supervisor ready." in self.contents(self.root / "second.out"))
        self.assertIsNone(second[0].poll(), "startup should keep supervising")
        self.assert_serial()
        self.assertEqual(self.contents(self.sync / "operations"), "first pull\nsecond pull\n")

    def test_two_wakes_without_remote_change(self):
        first = self.run_entry("first", self.agent())
        second = self.coordinate(lambda: self.run_entry("second", self.agent()))
        self.finish(first, self.good)
        self.finish(second, self.good)
        self.assert_serial()

    def test_failed_rollback_reports_real_head_and_releases_lock(self):
        target = self.advance("rollback failure target")
        agent = self.agent("deadbeef" * 5)
        (Path("/tmp") / f"agent-{agent.name}-cycle-failed").touch()
        first = self.run_entry("first", agent, hold="checkout")
        second = self.coordinate(lambda: self.run_entry("second", self.agent()))
        stderr = self.finish(first, target)
        self.assertIn("ERROR: rollback failed", stderr)
        self.finish(second, target)
        self.assert_serial()
        events = [json.loads(line) for line in
                  (agent / "logs/events.jsonl").read_text().splitlines()]
        self.assertEqual([event["type"] for event in events], ["error"])

    def test_failed_pull_keeps_current_commit_and_releases_lock(self):
        self.git(self.framework, "remote", "set-url", "origin", str(self.root / "missing.git"))
        (self.sync / "release").touch()
        agent = self.agent()
        proc, out, err = self.run_entry("first", agent)
        proc.wait(timeout=10)
        out.seek(0)
        err.seek(0)
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(out.read(), f"FRAMEWORK_COMMIT='{self.good}'\n")
        self.assertIn("framework pull failed", err.read())
        self.git(self.framework, "remote", "set-url", "origin", str(self.remote))
        target = self.advance("recovered remote")
        self.finish(self.run_entry("second", agent), target)

    def test_lock_failure_leaves_checkout_untouched(self):
        target = self.advance("must not pull")
        (self.framework / ".git/framework-update.lock").mkdir()
        (self.sync / "release").touch()
        proc, out, err = self.run_entry("first", self.agent())
        proc.wait(timeout=10)
        out.seek(0)
        err.seek(0)
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(out.read(), f"FRAMEWORK_COMMIT='{self.good}'\n")
        self.assertIn("framework update lock unavailable", err.read())
        self.assertEqual(self.git(self.framework, "rev-parse", "HEAD"), self.good)
        self.assertFalse((self.sync / "operations").exists())
        self.assertNotEqual(target, self.good)

    def test_lock_timeout_keeps_current_commit(self):
        self.advance("must not pull after timeout")
        self.write_shim("python3", f"""
exec {shlex.quote(PYTHON)} "$1" --timeout 0.05 "${{@:2}}"
""")
        with (self.framework / ".git/framework-update.lock").open("a") as lock:
            fcntl.lockf(lock, fcntl.LOCK_EX)
            proc, out, err = self.run_entry("first", self.agent())
            proc.wait(timeout=10)
        out.seek(0)
        err.seek(0)
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(out.read(), f"FRAMEWORK_COMMIT='{self.good}'\n")
        self.assertIn("timed out waiting", err.read())
        self.assertFalse((self.sync / "operations").exists())

    def test_startup_lock_failure_keeps_supervising_without_pulling(self):
        self.advance("must not pull on startup")
        (self.framework / ".git/framework-update.lock").mkdir()
        result = self.run_entry("first", self.agent(), start=True)
        self.wait_for(lambda: "Supervisor ready." in self.contents(self.root / "first.out"))
        self.assertIsNone(result[0].poll())
        self.assertIn("Framework pull failed (non-fatal)", self.contents(self.root / "first.out"))
        self.assertEqual(self.git(self.framework, "rev-parse", "HEAD"), self.good)
        self.assertFalse((self.sync / "operations").exists())

    def test_terminated_lock_holder_releases_lock(self):
        ready = self.root / "holder-ready"
        proc = subprocess.Popen(
            [PYTHON, str(self.framework / "scripts/framework-lock.py"),
             str(self.framework), "bash", "-c", 'touch "$1"; exec sleep 30',
             "holder", str(ready)], start_new_session=True,
        )
        self.processes.append(proc)
        self.wait_for(ready.exists)
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=5)
        self.assertTrue((self.framework / ".git/framework-update.lock").exists())
        (self.sync / "release").touch()
        self.finish(self.run_entry("first", self.agent()), self.good)

    def check_workspace_pull(self, cycle):
        agent = self.agent()
        with (agent / "agent.yaml").open("a") as config:
            config.write(f"workspaces:\n  - repo: fixture/framework\n    path: {self.framework}\n")
        (agent / "portal.config.json").write_text(json.dumps({
            "harness": {"type": "mock", "command": "fixture-harness", "extraFlags": ""},
        }))
        self.git(agent, "init", "--initial-branch=main")
        self.git(agent, "config", "user.name", "Fixture")
        self.git(agent, "config", "user.email", "fixture@example.invalid")
        self.git(agent, "add", ".")
        self.git(agent, "commit", "-m", "initial agent")
        first = self.run_entry("first", agent, cycle=cycle)
        second = self.coordinate(lambda: self.run_entry("second", self.agent()))
        self.finish(second, self.good)
        proc, out, err = first
        proc.wait(timeout=10)
        err.seek(0)
        out.seek(0)
        self.assertEqual(proc.returncode, 0, err.read() + out.read() +
                         self.contents(agent / "logs/cycles/wake-steps.log"))
        self.assertFalse((self.sync / "overlap").exists(), "workspace pull overlapped update")
        events = [json.loads(line) for line in (agent / "logs/events.jsonl").read_text().splitlines()]
        self.assertIn("cycle_end", [event["type"] for event in events])
        self.assertNotIn("error", [event["type"] for event in events])

    def test_respond_workspace_pull_waits_for_update(self):
        self.check_workspace_pull("respond")

    def test_wake_workspace_pull_waits_for_update(self):
        self.check_workspace_pull("wake")


if __name__ == "__main__":
    unittest.main(verbosity=2)
