import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.locator_agent import locate_files
from agents.planner_agent import create_plan
from agents.verifier_agent import verify_execution
from interfaces.repo_adapter import RealRepoAdapter
from interfaces.repo_profiler import profile_repo
from interfaces.test_adapter import RealTestAdapter
from main import build_task_result
from orchestrator.agent_loop import run_agent
from orchestrator.state import AgentState
from skills.registry import match_skill


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def _make_conduit_repo(root: Path) -> None:
    _write_json(
        root / "frontend" / "package.json",
        {
            "scripts": {"test": "vitest", "build": "vite build"},
            "dependencies": {"@vitejs/plugin-react": "latest", "vite": "latest", "react": "latest"},
        },
    )
    _write_json(
        root / "backend" / "package.json",
        {
            "scripts": {"test": "jest"},
            "dependencies": {"express": "latest", "sequelize": "latest"},
        },
    )
    (root / "frontend" / "src" / "pages").mkdir(parents=True)
    (root / "frontend" / "src" / "api").mkdir(parents=True)
    (root / "backend" / "src" / "models").mkdir(parents=True)
    (root / "backend" / "src" / "routes").mkdir(parents=True)
    (root / "backend" / "src" / "controllers").mkdir(parents=True)
    (root / "frontend" / "src" / "pages" / "Article.jsx").write_text("export function Article() {}", encoding="utf-8")
    (root / "frontend" / "src" / "pages" / "Editor.jsx").write_text("export function Editor() {}", encoding="utf-8")
    (root / "frontend" / "src" / "api" / "articles.js").write_text("export const articles = {}", encoding="utf-8")
    (root / "backend" / "src" / "models" / "Article.js").write_text("module.exports = Article", encoding="utf-8")
    (root / "backend" / "src" / "routes" / "articles.js").write_text("router.get('/articles')", encoding="utf-8")
    (root / "backend" / "src" / "controllers" / "articles.js").write_text("exports.list = () => {}", encoding="utf-8")


def _add_root_package_scripts(root: Path, scripts: dict) -> None:
    _write_json(
        root / "package.json",
        {
            "scripts": scripts,
            "workspaces": ["frontend", "backend"],
        },
    )


class ConduitRepoProfileTest(unittest.TestCase):
    def test_conduit_repo_detection_success(self):
        with tempfile.TemporaryDirectory() as repo_root:
            _make_conduit_repo(Path(repo_root))

            profile = profile_repo(repo_root)

        self.assertEqual(profile["repo_type"], "conduit")
        self.assertEqual(profile["frontend_root"], "frontend")
        self.assertEqual(profile["backend_root"], "backend")
        self.assertIn("react", profile["detected_frameworks"])
        self.assertIn("express", profile["detected_frameworks"])
        self.assertTrue(profile["conduit_checks"]["has_conduit_structure"])

    def test_generic_repo_detection(self):
        with tempfile.TemporaryDirectory() as repo_root:
            (Path(repo_root) / "package.json").write_text('{"scripts":{"test":"echo ok"}}', encoding="utf-8")

            profile = profile_repo(repo_root)

        self.assertEqual(profile["repo_type"], "generic")
        self.assertTrue(profile["exists"])
        self.assertFalse(profile["conduit_checks"]["has_conduit_structure"])

    def test_invalid_conduit_target_repo_blocks_agent(self):
        missing = str(Path(tempfile.gettempdir()) / "missing-conduit-repo-for-agent-runtime")
        dsl = {
            "requirement_id": "REQ-CONDUIT-BLOCK",
            "task_name": "Conduit article change",
            "user_story": "Update Conduit article page",
            "requirement_type": "conduit_frontend",
            "target_repo": missing,
            "skill_hint": "conduit-article",
        }

        state = run_agent("Update Conduit article page", task_id="conduit_invalid_repo_test", requirement_dsl=dsl)

        self.assertEqual(state.status, "PAUSED")
        self.assertEqual(state.artifacts["repo_profile"]["repo_type"], "invalid")
        self.assertIn("blocked_reason", state.artifacts)

    def test_conduit_profile_enters_json_result(self):
        state = AgentState(task_id="json_conduit_profile", user_input="x")
        state.status = "SUCCESS"
        state.artifacts["repo_profile"] = {
            "repo_type": "conduit",
            "conduit_checks": {"has_conduit_structure": True},
        }

        result = build_task_result(state, "state.json")

        self.assertEqual(result["repo_type"], "conduit")
        self.assertTrue(result["conduit_checks"]["has_conduit_structure"])
        self.assertEqual(result["repo_profile"]["repo_type"], "conduit")

    def test_conduit_skill_patterns_affect_locator(self):
        with tempfile.TemporaryDirectory() as repo_root:
            _make_conduit_repo(Path(repo_root))
            repo = RealRepoAdapter(repo_root)
            profile = profile_repo(repo_root)
            skill = match_skill("Conduit article page change", {"skill_hint": "conduit-article"})["skill"]
            plan = create_plan(
                "Conduit article page change",
                skill,
                requirement_dsl={"task_name": "Conduit article page change", "requirement_type": "conduit_frontend"},
                repo_profile=profile,
            )

            result = locate_files(plan, skill, repo_adapter=repo, user_input="Conduit article page", repo_profile=profile)

        self.assertTrue(result["located"])
        self.assertEqual(result["strategy"], "conduit_repo")
        paths = [item["relative_path"] for item in result["files"]]
        self.assertTrue(all(path.startswith("frontend/") for path in paths), paths)
        self.assertTrue(any(item["relative_path"] == "frontend/src/pages/Article.jsx" for item in result["files"]))
        self.assertIn("frontend/src/pages/Article.jsx", result["search_terms"])

    def test_conduit_test_command_preview_uses_available_scripts(self):
        with tempfile.TemporaryDirectory() as repo_root:
            _make_conduit_repo(Path(repo_root))
            _add_root_package_scripts(Path(repo_root), {"test": "vitest run"})
            profile = profile_repo(repo_root)
            adapter = RealTestAdapter(repo_root)

            with patch.dict(os.environ, {}, clear=True):
                result = verify_execution(
                    plan={"test_commands": []},
                    execution_result={"executed": True, "files": []},
                    test_adapter=adapter,
                    repo_profile=profile,
                )

        commands = result["verify_preview"]["commands"]
        self.assertEqual(result["mode"], "verify_preview_only")
        self.assertIn("npm run build -w frontend", commands)
        self.assertIn("npm test", commands)
        self.assertNotIn("npm run test", commands)
        self.assertNotIn("npm run lint", commands)

    def test_conduit_no_lint_script_skips_npm_run_lint(self):
        with tempfile.TemporaryDirectory() as repo_root:
            _make_conduit_repo(Path(repo_root))
            _add_root_package_scripts(Path(repo_root), {"test": "vitest run"})
            profile = profile_repo(repo_root)
            adapter = RealTestAdapter(repo_root)

            with patch.dict(os.environ, {}, clear=True):
                result = verify_execution(
                    plan={"test_commands": ["npm run lint", "npm test"]},
                    execution_result={"executed": True, "files": []},
                    test_adapter=adapter,
                    repo_profile=profile,
                )

        commands = result["verify_preview"]["commands"]
        self.assertIn("npm test", commands)
        self.assertNotIn("npm run lint", commands)
        self.assertEqual(result["skipped_commands"][0]["command"], "npm run lint")
        self.assertEqual(result["skipped_commands"][0]["reason"], "missing_package_script")

    def test_conduit_frontend_build_script_exists_selects_build(self):
        with tempfile.TemporaryDirectory() as repo_root:
            _make_conduit_repo(Path(repo_root))
            profile = profile_repo(repo_root)
            adapter = RealTestAdapter(repo_root)

            with patch.dict(os.environ, {}, clear=True):
                result = verify_execution(
                    plan={"test_commands": []},
                    execution_result={"executed": True, "files": []},
                    test_adapter=adapter,
                    repo_profile=profile,
                )

        self.assertIn("npm run build -w frontend", result["verify_preview"]["commands"])

    def test_conduit_root_test_script_exists_selects_npm_test(self):
        with tempfile.TemporaryDirectory() as repo_root:
            _make_conduit_repo(Path(repo_root))
            _add_root_package_scripts(Path(repo_root), {"test": "vitest run"})
            profile = profile_repo(repo_root)
            adapter = RealTestAdapter(repo_root)

            with patch.dict(os.environ, {}, clear=True):
                result = verify_execution(
                    plan={"test_commands": []},
                    execution_result={"executed": True, "files": []},
                    test_adapter=adapter,
                    repo_profile=profile,
                )

        self.assertIn("npm test", result["verify_preview"]["commands"])

    def test_dsl_target_repo_drives_conduit_preview_flow_without_env_repo(self):
        with tempfile.TemporaryDirectory() as repo_root:
            _make_conduit_repo(Path(repo_root))
            dsl = {
                "requirement_id": "REQ-CONDUIT-L1",
                "task_name": "Conduit article stats",
                "user_story": "Update Conduit article page",
                "requirement_type": "conduit_frontend",
                "target_repo": repo_root,
                "skill_hint": "conduit-article",
            }

            with patch.dict(os.environ, {}, clear=True):
                state = run_agent("Update Conduit article page", task_id="conduit_target_repo_flow_test", requirement_dsl=dsl)

        self.assertEqual(state.artifacts["repo_profile"]["repo_type"], "conduit")
        self.assertEqual(state.artifacts["located_files"]["strategy"], "conduit_repo")
        self.assertEqual(state.artifacts["verification_result"]["mode"], "verify_preview_only")
        self.assertIn("npm run build -w frontend", state.artifacts["verify_preview"]["commands"])


if __name__ == "__main__":
    unittest.main()
