#!/usr/bin/env python3
"""Which deal-hunt window is open on a given day (#809).

Reads ``config/occasions.yaml`` and prints one JSON object:

    python3 scripts/deal_window.py --date 2026-11-27
    {"date": "2026-11-27", "occasion": "black_friday", "label": "...",
     "covers": ["black_friday", "cyber_monday"],
     "window_start": "2026-11-20", "window_end": "2026-12-03"}

Exit codes:

- 0: a window is open; ``occasion`` is its id and ``window_end`` its last day
  (the default deal ``expiry_date`` when an official page names none)
- 3: no window is open; prints ``{"date": ..., "occasion": "none",
  "window_end": null}`` so the daily pipeline can skip the deal-hunter
- 2: bad arguments or an invalid occasions file (message on stderr)

``--date`` defaults to today in UTC; tests always pass it. Stdlib only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import deal_model  # noqa: E402

_HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CONFIG = os.path.join(_HERE, os.pardir, "config", "occasions.yaml")
KEYS = ("id", "label", "start", "end", "covers")
MONTH_DAY_RE = re.compile(r"^(\d{2})-(\d{2})$")
EXIT_OPEN, EXIT_USAGE, EXIT_NONE = 0, 2, 3
# Occasions a window may name: every deal occasion except the catch-all.
WINDOW_OCCASIONS = tuple(o for o in deal_model.OCCASIONS if o != "other")


class OccasionError(ValueError):
    """config/occasions.yaml is malformed."""


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def parse_occasions_text(text: str, filename: str = "occasions.yaml") -> list:
    """Parse the restricted list-of-blocks shape documented in the file."""
    windows = []
    current = None
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if line.startswith("- "):
            current = {}
            windows.append(current)
            body = line[2:]
        elif line.startswith("  ") and not line.startswith("   ") and current is not None:
            body = line[2:]
        else:
            raise OccasionError(f"{filename}:{lineno}: expected '- key: value' or '  key: value'")
        key, sep, raw = body.partition(":")
        key = key.strip()
        if not sep or key not in KEYS:
            raise OccasionError(f"{filename}:{lineno}: unknown or malformed key {key!r}; expected one of {', '.join(KEYS)}")
        if key in current:
            raise OccasionError(f"{filename}:{lineno}: duplicate key {key!r}")
        current[key] = _unquote(raw)
    return [validate_window(w, filename) for w in _check_unique(windows, filename)]


def _check_unique(windows: list, filename: str) -> list:
    ids = [w.get("id") for w in windows]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise OccasionError(f"{filename}: duplicate window id(s): {', '.join(dupes)}")
    return windows


def _month_day(value: str, field: str, label: str) -> tuple:
    match = MONTH_DAY_RE.match(value or "")
    if not match:
        raise OccasionError(f"{label}: {field} must be \"MM-DD\", got {value!r}")
    month, day = int(match.group(1)), int(match.group(2))
    try:
        # 2023 is not a leap year: 02-29 would open a window only every 4 years.
        dt.date(2023, month, day)
    except ValueError:
        raise OccasionError(f"{label}: {field} {value!r} is not a calendar day in every year") from None
    return month, day


def validate_window(window: dict, filename: str) -> dict:
    label = f"{filename}: window {window.get('id')!r}"
    missing = [k for k in KEYS if not window.get(k)]
    if missing:
        raise OccasionError(f"{label}: missing {', '.join(missing)}")
    if window["id"] not in WINDOW_OCCASIONS:
        raise OccasionError(f"{label}: id must be one of {', '.join(WINDOW_OCCASIONS)}")
    covers = [c.strip() for c in window["covers"].split(",") if c.strip()]
    bad = [c for c in covers if c not in WINDOW_OCCASIONS]
    if bad or not covers:
        raise OccasionError(f"{label}: covers must list deal occasions from {', '.join(WINDOW_OCCASIONS)}")
    start = _month_day(window["start"], "start", label)
    end = _month_day(window["end"], "end", label)
    if start == end:
        raise OccasionError(f"{label}: start and end are the same day; use a range")
    return {"id": window["id"], "label": window["label"], "start": start, "end": end, "covers": covers}


def window_span(window: dict, day: dt.date):
    """(start, end) dates of the window occurrence containing *day*, or None."""
    (sm, sd), (em, ed) = window["start"], window["end"]
    md = (day.month, day.day)
    if (sm, sd) < (em, ed):
        if (sm, sd) <= md <= (em, ed):
            return dt.date(day.year, sm, sd), dt.date(day.year, em, ed)
        return None
    # Crosses the new year: e.g. 12-15 .. 01-02.
    if md >= (sm, sd):
        return dt.date(day.year, sm, sd), dt.date(day.year + 1, em, ed)
    if md <= (em, ed):
        return dt.date(day.year - 1, sm, sd), dt.date(day.year, em, ed)
    return None


def check_no_overlap(windows: list, filename: str = "occasions.yaml") -> None:
    """Walk one leap year (plus the turn of the year) so no day is in two windows."""
    day = dt.date(2023, 12, 1)
    while day <= dt.date(2025, 1, 31):
        open_ids = [w["id"] for w in windows if window_span(w, day)]
        if len(open_ids) > 1:
            raise OccasionError(f"{filename}: windows {', '.join(open_ids)} overlap on {day:%m-%d}")
        day += dt.timedelta(days=1)


def load_occasions(path: str = DEFAULT_CONFIG) -> list:
    with open(path, encoding="utf-8") as fh:
        windows = parse_occasions_text(fh.read(), path)
    check_no_overlap(windows, path)
    return windows


def open_window(windows: list, day: dt.date) -> dict | None:
    """The JSON payload for the window open on *day*, or None."""
    for window in windows:
        span = window_span(window, day)
        if span:
            return {
                "date": day.isoformat(),
                "occasion": window["id"],
                "label": window["label"],
                "covers": window["covers"],
                "window_start": span[0].isoformat(),
                "window_end": span[1].isoformat(),
            }
    return None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Print the deal-hunt window open on a date (#809).")
    parser.add_argument("--date", help="YYYY-MM-DD (default: today in UTC)")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="occasions file (default: config/occasions.yaml)")
    args = parser.parse_args(argv)
    try:
        day = deal_model._date(args.date, "--date", "deal_window") if args.date else deal_model.utc_today()
        windows = load_occasions(args.config)
    except (deal_model.DealError, OccasionError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return EXIT_USAGE
    payload = open_window(windows, day)
    if payload is None:
        print(json.dumps({"date": day.isoformat(), "occasion": "none", "window_end": None}))
        return EXIT_NONE
    print(json.dumps(payload))
    return EXIT_OPEN


if __name__ == "__main__":
    sys.exit(main())
