import json
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


def get_control_path(task_id: str) -> str:
    storage_dir = Path(__file__).resolve().parents[1] / "storage" / "runtime"
    storage_dir.mkdir(parents=True, exist_ok=True)
    return str(storage_dir / f"{task_id}.control.json")


def read_control_signal(task_id: str) -> Optional[Dict[str, Any]]:
    path = Path(get_control_path(task_id))
    if not path.exists():
        return None

    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
        return {"type": "INVALID", "payload": {}, "reason": "Invalid control json"}
    except json.JSONDecodeError:
        return {"type": "INVALID", "payload": {}, "reason": "Invalid control json"}


def clear_control_signal(task_id: str) -> None:
    path = Path(get_control_path(task_id))
    path.write_text(json.dumps({"type": "CONSUMED"}, ensure_ascii=False, indent=2), encoding="utf-8")


def apply_control_signal(state, signal: Optional[Dict[str, Any]]) -> Tuple[bool, str]:
    if signal is None:
        return True, ""

    signal_type = signal.get("type")

    if signal_type == "PAUSE":
        state.status = "PAUSED"
        return False, "Paused by runtime control"

    if signal_type == "STOP":
        state.status = "FAILED"
        state.artifacts["last_error"] = "Stopped by runtime control"
        return False, "Stopped by runtime control"

    if signal_type == "APPEND_INSTRUCTION":
        instruction = signal.get("payload", {}).get("instruction", "")
        if isinstance(instruction, str) and instruction.strip():
            state.instructions.append(instruction)
            state.artifacts["last_runtime_instruction"] = instruction
        clear_control_signal(state.task_id)
        return True, "Instruction appended"

    if signal_type == "CONSUMED":
        return True, ""

    if signal_type == "INVALID":
        state.status = "FAILED"
        state.artifacts["last_error"] = signal.get("reason", "Invalid control json")
        return False, signal.get("reason", "Invalid control json")

    state.status = "FAILED"
    state.artifacts["last_error"] = f"Unknown control type: {signal_type}"
    return False, f"Unknown control type: {signal_type}"
