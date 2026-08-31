---
name: daily-offer-check
description: "Re-verify active offers vs source_url, apply live/expired updates, open one PR (skip PR if report-only). Use for the daily check, freshness sweep, or a stale-content issue. Don't use for adding offers, screenshot ingest, or CI workflow edits."
license: MIT
effort: high
compatibility: "Requires git, GitHub CLI (gh), and python3. Run gh auth status to verify."
metadata:
  version: 1.0.0
  author: Luong NGUYEN <luongnv89@gmail.com>
  epic: "#31"
---

# daily-offer-check

You are the orchestrator. Inventory active offers, fan out verifiers, merge
verdicts, apply **safe writes**, and open **one** pull request. You do not
fetch `source_url` yourself, and you do not open `agents/` or `references/`
files a phase's worker is supposed to receive as its Input.

This skill is **user-invoked**. The user asked for the sweep — proceed. Do not
wait for a second "yes" before opening the PR. Never push to `main`.

## Branch selector

Pick **one** branch. If several rows match, use this precedence (highest first):

1. add / publish a **new** offer, screenshot, pasted pitch → **Stop.** Point at `offer-updater`.
2. "report only", "dry run", "don't open a PR", "don't commit" → **Report-only** (wins over "also apply the YAML").
3. named slugs, `--offers-dir`, or a directory other than `<repo>/offers` → **filtered inventory**; if the directory is not `<repo>/offers`, force **Report-only** so fixtures cannot land in a catalog PR.
4. `/daily-offer-check`, "run the daily offer check", "freshness sweep", "re-verify the catalog", "stale-content issue" → **Apply+PR**

## Repo Sync Before Edits (mandatory)

A catalog PR must start from `origin/main` with a clean tree so feature WIP
cannot land in the sweep. All later commands run from the repo root:

```bash
cd "$(git rev-parse --show-toplevel)"
today="$(date +%F)"
# If the user named a YYYY-MM-DD, use that string instead of date +%F.
branch="$(git rev-parse --abbrev-ref HEAD)"
git fetch origin && git pull --rebase origin "$branch"
```

Use that same `$today` for the branch name, `--today` flags, issue title, and PR title.

- If `git status --porcelain` is non-empty: `git stash push -m "daily-offer-check pre-sync"`, sync, then `git stash pop`. If pop conflicts, stop and ask.
- If `origin` is missing or the rebase conflicts: stop, report the error verbatim, and ask. Never force-push.
- **Report-only:** stop after fetch/rebase on the current branch. Do **not** create or check out `chore/daily-offer-check-$today`.
- **Apply+PR:** if `chore/daily-offer-check-$today` already exists, check it out and continue (idempotent). Otherwise `git checkout -b "chore/daily-offer-check-$today" origin/main` (never `-B`). If the restored stash still dirties the tree, stop — do not mix WIP into the sweep branch. `gh auth status` must succeed before Step 4; if it fails, stop — do not apply writes you cannot ship.

## Leading words

- **active offer** — `expiry_date` is `null` or ≥ today (an offer expiring *today* stays active).
- **safe write** — bump `verified_date` on **live**, or set `expiry_date` + `verified_date` to today on **expired**. Never resolve a **conflict**.
- **empty-diff exception** — zero YAML writes ⇒ no PR. Report instead; optionally comment on an open issue whose title contains `stale content`.
- **fail-soft** — one dead URL or crashed worker does not abort the catalog. Mark that slug **unverifiable** and continue.

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

If `active_count` is 0: print the Step 1 report, skip to Step 7, no PR.

```
◆ Inventory (step 1 of 7)
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
provider, amount, expiry_date, source_url, verified_date.

Each worker's Output: a JSON array, one object per input slug — never a
silent drop. Shape is pinned in `agents/verifier.md`.

Workers **must not** write `offers/`, commit, or ask questions. On tool
failure they return `unverifiable` with the error in `reason`.

Missing slugs after the first wave: respawn **once** for those slugs only.
Still missing → synthesize `unverifiable` / `reason: worker dropped slug`.

```
◆ Verify (step 2 of 7)
··································································
  Workers spawned:        √ K in one turn (or sequential degrade)
  Every slug returned:    √ N/N
  ____________________________
  Result:                 PASS
```

## Step 3 — Coverage merge (you)

Concatenate worker arrays into `/tmp/daily-offer-check-$today-verdicts.json`.
If a worker wrapped JSON in markdown fences, strip the fences once so the
file is a JSON array — that is repair, not rewriting verdicts. Extra slugs
not in inventory may be dropped; never change a verdict for an inventory
slug. Then:

```bash
python3 .agents/skills/daily-offer-check/scripts/check_coverage.py \
  /tmp/daily-offer-check-$today-inventory.json \
  /tmp/daily-offer-check-$today-verdicts.json
```

Done when the script prints `OK N/N slugs covered`. On exit 1, fix as the
stderr says, then re-run once. Still failing → stop, paste stderr, no writes.

**Report-only branch stops here.** Print the table from Step 7 (no PR URL)
and halt.

## Step 4 — Apply safe writes (you)

```bash
python3 .agents/skills/daily-offer-check/scripts/apply_verdicts.py \
  --today "$today" \
  --inventory /tmp/daily-offer-check-$today-inventory.json \
  --verdicts /tmp/daily-offer-check-$today-verdicts.json
```

The script is the only writer. You do not hand-edit YAML. Done when exit 0
and `writes` equals the number of files whose `action` is `bumped` or
`expired` (not `unchanged`, not skipped).

## Step 5 — Validate (you)

```bash
python3 scripts/validate_offers.py
```

Exit 0 required. If it fails, undo only paths in `applied[]`
(`git checkout -- path …`) and stop — do not open a PR on an invalid catalog.

## Step 6 — Issue + PR (you)

Read `.agents/skills/daily-offer-check/references/apply-and-pr.md` now (not earlier). Empty-diff first: if
`writes == 0`, do not create an issue or a PR — follow the exception in that
file. Otherwise:

- tracking issue titled `Daily offer re-verify $today`, **or** `Closes #<N>`
  when the user named an existing stale-content issue
- one commit on `chore/daily-offer-check-$today`
- one PR against `main` whose body starts with `Closes #<issue>`
- `git add` only paths listed in `applied[]`, never `git add .`

Done when `gh pr view --json url` prints a URL, or the exception fired.

## Step 7 — Report (you)

Print this table (every inventory slug, one row), then the PR URL or the
empty-diff reason:

| slug | prior verified_date | verdict | write | evidence |
| --- | --- | --- | --- | --- |

`write` is `bumped` / `expired` / `none`. `evidence` is the quote (or
`reason` for unverifiable/conflict).

Then:

```
◆ Daily offer check (<today>)
··································································
  Inventory:              √ N active
  Coverage:               √ N/N
  Safe writes:            √ W files
  validate_offers.py:     √ / — skipped (report-only or empty)
  PR:                     √ <url> / — empty-diff / — report-only
  ____________________________
  Result:                 PASS | FAIL | PARTIAL
```

`PARTIAL` if any slug is `unverifiable` or `conflict` (the PR may still have
shipped). `FAIL` only when a gate stopped the run before a complete table.
