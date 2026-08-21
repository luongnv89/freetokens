# Branch Protection — `main`

`main` is protected so that malformed offer entries cannot reach the deployed
site: every change must arrive through a pull request whose offer validation
check is green. This makes invariant **F5** ("malformed entries are rejected")
enforceable by CI rather than by convention.

## Settings

Configured via `PUT /repos/luongnv89/freetokens/branches/main/protection`
(admin only):

| Setting | Value | Why |
|---------|-------|-----|
| Required pull request reviews | required (0 approvals minimum) | Direct pushes to `main` are rejected; all changes require a PR |
| Required status checks | `Validate offers / validate`, strict = false | PRs merge only when the offer-schema validation check passes on the head commit |
| Allow force pushes | false | History on `main` is immutable |
| Allow deletions | false | `main` cannot be deleted |
| Enforce for administrators | false | Kept minimal per issue #12 scope |

Everything else (restrictions, conversation resolution, lock branch) is left at
its default / unset.

## Why the validation check runs on every PR

`.github/workflows/validate.yml` originally filtered its `pull_request`
trigger with `paths: ["offers/**"]`. GitHub keeps a path-filtered workflow in
"Pending" and never reports its check on PRs that don't touch those paths, which
permanently blocks such PRs once the check is required (see GitHub's
[troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)).
The `paths:` filter was therefore removed from the `pull_request` trigger; the
`push` trigger keeps it. Validation takes seconds, so running it on every PR is
cheap insurance.

## Verify current settings

```bash
gh api repos/luongnv89/freetokens/branches/main/protection
```

To change these settings you need admin access to the repository.
