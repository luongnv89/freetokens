# Publish: tracking issue, commit, PR

Read only in Step 8 of the Publish branch. Each shell call is a new shell:
start every block with the state line, which also binds the counts.

```bash
. "$(git rev-parse --absolute-git-dir)/offer-hunter/state.env" && cd "$REPO" || exit 1
counts() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$W/shortlist.json" "$1"; }
new_count="$(counts new_count)"; update_count="$(counts update_count)"
```

## 1. Tracking issue

Reuse an open issue from an earlier attempt today:

```bash
gh issue list --state open --search "Offer hunt $today in:title" --json number,title
```

Otherwise render the body to a file and create it. Never pass a body
inline, because the shell expands `$25` to `5`:

```bash
python3 .agents/skills/offer-hunter/scripts/render_pr.py \
  --shortlist "$W/shortlist.json" --mode issue > "$W/issue-body.md"
gh issue create --title "Offer hunt $today: $new_count new, $update_count updated offers" \
  --body-file "$W/issue-body.md"
```

Append `issue=<N>` to the state file. Done when
`gh issue view "$issue" --json state` reads `OPEN`.

## 2. Stage and scope

Stage only the applied paths plus the three artifacts. Never `git add .`
or `git add -A`:

```bash
python3 -c 'import json,sys; print("\0".join(json.load(open(sys.argv[1]))["applied"]), end="")' \
  "$W/applied.json" | xargs -0 git add --
git add -- index.json app/public/llms.txt app/public/llms-full.txt
python3 .agents/skills/offer-hunter/scripts/check_scope.py
```

`check_scope.py` must print `OK scope`. On exit 1, stop and report its
stderr. Leave the working tree as it is so the user can inspect it.

## 3. Commit and push

```bash
git commit -m "feat(offers): add $new_count and refresh $update_count hunted offers (#$issue)"
git push -u origin "$hunt_branch"
```

Never push `main`, never force-push, and never pass `--no-verify`. If a
pre-commit hook modifies files, re-run step 2's scope check, then amend
once. If a hook blocks the commit, stop the run and report the hook's
output.

## 4. Pull request

```bash
python3 .agents/skills/offer-hunter/scripts/render_pr.py \
  --shortlist "$W/shortlist.json" --mode pr --issue "$issue" \
  --checks "validate_offers.py exit 0; check_scope.py OK scope; index.json and llms files regenerated" \
  --web-tools "$web_tools_note" > "$W/pr-body.md"
gh pr create --base main --head "$hunt_branch" \
  --title "feat(offers): offer hunt $today ($new_count new, $update_count updated)" \
  --body-file "$W/pr-body.md"
```

If an open PR for `$hunt_branch` already exists, reuse it instead of
creating a second one. Done when `gh pr view "$hunt_branch" --json
url,number,state` shows `OPEN` with a URL.

**Never merge.** A human reviews and merges, and that merge publishes the
offers. If an auth, network, or hook failure occurs, stop, name the failed
command, and keep the local branch so the user can push it. Never claim a
PR exists when `gh pr view` cannot show it.
