#!/usr/bin/env python3
"""Audit top-level prerendered HTML for the SEO baseline.

The command intentionally audits only ``<dist>/*.html``. Offer detail pages
live below ``<dist>/offers/`` and are outside the baseline scope; later SEO
work can audit those pages separately.

Usage:
    python3 scripts/audit_seo.py app/dist
    python3 scripts/audit_seo.py --json app/dist
    python3 scripts/audit_seo.py --fail-on-critical app/dist

A readable audit with findings exits zero. Use ``--fail-on-critical`` when the
report is being used as a gate. An unreadable or invalid audit target exits 1.
"""

from __future__ import annotations

import argparse
import json
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


OG_PROPERTIES = (
    "og:title",
    "og:description",
    "og:url",
    "og:type",
    "og:image",
    "og:site_name",
)
TWITTER_PROPERTIES = (
    "twitter:card",
    "twitter:title",
    "twitter:description",
    "twitter:image",
)
HEAD_CONTENT_TAGS = frozenset(
    {"base", "link", "meta", "title", "noscript", "noframes", "style", "template", "script"}
)


class AuditError(Exception):
    """Raised when the requested audit directory cannot be inspected."""


class MetadataParser(HTMLParser):
    """Collect the HTML signals used by the audit without brittle regexes."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.canonical_hrefs: list[str] = []
        self.meta_names: set[str] = set()
        self.meta_properties: set[str] = set()
        self.json_ld_blocks = 0
        self.invalid_json_ld_blocks = 0
        self.h1_count = 0
        self.html_lang = ""
        self.in_head = False
        self._head_closed = False
        self._json_ld_buffer: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attributes = {name.lower(): (value or "").strip() for name, value in attrs}

        if tag == "html":
            self.html_lang = attributes.get("lang", "")
            return
        if tag == "head":
            if not self._head_closed:
                self.in_head = True
            return
        if tag == "body":
            self.in_head = False
            self._head_closed = True
            return
        if tag not in HEAD_CONTENT_TAGS:
            self.in_head = False
            self._head_closed = True
        if tag == "h1":
            self.h1_count += 1
            return
        if not self.in_head:
            return

        if tag == "link":
            relations = set(attributes.get("rel", "").lower().split())
            if "canonical" in relations:
                self.canonical_hrefs.append(attributes.get("href", ""))
        elif tag == "meta":
            content = attributes.get("content", "")
            name = attributes.get("name", "").lower()
            property_name = attributes.get("property", "").lower()
            if content:
                if name:
                    self.meta_names.add(name)
                if property_name:
                    self.meta_properties.add(property_name)
        elif tag == "script":
            script_type = attributes.get("type", "").lower().split(";", 1)[0].strip()
            if script_type == "application/ld+json":
                self._finish_json_ld()
                self._json_ld_buffer = []

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Handle self-closing tags, including an empty JSON-LD script."""
        self.handle_starttag(tag, attrs)
        if tag.lower() == "script":
            self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if self._json_ld_buffer is not None:
            self._json_ld_buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "script" and self._json_ld_buffer is not None:
            self._finish_json_ld()
        elif tag == "head":
            self.in_head = False
            self._head_closed = True

    def close(self) -> None:
        super().close()
        self._finish_json_ld()

    def _finish_json_ld(self) -> None:
        if self._json_ld_buffer is None:
            return
        payload = "".join(self._json_ld_buffer).strip()
        try:
            decoded = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            self.invalid_json_ld_blocks += 1
        else:
            is_json_ld_document = (
                isinstance(decoded, dict)
                and bool(decoded)
            ) or (
                isinstance(decoded, list)
                and bool(decoded)
                and all(isinstance(item, dict) and bool(item) for item in decoded)
            )
            if is_json_ld_document:
                self.json_ld_blocks += 1
            else:
                self.invalid_json_ld_blocks += 1
        self._json_ld_buffer = None


def parse_document(html: str) -> MetadataParser:
    """Parse one HTML document and return its collected metadata."""
    parser = MetadataParser()
    parser.feed(html)
    parser.close()
    return parser


def _is_absolute_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def audit_directory(dist_dir: Path) -> dict[str, object]:
    """Return severity buckets and file metadata for ``dist_dir/*.html``."""
    try:
        if not dist_dir.is_dir():
            raise AuditError(f"directory not found: {dist_dir}")
        html_files = sorted(dist_dir.glob("*.html"))
    except AuditError:
        raise
    except OSError as exc:
        raise AuditError(f"cannot inspect directory {dist_dir}: {exc}") from exc

    if not html_files:
        raise AuditError(f"no top-level HTML files found in: {dist_dir}")

    critical: list[str] = []
    warning: list[str] = []
    info: list[str] = []
    results: dict[str, object] = {
        "critical": critical,
        "warning": warning,
        "info": info,
        "files_checked": len(html_files),
        "html_files": [path.name for path in html_files],
    }

    for filepath in html_files:
        try:
            document = parse_document(filepath.read_text(encoding="utf-8"))
        except (OSError, UnicodeError) as exc:
            raise AuditError(f"cannot read {filepath}: {exc}") from exc

        filename = filepath.name
        canonical_hrefs = document.canonical_hrefs
        if not canonical_hrefs:
            critical.append(f"{filename}: Missing canonical tag")
        else:
            if len(canonical_hrefs) > 1:
                warning.append(f"{filename}: Multiple canonical tags ({len(canonical_hrefs)})")
            if any(not href for href in canonical_hrefs):
                critical.append(f"{filename}: Canonical tag has empty href")
            non_absolute = [href for href in canonical_hrefs if href and not _is_absolute_http_url(href)]
            if non_absolute:
                warning.append(
                    f"{filename}: Canonical href is not absolute: {', '.join(non_absolute)}"
                )

        missing_og = [name for name in OG_PROPERTIES if name not in document.meta_properties]
        if missing_og:
            critical.append(f"{filename}: Missing OG tags: {', '.join(missing_og)}")

        missing_twitter = [name for name in TWITTER_PROPERTIES if name not in document.meta_names]
        if missing_twitter:
            warning.append(f"{filename}: Missing Twitter tags: {', '.join(missing_twitter)}")

        if document.json_ld_blocks == 0:
            if document.invalid_json_ld_blocks:
                critical.append(f"{filename}: Invalid JSON-LD structured data")
            else:
                critical.append(f"{filename}: Missing JSON-LD structured data")
        else:
            if document.invalid_json_ld_blocks:
                warning.append(
                    f"{filename}: Invalid JSON-LD blocks ({document.invalid_json_ld_blocks})"
                )
            if document.json_ld_blocks > 1:
                warning.append(f"{filename}: Multiple JSON-LD blocks ({document.json_ld_blocks})")

        if document.h1_count == 0:
            critical.append(f"{filename}: Missing H1 heading")
        elif document.h1_count > 1:
            warning.append(f"{filename}: Multiple H1 headings ({document.h1_count})")

        if "viewport" not in document.meta_names:
            warning.append(f"{filename}: Missing viewport meta tag")
        if not document.html_lang:
            warning.append(f"{filename}: Missing lang attribute on html tag")

    for artifact in ("robots.txt", "sitemap.xml"):
        if not (dist_dir / artifact).is_file():
            critical.append(f"dist/: Missing {artifact}")

    return results


def format_report(results: dict[str, object]) -> str:
    """Render the human-readable audit report."""
    lines = [
        f"SEO Audit Summary (dist/{results['files_checked']} top-level HTML files)",
        f"  Critical: {len(results['critical'])}",
        f"  Warning:  {len(results['warning'])}",
        f"  Info:     {len(results['info'])}",
        "",
    ]
    for label, key in (("CRITICAL", "critical"), ("WARNING", "warning"), ("INFO", "info")):
        items = results[key]
        if not items:
            continue
        lines.append(f"{label} issues:")
        lines.extend(f"  - {item}" for item in items)
        lines.append("")
    return "\n".join(lines).rstrip()


def main(argv: list[str] | None = None) -> int:
    """Run the audit CLI and return a process exit code."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", dest="as_json", help="emit structured JSON")
    parser.add_argument(
        "--fail-on-critical",
        action="store_true",
        help="return 1 when the audit contains critical findings",
    )
    parser.add_argument("dist_dir", type=Path, help="built output directory to audit")
    args = parser.parse_args(argv)

    try:
        results = audit_directory(args.dist_dir)
    except AuditError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if args.as_json:
        print(json.dumps(results, indent=2, sort_keys=True))
    else:
        print(format_report(results))
    return 1 if args.fail_on_critical and results["critical"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
