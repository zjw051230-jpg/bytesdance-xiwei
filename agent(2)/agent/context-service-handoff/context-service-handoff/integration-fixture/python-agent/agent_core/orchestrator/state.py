import json
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from actions import get_action_names


@dataclass
class AgentState:
    task_id: str
    user_input: str
    status: str = "RUNNING"
    current_step: int = 0
    max_steps: int = 10
    run_id: Optional[str] = None
    current_node_id: Optional[str] = None
    node_history: List[Dict[str, Any]] = field(default_factory=list)
    context_snapshots: List[Dict[str, Any]] = field(default_factory=list)
    history: List[Dict[str, Any]] = field(default_factory=list)
    instructions: List[str] = field(default_factory=list)
    artifacts: Dict[str, Any] = field(default_factory=dict)
    matched_skill: Optional[Dict[str, Any]] = None
    model_trace: List[Dict[str, Any]] = field(default_factory=list)
    available_actions_history: List[Dict[str, Any]] = field(default_factory=list)
    memory_hits: List[Dict[str, Any]] = field(default_factory=list)

    def __post_init__(self):
        if not self.run_id:
            self.run_id = "run_" + self.task_id
        self.artifacts.setdefault("task_level", "L1")
        self.artifacts.setdefault("risk_level", "low")
        self.artifacts.setdefault("budget_mode", "balanced")

    def add_step(self, action: Dict[str, Any], observation: Dict[str, Any]) -> None:
        self.available_actions_history.append(
            {"step": self.current_step, "available_actions": get_action_names()}
        )
        self.history.append({"step": self.current_step, "action": action, "observation": observation})
        self.current_step += 1

    def is_finished(self) -> bool:
        if self.status in {"SUCCESS", "FAILED", "PAUSED"}:
            return True
        return self.current_step >= self.max_steps

    def add_model_trace(self, model_info: Dict[str, Any]) -> None:
        self.model_trace.append({"step": self.current_step, **model_info})

    def add_node(self, node_id: str, node_type: str, depends_on: Optional[List[str]] = None) -> None:
        self.node_history.append(
            {
                "node_id": node_id,
                "node_type": node_type,
                "step": self.current_step,
                "depends_on": depends_on or [],
            }
        )
        self.current_node_id = node_id

    def add_context_snapshot(self, agent_name: str, context: Dict[str, Any]) -> None:
        self.context_snapshots.append(
            {
                "step": self.current_step,
                "agent_name": agent_name,
                "context": context,
            }
        )

    def save(self) -> Path:
        storage_dir = Path(__file__).resolve().parents[1] / "storage" / "states"
        storage_dir.mkdir(parents=True, exist_ok=True)
        file_path = storage_dir / f"{self.task_id}.json"
        with file_path.open("w", encoding="utf-8") as f:
            json.dump(
                {
                    "task_id": self.task_id,
                    "user_input": self.user_input,
                    "status": self.status,
                    "current_step": self.current_step,
                    "max_steps": self.max_steps,
                    "run_id": self.run_id,
                    "current_node_id": self.current_node_id,
                    "node_history": self.node_history,
                    "context_snapshots": self.context_snapshots,
                    "history": self.history,
                    "instructions": self.instructions,
                    "artifacts": self.artifacts,
                    "matched_skill": self.matched_skill,
                    "model_trace": self.model_trace,
                    "available_actions_history": self.available_actions_history,
                    "memory_hits": self.memory_hits,
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
        return file_path
