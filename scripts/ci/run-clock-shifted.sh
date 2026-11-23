#!/usr/bin/env bash
# Run a command with the wall clock moved forward (#782).
#
#   scripts/ci/run-clock-shifted.sh [--days N] -- <command> [args...]
#
# Builds scripts/ci/clockshift.c into a temp dir with the system C compiler
# and runs <command> with it preloaded, so Python, Node and git (and every
# subprocess they start) see "now" N days ahead (default 400). Monotonic
# clocks are not shifted. Fails loudly if the shift does not take effect.
set -euo pipefail

days=400
if [[ "${1:-}" == "--days" ]]; then
  days="$2"
  shift 2
fi
if [[ "${1:-}" == "--" ]]; then shift; fi
if [[ $# -eq 0 ]]; then
  echo "usage: $0 [--days N] -- <command> [args...]" >&2
  exit 2
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT
cc -shared -fPIC -O2 -o "$build/libclockshift.so" "$here/clockshift.c" -ldl

export CLOCKSHIFT_DAYS="$days"
export LD_PRELOAD="$build/libclockshift.so${LD_PRELOAD:+:$LD_PRELOAD}"

# Prove the shift reached every runtime before trusting a green run.
real_today="$(env -u LD_PRELOAD date -u +%F)"
want="$(env -u LD_PRELOAD date -u -d "$real_today + $days days" +%F)"
py_today="$(python3 -c 'import datetime as d; print(d.date.today(), d.datetime.now(d.timezone.utc).date())')"
node_today="$(node -e 'const d = new Date(); console.log(d.toISOString().slice(0, 10), new Date(Date.now()).toISOString().slice(0, 10))')"
git_today="$(git -c log.showSignature=false var GIT_COMMITTER_IDENT | awk '{print $(NF-1)}' | xargs -I{} date -u -d @{} +%F)"
for got in $py_today $node_today $git_today; do
  # Allow one day of slack: the local zone and UTC can straddle midnight.
  if [[ "$got" != "$want" && "$got" != "$(env -u LD_PRELOAD date -u -d "$want - 1 day" +%F)" && "$got" != "$(env -u LD_PRELOAD date -u -d "$want + 1 day" +%F)" ]]; then
    echo "clockshift: shift did not take effect (want $want; python $py_today, node $node_today, git $git_today)" >&2
    exit 3
  fi
done
echo "clockshift: real $real_today -> $want (+${days}d; python $py_today, node $node_today, git $git_today)" >&2

"$@"
