# Site health — stale content & deploy-failure alerting

Implements **Task 4.4** (PRD §7.4 alerts).

## Signals

| Signal | Threshold | Source |
|---|---|---|
| Fresh-offer ratio | `< 70%` of offers have `verified_date` within 14 days | `scripts/check_site_health.py` |
| Last-verified age | most-recent `verified_date` > 14 days old | same script |
| Deploy failure | 2 consecutive failures of `Deploy to GitHub Pages` on `main` | `workflow_run` in `.github/workflows/site-health.yml` |

Either stale signal makes the catalog **STALE**; both conditions are checked as
`ratio < --min-ratio (0.70) OR days_since_last > --max-age-days (14)`.

## Script

```bash
# Human report (lists offers oldest-first for re-verification)
python3 scripts/check_site_health.py

# JSON for workflow / programmatic use
python3 scripts/check_site_health.py --json

# CI gate — exit 2 when stale (no issue spam)
python3 scripts/check_site_health.py --fail-on-stale

# Dry-run proven on a stale fixture (acceptance criterion)
python3 scripts/check_site_health.py --today 2099-01-01 --fail-on-stale --dry-run
```

The script is stdlib-only (ADR-001), reuses `scripts/offer_model.py`'s frozen
validation, and never writes offers — it only reads `offers/*.yaml`.

## Workflow — `.github/workflows/site-health.yml`

Two jobs behind one workflow to keep permissions minimal:

* **`freshness`** — runs on `schedule` (daily 08:00 UTC) and `workflow_dispatch`.
  Runs the script, writes the human report to `$GITHUB_STEP_SUMMARY`, and — when
  stale — opens **one** deduplicated issue with label `site-health` that
  contains the remediation table (oldest `verified_date` first, top 20, each
  row linking to `offers/<slug>.yaml`). An existing open stale-content issue
  suppresses duplicates.

* **`deploy-failure`** — runs on `workflow_run` when `Deploy to GitHub Pages`
  completes with `failure`. It resolves the Deploy workflow id via
  `gh api repos/{owner}/{repo}/actions/workflows`, fetches the last two runs
  on `main`, and only opens an issue when **both** are `failure` (second
  consecutive failure). This matches the PRD 7.4 High-severity expectation and
  avoids flapping on a first retry that succeeds. A single open deploy-failure
  issue deduplicates further alerts until closed.

Both jobs degrade gracefully if the `site-health` label does not yet exist
(fallback to an unlabeled issue).

## Remediation

* Stale content: re-verify offers in the order listed (oldest `verified_date`
  first), bump `verified_date` to today, confirm `source_url` still live.
* Deploy failure (2×): fix within the same day; the site continues serving the
  last good build while the deploy is red.

## Labels

Create once if absent:

```bash
gh label create site-health --description "Automated site-health alert" --color "d73a4a" --force
```
