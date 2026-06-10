import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from orchestrator.state import AgentState


class StatePathTest(unittest.TestCase):
    def test_state_save_uses_module_relative_storage_dir(self):
        original_cwd = Path.cwd()
        agent_core_dir = Path(__file__).resolve().parents[1] / "agent_core"

        try:
            os.chdir(agent_core_dir)
            state = AgentState(task_id="path_regression_test", user_input="demo")
            file_path = state.save()

            self.assertTrue(file_path.is_absolute())
            self.assertTrue(file_path.parent == (agent_core_dir / "storage" / "states"))
            file_path.unlink()
        finally:
            os.chdir(original_cwd)


if __name__ == "__main__":
    unittest.main()
