#!/usr/bin/env python3
"""Validate candidate offer YAML files against CI's exact schema rules.

Deterministic helper behind the offer-updater agent skill (issue #20). It
reuses scripts/build.py's parser/validator — the same code path CI runs — so
a draft that passes here cannot fail the build on schema grounds.

Usage:

    python3 .claude/skills/offer-updater/validate_offer.py <draft.yaml> [...]

Exit codes:
    0  every named file is valid (one "OK <path> (<slug>)" line per file)
    1  at least one file failed validation (file + field named on stderr)
    2  usage error (no arguments, missing/unreadable file, wrong extension)
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
VALID_EXTENSIONS = (".yaml", ".yml")


def _repo_root(start: Path) -> Path:
    """Walk up from *start* until scripts/build.py is found."""
    for candidate in (start, *start.parents):
        if (candidate / "scripts" / "build.py").is_file():
            return candidate
    raise SystemExit(
        "validate_offer.py: could not locate scripts/build.py above "
        f"{start}; run this helper from inside the freetokens repository"
    )


def _load_build_module():
    root = _repo_root(Path(__file__).resolve().parent)
    scripts_dir = str(root / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    import build

    return build


def validate_file(path: str, build) -> str:
    """Return the slug for a valid offer file; raise build.OfferError otherwise."""
    file_path = Path(path)
    slug = file_path.stem
    if not SLUG_RE.match(slug):
        raise build.OfferError(
            f"{path}: slug {slug!r} violates naming convention "
            "(lowercase ASCII words separated by hyphens, no leading/"
            "trailing hyphen)"
        )
    text = file_path.read_text(encoding="utf-8")
    data = build.parse_offer_text(text, path)
    build.validate_offer(data, path)
    return slug


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2

    try:
        build = _load_build_module()
    except SystemExit as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 2

    failures = 0
    seen_slugs: dict[str, str] = {}
    for raw_path in argv:
        path = Path(raw_path)
        # Invocation problems are usage errors, not schema failures.
        if not path.is_file():
            print(f"validation failed: {path}: no such file", file=sys.stderr)
            return 2
        if path.suffix.lower() not in VALID_EXTENSIONS:
            print(
                f"validation failed: {path}: offer files must end in "
                f"{' or '.join(VALID_EXTENSIONS)}",
                file=sys.stderr,
            )
            return 2
        try:
            slug = validate_file(str(path), build)
        except build.OfferError as exc:
            print(f"validation failed: {exc}", file=sys.stderr)
            failures += 1
            continue
        except (OSError, UnicodeDecodeError) as exc:
            print(f"validation failed: {path}: {exc}", file=sys.stderr)
            failures += 1
            continue
        clash = seen_slugs.get(slug)
        if clash is not None:
            print(
                f"validation failed: duplicate slug {slug!r}: {clash} and "
                f"{path} produce the same slug; rename one file",
                file=sys.stderr,
            )
            failures += 1
            continue
        seen_slugs[slug] = str(path)
        print(f"OK {path} ({slug})")

    if failures:
        print(
            f"{failures} file(s) failed validation; nothing here may be "
            "committed to offers/",
            file=sys.stderr,
        )
        return 1
    print(f"{len(argv)} file(s) valid against the frozen offer schema")
    return 0


if __name__ == "__main__":
    sys.exit(main())
