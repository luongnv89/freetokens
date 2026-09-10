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
malformed records, duplicate keys/slugs, missing/extra slugs, and invalid
verdict evidence. Success prints `OK N/N slugs covered`; errors go to stderr
with exit 1. Worker verdict schema lives in `agents/verifier.md`.

Apply accepts `--today`, `--inventory`, `--verdicts`, and optional trusted
`--offers-dir` (defaults to repository offers, never inferred from JSON).
Success JSON has `writes`, `applied`, and `results`. Results contain
`{slug, path, action}`; actions are bumped / expired / unchanged / skipped.
Applied contains only changed results. Paths remain relative to offers_dir:
for git, prefix each with `offers/`, pass as literal arguments after `--`,
and never evaluate strings as shell syntax. No other YAML field is changed.

Apply validates the entire batch and original hashes before writing. Stale
inventory fails: regenerate inventory and re-verify rather than overriding
hashes. A fresh same-day rerun yields zero writes. This is not a transaction:
an I/O failure or concurrent mutation can interrupt a write batch. Stop and
inspect the diff; never publish after such a failure. Run in a quiet worktree.

## Empty-diff exception

When writes is zero, create no issue, commit, push, or PR. Report unchanged /
conflict / unverifiable rows. Optionally comment on an already open issue
whose title contains `stale content`; never create an issue just for this.

## One catalog PR

1. Require successful content validation, clean pre-sweep baseline, expected
   `chore/daily-offer-check-<today>` branch, and only applied paths in the diff.
   Any unrelated change stops publication; never stage it.
2. Reuse the user's existing stale-content issue, or create one titled
   `Daily offer re-verify <today>` with the coverage and evidence table.
3. Stage only applied paths with `git add -- <literal paths>`. Inspect the
   staged diff: only verified_date and permitted expiry_date changes. Follow
   repository security/pre-commit gates; a block stops publication.
4. Commit `chore(offers): re-verify active offers <today>`. Push only the sweep
   branch, never main and never force. Reuse an existing PR for that branch;
   otherwise create one against main. Body starts `Closes #<issue>` and includes
   the evidence table, counts, partial results, and validator outcome.
5. Confirm `gh pr view --json url` returns its URL. On auth/network/hook failure,
   stop, report the exact failed gate, and retain local work for recovery. Do
   not claim a PR exists or create duplicates on retry.
