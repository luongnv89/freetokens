# Verdict rules — conflicts and the skip-verification override

Read from SKILL.md Step 2. Both sections decide field values without asking
the curator.

## Conflicts — official wins

Settle every disagreement yourself; never ask the curator to pick a winner:

- **Input vs official** (amount, expiry, eligibility, title): use the
  official value — but only when the official page describes the same
  program (same name or landing page, or an explicit rename). A different
  program is not a correction of the input; the input's offer is
  unverifiable.
- **Input claim, official silence** (e.g. the input states an end date no
  official page mentions): the official state wins — `expiry_date: null`
  when no official end date exists — and the claim is still listed in the
  Step 5 table with "not stated" as the official side.
- **Official vs official** on the same term: a clearly newer dated
  statement wins; failing that, the higher page in the official order wins
  (the offer's own page, then docs/pricing/terms, then blog/changelog, then
  social posts); if neither settles it, the offer is unverifiable.
- Record every settled conflict for the Step 5 side-by-side table. When an
  official page lost a tie-break, also add a
  `# Known conflict: <url> says "<quote>"` line to the comment header.

## Skip-verification override

Applies only when the curator explicitly says "skip verification":

- `verified_date` keeps today's date ONLY if the input itself is first-hand
  evidence (a fresh screenshot).
- The input's values are used as-is with `verification: unverified`.
- Every field the page would have confirmed is reported as unverified in
  Step 6.
- The verdict, early-lane, and drop rules in Step 2 do not apply, except that
  an offer missing a required field is still dropped.
