---
name: daily-offer-check
description: "Re-verify active offers vs official sources, fix drifted terms, refresh evidence, then issue, PR, review, merge unattended; report-only/no-merge modes. Use for daily checks or stale-content issues. Don't use for adding or editing one offer, or CI."
license: MIT
effort: high
compatibility: "Requires git, GitHub CLI (gh), python3, node, read-only web tools, and the issue-creator and issue-pr-review skills. Run gh auth status to verify. Optional: TinyFish (MCP server or tinyfish CLI) for page reads and the lightpanda CLI for a browser retry; each falls back when missing."
metadata:
  version: 2.2.0
  author: "Luong NGUYEN <luongnv89@gmail.com>"
  epic: "#31"
---

# daily-offer-check

You are the orchestrator. Inventory active offers, fan out verifiers, merge
verdicts, apply **safe writes**, then carry one catalog PR from issue to merge.
You do not fetch `source_url` yourself, and you do not open `agents/` or
`references/` files a phase's worker is supposed to receive as its Input.

This skill is **user-invoked** and runs **unattended**: the user asked for the
whole pipeline (sweep, issue, PR, review, merge), so do not stop for
confirmations. Unattended removes confirmations, never safeguards: every gate
below still stops the run. Never push to `main`; the only way in is the Step 8
merge.

## Branch selector

Pick **one** branch. If several rows match, use this precedence (highest first):

1. add / publish a **new** offer, change **one** offer from user-supplied details, screenshot, pasted pitch → **Stop.** Point at `offer-updater`.
2. "report only", "dry run", "don't open a PR", "don't commit" → **Report-only** (wins over any apply, PR, or merge phrasing in the same request).
3. `--offers-dir` naming a directory other than `<repo>/offers` → **Report-only**, so fixtures cannot land in a catalog PR.
4. "don't merge", "leave the PR open", `--no-merge` → **No-merge**: run through a clean review, then stop with the PR open.
5. `/daily-offer-check`, "run the daily offer check", "freshness sweep", "re-verify the catalog", "stale-content issue" → **Unattended**: issue → PR → review → merge.

Named slugs filter the inventory (`--slugs a,b`) on whichever branch wins.
**Publishing branches** = No-merge and Unattended.

## Dependency Preflight (mandatory)

Publishing branches invoke `issue-creator` (Step 6) and `issue-pr-review`
(Step 7) and need an authenticated `gh`. Verify all three **before** Repo
Sync, so a run that cannot publish never starts the sweep; Report-only never
publishes and skips this check.

```bash
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated; run: gh auth login" >&2; exit 1; }
for skill in issue-creator issue-pr-review; do
  asm list -p agents --json 2>/dev/null | grep -q "\"$skill\"" \
    || test -f "$HOME/.agents/skills/$skill/SKILL.md" \
    || test -f "$HOME/.claude/skills/$skill/SKILL.md" || {
    echo "Missing required skill: $skill" >&2
    echo "Install it:      asm install https://github.com/luongnv89/idd --skill $skill -p agents -s global -y" >&2
    echo "No asm yet:      npm install -g agent-skill-manager" >&2
    echo "Verify:          asm list -p agents --json | grep '\"$skill\"'" >&2
    exit 1
  }
done
```

On a miss, stop and print the fix commands; do not start a sweep you cannot
publish.

## Repo Sync Before Edits (mandatory)

A catalog PR must start from `origin/main` with a clean tree so feature WIP
cannot land in the sweep. All later commands run from the repo root:

```bash
cd "$(git rev-parse --show-toplevel)"
today="$(date +%F)"
# If the user named a YYYY-MM-DD, use that string instead of date +%F.
branch="$(git rev-parse --abbrev-ref HEAD)"
stashed=0
if [ -n "$(git status --porcelain)" ]; then
  git stash push -u -m "daily-offer-check pre-sync" || exit 1
  stashed=1
fi
git fetch origin && git pull --rebase origin "$branch" || exit 1
if [ "$stashed" = 1 ]; then
  git stash pop || exit 1
fi
```

Use that same `$today` for the branch name, `--today` flags, issue input, and PR title.

- Stash tracked and untracked work **before** sync as above. On sync failure retain the stash; on pop conflicts stop and ask. Never drop a stash to get a clean tree.
- If `origin` is missing or the rebase conflicts: stop, report the error verbatim, and ask. Never force-push.
- **Report-only:** stop after fetch/rebase on the current branch. Do **not** create or check out `chore/daily-offer-check-$today`.
- **Publishing branches:** require `git status --porcelain` empty **before** any checkout; restored WIP stops the run. Run the **bundled-files check**, then switch branches only with `python3 .agents/skills/daily-offer-check/scripts/prepare_branch.py --today "$today"`, which must print `OK branch`. It creates `chore/daily-offer-check-$today` from `origin/main`, or resumes an earlier attempt today by fast-forward only (to the pushed branch, else `origin/main`); it refuses, without switching branches, a branch that has diverged or lacks `origin/main` (a leftover cut from an older `main` lacks this skill's current scripts). On refusal, stop and report its stderr; never rebuild the branch by hand (`checkout -B`, `reset`, `branch -D`). Then run the bundled-files check again and require `python3 .agents/skills/daily-offer-check/scripts/check_scope.py --base origin/main --head HEAD` to print `OK scope`, proving a resumed branch holds only sweep changes.

## Leading words

- **active offer** — `expiry_date` is `null` or ≥ today (an offer expiring *today* stays active).
- **official source** — the offer's `source_url` and the provider's own pages (`references/trust-policy.md`). It wins every disagreement; corroboration never overrides it.
- **safe write** — the only writes: bump `verified_date` on **live**; set `title` / `amount` / `expiry_date` / `signup` to the official values in a live verdict's `updates`; set `expiry_date` + `verified_date` to today on **expired**; merge the verdict's references into the **reference trace**. Never resolve a **conflict**.
- **reference trace** — `offers/details/<slug>.json` → `social_proof` `link` entries. Evidence URLs are appended (deduped by URL, cap 10), curated entries are never removed, and an excerpt is refreshed only when the offer's terms changed.
- **scope gate** — `scripts/check_scope.py` exits 0: the diff touches only existing offer YAMLs (safe-write fields), reference traces (append or refresh), and the three generated artifacts.
- **clean** — an `/issue-pr-review` round whose summary is its *Clean PR* block (`◆ PR Review: #<pr> (pass N — clean)`, `Result: PASS`) and whose round gate committed nothing; `head` is then the PR's `headRefOid`.
- **empty-diff exception** — zero writes ⇒ no issue, no PR. Report instead; optionally comment on an open issue whose title contains `stale content`.
- **fail-soft** — one dead URL or crashed worker does not abort the catalog. Mark that slug **unverifiable** and continue.

## Step Completion Reports

After each major step, print `◆ <name> (step N of 9)`, its gate checks with
`√` / `×`, and `Result: PASS | FAIL | PARTIAL`. Steps 3–8 respectively check
coverage N/N, writes against applied length, validator exit 0, issue + PR
URLs (or the empty-diff exception), a clean round, and `MERGED`. On failure
print stderr and stop; do not report success for skipped gates. The final
report includes all skipped steps.

The **bundled-files check** requires the six scripts (`list_active.py`,
`check_coverage.py`, `apply_verdicts.py`, `check_scope.py`,
`prepare_branch.py`, `render_report.py`), `agents/verifier.md`,
`references/trust-policy.md`, `references/apply-and-pr.md`,
`references/review-and-merge.md`, and root `scripts/offer_model.py` to exist.
Run it before the first bundled script (in Repo Sync on publishing branches,
before Step 1 on Report-only) and again after `prepare_branch.py`. Missing
file: stop and name it. These are bundled files; skill dependencies are gated
in *Dependency Preflight*.

## Step 1 — Inventory (you)

From repo root:

```bash
python3 .agents/skills/daily-offer-check/scripts/list_active.py --today "$today"
# add --offers-dir <dir> and/or --slugs a,b when the branch selector says so
```

Save stdout to `/tmp/daily-offer-check-$today-inventory.json` (outside the repo). Done when:

- exit 0
- `active_count` equals `len(offers)`
- `offers` is oldest-`verified_date` first

If the user named slugs that `skipped_expired` absorbed, say so in the report (named-but-expired is not a successful empty sweep).

If `active_count` is 0: print the Step 1 report, skip to Step 9, no PR.

```
◆ Inventory (step 1 of 9)
··································································
  Script exit 0:          √
  Active listed:          √ N (skipped_expired=M)
  Oldest-first:           √
  ____________________________
  Result:                 PASS
```

## Step 2 — Fan out verifiers (workers, parallel)

Spawn workers **in the same turn**. One rule: `workers = min(8, active_count)`.
Split the oldest-first list into that many contiguous slices, as evenly as
possible. Sequential degrade (no Agent tool): the same slices, one after
another — say so in the Step 2 report.

Put these paths in each worker prompt as files to Read (you do not Read them):

- `.agents/skills/daily-offer-check/agents/verifier.md`
- `.agents/skills/daily-offer-check/references/trust-policy.md`

Plus the batch objects with every inventory field: slug, path, title,
provider, amount, expiry_date, source_url, verified_date, sha256; also pass today.

Each worker's Output: a JSON array, one object per input slug — never a
silent drop. Shape is pinned in `agents/verifier.md`.

Workers read pages with TinyFish and retry with the Lightpanda browser when
those tools are available, and otherwise with the host's built-in read-only
web tools, per `agents/verifier.md` → *Web tools*. A missing tool is never a
reason to stop the sweep. They **must not** write `offers/`,
commit, or ask questions. On tool failure they return `unverifiable` with
the error in `reason`.

Missing slugs after the first wave: respawn **once** for those slugs only.
Still missing → synthesize `unverifiable` / `reason: worker dropped slug` /
`updates: {}` / `references: []`.

```
◆ Verify (step 2 of 9)
··································································
  Workers spawned:        √ K in one turn (or sequential degrade)
  Every slug returned:    √ N/N
  ____________________________
  Result:                 PASS
```

## Step 3 — Coverage merge (you)

Concatenate worker arrays into `/tmp/daily-offer-check-$today-verdicts.json`.
If a worker wrapped JSON in markdown fences, strip the fences once so the
file is a JSON array — that is repair, not rewriting verdicts. Extra slugs, duplicates, and malformed records must fail coverage; request
corrected worker output rather than silently dropping or rewriting verdicts. Then:

```bash
python3 .agents/skills/daily-offer-check/scripts/check_coverage.py \
  /tmp/daily-offer-check-$today-inventory.json \
  /tmp/daily-offer-check-$today-verdicts.json
```

Done when the script prints `OK N/N slugs covered`. On exit 1, fix as the
stderr says, then re-run once. Still failing → stop, paste stderr, no writes.

**Report-only branch stops here.** Print the table from Step 9 (no PR URL)
and halt.

## Step 4 — Apply safe writes (you)

```bash
python3 .agents/skills/daily-offer-check/scripts/apply_verdicts.py \
  --today "$today" \
  --inventory /tmp/daily-offer-check-$today-inventory.json \
  --verdicts /tmp/daily-offer-check-$today-verdicts.json \
  > /tmp/daily-offer-check-$today-applied.json
```

The script is the sweep's only writer (Step 7's `/issue-pr-review` fixes are
the one other, bounded by the scope gate): you never hand-edit YAML or detail
JSON. Its default trusted write root is repository `offers/`; inventory cannot
redirect it. Fixture orchestration never reaches this step. Only offline
helper tests explicitly pass a temporary `--offers-dir`. Stale inventory
fails: regenerate and re-verify. Fresh same-day reruns are idempotent; old
snapshots are not reusable. Done when exit 0 and `writes` equals
`len(applied)`: offer YAMLs (`bumped` / `updated` / `expired`) plus reference
traces (`references`).
Steps 5, 6, and 9 read `results`, `references`, and `applied` from that file.

## Step 4b — Regenerate committed artifacts (you)

Skip when `writes == 0` (empty-diff — no artifact changed).

YAML writes drift the committed generated artifacts — repo-root `index.json`
(the `load-offers` vitest contract deep-equals it against `offers/`) and
`app/public/llms.txt` / `llms-full.txt`. Regenerate them so the sweep's PR
does not ship a stale catalog:

```bash
(cd app && node scripts/load-offers.mjs --index-json ../index.json) || exit 1
(cd app && node scripts/generate-llms.mjs) || exit 1
```

Done when `git status --porcelain` shows at most `offers/` writes (offer
YAMLs and `offers/details/` JSON) plus `index.json`, `app/public/llms.txt`,
`app/public/llms-full.txt` — anything else is out of scope for the sweep commit.

## Step 5 — Validate (you)

```bash
python3 scripts/validate_offers.py
```

Exit 0 required. If it fails, undo only the files in `applied[]` (prefix each
path with `offers/`; `git checkout -- <literal paths>` for tracked files,
`rm -- <literal paths>` for detail files this run created per
`references[].created`) and stop — never open a PR on an invalid catalog.

## Step 6 — Issue + PR (you, via /issue-creator)

Read `.agents/skills/daily-offer-check/references/apply-and-pr.md` now (not
earlier). Empty-diff first: if `writes == 0`, create no issue and no PR —
follow the exception in that file. Otherwise, in this order:

- tracking issue: the user's named stale-content issue, an open issue from an
  earlier attempt today, or `/issue-creator "<input>" --auto`
- stage only `applied[]` paths plus `index.json`, `app/public/llms.txt`,
  `app/public/llms-full.txt` — never `git add .` — and `check_scope.py
  --staged` prints `OK scope`
- one commit on `chore/daily-offer-check-$today`, pushed
- one PR against `main`: body rendered by `render_report.py --pr-issue` into
  a file and passed with `--body-file` (first line `Closes #<issue>`)
- older open sweep PRs closed as superseded

Done when `gh pr view --json url,number` returns both, or the exception
fired. Bind `issue` and `pr`.

## Step 7 — Review loop (you, via /issue-pr-review)

Read `.agents/skills/daily-offer-check/references/review-and-merge.md` now.
Run up to **3 rounds** of `/issue-pr-review <pr> --auto --no-merge`, each
followed by that file's round gate (artifact regeneration, scope gate,
validator). Done when a round is **clean**; bind `head`. A failed gate
(report the offending paths for manual triage), stagnation (the same findings
twice in a row), or 3 rounds without a clean one → stop with the PR open; the
run is `PARTIAL`.

## Step 8 — Merge (you)

**No-merge:** skip and report the clean PR URL. **Unattended:** run the merge
gate in `references/review-and-merge.md` against `head` (scope gate; PR open,
mergeable, on `main`, at `head`; every check green including `validate`), then
`gh pr merge "$pr" --squash --delete-branch --match-head-commit "$head"`.
Done when the PR reads `MERGED`. Any failed check → no merge, PR open,
`PARTIAL`.

## Step 9 — Report (you)

Render the per-slug table with the script, never by hand (quotes are
untrusted page text). Drop `--applied` on Report-only:

```bash
python3 .agents/skills/daily-offer-check/scripts/render_report.py \
  --inventory /tmp/daily-offer-check-$today-inventory.json \
  --verdicts /tmp/daily-offer-check-$today-verdicts.json \
  --applied /tmp/daily-offer-check-$today-applied.json
```

It prints the summary, the official-source updates (proposed ones on
Report-only), and one row per inventory slug: `slug | prior verified_date |
verdict | write | updates | refs | evidence`, where `refs` shows the reference
trace change (`new`, `+added`, `~refreshed`, `-dropped`). Print it, then:

```
◆ Daily offer check (<today>)
··································································
  Inventory:              √ N active
  Coverage:               √ N/N
  Safe writes:            √ W files (B bumped, U updated, E expired, R traces)
  validate_offers.py:     √ / — skipped (report-only or empty)
  Issue:                  √ #<n> / — skipped
  PR:                     √ <url> / — empty-diff / — report-only
  Superseded:             #<old PRs> / — none
  Review:                 √ clean in round K / × <why not> / — skipped
  Merge:                  √ merged / — no-merge / × <failed check> / — skipped
  ____________________________
  Result:                 PASS | FAIL | PARTIAL
```

`PARTIAL` if any slug is `unverifiable` or `conflict`, or an Unattended run
ended without a merge (review not clean, a gate refused). `FAIL` only when a
gate stopped the run before a complete table.
