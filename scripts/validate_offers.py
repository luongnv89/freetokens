#!/usr/bin/env python3
"""Validate every offers/*.yaml against the frozen offer schema (Task 2.1).

Stdlib-only (ADR 001). The canonical constraints live in build.py's
parser/validator; this CLI reuses them so CI and the build cannot drift, and
cross-checks schemas/offer.schema.json against build.py's constants so the
JSON Schema artifact stays in sync.

Usage:

    python3 scripts/validate_offers.py [--offers-dir offers] [--schema schemas/offer.schema.json]

Exits 0 when every offer is valid; exits 1 with a message naming the
offending file and field (plus a YYYY-MM-DD hint on date errors) otherwise.
"""

from __future__ import annotations

import argparse
import glob as _glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import offer_model as build  # noqa: E402

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


class SchemaMismatch(ValueError):
    """schemas/offer.schema.json disagrees with build.py's constants."""


def load_schema(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        schema = json.load(fh)
    if not isinstance(schema, dict):
        raise SchemaMismatch(f"{path}: top level must be an object")
    return schema


def check_schema_matches_build(schema: dict) -> None:
    required = set(schema.get("required", []))
    if required != set(build.REQUIRED_FIELDS):
        missing = sorted(set(build.REQUIRED_FIELDS) - required)
        extra = sorted(required - set(build.REQUIRED_FIELDS))
        raise SchemaMismatch(
            "schema 'required' does not match build.py REQUIRED_FIELDS "
            f"(schema-only: {extra or '{}'}; build-only: {missing or '{}'})"
        )
    props = schema.get("properties")
    if not isinstance(props, dict):
        raise SchemaMismatch("schema 'properties' must be an object")
    enum = props.get("category", {}).get("enum")
    if enum != list(build.CATEGORIES):
        raise SchemaMismatch(
            "schema category enum does not match build.py CATEGORIES "
            f"(schema: {enum}, build: {list(build.CATEGORIES)})"
        )
    for field in ("expiry_date", "verified_date"):
        pattern = props.get(field, {}).get("pattern")
        if pattern != "^[0-9]{4}-[0-9]{2}-[0-9]{2}$":
            raise SchemaMismatch(
                f"schema {field} pattern must enforce YYYY-MM-DD (got {pattern!r})"
            )
    nullable = props.get("expiry_date", {}).get("type")
    if "null" not in (nullable or []):
        raise SchemaMismatch("schema expiry_date must be nullable")
    verified = props.get("verified_date", {}).get("type")
    if isinstance(verified, list) and "null" in verified:
        raise SchemaMismatch("schema verified_date must not be nullable")


def check_detail_schema_matches_build(schema: dict) -> None:
    """Cross-check schemas/offer-detail.schema.json against build constants."""
    if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
        raise SchemaMismatch(
            "offer-detail schema must declare the 2020-12 draft $schema"
        )
    props = schema.get("properties")
    if not isinstance(props, dict):
        raise SchemaMismatch("offer-detail 'properties' must be an object")
    keys = set(props)
    if keys != set(build.DETAIL_KEYS):
        raise SchemaMismatch(
            "offer-detail properties do not match build.py DETAIL_KEYS "
            f"(schema-only: {sorted(keys - set(build.DETAIL_KEYS)) or '{}'}; "
            f"build-only: {sorted(set(build.DETAIL_KEYS) - keys) or '{}'})"
        )
    proof = props.get("social_proof", {}).get("items", {})
    enum = proof.get("properties", {}).get("type", {}).get("enum")
    if enum != list(build.DETAIL_TYPES):
        raise SchemaMismatch(
            "offer-detail social_proof type enum does not match "
            f"build.py DETAIL_TYPES (schema: {enum}, "
            f"build: {list(build.DETAIL_TYPES)})"
        )


def check_slug(slug: str, filename: str) -> None:
    if not SLUG_RE.match(slug):
        raise build.OfferError(
            f"{filename}: slug {slug!r} violates naming convention "
            "(lowercase ASCII words separated by hyphens, no leading/"
            "trailing hyphen)"
        )


def validate_offers_dir(offers_dir: str) -> list:
    paths = sorted(_glob.glob(os.path.join(offers_dir, "*.yaml")))
    paths += sorted(_glob.glob(os.path.join(offers_dir, "*.yml")))
    slugs = {}
    for path in paths:
        slug = os.path.splitext(os.path.basename(path))[0]
        check_slug(slug, path)
        clash = slugs.get(slug)
        if clash is not None:
            raise build.OfferError(
                f"duplicate slug {slug!r}: {clash} and {path} produce the "
                "same slug; rename one file"
            )
        slugs[slug] = path
    # Full parse + validation (file+field errors with date hints).
    return build.load_offers(offers_dir)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offers-dir", default="offers")
    parser.add_argument("--schema", default="schemas/offer.schema.json")
    parser.add_argument(
        "--detail-schema", default="schemas/offer-detail.schema.json"
    )
    args = parser.parse_args(argv)

    try:
        schema = load_schema(args.schema)
        check_schema_matches_build(schema)
        offers = validate_offers_dir(args.offers_dir)
        if os.path.exists(args.detail_schema):
            check_detail_schema_matches_build(load_schema(args.detail_schema))
            build.load_details(args.offers_dir, {o["slug"] for o in offers})
    except SchemaMismatch as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 1
    except build.OfferError as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 1

    print(f"validated {len(offers)} offers against {args.schema}: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
