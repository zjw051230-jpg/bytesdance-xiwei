import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


class PackageEntrypointTest(unittest.TestCase):
    def test_python_module_entrypoint_runs_without_module_not_found(self):
        repo_root = Path(__file__).resolve().parents[1]
        env = os.environ.copy()
        env["AGENT_OUTPUT_JSON"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"

        completed = subprocess.run(
            [sys.executable, "-m", "agent_core.main"],
            input="Create note.txt with content 100",
            cwd=str(repo_root),
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )

        combined_output = f"{completed.stdout}\n{completed.stderr}"
        self.assertNotIn("ModuleNotFoundError", combined_output)
        self.assertEqual(completed.returncode, 0, combined_output)

        result = json.loads(completed.stdout)
        self.assertIn(result["status"], {"preview", "success"})
        self.assertEqual(result["task_id"], "demo_task")


if __name__ == "__main__":
    unittest.main()
