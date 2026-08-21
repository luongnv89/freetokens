#!/usr/bin/env python3
"""Static build for freetokens: validate offers, emit index.json and HTML.

Stdlib-only by design (ADR 001). Usage:

    python3 scripts/build.py [--offers-dir offers] [--out .]
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import html
import json
import os
import sys

CATEGORIES = ("api_provider", "coding", "image", "voice", "video")
REQUIRED_FIELDS = (
    "title",
    "provider",
    "category",
    "amount",
    "expiry_date",
    "source_url",
    "verified_date",
)
NULL_TOKENS = {"null", "~", ""}


class OfferError(ValueError):
    """A offer file is malformed or fails schema validation."""


def _parse_scalar(raw: str):
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    if value.lower() in NULL_TOKENS:
        return None
    return value


def parse_offer_text(text: str, filename: str) -> dict:
    """Parse the constrained flat-YAML subset used by offers/*.yaml."""
    data = {}
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if line[:1] in (" ", "\t"):
            raise OfferError(
                f"{filename}:{lineno}: nested/indented lines are not allowed "
                "(offer files are flat key/value documents)"
            )
        key, sep, raw = line.partition(":")
        if not sep:
            raise OfferError(f"{filename}:{lineno}: expected 'key: value'")
        key = key.strip()
        if not key or " " in key:
            raise OfferError(f"{filename}:{lineno}: invalid field name {key!r}")
        if key in data:
            raise OfferError(f"{filename}:{lineno}: duplicate field {key!r}")
        data[key] = _parse_scalar(raw)
    return data


def _validate_date(value, field: str, filename: str):
    if not isinstance(value, str):
        raise OfferError(
            f"{filename}: {field} must be a YYYY-MM-DD date, got {value!r} "
            "(this field is not nullable)"
        )
    try:
        return dt.datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise OfferError(
            f"{filename}: {field} must be a YYYY-MM-DD date, got {value!r}"
        ) from None


def validate_offer(data: dict, filename: str) -> dict:
    missing = [f for f in REQUIRED_FIELDS if f not in data]
    if missing:
        raise OfferError(f"{filename}: missing required fields: {', '.join(missing)}")
    unknown = [k for k in data if k not in REQUIRED_FIELDS]
    if unknown:
        raise OfferError(f"{filename}: unknown fields: {', '.join(sorted(unknown))}")

    for field in ("title", "provider", "amount"):
        if not isinstance(data[field], str) or not data[field].strip():
            raise OfferError(f"{filename}: {field} must be a non-empty string")

    if data["category"] not in CATEGORIES:
        raise OfferError(
            f"{filename}: category must be one of {'|'.join(CATEGORIES)}, "
            f"got {data['category']!r}"
        )

    if data["expiry_date"] is not None:
        data["expiry_date"] = _validate_date(
            data["expiry_date"], "expiry_date", filename
        )
    data["verified_date"] = _validate_date(
        data["verified_date"], "verified_date", filename
    )
    if data["verified_date"] > dt.date.today():
        raise OfferError(
            f"{filename}: verified_date is in the future ({data['verified_date']})"
        )

    url = data["source_url"]
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        raise OfferError(f"{filename}: source_url must be an http(s) URL, got {url!r}")
    return data


def load_offers(offers_dir: str) -> list:
    paths = sorted(glob.glob(os.path.join(offers_dir, "*.yaml")))
    paths += sorted(glob.glob(os.path.join(offers_dir, "*.yml")))
    offers = []
    for path in paths:
        slug = os.path.splitext(os.path.basename(path))[0]
        with open(path, encoding="utf-8") as fh:
            data = parse_offer_text(fh.read(), path)
        offer = validate_offer(data, path)
        offer["slug"] = slug
        clash = next((o for o in offers if o["slug"] == slug), None)
        if clash is not None:
            raise OfferError(
                f"duplicate slug {slug!r}: {clash.get('_path', '?')} and "
                f"{path} produce the same slug; rename one file"
            )
        offer["_path"] = path
        offers.append(offer)
    for offer in offers:
        del offer["_path"]
    return offers


def filter_expired(offers: list, today: dt.date | None = None) -> list:
    """Drop offers whose expiry_date is in the past; None means ongoing."""
    if today is None:
        today = dt.date.today()
    return [o for o in offers if o["expiry_date"] is None or o["expiry_date"] >= today]


def build_index(offers: list) -> dict:
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "count": len(offers),
        "offers": [
            {
                "slug": o["slug"],
                "title": o["title"],
                "provider": o["provider"],
                "category": o["category"],
                "amount": o["amount"],
                "expiry_date": o["expiry_date"].isoformat()
                if o["expiry_date"]
                else None,
                "source_url": o["source_url"],
                "verified_date": o["verified_date"].isoformat(),
            }
            for o in sorted(offers, key=lambda o: o["slug"])
        ],
    }


_PAGE_TMPL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Free AI Credits</title>
<style>
* {{ box-sizing: border-box; }}
body {{ font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 48rem; padding: 0 1rem; overflow-wrap: break-word; }}
.offer {{ border: 1px solid #ccc; border-radius: 8px; margin: 1rem 0; padding: 1rem; }}
.meta {{ color: #666; font-size: 0.9rem; }}
.badge {{ display: inline-block; background: #eef; color: #336; border-radius: 999px; padding: 0.1rem 0.6rem; font-size: 0.8rem; }}
h2 a {{ overflow-wrap: anywhere; }}
</style>
</head>
<body>
<h1>Free AI Credits</h1>
<p>Verified, currently-claimable free AI credit offers.</p>
{cards}
</body>
</html>
"""

_CARD_TMPL = """<article class="offer" data-category="{category}">
<h2><a href="{source_url}" rel="noopener" aria-label="{title} from {provider}">{title}</a></h2>
<p>{amount}</p>
<p class="meta">{provider} &middot; <span class="badge">{category}</span> &middot; {expiry_display}</p>
</article>"""


def render_html(index: dict) -> str:
    cards = []
    for o in index["offers"]:
        cards.append(
            _CARD_TMPL.format(
                category=html.escape(o["category"]),
                source_url=html.escape(o["source_url"], quote=True),
                title=html.escape(o["title"], quote=True),
                amount=html.escape(o["amount"]),
                provider=html.escape(o["provider"], quote=True),
                expiry_display=f"expires: {o['expiry_date']}"
                if o["expiry_date"]
                else "ongoing",
            )
        )
    return _PAGE_TMPL.format(cards="\n".join(cards))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offers-dir", default="offers")
    parser.add_argument("--out", default=".")
    args = parser.parse_args(argv)

    try:
        offers = load_offers(args.offers_dir)
    except OfferError as exc:
        print(f"build failed: {exc}", file=sys.stderr)
        return 1
    if not offers:
        print(
            f"build failed: no offer files found in {args.offers_dir}", file=sys.stderr
        )
        return 1

    index = build_index(filter_expired(offers))

    out_dir = os.path.join(args.out, "site")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(render_html(index))

    print(f"built {index['count']} offers -> index.json, site/index.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
