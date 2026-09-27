# Apply and publish contract

Read only in Step 6. Report-only runs never reach this step. Non-catalog
fixture orchestration is always report-only, even when the user says apply.
Offline helper tests may explicitly pass `--offers-dir <temporary-fixture>` to
the writer; this is not permission to publish fixture data.

## CLI records

Inventory is an object with exactly `today` (YYYY-MM-DD), `offers_dir`
(canonical absolute root), `active_count` (integer), `skipped_expired` (slug
array), and `offers` (array). Each offer has exactly slug, path (relative to
that root), title, provider, amount, expiry_date (date or null), source_url,
verified_date, sha256 (hash of original bytes). Sort is verified_date then slug.
Unknown requested slugs fail; named expired slugs appear in skipped_expired.

Coverage accepts inventory and verdict filenames positionally. It rejects
malformed records, duplicate keys/slugs, missing/extra slugs, invalid
evidence, `updates` that are off-site or not on a live verdict, and references
that break the trace rules. Success prints `OK N/N slugs covered`; errors go
to stderr with exit 1. The verdict schema lives in `agents/verifier.md`.

Apply accepts `--today`, `--inventory`, `--verdicts`, and optional trusted
`--offers-dir` (defaults to repository offers, never inferred from JSON).
Success JSON:

- `results`: one `{slug, path, action, changes}` per inventory row; action is
  bumped / updated / expired / unchanged / skipped, and `changes` lists each
  official-source rewrite as `{field, from, to}`.
- `references`: `{slug, path, created, added, refreshed, dropped}` for each
  reference trace touched under `details/`.
- `applied`: every file written (detail files carry action `references`);
  `writes` equals its length.

Paths are relative to offers_dir: for git, prefix each with `offers/`, pass as
literal arguments after `--`, and never evaluate strings as shell syntax. No
YAML field outside verified_date, expiry_date, and the verdict's `updates`
changes; detail files only gain entries, or refresh an excerpt when the
offer's terms changed.

Apply validates the entire batch and original hashes before writing. Stale
inventory fails: regenerate inventory and re-verify rather than overriding
hashes. A fresh same-day rerun yields zero writes. This is not a transaction:
an I/O failure or concurrent mutation can interrupt a write batch. Stop and
inspect the diff; never publish after such a failure. Run in a quiet worktree.

## Empty-diff exception

When writes is zero, create no issue, commit, push, or PR. Report unchanged /
conflict / unverifiable rows. Optionally comment on an already open issue
whose title contains `stale content`; never create an issue just for this.

## Issue, commit, PR

1. Require successful content validation, a clean pre-sweep baseline, and the
   expected `chore/daily-offer-check-<today>` branch.
2. **Issue.** Reuse the stale-content issue the user named, or an open issue
   from an earlier attempt today (`gh issue list --state open --search
   "<today> in:title" --json number,title`, title about offers). Otherwise
   invoke `/issue-creator "<input>" --auto`. The input's first line is
   `Re-verify active offers <today>`; then the counts (active, bumped,
   updated, expired, reference traces, conflict, unverifiable); the slugs with
   official-source updates, conflict, or unverifiable verdicts; and this
   done-when list with the run date substituted for every `<today>`, so the
   generated acceptance criteria are checkable from the PR:
   - every active offer is accounted for in the PR evidence table;
   - every live or expired offer's verified_date equals <today>, and every
     expired offer's expiry_date equals <today>;
   - every official-source update quotes the official page and changes only
     title, amount, expiry_date, or signup;
   - every live or expired offer's reference trace lists its evidence URL;
   - validate_offers.py passes and index.json and the llms files are
     regenerated.

   Keep dollar signs, backticks, and quotes out of the input; amounts and
   quotes belong in the PR body. Done when issue-creator printed `◆ Issue
   Created` and `gh issue view <N> --json state` reads `OPEN`; bind `issue`.
3. **Stage.** `git add -- <offers/-prefixed applied paths>` plus `index.json`,
   `app/public/llms.txt`, and `app/public/llms-full.txt`; never `git add .`.
   Then `python3 .agents/skills/daily-offer-check/scripts/check_scope.py
   --staged` must print `OK scope`, and repository security/pre-commit gates
   must pass. Either blocking stops publication; never stage around it.
4. **Commit and push.** Message `chore(offers): re-verify active offers
   <today> (#<issue>)`. Push only the sweep branch, never main, never force.
5. **PR.** Reuse an open PR for the branch. Otherwise render the body to a
   file and create the PR from it. Never pass the body inline (the shell
   expands `$10` to `0`) and never assemble it by hand (quotes are untrusted
   page text; the script escapes them):

   ```bash
   python3 .agents/skills/daily-offer-check/scripts/render_report.py \
     --inventory /tmp/daily-offer-check-$today-inventory.json \
     --verdicts /tmp/daily-offer-check-$today-verdicts.json \
     --applied /tmp/daily-offer-check-$today-applied.json \
     --pr-issue "$issue" --checks "validate_offers.py exit 0; check_scope.py OK" \
     > /tmp/daily-offer-check-$today-pr-body.md
   gh pr create --base main --head "chore/daily-offer-check-$today" \
     --title "chore(offers): re-verify active offers $today" \
     --body-file /tmp/daily-offer-check-$today-pr-body.md
   ```

   The body opens with `Closes #<issue>`, then the summary, the
   official-source updates, the evidence table, and a *Decision Record*.
6. Done when `gh pr view "chore/daily-offer-check-$today" --json url,number`
   returns both; bind `pr`. On auth/network/hook failure, stop, report the
   exact failed gate, and retain local work for recovery. Do not claim a PR
   exists or create duplicates on retry.
7. **Supersede.** Only one sweep PR stays open. List the other open ones —
   head branch `chore/daily-offer-check-<date>` with an earlier date:

   ```bash
   gh pr list --state open --json number,headRefName --jq '.[]
     | select(.headRefName | test("^chore/daily-offer-check-[0-9]{4}-[0-9]{2}-[0-9]{2}$"))
     | select(.headRefName < "chore/daily-offer-check-'"$today"'") | .number'
   ```

   For each: `gh pr close <n> --comment "Superseded by #<pr>."`; when that
   PR's body starts with `Closes #<m>`, also `gh issue close <m> --comment
   "Superseded by #<issue>."`. Never delete their branches. List them on the
   report's `Superseded` line.
