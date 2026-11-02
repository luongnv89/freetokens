"""Structural tests for .github/workflows/deploy.yml and validate.yml.

Guards regression of #542: actions/upload-pages-artifact defaults
include-hidden-files to false, which adds --exclude=.[^/]* to the tar and
silently drops dist/.well-known/ — breaking the /.well-known/* discovery
manifests (agent-card, api-catalog, oauth-*, mcp/server-card, agent-skills).

Guards regression of #654: both workflows must run the whole Python unit
suite via `unittest discover`, and on pull requests it must run inside the
required `validate` job, not a separate check.

python3 -m unittest tests/test_deploy_workflow.py -v
python3 -m unittest discover -s tests -v
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WORKFLOWS = REPO / ".github" / "workflows"
DISCOVER = "python3 -m unittest discover -s tests"


def job_block(text, job):
    """Return the text of one top-level job in a workflow (stdlib, no YAML).

    Jobs sit at two-space indent under `jobs:`; a job's block runs until the
    next line at that indent.
    """
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines)
                 if re.match(r"^jobs:\s*(#.*)?$", line))
    block, inside = [], False
    for line in lines[start + 1:]:
        header = re.match(r"^  ([A-Za-z0-9_-]+):\s*(#.*)?$", line)
        if header:
            if inside:
                break
            inside = header.group(1) == job
            continue
        if inside:
            block.append(line)
    return "\n".join(block)


def assert_gates_full_suite(case, block):
    """The job runs the exact discover command, and a failure fails the job."""
    case.assertTrue(block, "workflow must define a `validate` job")
    # Exact line: no narrowing `-p`, no `|| true`, not commented out.
    case.assertRegex(block, rf"(?m)^\s+run: {re.escape(DISCOVER)}\s*$")
    case.assertNotIn("continue-on-error", block)


class DeployWorkflowTests(unittest.TestCase):
    WF = WORKFLOWS / "deploy.yml"

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

    def test_runs_full_python_suite(self):
        # A fixed file list silently skips new test modules (#654).
        block = job_block(self.WF.read_text(encoding="utf-8"), "validate")
        assert_gates_full_suite(self, block)
        self.assertNotIn("unittest tests/", block)


class ValidateWorkflowTests(unittest.TestCase):
    WF = WORKFLOWS / "validate.yml"

    def test_validate_job_runs_full_python_suite(self):
        # The required `validate` check gates PRs and the nightly auto-merge;
        # the suite must run inside it (#654).
        block = job_block(self.WF.read_text(encoding="utf-8"), "validate")
        assert_gates_full_suite(self, block)
        # A `name:` override or a matrix would rename the required check.
        self.assertNotRegex(block, r"(?m)^    (name|strategy):")


if __name__ == "__main__":
    unittest.main()
