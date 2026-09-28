# Review loop and merge contract

Read only in Step 7. Report-only runs and the empty-diff exception never reach
this file. `$pr`, `$issue`, and `$today` come from Step 6; run everything from
the repo root.

## Review rounds (Step 7)

A **round** is one `/issue-pr-review <pr> --auto --no-merge` run followed by
the round gate. `--auto` removes confirmations, never safeguards; `--no-merge`
keeps the merge in Step 8, behind the scope gate. Run at most **3 rounds**.

1. Invoke `/issue-pr-review <pr> --auto --no-merge`. It checks out the PR head,
   reviews, fixes, pushes, and waits for CI on its own.
2. Read its Step 7 summary. The round can be **clean** only when that summary
   is the *Clean PR* block: header `◆ PR Review: #<pr> (pass N — clean)` and
   `Result: PASS`. A remaining-issues summary, pending CI, a CI failure held
   non-blocking, a stagnation stop, or a cycle-cap stop is not clean; record
   its *Remaining* lines (`● [dimension] …`) as the round's finding set.
3. Round gate, every round, clean or not:

   ```bash
   git fetch origin \
     && git checkout "chore/daily-offer-check-$today" \
     && git pull --ff-only origin "chore/daily-offer-check-$today" || exit 1
   (cd app && node scripts/load-offers.mjs --index-json ../index.json) || exit 1
   (cd app && node scripts/generate-llms.mjs) || exit 1
   ```

   Any of these failing stops the run with the PR open: the gates below never
   run on a stale checkout or from `app/`.

   If regeneration changed anything, stage exactly `index.json`,
   `app/public/llms.txt`, and `app/public/llms-full.txt`, commit
   `chore(offers): regenerate artifacts (#<issue>)`, push the sweep branch,
   and count the round as not clean (the head moved). Then both must exit 0:

   ```bash
   python3 .agents/skills/daily-offer-check/scripts/check_scope.py --base origin/main --head HEAD
   python3 scripts/validate_offers.py
   ```

   Either failing stops the run: PR stays open, no merge; report the stderr
   lines (the offending paths) for manual triage. Never revert or rewrite a
   review fix by hand.
4. Clean summary and the round gate committed nothing → bind
   `head="$(gh pr view "$pr" --json headRefOid --jq .headRefOid)"`, require it
   to equal `git rev-parse HEAD`, and go to Step 8. Otherwise → next round.
5. **Stagnation:** the same finding set (identical *Remaining* lines, ignoring
   line numbers) in two consecutive rounds → stop. Three rounds without a
   clean one → stop. Either way the PR stays open, the run reports `PARTIAL`,
   and nothing merges.

## Merge gate (Step 8)

The No-merge branch skips this section and reports the clean PR URL. Otherwise
every check must hold against the `head` bound by the clean round:

```bash
git fetch origin
python3 .agents/skills/daily-offer-check/scripts/check_scope.py --base origin/main --head "$head"
gh pr view "$pr" --json state,isDraft,baseRefName,mergeable,headRefOid \
  --jq '[.state, .isDraft, .baseRefName, .mergeable, .headRefOid] | @tsv'
gh pr view "$pr" --json statusCheckRollup --jq '.statusCheckRollup as $c
  | ($c|length) > 0
  and all($c[]; ((.status // "COMPLETED") == "COMPLETED")
    and ((.conclusion // .state) as $s | $s == "SUCCESS" or $s == "NEUTRAL" or $s == "SKIPPED"))
  and any($c[]; ((.name // .context) == "validate") and ((.conclusion // .state) == "SUCCESS"))'
```

Pass = scope prints `OK scope`; the tsv line is `OPEN false main MERGEABLE
<head>` (tab-separated); the rollup prints `true`. `mergeable` reading
`UNKNOWN` → wait 10 s and re-read, at most 3 times. Any other outcome stops the
run: PR open, no merge, report the failed check.

Then merge — the repository is squash-only:

```bash
gh pr merge "$pr" --squash --delete-branch --match-head-commit "$head"
gh pr view "$pr" --json state,mergedAt --jq '[.state, .mergedAt] | @tsv'
gh issue view "$issue" --json state --jq .state
git checkout main && git pull --ff-only origin main
```

Done when the PR reads `MERGED`. The issue should read `CLOSED` through
`Closes #<issue>`; if it is still open, report it — do not close it by hand.
A refused merge (moved head, failed check) is reported, never retried with
weaker flags, and never finished by deleting the branch by hand.
