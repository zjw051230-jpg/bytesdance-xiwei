import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.executor_agent import execute_patch_plan
from interfaces import repo_adapter as repo_adapter_module
from interfaces.repo_adapter import MockRepoAdapter, RealRepoAdapter, get_default_repo_adapter
from orchestrator.agent_loop import run_agent


class RepoAdapterTest(unittest.TestCase):
    def setUp(self):
        repo_adapter_module._DEFAULT_REPO_ADAPTER = None

    def tearDown(self):
        repo_adapter_module._DEFAULT_REPO_ADAPTER = None

    def test_execute_patch_plan_uses_repo_adapter_when_provided(self):
        repo = MockRepoAdapter()
        result = execute_patch_plan(
            {"patches": [{"file": "frontend/src/pages/Article.jsx", "changes": ["Add word count"]}]},
            {"approved": True},
            repo_adapter=repo,
        )

        self.assertTrue(result["executed"])
        self.assertEqual(result["mode"], "mock_repo")
        self.assertEqual(len(result["files"]), 1)
        self.assertEqual(result["files"][0]["file"], "frontend/src/pages/Article.jsx")
        self.assertTrue(result["files"][0]["applied"])

    def test_default_repo_adapter_returns_mock_repo_adapter(self):
        with patch.dict(os.environ, {}, clear=True):
            repo = get_default_repo_adapter()

        self.assertIsInstance(repo, MockRepoAdapter)

    def test_default_repo_adapter_returns_real_repo_adapter_when_enabled(self):
        with tempfile.TemporaryDirectory() as repo_root:
            with patch.dict(os.environ, {"AGENT_REPO_MODE": "real", "AGENT_REPO_ROOT": repo_root}, clear=True):
                repo = get_default_repo_adapter()

        self.assertIsInstance(repo, RealRepoAdapter)

    def test_real_mode_without_repo_root_fails(self):
        with patch.dict(os.environ, {"AGENT_REPO_MODE": "real"}, clear=True):
            with self.assertRaises(ValueError):
                get_default_repo_adapter()

    def test_real_repo_adapter_reads_file_inside_repo_root(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "README.md"
            path.write_text("hello repo", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            result = repo.read_file("README.md")

        self.assertTrue(result["ok"])
        self.assertEqual(result["content"], "hello repo")
        self.assertEqual(result["mode"], "real_repo_readonly")

    def test_real_repo_adapter_rejects_parent_path_escape(self):
        with tempfile.TemporaryDirectory() as repo_root:
            repo = RealRepoAdapter(repo_root)

            result = repo.read_file("../outside.txt")

        self.assertFalse(result["ok"])
        self.assertIn("escape", result["error"])

    def test_real_repo_adapter_rejects_absolute_path(self):
        with tempfile.TemporaryDirectory() as repo_root:
            absolute_path = str(Path(repo_root) / "README.md")
            repo = RealRepoAdapter(repo_root)

            result = repo.read_file(absolute_path)

        self.assertFalse(result["ok"])
        self.assertIn("absolute", result["error"])

    def test_real_repo_adapter_rejects_windows_drive_path(self):
        with tempfile.TemporaryDirectory() as repo_root:
            repo = RealRepoAdapter(repo_root)

            result = repo.read_file("C:/outside.txt")

        self.assertFalse(result["ok"])
        self.assertIn("absolute", result["error"])

    def test_real_repo_adapter_apply_patch_is_dry_run(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "README.md"
            path.write_text("before", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            result = repo.apply_patch("README.md", ["Replace content"])
            diff = repo.get_diff()
            content = path.read_text(encoding="utf-8")

        self.assertTrue(result["ok"])
        self.assertFalse(result["applied"])
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["mode"], "real_repo_dry_run")
        self.assertEqual(content, "before")
        self.assertEqual(len(diff["diff"]), 1)

    def test_apply_code_patch_dry_run(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "Article.jsx"
            path.write_text("export const body = article.body;\n", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            result = repo.apply_code_patch(
                {
                    "file": "Article.jsx",
                    "operation": "replace",
                    "before_snippet": "export const body = article.body;\n",
                    "after_snippet": "const wordCount = 1;\nexport const body = article.body;\n",
                    "diff": "",
                    "confidence": 0.8,
                }
            )
            content = path.read_text(encoding="utf-8")

        self.assertTrue(result["ok"])
        self.assertTrue(result["dry_run"])
        self.assertFalse(result["applied"])
        self.assertEqual(result["mode"], "real_repo_dry_run")
        self.assertIn("dry_run_diff", result)
        self.assertIn("+const wordCount = 1;", result["dry_run_diff"])
        self.assertEqual(content, "export const body = article.body;\n")

    def test_diff_preview(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "Article.jsx"
            path.write_text("export const body = article.body;\n", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            with patch.dict(os.environ, {"AGENT_REPO_APPLY": "1"}, clear=True):
                result = repo.apply_code_patch(
                    {
                        "file": "Article.jsx",
                        "operation": "replace",
                        "before_snippet": "export const body = article.body;\n",
                        "after_snippet": "const readingTime = 1;\nexport const body = article.body;\n",
                        "diff": "",
                        "confidence": 0.8,
                    }
                )

        self.assertTrue(result["ok"])
        self.assertTrue(result["preview"])
        self.assertEqual(result["mode"], "real_repo_preview")
        self.assertIn("preview_diff", result)
        self.assertIn("+const readingTime = 1;", result["preview_diff"])

    def test_real_repo_adapter_create_file_operation_is_dry_run(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "note.txt"
            repo = RealRepoAdapter(repo_root)

            with patch.dict(os.environ, {"AGENT_REPO_MODE": "real", "AGENT_REPO_ROOT": repo_root}, clear=True):
                result = repo.apply_patch({"operation": "create_file", "path": "note.txt", "content": "100"})

        self.assertTrue(result["ok"])
        self.assertEqual(result["operation"], "create_file")
        self.assertTrue(result["would_write"])
        self.assertEqual(result["content_preview"], "100")
        self.assertFalse(path.exists())

    def test_real_repo_adapter_replace_file_operation_is_dry_run(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "test.py"
            path.write_text("before", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            result = repo.apply_patch({"operation": "replace_file", "path": "test.py", "content": "after"})
            content = path.read_text(encoding="utf-8")

        self.assertTrue(result["ok"])
        self.assertEqual(result["operation"], "replace_file")
        self.assertTrue(result["would_write"])
        self.assertEqual(result["content_preview"], "after")
        self.assertEqual(content, "before")

    def test_real_repo_adapter_append_text_operation_is_dry_run(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "test.py"
            path.write_text("before", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            result = repo.apply_patch({"operation": "append_text", "path": "test.py", "content": "\n# hello"})
            content = path.read_text(encoding="utf-8")

        self.assertTrue(result["ok"])
        self.assertEqual(result["operation"], "append_text")
        self.assertTrue(result["would_write"])
        self.assertIn("# hello", result["content_preview"])
        self.assertEqual(content, "before")

    def test_real_repo_adapter_rejects_unsupported_operation(self):
        with tempfile.TemporaryDirectory() as repo_root:
            repo = RealRepoAdapter(repo_root)

            result = repo.apply_patch({"operation": "delete_file", "path": "test.py", "content": ""})

        self.assertFalse(result["ok"])
        self.assertIn("Unsupported", result["error"])

    def test_real_repo_adapter_rejects_operation_path_escape(self):
        with tempfile.TemporaryDirectory() as repo_root:
            repo = RealRepoAdapter(repo_root)

            result = repo.apply_patch({"operation": "create_file", "path": "../note.txt", "content": "100"})

        self.assertFalse(result["ok"])
        self.assertIn("escape", result["error"])

    def test_real_repo_adapter_text_changes_are_not_real_write_operations(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "test.py"
            path.write_text("before", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            result = repo.apply_patch("test.py", ["Append hello"])
            content = path.read_text(encoding="utf-8")

        self.assertTrue(result["ok"])
        self.assertEqual(result["operation"], "dry_run_text_change")
        self.assertFalse(result["would_write"])
        self.assertTrue(result["unsupported_for_real_write"])
        self.assertEqual(content, "before")

    def test_real_repo_adapter_apply_create_file_previews_without_confirmation(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "note.txt"
            repo = RealRepoAdapter(repo_root)

            with patch.dict(os.environ, {"AGENT_REPO_APPLY": "1"}, clear=True):
                result = repo.apply_patch({"operation": "create_file", "path": "note.txt", "content": "100"})

        self.assertTrue(result["ok"])
        self.assertFalse(result["applied"])
        self.assertFalse(result["real_write"])
        self.assertTrue(result["preview"])
        self.assertTrue(result["approval_required"])
        self.assertEqual(result["mode"], "real_repo_preview")
        self.assertIn("diff_preview", result)
        self.assertFalse(path.exists())

    def test_real_repo_adapter_apply_create_file_writes_when_confirmed(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "note.txt"
            repo = RealRepoAdapter(repo_root)

            with patch.dict(os.environ, {"AGENT_REPO_APPLY": "1", "AGENT_REPO_CONFIRM": "YES"}, clear=True):
                result = repo.apply_patch({"operation": "create_file", "path": "note.txt", "content": "100"})

            content = path.read_text(encoding="utf-8")

        self.assertTrue(result["ok"])
        self.assertTrue(result["applied"])
        self.assertTrue(result["real_write"])
        self.assertFalse(result["preview"])
        self.assertFalse(result["dry_run"])
        self.assertEqual(result["mode"], "real_repo_apply")
        self.assertFalse(result["before_exists"])
        self.assertTrue(result["after_exists"])
        self.assertEqual(result["bytes_written"], 3)
        self.assertEqual(content, "100")

    def test_real_repo_adapter_apply_create_file_existing_fails_without_overwrite(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "note.txt"
            path.write_text("before", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            with patch.dict(os.environ, {"AGENT_REPO_APPLY": "1", "AGENT_REPO_CONFIRM": "YES"}, clear=True):
                result = repo.apply_patch({"operation": "create_file", "path": "note.txt", "content": "after"})

            content = path.read_text(encoding="utf-8")

        self.assertFalse(result["ok"])
        self.assertFalse(result["applied"])
        self.assertEqual(result["mode"], "real_repo_apply")
        self.assertTrue(result["before_exists"])
        self.assertTrue(result["after_exists"])
        self.assertEqual(result["bytes_written"], 0)
        self.assertEqual(content, "before")

    def test_real_repo_adapter_apply_create_file_overwrite_replaces_existing_file(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "note.txt"
            path.write_text("before", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            with patch.dict(os.environ, {"AGENT_REPO_APPLY": "1", "AGENT_REPO_CONFIRM": "YES"}, clear=True):
                result = repo.apply_patch(
                    {"operation": "create_file", "path": "note.txt", "content": "after", "overwrite": True}
                )

            content = path.read_text(encoding="utf-8")

        self.assertTrue(result["ok"])
        self.assertTrue(result["applied"])
        self.assertTrue(result["before_exists"])
        self.assertEqual(content, "after")

    def test_real_repo_adapter_apply_replace_file_requires_existing_file(self):
        with tempfile.TemporaryDirectory() as repo_root:
            repo = RealRepoAdapter(repo_root)

            with patch.dict(os.environ, {"AGENT_REPO_APPLY": "1", "AGENT_REPO_CONFIRM": "YES"}, clear=True):
                missing = repo.apply_patch({"operation": "replace_file", "path": "test.py", "content": "after"})

            path = Path(repo_root) / "test.py"
            path.write_text("before", encoding="utf-8")
            with patch.dict(os.environ, {"AGENT_REPO_APPLY": "1", "AGENT_REPO_CONFIRM": "YES"}, clear=True):
                replaced = repo.apply_patch({"operation": "replace_file", "path": "test.py", "content": "after"})
            content = path.read_text(encoding="utf-8")

        self.assertFalse(missing["ok"])
        self.assertIn("does not exist", missing["error"])
        self.assertTrue(replaced["ok"])
        self.assertTrue(replaced["applied"])
        self.assertEqual(content, "after")

    def test_real_repo_adapter_apply_append_text_requires_existing_file(self):
        with tempfile.TemporaryDirectory() as repo_root:
            repo = RealRepoAdapter(repo_root)

            with patch.dict(os.environ, {"AGENT_REPO_APPLY": "1", "AGENT_REPO_CONFIRM": "YES"}, clear=True):
                missing = repo.apply_patch({"operation": "append_text", "path": "test.py", "content": "\n# hello"})

            path = Path(repo_root) / "test.py"
            path.write_text("before", encoding="utf-8")
            with patch.dict(os.environ, {"AGENT_REPO_APPLY": "1", "AGENT_REPO_CONFIRM": "YES"}, clear=True):
                appended = repo.apply_patch({"operation": "append_text", "path": "test.py", "content": "\n# hello"})
            content = path.read_text(encoding="utf-8")

        self.assertFalse(missing["ok"])
        self.assertIn("does not exist", missing["error"])
        self.assertTrue(appended["ok"])
        self.assertTrue(appended["applied"])
        self.assertEqual(content, "before\n# hello")

    def test_real_repo_adapter_apply_path_escape_is_rejected_when_enabled(self):
        with tempfile.TemporaryDirectory() as repo_root:
            repo = RealRepoAdapter(repo_root)

            with patch.dict(os.environ, {"AGENT_REPO_APPLY": "1", "AGENT_REPO_CONFIRM": "YES"}, clear=True):
                result = repo.apply_patch({"operation": "create_file", "path": "../note.txt", "content": "100"})

        self.assertFalse(result["ok"])
        self.assertFalse(result["applied"])
        self.assertIn("escape", result["error"])

    def test_real_repo_adapter_text_changes_never_write_when_apply_enabled(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "test.py"
            path.write_text("before", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            with patch.dict(os.environ, {"AGENT_REPO_APPLY": "1"}, clear=True):
                result = repo.apply_patch("test.py", ["Append hello"])
            content = path.read_text(encoding="utf-8")

        self.assertTrue(result["ok"])
        self.assertFalse(result["applied"])
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["mode"], "real_repo_dry_run")
        self.assertTrue(result["unsupported_for_real_write"])
        self.assertEqual(content, "before")

    def test_real_repo_adapter_apply_does_not_persist_after_env_cleared(self):
        with tempfile.TemporaryDirectory() as repo_root:
            repo = RealRepoAdapter(repo_root)

            with patch.dict(os.environ, {"AGENT_REPO_APPLY": "1", "AGENT_REPO_CONFIRM": "YES"}, clear=True):
                applied = repo.apply_patch({"operation": "create_file", "path": "one.txt", "content": "1"})
            with patch.dict(os.environ, {}, clear=True):
                dry_run = repo.apply_patch({"operation": "create_file", "path": "two.txt", "content": "2"})

            one_exists = (Path(repo_root) / "one.txt").exists()
            two_exists = (Path(repo_root) / "two.txt").exists()

        self.assertTrue(applied["applied"])
        self.assertTrue(one_exists)
        self.assertTrue(dry_run["dry_run"])
        self.assertFalse(two_exists)

    def test_real_repo_preview_result_is_saved_in_state(self):
        with tempfile.TemporaryDirectory() as repo_root:
            with patch.dict(
                os.environ,
                {"AGENT_REPO_MODE": "real", "AGENT_REPO_ROOT": repo_root, "AGENT_REPO_APPLY": "1"},
                clear=True,
            ):
                repo_adapter_module._DEFAULT_REPO_ADAPTER = None
                state = run_agent("创建 note.txt 文件，内容为 100", task_id="preview_state_test")

            path = Path(repo_root) / "note.txt"

        self.assertIn("preview_result", state.artifacts)
        self.assertEqual(state.artifacts["execution_result"]["mode"], "real_repo_preview")
        self.assertEqual(state.artifacts["preview_result"][0]["operation"], "create_file")
        self.assertFalse(path.exists())

    def test_real_repo_adapter_list_files_includes_python_files(self):
        with tempfile.TemporaryDirectory() as repo_root:
            path = Path(repo_root) / "main.py"
            path.write_text("print('hello')", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            result = repo.list_files()

        self.assertTrue(result["ok"])
        self.assertTrue(any(item["path"] == "main.py" for item in result["files"]))

    def test_real_repo_adapter_list_files_ignores_generated_and_vendor_dirs(self):
        with tempfile.TemporaryDirectory() as repo_root:
            for directory in ("__pycache__", ".git", "node_modules"):
                ignored_dir = Path(repo_root) / directory
                ignored_dir.mkdir()
                (ignored_dir / "ignored.py").write_text("ignored", encoding="utf-8")
            (Path(repo_root) / "app.py").write_text("included", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            result = repo.list_files()

        listed_paths = [item["path"] for item in result["files"]]
        self.assertEqual(listed_paths, ["app.py"])

    def test_real_repo_adapter_list_files_rejects_path_escape(self):
        with tempfile.TemporaryDirectory() as repo_root:
            repo = RealRepoAdapter(repo_root)

            result = repo.list_files("../outside")

        self.assertFalse(result["ok"])
        self.assertEqual(result["files"], [])
        self.assertIn("escape", result["error"])


if __name__ == "__main__":
    unittest.main()
