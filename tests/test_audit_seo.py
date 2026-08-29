import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from scripts import audit_seo


FULL_DOCUMENT = """<!doctype html>
<html lang="en">
<head>
  <meta name="viewport" content="width=device-width">
  <meta property="og:title" content="Example">
  <meta property="og:description" content="Example">
  <meta property="og:url" content="https://example.test/">
  <meta property="og:type" content="website">
  <meta property="og:image" content="https://example.test/image.svg">
  <meta property="og:site_name" content="Example">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Example">
  <meta name="twitter:description" content="Example">
  <meta name="twitter:image" content="https://example.test/image.svg">
  <link href="https://example.test/" rel="alternate canonical">
  <script type="application/ld+json">{"@context":"https://schema.org"}</script>
</head>
<body><h1>Example</h1></body>
</html>
"""


class AuditSeoTests(unittest.TestCase):
    def make_dist(self, files):
        directory = tempfile.TemporaryDirectory()
        dist = Path(directory.name)
        for name, content in files.items():
            path = dist / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        self.addCleanup(directory.cleanup)
        return dist

    def test_complete_document_and_artifacts_are_clean(self):
        dist = self.make_dist(
            {
                "index.html": FULL_DOCUMENT,
                "robots.txt": "User-agent: *\nAllow: /\n",
                "sitemap.xml": "<urlset />\n",
            }
        )

        result = audit_seo.audit_directory(dist)

        self.assertEqual(result["files_checked"], 1)
        self.assertEqual(result["critical"], [])
        self.assertEqual(result["warning"], [])
        self.assertEqual(result["info"], [])

    def test_missing_signals_are_bucketed_by_severity(self):
        dist = self.make_dist(
            {
                "index.html": '<html lang="en"><head><meta name="viewport" content="width=device-width"></head><body><h1>Example</h1></body></html>'
            }
        )

        result = audit_seo.audit_directory(dist)

        self.assertEqual(len(result["critical"]), 5)
        self.assertIn("index.html: Missing canonical tag", result["critical"])
        self.assertIn("index.html: Missing OG tags: og:title, og:description, og:url, og:type, og:image, og:site_name", result["critical"])
        self.assertIn("index.html: Missing JSON-LD structured data", result["critical"])
        self.assertIn("dist/: Missing robots.txt", result["critical"])
        self.assertIn("dist/: Missing sitemap.xml", result["critical"])
        self.assertEqual(len(result["warning"]), 1)
        self.assertIn("index.html: Missing Twitter tags: twitter:card, twitter:title, twitter:description, twitter:image", result["warning"])

    def test_metadata_after_implicit_head_end_is_not_counted(self):
        parser = audit_seo.parse_document(
            "<html><head><body><meta name='description' content='Body only'></body></html>"
        )

        self.assertEqual(parser.meta_names, set())
        self.assertEqual(parser.meta_properties, set())
        self.assertFalse(parser.in_head)

    def test_json_ld_requires_objects(self):
        for payload in ("null", "true", '"text"', "[]", "[null]"):
            with self.subTest(payload=payload):
                dist = self.make_dist(
                    {
                        "index.html": f"""<html lang="en"><head>
                          <script type="application/ld+json">{payload}</script>
                        </head><body><h1>Example</h1></body></html>""",
                        "robots.txt": "",
                        "sitemap.xml": "",
                    }
                )

                result = audit_seo.audit_directory(dist)

                self.assertIn("index.html: Invalid JSON-LD structured data", result["critical"])

    def test_head_scope_empty_values_and_json_validity_are_checked(self):
        dist = self.make_dist(
            {
                "index.html": """<html lang="en"><head>
                  <link rel="canonical" href="">
                  <meta name="viewport" content="">
                  <meta property="og:title" content="">
                  <script type="application/ld+json">not-json</script>
                </head><body>
                  <link rel="canonical" href="https://body.example/">
                  <meta property="og:description" content="Body only">
                  <script type="application/ld+json">{\"body\":true}</script>
                  <h1>Example</h1>
                </body></html>""",
                "robots.txt": "",
                "sitemap.xml": "",
            }
        )

        result = audit_seo.audit_directory(dist)

        self.assertIn("index.html: Canonical tag has empty href", result["critical"])
        self.assertIn("index.html: Missing OG tags: og:title, og:description, og:url, og:type, og:image, og:site_name", result["critical"])
        self.assertIn("index.html: Invalid JSON-LD structured data", result["critical"])
        self.assertIn("index.html: Missing Twitter tags: twitter:card, twitter:title, twitter:description, twitter:image", result["warning"])
        self.assertIn("index.html: Missing viewport meta tag", result["warning"])
        self.assertNotIn("index.html: Missing canonical tag", result["critical"])

    def test_attribute_order_multiple_values_and_absolute_canonical_are_supported(self):
        dist = self.make_dist(
            {
                "index.html": FULL_DOCUMENT.replace(
                    '<meta property="og:title" content="Example">',
                    '<meta content="Example" data-extra="yes" property="og:title">',
                )
                .replace(
                    '<meta name="twitter:title" content="Example">',
                    '<meta content="Example" name="twitter:title">',
                )
                .replace(
                    'rel="alternate canonical"',
                    'rel="CANONICAL alternate"',
                )
            }
        )
        (dist / "robots.txt").write_text("User-agent: *\n", encoding="utf-8")
        (dist / "sitemap.xml").write_text("<urlset />\n", encoding="utf-8")

        result = audit_seo.audit_directory(dist)

        self.assertEqual(result["critical"], [])
        self.assertEqual(result["warning"], [])

    def test_nested_offer_pages_are_outside_baseline_scope(self):
        dist = self.make_dist(
            {
                "index.html": FULL_DOCUMENT,
                "offers/example.html": "<html><body></body></html>",
            }
        )

        result = audit_seo.audit_directory(dist)

        self.assertEqual(result["files_checked"], 1)
        self.assertEqual(result["html_files"], ["index.html"])

    def test_missing_directory_empty_directory_and_decode_errors_raise_audit_error(self):
        with self.assertRaises(audit_seo.AuditError):
            audit_seo.audit_directory(Path("/does/not/exist"))

        dist = self.make_dist({})
        with self.assertRaises(audit_seo.AuditError):
            audit_seo.audit_directory(dist)

        (dist / "index.html").write_bytes(b"\xff")
        with self.assertRaises(audit_seo.AuditError):
            audit_seo.audit_directory(dist)

    def test_json_cli_output_honors_the_requested_directory(self):
        dist = self.make_dist({"index.html": FULL_DOCUMENT})
        stdout = io.StringIO()

        with contextlib.redirect_stdout(stdout):
            exit_code = audit_seo.main(["--json", str(dist)])

        payload = json.loads(stdout.getvalue())
        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["files_checked"], 1)
        self.assertEqual(payload["html_files"], ["index.html"])
        self.assertIn("dist/: Missing robots.txt", payload["critical"])

    def test_human_cli_output_and_fail_on_critical_gate(self):
        dist = self.make_dist({"index.html": FULL_DOCUMENT})
        stdout = io.StringIO()

        with contextlib.redirect_stdout(stdout):
            report_exit = audit_seo.main([str(dist)])
        self.assertEqual(report_exit, 0)
        self.assertIn("SEO Audit Summary (dist/1 top-level HTML files)", stdout.getvalue())
        self.assertIn("Critical: 2", stdout.getvalue())

        self.assertEqual(audit_seo.main(["--fail-on-critical", str(dist)]), 1)

        (dist / "robots.txt").write_text("User-agent: *\n", encoding="utf-8")
        (dist / "sitemap.xml").write_text("<urlset />\n", encoding="utf-8")
        self.assertEqual(audit_seo.main(["--fail-on-critical", str(dist)]), 0)


if __name__ == "__main__":
    unittest.main()
