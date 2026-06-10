import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .state import AgentState


REPLAY_STAGES = [
    "select_skill",
    "make_plan",
    "locate_files",
    "generate_patch",
    "validate_patch",
    "review_patch",
    "execute_patch",
    "verify_result",
    "finish",
]

STAGE_ARTIFACTS = {
    "select_skill": ["matched_skill", "skill_match"],
    "make_plan": ["plan"],
    "locate_files": ["located_files"],
    "generate_patch": ["patch_plan"],
    "validate_patch": ["validation_result"],
    "review_patch": ["review"],
    "execute_patch": ["execution_result", "preview_result"],
    "verify_result": ["verification_result", "verify_preview", "last_test_event"],
    "finish": ["final_summary", "pr_draft", "last_pr_draft_event"],
}

OVERRIDE_ALIASES = {
    "review_result": "review",
}


def storage_states_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "storage" / "states"


def load_state_file(path: Path) -> Optional[Dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def find_parent_state(requirement_id: str = "", task_id: str = "") -> Optional[Dict[str, Any]]:
    states_dir = storage_states_dir()
    if task_id:
        direct = states_dir / f"{task_id}.json"
        data = load_state_file(direct)
        if data:
            return data

    if not requirement_id or not states_dir.exists():
        return None

    for path in sorted(states_dir.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        data = load_state_file(path)
        if not data:
            continue
        artifacts = data.get("artifacts") if isinstance(data.get("artifacts"), dict) else {}
        dsl = artifacts.get("requirement_dsl") if isinstance(artifacts.get("requirement_dsl"), dict) else {}
        if artifacts.get("requirement_id") == requirement_id or dsl.get("requirement_id") == requirement_id:
            return data
    return None


def state_from_snapshot(snapshot: Dict[str, Any], fallback_user_input: str = "") -> AgentState:
    artifacts = snapshot.get("artifacts") if isinstance(snapshot.get("artifacts"), dict) else {}
    state = AgentState(
        task_id=snapshot.get("task_id") or "demo_task",
        user_input=snapshot.get("user_input") or fallback_user_input,
        status="RUNNING",
        current_step=int(snapshot.get("current_step") or 0),
        max_steps=max(int(snapshot.get("max_steps") or 11), 11),
        run_id=snapshot.get("run_id"),
        current_node_id=snapshot.get("current_node_id"),
        node_history=list(snapshot.get("node_history") or []),
        context_snapshots=list(snapshot.get("context_snapshots") or []),
        history=list(snapshot.get("history") or []),
        instructions=list(snapshot.get("instructions") or []),
        artifacts=dict(artifacts),
        matched_skill=snapshot.get("matched_skill"),
        model_trace=list(snapshot.get("model_trace") or []),
        available_actions_history=list(snapshot.get("available_actions_history") or []),
        memory_hits=list(snapshot.get("memory_hits") or []),
    )
    return state


def normalize_overrides(overrides: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if overrides is None:
        return {}, None
    if not isinstance(overrides, dict):
        return None, "replay overrides must be an object"

    normalized = {}
    for key, value in overrides.items():
        target_key = OVERRIDE_ALIASES.get(str(key), str(key))
        if target_key == "located_files" and isinstance(value, list):
            value = {"located": True, "files": value, "strategy": "replay_override"}
        if target_key in {"plan", "located_files", "patch_plan", "validation_result", "review", "execution_result", "verification_result"}:
            if not isinstance(value, dict):
                return None, f"override {key} must be an object"
        normalized[target_key] = value
    return normalized, None


def validate_replay_request(request: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if not isinstance(request, dict):
        return None, "Replay request must be a JSON object"
    if request.get("mode") != "replay":
        return None, "Replay request mode must be replay"
    from_stage = request.get("from_stage")
    if from_stage not in REPLAY_STAGES:
        return None, f"Illegal replay from_stage: {from_stage}"
    overrides, error = normalize_overrides(request.get("overrides") or {})
    if error:
        return None, error
    normalized = dict(request)
    normalized["from_stage"] = from_stage
    normalized["overrides"] = overrides
    return normalized, None


def prune_replayed_artifacts(artifacts: Dict[str, Any], from_stage: str) -> None:
    start = REPLAY_STAGES.index(from_stage)
    for stage in REPLAY_STAGES[start:]:
        for key in STAGE_ARTIFACTS.get(stage, []):
            artifacts.pop(key, None)


def apply_replay_overrides(state: AgentState, overrides: Dict[str, Any]) -> None:
    for key, value in overrides.items():
        state.artifacts[key] = value
    if isinstance(state.artifacts.get("matched_skill"), dict):
        state.matched_skill = state.artifacts["matched_skill"]


def replay_metadata(request: Dict[str, Any]) -> Dict[str, Any]:
    requirement_id = request.get("requirement_id")
    replay_id = request.get("replay_id") or f"replay_{requirement_id or 'adhoc'}_{request.get('from_stage')}"
    overrides = request.get("overrides") if isinstance(request.get("overrides"), dict) else {}
    return {
        "replay_id": replay_id,
        "replay_from_stage": request.get("from_stage"),
        "replay_overrides_keys": sorted(str(key) for key in overrides.keys()),
        "replay_parent_requirement_id": requirement_id,
    }
