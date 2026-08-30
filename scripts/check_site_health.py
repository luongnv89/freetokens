#!/usr/bin/env python3
"""Site-health check for stale content (Task 4.4 / PRD 7.4).

Evaluates two staleness signals over offers/*.yaml:

* **fresh-offer ratio** — fraction of offers whose ``verified_date`` is within
  ``--max-age-days`` (default 14). Threshold ``--min-ratio`` (default 0.70)
  comes from PRD 7.1 and the issue acceptance criteria.
* **last verified age** — days since the most-recent ``verified_date``.
  The catalog is stale when this exceeds ``--max-age-days``.

When either signal is breached the script prints a remediation report
listing offers oldest-first and — with ``--fail-on-stale`` — exits 2 so a
CI step can surface the failure. ``--json`` emits a machine-readable
summary for workflow consumption. ``--dry-run`` is an alias for a
non-failing run that still prints the report.

The parallel ``deploy-failure`` signal (PRD 7.4 High) is handled by the
workflow layer via ``workflow_run`` and the GitHub API — see
``.github/workflows/site-health.yml`` — because a second consecutive
failure requires cross-run state that a single script invocation cannot
provide without persistence.

Usage::

    python3 scripts/check_site_health.py
    python3 scripts/check_site_health.py --max-age-days 14 --min-ratio 0.7 --fail-on-stale
    python3 scripts/check_site_health.py --json
    python3 scripts/check_site_health.py --offers-dir offers --today 2026-08-30

Stdlib-only (ADR-001).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import offer_model as build  # noqa: E402


def _parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--offers-dir", default="offers", help="Directory containing offers/*.yaml")
    p.add_argument("--max-age-days", type=int, default=14, help="Freshness window in days (default: 14)")
    p.add_argument("--min-ratio", type=float, default=0.70, help="Minimum fresh-offer ratio (default: 0.70)")
    p.add_argument("--today", default=None, help="Override today as YYYY-MM-DD (for testing)")
    p.add_argument("--json", action="store_true", dest="json_out", help="Emit JSON summary to stdout")
    p.add_argument("--fail-on-stale", action="store_true", help="Exit 2 when stale (for CI)")
    p.add_argument("--dry-run", action="store_true", help="Alias: always exit 0 even when stale (still prints report)")
    return p.parse_args(argv)


def _today(arg: str | None) -> dt.date:
    if arg is None:
        return dt.date.today()
    try:
        return dt.datetime.strptime(arg, "%Y-%m-%d").date()
    except ValueError:
        print(f"Invalid --today {arg!r}: expected YYYY-MM-DD", file=sys.stderr)
        sys.exit(2)


def check_freshness(offers_dir: str, today: dt.date, max_age_days: int, min_ratio: float) -> dict:
    offers = build.load_offers(offers_dir)
    total = len(offers)
    if total == 0:
        return {
            "total": 0,
            "fresh": 0,
            "ratio": 0.0,
            "last_verified": None,
            "days_since_last": None,
            "stale": True,
            "stale_reason": "no offers found",
            "oldest": [],
            "offers": [],
        }

    def _age(o):
        return (today - o["verified_date"]).days

    fresh = sum(1 for o in offers if _age(o) <= max_age_days)
    ratio = fresh / total if total else 0.0
    last_verified = max(o["verified_date"] for o in offers)
    days_since_last = (today - last_verified).days

    # Sorted oldest-first for remediation links.
    oldest = sorted(offers, key=lambda o: o["verified_date"])
    # Enrich with computed age for report convenience.
    for o in oldest:
        o["_age_days"] = _age(o)
        o["_stale"] = _age(o) > max_age_days

    stale_reasons = []
    if ratio < min_ratio:
        stale_reasons.append(f"fresh-offer ratio {ratio:.0%} < {min_ratio:.0%} ({fresh}/{total} fresh)")
    if days_since_last > max_age_days:
        stale_reasons.append(f"last verified_date {last_verified.isoformat()} is {days_since_last} days ago (> {max_age_days} days)")
    stale = bool(stale_reasons)

    return {
        "total": total,
        "fresh": fresh,
        "ratio": ratio,
        "last_verified": last_verified.isoformat(),
        "days_since_last": days_since_last,
        "stale": stale,
        "stale_reason": "; ".join(stale_reasons) if stale_reasons else "",
        "oldest": [
            {
                "slug": o["slug"],
                "provider": o["provider"],
                "title": o["title"],
                "verified_date": o["verified_date"].isoformat(),
                "age_days": o["_age_days"],
                "stale": o["_stale"],
                "path": f"offers/{o['slug']}.yaml",
            }
            for o in oldest
        ],
        "offers": oldest,
    }


def _human_report(result: dict, today: dt.date, max_age_days: int, min_ratio: float) -> str:
    lines = []
    lines.append(f"Site health — {today.isoformat()} (window: {max_age_days}d, min ratio: {min_ratio:.0%})")
    lines.append(f"Total offers: {result['total']}; fresh (≤{max_age_days}d): {result['fresh']} ({result['ratio']:.0%})")
    if result["total"] == 0:
        lines.append("STALE: no offers found — catalog is empty")
    elif result["stale"]:
        lines.append(f"STALE: {result['stale_reason']}")
    else:
        lines.append(f"OK: fresh-offer ratio {result['ratio']:.0%} and last verified {result['last_verified']} ({result['days_since_last']}d ago)")

    if result["oldest"]:
        lines.append("")
        lines.append("Offers by oldest verified_date (re-verify from top):")
        for entry in result["oldest"]:
            flag = " STALE" if entry["stale"] else ""
            lines.append(
                f"  - {entry['verified_date']} ({entry['age_days']}d ago){flag} — {entry['slug']} ({entry['provider']}) — {entry['path']}"
            )
    return "\n".join(lines)


def main(argv=None) -> int:
    args = _parse_args(argv)
    today = _today(args.today)

    try:
        result = check_freshness(args.offers_dir, today, args.max_age_days, args.min_ratio)
    except build.OfferError as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 1
    except FileNotFoundError as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 1

    if args.json_out:
        # Emit only serializable subset; offers already shaped.
        out = {k: v for k, v in result.items() if k != "offers"}
        # Also include compact oldest for JSON consumers.
        json.dump(out, sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        print(_human_report(result, today, args.max_age_days, args.min_ratio))

    if args.dry_run:
        return 0
    if args.fail_on_stale and result["stale"]:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
