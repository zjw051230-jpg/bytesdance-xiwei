import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.executor_agent import execute_patch_plan


class FailingRepoAdapter:
    def apply_patch(self, file, changes):
        return {
            "ok": False,
            "file": file,
            "applied": False,
            "mode": "real_repo_dry_run",
            "error": "path escape is not allowed",
        }


class CustomModeRepoAdapter:
    def apply_patch(self, file, changes):
        return {
            "ok": True,
            "file": file,
            "applied": False,
            "dry_run": True,
            "mode": "real_repo_dry_run",
        }


class StructuredPatchRepoAdapter:
    def apply_patch(self, file, changes):
        return {
            "ok": True,
            "operation": file["operation"],
            "file": file["path"],
            "path": file["path"],
            "applied": False,
            "dry_run": True,
            "would_write": True,
            "content_preview": file["content"],
            "mode": "real_repo_dry_run",
        }


class AppliedStructuredPatchRepoAdapter:
    def apply_patch(self, file, changes):
        return {
            "ok": True,
            "operation": file["operation"],
            "file": file["path"],
            "path": file["path"],
            "applied": True,
            "real_write": True,
            "dry_run": False,
            "would_write": True,
            "content_preview": file["content"],
            "before_exists": False,
            "after_exists": True,
            "bytes_written": len(file["content"].encode("utf-8")),
            "mode": "real_repo_apply",
        }


class PreviewStructuredPatchRepoAdapter:
    def apply_patch(self, file, changes):
        return {
            "ok": True,
            "operation": file["operation"],
            "file": file["path"],
            "path": file["path"],
            "applied": False,
            "real_write": False,
            "dry_run": False,
            "preview": True,
            "approval_required": True,
            "would_write": True,
            "content_preview": file["content"],
            "diff_preview": "--- /dev/null\n+++ note.txt\n+100",
            "before_exists": False,
            "after_exists": False,
            "bytes_written": 0,
            "mode": "real_repo_preview",
        }


class ExecutorAgentTest(unittest.TestCase):
    def test_execute_patch_plan_runs_for_approved_patch(self):
        result = execute_patch_plan(
            {"patches": [{"file": "frontend/src/pages/Article.jsx", "changes": ["Add word count"]}]},
            {"approved": True},
        )

        self.assertTrue(result["executed"])
        self.assertEqual(result["mode"], "dry_run")
        self.assertTrue(result["files"])

    def test_execute_patch_plan_blocks_when_review_not_approved(self):
        result = execute_patch_plan(
            {"patches": [{"file": "frontend/src/pages/Article.jsx", "changes": ["Add word count"]}]},
            {"approved": False},
        )

        self.assertFalse(result["executed"])
        self.assertIn("blocked", result["summary"].lower())

    def test_execute_patch_plan_fails_when_repo_adapter_apply_patch_fails(self):
        result = execute_patch_plan(
            {"patches": [{"file": "../outside.txt", "changes": ["Change outside repo"]}]},
            {"approved": True},
            repo_adapter=FailingRepoAdapter(),
        )

        self.assertFalse(result["executed"])
        self.assertEqual(result["mode"], "real_repo_dry_run")
        self.assertEqual(result["files"][0]["status"], "failed")
        self.assertFalse(result["files"][0]["applied"])
        self.assertIn("path escape", result["error"])

    def test_execute_patch_plan_uses_adapter_mode(self):
        result = execute_patch_plan(
            {"patches": [{"file": "README.md", "changes": ["Dry run only"]}]},
            {"approved": True},
            repo_adapter=CustomModeRepoAdapter(),
        )

        self.assertTrue(result["executed"])
        self.assertEqual(result["mode"], "real_repo_dry_run")
        self.assertEqual(result["files"][0]["status"], "dry_run")
        self.assertTrue(result["files"][0]["dry_run"])

    def test_execute_patch_plan_records_structured_patch_result(self):
        result = execute_patch_plan(
            {"patches": [{"operation": "create_file", "path": "note.txt", "content": "100"}]},
            {"approved": True},
            repo_adapter=StructuredPatchRepoAdapter(),
        )

        self.assertTrue(result["executed"])
        self.assertEqual(result["mode"], "real_repo_dry_run")
        self.assertEqual(result["files"][0]["operation"], "create_file")
        self.assertEqual(result["files"][0]["file"], "note.txt")
        self.assertTrue(result["files"][0]["would_write"])
        self.assertEqual(result["files"][0]["content_preview"], "100")

    def test_execute_patch_plan_records_real_write_result(self):
        result = execute_patch_plan(
            {"patches": [{"operation": "create_file", "path": "note.txt", "content": "100"}]},
            {"approved": True},
            repo_adapter=AppliedStructuredPatchRepoAdapter(),
        )

        self.assertTrue(result["executed"])
        self.assertEqual(result["mode"], "real_repo_apply")
        self.assertEqual(result["files"][0]["status"], "applied")
        self.assertTrue(result["files"][0]["real_write"])
        self.assertFalse(result["files"][0]["dry_run"])
        self.assertFalse(result["files"][0]["before_exists"])
        self.assertTrue(result["files"][0]["after_exists"])
        self.assertEqual(result["files"][0]["bytes_written"], 3)

    def test_execute_patch_plan_records_preview_result(self):
        result = execute_patch_plan(
            {"patches": [{"operation": "create_file", "path": "note.txt", "content": "100"}]},
            {"approved": True},
            repo_adapter=PreviewStructuredPatchRepoAdapter(),
        )

        self.assertTrue(result["executed"])
        self.assertEqual(result["mode"], "real_repo_preview")
        self.assertEqual(result["files"][0]["status"], "preview")
        self.assertTrue(result["files"][0]["preview"])
        self.assertTrue(result["files"][0]["approval_required"])
        self.assertEqual(result["preview_result"][0]["operation"], "create_file")


if __name__ == "__main__":
    unittest.main()
