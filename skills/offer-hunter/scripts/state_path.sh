#!/usr/bin/env bash
# Print the per-clone offer-hunter state file path.
# State lives outside the repository so unattended agents can write it and
# `git status` stays clean. The repository path keys the directory, so
# concurrent runs in different clones never collide.
set -u

repo="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Error: not inside a git repository" >&2
  echo "Fix: cd into the freetokens repo first" >&2
  exit 1
}
if [ -z "${HOME:-}" ]; then
  echo "Error: HOME is not set" >&2
  echo "Fix: set HOME to a writable directory" >&2
  exit 1
fi

key="$(printf '%s' "$repo" | cksum | cut -d' ' -f1)"
root="${XDG_STATE_HOME:-$HOME/.local/state}/offer-hunter"
printf '%s\n' "$root/$key/state.env"
