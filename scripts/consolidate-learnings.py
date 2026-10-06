#!/usr/bin/env python3
"""Add new learnings to an agent's memory/operational.yaml (agent-portal#310).

Usage: consolidate-learnings.py <operational.yaml> <first-id> <added-date> < learnings.txt
  One learning per line on stdin; blank lines are skipped.

consolidate-memory.sh used to append each entry to the end of the file with a
two-space indent. That only works when `learnings:` is the file's last key and its
items are indented two spaces; otherwise the entries land inside whatever key
comes last and the file stops parsing. This script instead:

  - inserts the entries at the end of the `learnings:` list, at the indentation that
    list's items already use, so keys after the list are left alone;
  - writes each observation with json.dumps, whose output is a valid YAML
    double-quoted scalar (quotes and backslashes escaped);
  - when PyYAML is importable, parses the result and checks the new ids are the last
    items of the learnings list before replacing the file. If not, the file is left
    byte-for-byte as it was, the learnings are printed, and the exit status is 1.
"""
import json
import os
import re
import sys
import tempfile

LEARNINGS_KEY = re.compile(r"^learnings:[ \t]*(?:#.*)?$")
EMPTY_LEARNINGS_KEY = re.compile(r"^learnings:[ \t]*\[\][ \t]*(?:#.*)?$")
LIST_ITEM = re.compile(r"^([ \t]*)- ")
TOP_LEVEL_KEY = re.compile(r"^[^\s#-]")
DEFAULT_INDENT = "  "


def entry_lines(indent, learning_id, observation, added):
    return [
        f"{indent}- id: {learning_id}\n",
        f"{indent}  observation: {json.dumps(observation, ensure_ascii=False)}\n",
        f"{indent}  added: {json.dumps(added)}\n",
    ]


def entries(indent, first_id, observations, added):
    lines = []
    for offset, observation in enumerate(observations):
        lines.extend(entry_lines(indent, first_id + offset, observation, added))
    return lines


def is_content(line):
    stripped = line.strip()
    return bool(stripped) and not stripped.startswith("#")


def insert(text, observations, first_id, added):
    lines = text.splitlines(keepends=True)
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"

    key = next((i for i, line in enumerate(lines) if LEARNINGS_KEY.match(line) or EMPTY_LEARNINGS_KEY.match(line)), None)

    if key is None:
        first = next((line for line in lines if is_content(line)), None)
        if first is None:
            return "".join(lines + ["learnings:\n"] + entries(DEFAULT_INDENT, first_id, observations, added))
        item = LIST_ITEM.match(first)
        if item:
            # A bare list of entries, as the old append produced for a file it created.
            return "".join(lines + entries(item.group(1), first_id, observations, added))
        return "".join(lines + ["learnings:\n"] + entries(DEFAULT_INDENT, first_id, observations, added))

    if EMPTY_LEARNINGS_KEY.match(lines[key]):
        new = entries(DEFAULT_INDENT, first_id, observations, added)
        return "".join(lines[:key] + ["learnings:\n"] + new + lines[key + 1:])

    end = next((i for i in range(key + 1, len(lines)) if TOP_LEVEL_KEY.match(lines[i])), len(lines))
    indent = DEFAULT_INDENT
    for line in lines[key + 1:end]:
        item = LIST_ITEM.match(line)
        if item:
            indent = item.group(1)
            break
    # Keep blank lines and column-0 comments that introduce the next key after the new entries.
    at = end
    while at > key + 1 and (not lines[at - 1].strip() or lines[at - 1].startswith("#")):
        at -= 1
    new = entries(indent, first_id, observations, added)
    return "".join(lines[:at] + new + lines[at:])


def problem_with(text, new_ids):
    """None if the text is fine, or a reason it is not. None as well when PyYAML is missing."""
    try:
        import yaml
    except ImportError:
        return None
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as error:
        return f"the result does not parse: {error}"
    held = data.get("learnings") if isinstance(data, dict) else data
    if not isinstance(held, list):
        return "the result has no learnings list"
    tail = [item.get("id") if isinstance(item, dict) else None for item in held[-len(new_ids):]]
    if tail != new_ids:
        return f"the learnings list ends with ids {tail}, not the new ids {new_ids}"
    return None


def main():
    if len(sys.argv) != 4:
        print("usage: consolidate-learnings.py <operational.yaml> <first-id> <added-date> < learnings.txt", file=sys.stderr)
        return 2
    path, first_id, added = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    observations = [line.rstrip("\n") for line in sys.stdin if line.strip()]
    if not observations:
        print("No new operational learnings to add.")
        return 0

    original = ""
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            original = handle.read()

    updated = insert(original, observations, first_id, added)
    new_ids = list(range(first_id, first_id + len(observations)))
    problem = problem_with(updated, new_ids)
    if problem:
        print(f"{path} left unchanged: {problem}. The learnings that were not added:", file=sys.stderr)
        for observation in observations:
            print(f"  - {observation}", file=sys.stderr)
        return 1

    directory = os.path.dirname(os.path.abspath(path))
    fd, scratch = tempfile.mkstemp(dir=directory, prefix=".operational-", suffix=".yaml")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(updated)
        os.chmod(scratch, os.stat(path).st_mode & 0o777 if os.path.exists(path) else 0o644)
        os.replace(scratch, path)
    except BaseException:
        if os.path.exists(scratch):
            os.unlink(scratch)
        raise
    print(f"Added {len(observations)} new learnings to operational.yaml (ids {new_ids[0]}-{new_ids[-1]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
