import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.locator_agent import locate_files
from interfaces.event_adapter import MockEventAdapter
from interfaces.memory_adapter import InMemoryMemoryAdapter
from interfaces.repo_adapter import RealRepoAdapter
from orchestrator.state import AgentState
from tools.tool_registry import execute
from skills.registry import match_skill


class LocatorAgentTest(unittest.TestCase):
    def test_locate_files_uses_plan_hint(self):
        result = locate_files({"target_files_hint": ["frontend/src/pages/Article.jsx"]}, {"name": "article-word-stats"})

        self.assertTrue(result["located"])
        self.assertEqual(result["strategy"], "plan_hint")
        self.assertTrue(any(item["path"] == "frontend/src/pages/Article.jsx" for item in result["files"]))

    def test_locate_files_defaults_for_about_me_tab(self):
        result = locate_files(None, {"name": "about-me-tab"})

        self.assertTrue(result["located"])
        self.assertTrue(any("Profile.jsx" in item["path"] for item in result["files"]))

    def test_locate_files_defaults_for_cover_image(self):
        result = locate_files(None, {"name": "cover-image"})

        self.assertTrue(result["located"])
        self.assertTrue(any("backend/src/models/Article.js" in item["path"] for item in result["files"]))
        self.assertTrue(any("frontend/src/pages/Editor.jsx" in item["path"] for item in result["files"]))

    def test_current_conduit_cover_image_paths_can_be_matched(self):
        with tempfile.TemporaryDirectory() as repo_root:
            paths = [
                "backend/models/article.js",
                "backend/routes/articles.js",
                "backend/controllers/articles.js",
                "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx",
                "frontend/src/routes/Article/Article.jsx",
                "frontend/src/services/getArticle.js",
                "frontend/src/services/setArticle.js",
            ]
            for path in paths:
                target = Path(repo_root) / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("article cover image", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)
            skill = match_skill("add article cover image")["skill"]
            plan = {
                "target_files_hint": [],
                "target_file_patterns": skill["conduit_backend_patterns"] + skill["conduit_frontend_patterns"],
                "metadata": {"conduit_scope": "fullstack"},
            }
            repo_profile = {"repo_type": "conduit"}

            result = locate_files(
                plan,
                skill,
                repo_adapter=repo,
                user_input="add cover image",
                repo_profile=repo_profile,
            )

        matched_paths = {item["relative_path"] for item in result["files"]}
        self.assertTrue(result["located"])
        self.assertTrue(set(paths).issubset(matched_paths))

    def test_locate_files_uses_real_repo_file_list(self):
        with tempfile.TemporaryDirectory() as repo_root:
            src = Path(repo_root) / "src"
            src.mkdir()
            (src / "main.py").write_text("print('hello')", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            result = locate_files(
                {"target_files_hint": ["main.py"]},
                None,
                repo_adapter=repo,
                user_input="分析这个 Python 项目的 main.py",
            )

        self.assertTrue(result["located"])
        self.assertEqual(result["strategy"], "real_repo")
        self.assertEqual(len(result["files"]), 1)
        self.assertTrue(result["files"][0]["path"].endswith("main.py"))
        self.assertEqual(result["files"][0]["relative_path"], "src/main.py")

    def test_locate_files_real_repo_without_match_does_not_fallback_to_mock_default(self):
        with tempfile.TemporaryDirectory() as repo_root:
            (Path(repo_root) / "README.md").write_text("hello", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            result = locate_files(
                {"target_files_hint": ["frontend/src/pages/Article.jsx"]},
                {"name": "article-word-stats"},
                repo_adapter=repo,
            )

        self.assertFalse(result["located"])
        self.assertEqual(result["strategy"], "real_repo")
        self.assertEqual(result["files"], [])

    def test_locate_files_real_repo_uses_python_language_hint(self):
        with tempfile.TemporaryDirectory() as repo_root:
            (Path(repo_root) / "cash.py").write_text("print('cash')", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            result = locate_files(
                {"target_files_hint": []},
                None,
                repo_adapter=repo,
                user_input="分析这个 Python 项目的 main.py",
            )

        self.assertTrue(result["located"])
        self.assertEqual(result["strategy"], "real_repo")
        self.assertTrue(any(item["relative_path"] == "cash.py" for item in result["files"]))

    def test_locate_files_real_repo_searches_file_content(self):
        with tempfile.TemporaryDirectory() as repo_root:
            src = Path(repo_root) / "src"
            src.mkdir()
            (src / "article_view.jsx").write_text(
                "export function Article() { return <span>reading time</span>; }",
                encoding="utf-8",
            )
            (src / "profile.jsx").write_text("export function Profile() { return null; }", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)

            result = locate_files(
                {"target_files_hint": []},
                {"name": "article-word-stats", "keywords": ["reading time"]},
                repo_adapter=repo,
                user_input="add article reading time",
            )

        self.assertTrue(result["located"])
        self.assertEqual(result["strategy"], "real_repo")
        self.assertEqual(result["files"][0]["relative_path"], "src/article_view.jsx")
        self.assertIn("content", result["files"][0]["match_reasons"])
        self.assertIn("reading time", result["files"][0]["matched_terms"])
        self.assertIn("search_terms", result)

    def test_execute_locate_files_records_memory_and_event(self):
        memory = InMemoryMemoryAdapter()
        events = MockEventAdapter()
        with tempfile.TemporaryDirectory() as repo_root:
            src = Path(repo_root) / "src"
            src.mkdir()
            (src / "article_view.jsx").write_text("reading time", encoding="utf-8")
            repo = RealRepoAdapter(repo_root)
            state = AgentState(task_id="locate_event_test", user_input="reading time")
            state.artifacts["plan"] = {"target_files_hint": []}
            state.matched_skill = {"name": "article-word-stats", "keywords": ["reading time"]}

            with patch("tools.tool_registry.get_default_repo_adapter", return_value=repo), \
                 patch("tools.tool_registry.get_default_memory_adapter", return_value=memory), \
                 patch("tools.tool_registry.get_default_event_adapter", return_value=events):
                observation = execute({"tool": "locate_files", "args": {}}, state)

        self.assertTrue(observation["ok"])
        self.assertTrue(state.artifacts["located_files"]["located"])
        self.assertEqual(memory.events[0]["stage"], "locate_files")
        self.assertEqual(memory.events[0]["payload"]["strategy"], "real_repo")
        self.assertEqual(state.artifacts["last_event"]["type"], "FILES_LOCATED")
        self.assertEqual(state.node_history[0]["node_type"], "locate")

    def test_matched_skill_fields_enter_locate_result(self):
        skill = match_skill("please add About Me profile tab")["skill"]

        result = locate_files(None, skill)

        self.assertTrue(result["located"])
        self.assertEqual(result["strategy"], "skill_default")
        self.assertTrue(any("Profile.jsx" in item["path"] for item in result["files"]))
        self.assertIn("Search tab navigation components", result["context_rules"])


if __name__ == "__main__":
    unittest.main()
