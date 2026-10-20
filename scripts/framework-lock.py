#!/usr/bin/env python3
"""Run a command under the checkout's POSIX record lock."""

import argparse
import fcntl
import os
import subprocess
import sys
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("framework_dir")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.command:
        parser.error("a command is required")

    try:
        git_dir = subprocess.check_output(
            ["git", "-C", args.framework_dir, "rev-parse", "--absolute-git-dir"],
            text=True,
        ).strip()
        lock = open(Path(git_dir) / "framework-update.lock", "a")
        deadline = time.monotonic() + args.timeout
        while True:
            try:
                # flock(2) is local to each container on some shared mounts;
                # POSIX record locks are propagated by those filesystems.
                fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("timed out waiting for framework update lock")
                time.sleep(min(0.1, remaining))
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"Framework lock unavailable: {error}", file=sys.stderr)
        return 75

    # POSIX locks survive exec in this PID, and the kernel releases them on
    # exit, including SIGKILL. No stale-file cleanup or PID-namespace check.
    os.set_inheritable(lock.fileno(), True)
    os.execvp(args.command[0], args.command)


if __name__ == "__main__":
    sys.exit(main())
