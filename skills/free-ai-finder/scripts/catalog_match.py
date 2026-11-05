#!/usr/bin/env python3
"""Rank freetokens catalog offers for one need and print JSON on stdout.

Used by the free-ai-finder skill (Step 2). Standard library only.

Sources, chosen in this order:
  --index-file PATH   a saved copy of https://freetokens.custats.info/index.md
                      (tests and offline runs; details come from --details-dir)
  --source live       the live catalog at https://freetokens.custats.info/
  --source local      index.json + offers/details/ in a freetokens checkout
  --source auto       live, then local when the live fetch fails (default)

Exit 0: JSON printed (matches may be empty). Exit 1: input or source error,
explained on stderr with a fix. Network reads are pinned to the catalog host.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HOST = "freetokens.custats.info"
BASE = "https://" + HOST
INDEX_URL = BASE + "/index.md"
USER_AGENT = "free-ai-finder/1.0 (catalog reader)"
TIMEOUT = 20
MAX_INDEX_BYTES = 3_000_000
MAX_DETAIL_BYTES = 300_000
MAX_SUMMARY = 500

NEED_CATEGORIES = ("api_provider", "coding", "image", "voice", "video")
GATES = {"startup_program": "startup", "student": "student", "oss_program": "oss"}
ALL_CATEGORIES = NEED_CATEGORIES + tuple(GATES)
# Words that match almost every offer and so carry no signal.
STOPWORDS = {
    "a", "ai", "an", "and", "api", "apis", "credit", "credits", "free",
    "llm", "model", "models", "offer", "offers", "plan", "the", "tier",
    "token", "tokens", "trial",
}

LINE_RE = re.compile(
    r"^- \[(?P<title>(?:\\.|[^\]\\])+)\]"
    r"\((?P<url>https://freetokens\.custats\.info/offers/"
    r"(?P<slug>[a-z0-9][a-z0-9-]*)\.md)\): (?P<rest>.+)$"
)
REST_RE = re.compile(
    r"^(?P<provider>.+?) — (?P<amount>.+) "
    r"\((?P<category>" + "|".join(ALL_CATEGORIES) + r")\) · "
    r"review_status=(?P<review_status>[a-z-]+) · "
    r"verification=(?P<verification>[a-z_]+) · "
    r"signup=(?P<signup>[a-z]+) · "
    r"last_checked=(?P<last_checked>\d{4}-\d{2}-\d{2})$"
)
BUILT_RE = re.compile(r"rebuilt (\d{4}-\d{2}-\d{2}T[0-9:]+Z?)")
DEADLINE_RE = re.compile(
    r"^- Status: (?P<status>[a-z]+) — enrollment deadline: "
    r"(?P<deadline>\d{4}-\d{2}-\d{2}|none \(ongoing\))\s*$",
    re.M,
)
SOURCE_RE = re.compile(r"^- Source: (?P<url>https?://\S+)\s*$", re.M)
STEP_RE = re.compile(r"^\d+\.\s+(?P<step>.+)$")

_CARD = r"(?:credit |debit )?card"
NO_CARD_RE = re.compile(
    r"no " + _CARD + r"|no credit[- ]card"
    r"|without (?:a |any )?" + _CARD
    + r"|(?:does not|doesn't|do not|don't|never) (?:need|require|ask for) (?:a |any )?" + _CARD
    + r"|no payment (?:method|details|information|info)"
    + r"|card[- ]free",
    re.I,
)
# Only explicit requirement wording counts; "some models require a card" does not.
CARD_RE = re.compile(
    r"(?:credit |debit )card (?:is |are )?(?:required|needed|necessary)"
    r"|(?:a |your )card (?:is |are )required"
    r"|requires? (?:a |an )?(?:valid )?(?:credit|debit) card"
    r"|(?:valid )?payment method (?:is )?required"
    r"|requires? (?:a |an )?(?:valid )?payment method",
    re.I,
)


class SourceError(Exception):
    """A catalog source could not be read or parsed."""


class _PinnedRedirect(urllib.request.HTTPRedirectHandler):
    """Follow redirects only while they stay on https://HOST."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = urllib.parse.urlsplit(newurl)
        if parts.scheme != "https" or parts.hostname != HOST:
            raise urllib.error.URLError(
                f"refused redirect off {HOST}: {newurl}"
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_PinnedRedirect)


def fetch(url: str, limit: int) -> str:
    """Read one catalog URL. Only https://HOST/ URLs are allowed."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname != HOST:
        raise SourceError(
            f"refusing to fetch {url}: only https://{HOST}/ URLs are allowed"
        )
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/markdown, text/plain"},
    )
    try:
        with _OPENER.open(req, timeout=TIMEOUT) as resp:
            data = resp.read(limit + 1)
    except urllib.error.HTTPError as exc:
        raise SourceError(f"{url} returned HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        hint = ""
        if "CERTIFICATE_VERIFY_FAILED" in str(reason):
            hint = (" (Python cannot verify TLS certificates: on macOS run"
                    " 'Install Certificates.command' for your Python)")
        raise SourceError(f"could not read {url}: {reason}{hint}") from exc
    if len(data) > limit:
        raise SourceError(f"{url} is larger than {limit} bytes; refusing to parse it")
    return data.decode("utf-8", "replace")


# ---------------------------------------------------------------- parsing


def parse_index(text: str) -> tuple[list[dict], int, str | None]:
    """Parse the home-page markdown twin. Returns (offers, unparsed, built)."""
    offers, unparsed, in_offers = [], 0, False
    built = BUILT_RE.search(text)
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("## "):
            in_offers = line.strip() == "## Offers"
            continue
        if not in_offers or not line.startswith("- ["):
            continue
        m = LINE_RE.match(line)
        rest = REST_RE.match(m.group("rest")) if m else None
        if not rest:
            unparsed += 1
            continue
        slug = m.group("slug")
        offers.append({
            "slug": slug,
            "title": re.sub(r"\\(.)", r"\1", m.group("title")),
            "provider": rest.group("provider").strip(),
            "category": rest.group("category"),
            "amount": rest.group("amount").strip(),
            "review_status": rest.group("review_status"),
            "verification": rest.group("verification"),
            "signup": rest.group("signup"),
            "last_checked": rest.group("last_checked"),
            "detail_url": m.group("url"),
        })
    return offers, unparsed, built.group(1) if built else None


def parse_detail(text: str) -> dict:
    """Parse an offer's markdown twin: deadline, source, summary, claim steps."""
    out: dict = {"status": None, "deadline": None, "source_url": None,
                 "summary": "", "claim_steps": []}
    m = DEADLINE_RE.search(text)
    if m:
        out["status"] = m.group("status")
        deadline = m.group("deadline")
        out["deadline"] = None if deadline.startswith("none") else deadline
    src = SOURCE_RE.search(text)
    if src:
        out["source_url"] = src.group("url")
    section = None
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("## "):
            section = line[3:].strip()
            continue
        if not line:
            continue
        if section == "The offer" and not out["summary"]:
            out["summary"] = line[:MAX_SUMMARY]
        elif section == "How to claim":
            step = STEP_RE.match(line)
            if step:
                out["claim_steps"].append(step.group("step"))
    return out


# A card sentence about uncertainty or about paying after the free part ends
# says nothing about what claiming needs.
CARD_SKIP_RE = re.compile(
    r"whether|unconfirmed|not tested|continu|to keep using|after (?:the )?"
    r"(?:free|credits?|depletion|trial)|run out|runs out|used up",
    re.I,
)


def _sentence(blob: str, start: int, end: int) -> str:
    left = max(blob.rfind(". ", 0, start), blob.rfind("; ", 0, start))
    right_candidates = [i for i in (blob.find(". ", end), blob.find("; ", end)) if i != -1]
    right = min(right_candidates) if right_candidates else len(blob)
    return blob[left + 1:right]


def card_state(*texts: str) -> tuple[str, str | None]:
    """Return ('no-card' | 'card' | 'unknown', matched snippet or None)."""
    blob = " ".join(" ".join(t.split()) for t in texts if t)
    for state, pattern in (("no-card", NO_CARD_RE), ("card", CARD_RE)):
        for m in pattern.finditer(blob):
            if state == "card" and CARD_SKIP_RE.search(_sentence(blob, m.start(), m.end())):
                continue
            start, end = max(0, m.start() - 40), min(len(blob), m.end() + 40)
            return state, blob[start:end].strip()
    return "unknown", None


# ---------------------------------------------------------------- sources


def find_checkout() -> Path | None:
    """A freetokens checkout above the cwd or above this script, if any."""
    for start in (Path.cwd(), Path(__file__).resolve().parent):
        for d in (start, *start.parents):
            if (d / "index.json").is_file() and (d / "offers" / "details").is_dir():
                return d
    return None


def load_local(today: str) -> tuple[list[dict], str, str | None, dict]:
    root = find_checkout()
    if root is None:
        raise SourceError(
            "no freetokens checkout found (needs index.json and offers/details/ "
            "in the current directory or a parent)"
        )
    try:
        data = json.loads((root / "index.json").read_text(encoding="utf-8"))
        raw_offers = data["offers"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise SourceError(f"cannot read {root / 'index.json'}: {exc}") from exc
    offers, details = [], {}
    for o in raw_offers:
        expiry = o.get("expiry_date")
        status = o.get("status") or ("expired" if expiry and expiry < today else "active")
        if status != "active":
            continue
        slug = o["slug"]
        offers.append({
            "slug": slug, "title": o["title"], "provider": o["provider"],
            "category": o["category"], "amount": " ".join(str(o["amount"]).split()),
            "review_status": o.get("review_status", "unverified"),
            "verification": o.get("verification", "unverified"),
            "signup": o.get("signup", "required"),
            "last_checked": o.get("verified_date", ""),
            "detail_url": f"{BASE}/offers/{slug}.md",
        })
        detail = {"status": status, "deadline": expiry,
                  "source_url": o.get("source_url"), "summary": "", "claim_steps": []}
        path = root / "offers" / "details" / f"{slug}.json"
        if path.is_file():
            try:
                extra = json.loads(path.read_text(encoding="utf-8"))
                detail["summary"] = " ".join(str(extra.get("summary", "")).split())[:MAX_SUMMARY]
                detail["claim_steps"] = list(extra.get("claim_steps") or [])
            except (OSError, ValueError) as exc:
                detail["error"] = f"cannot read {path}: {exc}"
        details[slug] = detail
    return offers, str(root / "index.json"), data.get("generated_at"), details


# ---------------------------------------------------------------- ranking


def keyword_pattern(keyword: str) -> re.Pattern:
    # Leading boundary only, so "image" also matches "images".
    return re.compile(r"(?<![a-z0-9])" + re.escape(keyword))


def score_offer(offer: dict, categories: set, patterns: list) -> tuple[int, list]:
    head = f"{offer['title']} {offer['provider']}".lower()
    body = offer["amount"].lower()
    score, hits = 0, []
    if offer["category"] in categories:
        score += 3
    for kw, pat in patterns:
        if pat.search(head):
            score += 2
            hits.append(kw)
        elif pat.search(body):
            score += 1
            hits.append(kw)
    return score, hits


def rank(offers: list, categories: set, keywords: list, eligible: set):
    patterns = [(kw, keyword_pattern(kw)) for kw in keywords]
    ranked, gated = [], []
    for offer in offers:
        score, hits = score_offer(offer, categories, patterns)
        gate = GATES.get(offer["category"])
        if gate and not hits:
            continue  # a gated program must match the need itself
        if score <= 0:
            continue
        item = dict(offer, score=score, matched=hits)
        if gate:
            item["gate"] = gate
            if gate not in eligible:
                gated.append(item)
                continue
        ranked.append(item)
    def order(o):
        checked = int(o["last_checked"].replace("-", "") or 0)
        return (-o["score"], -checked, o["slug"])

    return sorted(ranked, key=order), sorted(gated, key=order)


# ---------------------------------------------------------------- details


def load_details(items, source, details_dir, local_details, workers=6):
    """Attach detail fields to each item in place."""

    def one(item):
        slug = item["slug"]
        try:
            if source == "local":
                return slug, dict(local_details.get(slug) or {"error": "no local detail"})
            if details_dir is not None:
                path = Path(details_dir) / f"{slug}.md"
                if not path.is_file():
                    return slug, {"error": f"{path} not found"}
                return slug, parse_detail(path.read_text(encoding="utf-8"))
            return slug, parse_detail(fetch(item["detail_url"], MAX_DETAIL_BYTES))
        except (SourceError, OSError) as exc:
            return slug, {"error": str(exc)}

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        results = dict(pool.map(one, items))
    for item in items:
        detail = results[item["slug"]]
        item["detail_error"] = detail.get("error")
        item["deadline"] = detail.get("deadline", "unknown") if not detail.get("error") else "unknown"
        item["source_url"] = detail.get("source_url")
        item["summary"] = detail.get("summary", "")
        item["claim_steps"] = detail.get("claim_steps", [])
        item["card"], item["card_basis"] = card_state(
            item["amount"], item["summary"], " ".join(item["claim_steps"])
        )
        item["page_url"] = f"{BASE}/offers/{item['slug']}.html"


def select(ranked, args, source, local_details, today, warnings):
    """Take up to --max ranked items whose claim deadline has not passed."""
    chosen, excluded, pos = [], [], 0
    rounds = 0
    while len(chosen) < args.max and pos < len(ranked) and rounds < 3:
        batch = ranked[pos:pos + (args.max - len(chosen))]
        pos += len(batch)
        rounds += 1
        if args.no_details:
            for item in batch:
                item.update(deadline="unknown", detail_error="details skipped",
                            source_url=None, summary="", claim_steps=[],
                            page_url=f"{BASE}/offers/{item['slug']}.html")
                item["card"], item["card_basis"] = card_state(item["amount"])
        else:
            load_details(batch, source, args.details_dir, local_details)
        for item in batch:
            deadline = item.get("deadline")
            if deadline and deadline != "unknown" and deadline < today:
                excluded.append({"slug": item["slug"], "reason": f"claim deadline {deadline} has passed"})
            else:
                chosen.append(item)
    failed = sum(1 for item in chosen if item.get("detail_error") and not args.no_details)
    if chosen and failed * 2 > len(chosen):
        warnings.append(f"{failed} of {len(chosen)} offer pages could not be read; claim steps are missing for them")
    return chosen, excluded


# ---------------------------------------------------------------- main


def split_list(value: str) -> list[str]:
    return [v.strip().lower() for v in (value or "").split(",") if v.strip()]


def fail(message: str, fix: str) -> int:
    print(f"Error: {message}", file=sys.stderr)
    print(f"Fix: {fix}", file=sys.stderr)
    return 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--categories", default="",
                        help="comma list from: " + ", ".join(NEED_CATEGORIES))
    parser.add_argument("--keywords", default="", help="comma list of need words")
    parser.add_argument("--eligible", default="", help="comma list from: student, startup, oss")
    parser.add_argument("--max", type=int, default=10, help="matches to return, 1-20")
    parser.add_argument("--source", choices=("auto", "live", "local"), default="auto")
    parser.add_argument("--index-file", help="read the index markdown from this file")
    parser.add_argument("--details-dir", help="read <slug>.md detail pages from this folder")
    parser.add_argument("--no-details", action="store_true", help="skip offer pages")
    parser.add_argument("--today", default=dt.date.today().isoformat(), help="YYYY-MM-DD")
    args = parser.parse_args(argv)

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.today):
        return fail(f"--today '{args.today}' is not YYYY-MM-DD", "pass a date like 2026-11-05")
    if not 1 <= args.max <= 20:
        return fail(f"--max {args.max} is out of range", "use a number from 1 to 20")
    categories = split_list(args.categories)
    bad = [c for c in categories if c not in NEED_CATEGORIES]
    if bad:
        return fail(
            f"unknown category {', '.join(repr(c) for c in bad)} in --categories",
            "use one or more of " + ", ".join(NEED_CATEGORIES)
            + "; student, startup and open-source programs go in --eligible",
        )
    eligible = split_list(args.eligible)
    bad = [e for e in eligible if e not in GATES.values()]
    if bad:
        return fail(f"unknown value {', '.join(repr(e) for e in bad)} in --eligible",
                    "use one or more of student, startup, oss, or leave it empty")
    raw_keywords = split_list(args.keywords)
    keywords = [k for k in dict.fromkeys(raw_keywords) if k not in STOPWORDS]
    warnings = []
    ignored = [k for k in raw_keywords if k in STOPWORDS]
    if ignored:
        warnings.append("ignored generic keywords: " + ", ".join(sorted(set(ignored))))
    if not categories and not keywords:
        return fail("nothing to match: no --categories and no specific --keywords",
                    "pass --categories (e.g. voice) and/or --keywords such as tts,text-to-speech")

    local_details: dict = {}
    built = None
    try:
        if args.index_file:
            path = Path(args.index_file)
            if not path.is_file():
                return fail(f"--index-file {path} does not exist",
                            "pass a saved copy of https://freetokens.custats.info/index.md")
            offers, unparsed, built = parse_index(path.read_text(encoding="utf-8"))
            source, origin = "file", str(path)
        elif args.source in ("auto", "live"):
            try:
                offers, unparsed, built = parse_index(fetch(INDEX_URL, MAX_INDEX_BYTES))
                source, origin = "live", INDEX_URL
                if not offers:
                    raise SourceError(f"parsed 0 offers from {INDEX_URL}")
            except SourceError as exc:
                if args.source == "live":
                    raise
                try:
                    offers, origin, built, local_details = load_local(args.today)
                except SourceError as local_exc:
                    raise SourceError(f"live catalog failed ({exc}); local fallback "
                                      f"failed ({local_exc})") from local_exc
                warnings.append(f"live catalog failed ({exc}); used the local checkout")
                source, unparsed = "local", 0
        else:
            offers, origin, built, local_details = load_local(args.today)
            source, unparsed = "local", 0
    except SourceError as exc:
        return fail(str(exc),
                    "check the network and retry; inside a freetokens checkout use "
                    "--source local; offline use --index-file with a saved index.md")

    if not offers:
        return fail(f"parsed 0 offers from {origin}; the catalog format may have changed",
                    "retry with --source local inside a freetokens checkout, or update "
                    "LINE_RE/REST_RE in scripts/catalog_match.py to the new line format")
    if unparsed:
        warnings.append(f"{unparsed} catalog lines did not parse and were skipped")

    ranked, gated = rank(offers, set(categories), keywords, set(eligible))
    matches, excluded = select(ranked, args, source, local_details, args.today, warnings)
    gated = gated[:5]
    if gated and not args.no_details:
        load_details(gated, source, args.details_dir, local_details)
    for item in matches + gated:
        item.pop("detail_url", None)
        item.setdefault("page_url", f"{BASE}/offers/{item['slug']}.html")
    result = {
        "source": source,
        "origin": origin,
        "catalog_built": built,
        "catalog_active": len(offers),
        "today": args.today,
        "profile": {"categories": categories, "keywords": keywords, "eligible": eligible},
        "considered": len(ranked),
        "matches": matches,
        "gated": gated,
        "excluded": excluded,
        "warnings": warnings,
    }
    json.dump(result, sys.stdout, indent=1, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
