#!/usr/bin/env bash
# Preflight + run state for offer-hunter. Run after the Repo Sync section.
# Writes <git-dir>/offer-hunter/state.env; every later step sources that file.
# State lives in the git dir so concurrent runs in other clones never collide.
# Publish mode also cuts the hunt branch from origin/main.
set -u

fail() { echo "Error: $1" >&2; [ -n "${2:-}" ] && echo "Fix: $2" >&2; exit 1; }

mode="" max=10 since=30 categories="" tinyfish_mcp="no"
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) mode="${2:-}"; shift 2 ;;
    --max) max="${2:-}"; shift 2 ;;
    --since) since="${2:-}"; shift 2 ;;
    --categories) categories="${2:-}"; shift 2 ;;
    --tinyfish-mcp) tinyfish_mcp="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" "use --mode publish|report [--max N] [--since DAYS] [--categories a,b] [--tinyfish-mcp yes|no]" ;;
  esac
done
case "$mode" in publish|report) ;; *) fail "--mode must be publish or report, got '$mode'" "pass --mode report for report-only runs" ;; esac
[[ "$max" =~ ^[0-9]+$ ]] && [ "$max" -ge 1 ] || fail "--max must be a positive integer, got '$max'" "omit --max to use 10"
if [ "$max" -gt 10 ]; then echo "Note: --max $max is above the cap; using 10." >&2; max=10; fi
[[ "$since" =~ ^[0-9]+$ ]] && [ "$since" -ge 1 ] && [ "$since" -le 365 ] || fail "--since must be 1-365 days, got '$since'" "omit --since to use 30"
valid="api_provider coding image voice video startup_program student oss_program"
for c in ${categories//,/ }; do
  [[ " $valid " == *" $c "* ]] || fail "unknown category '$c'" "use a comma list of: ${valid// /, }"
done

REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "not inside a git repository" "cd into the freetokens repo first"
cd "$REPO" || exit 1
S=".agents/skills/offer-hunter"
for f in scripts/common.py scripts/catalog_snapshot.py scripts/shortlist.py scripts/write_offers.py \
         scripts/check_scope.py scripts/render_pr.py agents/scout.md agents/verifier.md \
         references/sources.md references/web-tools.md references/trust-and-value.md references/publish.md; do
  [ -f "$S/$f" ] || fail "missing bundled file $S/$f" "restore the offer-hunter skill directory from main"
done
[ -f scripts/offer_model.py ] || fail "missing scripts/offer_model.py" "run from the freetokens repo root"
command -v python3 >/dev/null || fail "python3 not found" "install Python 3"

today="$(date +%F)"
STATE_DIR="$(git rev-parse --absolute-git-dir)/offer-hunter"
W="$STATE_DIR/$today"
mkdir -p "$W" || fail "cannot create $W" "check /tmp permissions"
branch="$(git rev-parse --abbrev-ref HEAD)"
hunt_branch=""

if [ "$mode" = publish ]; then
  command -v gh >/dev/null || fail "GitHub CLI (gh) not found" "install gh, or rerun with report only"
  gh auth status >/dev/null 2>&1 || fail "gh is not authenticated" "run: gh auth login"
  command -v node >/dev/null || fail "node not found (needed to regenerate index.json and llms files)" "install Node, then cd app && npm ci"
  dirty="$(git status --porcelain --untracked-files=no)"
  [ -z "$dirty" ] || fail "tracked files have uncommitted changes:
$dirty" "commit or stash them, then rerun; the hunt branch must start clean"
  stray="$(git status --porcelain --untracked-files=all -- offers)"
  [ -z "$stray" ] || fail "untracked files under offers/:
$stray" "move or commit them first; they would mix into the hunt PR"
  git rev-parse --verify --quiet origin/main >/dev/null || fail "origin/main not found" "run git fetch origin"
  open="$(gh pr list --state open --limit 200 --json number,headRefName \
    --jq ".[] | select(.headRefName | startswith(\"feat/offer-hunt-$today\")) | \"#\(.number) \(.headRefName)\"")" \
    || fail "could not list open PRs with gh" "check that origin is a GitHub repo and gh can reach it"
  [ -z "$open" ] || fail "today's hunt PR is already open: $open" "review or close it before hunting again today"
  hunt_branch="feat/offer-hunt-$today"; n=2
  while git rev-parse --verify --quiet "refs/heads/$hunt_branch" >/dev/null \
     || git ls-remote --exit-code --heads origin "$hunt_branch" >/dev/null 2>&1; do
    hunt_branch="feat/offer-hunt-$today-$n"; n=$((n + 1))
  done
  git switch -c "$hunt_branch" origin/main >/dev/null 2>&1 || fail "could not create $hunt_branch from origin/main" "check git status and retry"
fi

search="host"
if [ "$tinyfish_mcp" = yes ] || command -v tinyfish >/dev/null; then search="tinyfish"; fi
LP="${LIGHTPANDA_BIN:-$(command -v lightpanda || true)}"
retry="none"; [ -n "$LP" ] && retry="lightpanda"
web_tools_note="search/fetch: $search; browser retry: $retry"

{
  printf 'REPO=%q\ntoday=%q\nW=%q\nmode=%q\nmax=%q\nsince=%q\ncategories=%q\n' \
    "$REPO" "$today" "$W" "$mode" "$max" "$since" "$categories"
  printf 'branch=%q\nhunt_branch=%q\nweb_route_search=%q\nweb_route_retry=%q\nweb_tools_note=%q\n' \
    "$branch" "$hunt_branch" "$search" "$retry" "$web_tools_note"
} > "$STATE_DIR/state.env"

echo "OK start mode=$mode max=$max since=$since categories=${categories:-all} branch=${hunt_branch:-$branch} web=[$web_tools_note] state=$STATE_DIR/state.env"
