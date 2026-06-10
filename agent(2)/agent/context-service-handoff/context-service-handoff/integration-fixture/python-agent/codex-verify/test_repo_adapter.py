import sys
import unittest
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.executor_agent import execute_patch_plan
from interfaces.repo_adapter import MockRepoAdapter, RealRepoAdapter, get_default_repo_adapter


class RepoAdapterTest(unittest.TestCase):
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
        repo = get_default_repo_adapter()

        self.assertIsInstance(repo, MockRepoAdapter)

    def test_real_repo_adapter_dry_run_reads_file_and_does_not_modify_it(self):
        with tempfile.TemporaryDirectory() as repo_root:
            target = Path(repo_root) / "frontend" / "src" / "pages" / "Article.jsx"
            target.parent.mkdir(parents=True)
            target.write_text("export default function Article() { return null; }\n", encoding="utf-8")
            repo = RealRepoAdapter(repo_root=repo_root, dry_run=True)

            read_result = repo.read_file("frontend/src/pages/Article.jsx")
            patch_result = repo.apply_patch("frontend/src/pages/Article.jsx", ["Add word count"])
            diff_result = repo.get_diff()

            self.assertTrue(read_result["ok"])
            self.assertIn("Article", read_result["content"])
            self.assertFalse(patch_result["applied"])
            self.assertEqual(patch_result["mode"], "real_repo_dry_run")
            self.assertEqual(target.read_text(encoding="utf-8"), "export default function Article() { return null; }\n")
            self.assertEqual(diff_result["diff"][0]["file"], "frontend/src/pages/Article.jsx")

    def test_real_repo_adapter_rejects_path_escape_and_forbidden_files(self):
        with tempfile.TemporaryDirectory() as repo_root:
            repo = RealRepoAdapter(repo_root=repo_root, dry_run=True)

            with self.assertRaises(ValueError):
                repo.read_file("../outside.txt")
            with self.assertRaises(ValueError):
                repo.apply_patch(".env", ["write secret"])


if __name__ == "__main__":
    unittest.main()
