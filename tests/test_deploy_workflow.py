"""Structural tests for .github/workflows/deploy.yml.

Guards regression of #542: actions/upload-pages-artifact defaults
include-hidden-files to false, which adds --exclude=.[^/]* to the tar and
silently drops dist/.well-known/ — breaking the /.well-known/* discovery
manifests (agent-card, api-catalog, oauth-*, mcp/server-card, agent-skills).

python3 -m unittest tests/test_deploy_workflow.py -v
python3 -m unittest discover -s tests -v
"""

import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


class DeployWorkflowTests(unittest.TestCase):
    WF = REPO / ".github" / "workflows" / "deploy.yml"

    def test_workflow_exists(self):
        self.assertTrue(self.WF.exists(), "deploy.yml must exist")

    def test_upload_includes_hidden_files(self):
        text = self.WF.read_text(encoding="utf-8")
        self.assertIn("actions/upload-pages-artifact@", text)
        # Without this the tar drops every top-level dot-dir (#542).
        self.assertIn("include-hidden-files: true", text)

    def test_actions_pinned_to_sha(self):
        text = self.WF.read_text(encoding="utf-8")
        for line in text.splitlines():
            if "uses:" in line and "actions/" in line:
                self.assertRegex(line, r"actions/.+@[0-9a-f]{40}", msg=line)


if __name__ == "__main__":
    unittest.main()
