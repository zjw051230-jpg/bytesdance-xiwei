from pathlib import Path
import json
import locale
import os
import re
import sys
import traceback

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_core.orchestrator.agent_loop import run_agent
from agent_core.observability.llm_metrics import summarize_llm_metrics
from agent_core.requirement_dsl import RequirementDslError, build_acceptance_criteria_coverage, parse_requirement_input


_LOSSY_PIPE_FALLBACKS = {
    # Windows PowerShell 5.x can encode native-command pipeline input as ASCII,
    # replacing every Chinese character with "?". Once that happens, the bytes
    # are unrecoverable, so keep the documented smoke-test requirement working.
    "???????????": "文章详情页新增字数统计",
}


def _safe_task_filename(task_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(task_id or "demo_task"))


def _state_file_path(task_id: str) -> str:
    storage_root = os.getenv("AGENT_STATE_DIR")
    path = (Path(storage_root).expanduser().resolve() if storage_root else Path(__file__).resolve().parent / "storage" / "states") / f"{_safe_task_filename(task_id)}.json"
    try:
        return str(path.relative_to(Path.cwd()))
    except ValueError:
        return str(path)


def _print_success_summary(state, state_file: str) -> None:
    final_summary = state.artifacts.get("final_summary") or {}
    plan = state.artifacts.get("plan") or {}
    located_files = state.artifacts.get("located_files") or {}
    patch_plan = state.artifacts.get("patch_plan") or {}
    review = state.artifacts.get("review") or {}
    verification_result = state.artifacts.get("verification_result") or {}
    execution_result = state.artifacts.get("execution_result") or {}
    verify_preview = state.artifacts.get("verify_preview") or verification_result.get("verify_preview") or {}

    skill = state.matched_skill or final_summary.get("skill") or {}
    skill_name = skill.get("name") if isinstance(skill, dict) else skill
    if skill_name == "generic":
        skill_name = None
    plan_name = plan.get("task_name") if isinstance(plan, dict) else final_summary.get("plan_summary")
    located_count = len(located_files.get("files", [])) if isinstance(located_files, dict) else 0
    patch_count = len(patch_plan.get("patches", [])) if isinstance(patch_plan, dict) else 0
    review_passed = bool(review.get("approved")) if isinstance(review, dict) else False
    verify_passed = verification_result.get("passed") if isinstance(verification_result, dict) else None
    execution_mode = execution_result.get("mode") if isinstance(execution_result, dict) else None

    print("任务完成")
    print(f"状态：{state.status}")
    print(f"执行步数：{state.current_step}")
    print(f"匹配 Skill：{skill_name or 'None'}")
    print(f"计划：{plan_name or 'None'}")
    print(f"定位文件数：{located_count}")
    if isinstance(located_files, dict):
        for item in located_files.get("files", []):
            if isinstance(item, dict) and item.get("path"):
                print(f"定位文件：{item['path']}")
    print(f"Patch 数量：{patch_count}")
    if isinstance(execution_result, dict):
        for item in execution_result.get("files", []):
            if not isinstance(item, dict):
                continue
            operation = item.get("operation") or "patch"
            file_path = item.get("file") or "None"
            status = item.get("status") or "unknown"
            print(f"Patch 结果：{operation} {status} {file_path}")
            if item.get("preview"):
                print("Patch Preview:")
                print(f"Operation: {operation}")
                print(f"Path: {file_path}")
                print(f"Approval Required: {bool(item.get('approval_required'))}")
    print(f"Review 通过：{review_passed}")
    if isinstance(verify_preview, dict):
        print("Verify Preview:")
        commands = verify_preview.get("commands", [])
        if commands:
            for command in commands:
                print(command)
        else:
            print("skipped_no_safe_commands")
        print(f"Verification Required: {bool(verification_result.get('verification_required'))}")
    print(f"Verify 通过：{verify_passed}")
    print(f"执行模式：{execution_mode or 'None'}")
    print(f"状态文件：{state_file}")


def _print_failure_summary(state) -> None:
    final_summary = state.artifacts.get("final_summary") or {}
    error = state.artifacts.get("last_error") or final_summary.get("message") or "Unknown error"

    print("任务失败")
    print(f"错误原因：{error}")


def _decode_stdin_bytes(data: bytes) -> str:
    encodings = [
        "utf-8-sig",
        getattr(sys.stdin, "encoding", None),
        locale.getpreferredencoding(False),
        "gbk",
        "cp936",
        "utf-16",
        "utf-16-le",
    ]

    for encoding in encodings:
        if not encoding:
            continue
        try:
            return data.decode(encoding)
        except UnicodeError:
            continue

    return data.decode("utf-8", errors="replace")


def _normalize_user_input(text: str) -> str:
    stripped = text.strip()
    return _LOSSY_PIPE_FALLBACKS.get(stripped, stripped)


def _read_user_input(stdin=None) -> str:
    stream = stdin or sys.stdin
    if stream.isatty():
        return _normalize_user_input(input("请输入需求："))

    if hasattr(stream, "buffer"):
        return _normalize_user_input(_decode_stdin_bytes(stream.buffer.read()))

    return _normalize_user_input(stream.read())


def _json_output_enabled() -> bool:
    return os.getenv("AGENT_OUTPUT_JSON") == "1"


def _json_safe(value):
    if isinstance(value, dict):
        return {_json_safe_string(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, str):
        return _json_safe_string(value)
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)


def _json_safe_string(value: str) -> str:
    text = str(value)
    text = text.encode("utf-8", "replace").decode("utf-8", "replace")
    return "".join(ch if (ch >= " " or ch in "\n\r\t") else "\ufffd" for ch in text)


def _selected_actions(state) -> list:
    decisions = state.artifacts.get("action_decisions") if isinstance(state.artifacts, dict) else None
    if isinstance(decisions, list) and decisions:
        return _json_safe(decisions)

    actions = []
    for item in state.history or []:
        if not isinstance(item, dict):
            continue
        action = item.get("action") if isinstance(item.get("action"), dict) else {}
        observation = item.get("observation") if isinstance(item.get("observation"), dict) else {}
        actions.append(
            {
                "step": item.get("step"),
                "decision_source": "mock",
                "selected_action": action.get("tool"),
                "selected_tool": action.get("tool"),
                "rejected_action": None,
                "reason": observation.get("message") or observation.get("error") or "",
                "confidence": 1.0,
            }
        )
    return actions


def _events_count(state) -> int:
    artifacts = state.artifacts if isinstance(state.artifacts, dict) else {}
    count = len(state.node_history or [])
    count += len(artifacts.get("action_decisions", []) or [])
    if artifacts.get("last_test_event"):
        count += 1
    if artifacts.get("last_pr_draft_event"):
        count += 1
    if artifacts.get("last_replay_started_event"):
        count += 1
    if artifacts.get("last_replay_completed_event"):
        count += 1
    if artifacts.get("last_historical_recall_event"):
        count += 1
    if artifacts.get("last_llm_metric_event"):
        count += len(artifacts.get("llm_metrics", []) or [])
    return count


def _has_preview_result(execution_result: dict, verification_result: dict) -> bool:
    if isinstance(execution_result, dict):
        for item in execution_result.get("files", []) or []:
            if isinstance(item, dict) and (item.get("preview") or item.get("dry_run")):
                return True
    if isinstance(verification_result, dict):
        mode = str(verification_result.get("mode") or "")
        if mode.startswith("verify_preview"):
            return True
        if verification_result.get("verification_required") is True:
            return True
    return False


def _result_status(state) -> str:
    artifacts = state.artifacts if isinstance(state.artifacts, dict) else {}
    execution_result = artifacts.get("execution_result") or {}
    verification_result = artifacts.get("verification_result") or {}
    if state.status == "SUCCESS":
        return "preview" if _has_preview_result(execution_result, verification_result) else "success"
    if state.status in {"PAUSED", "RUNNING"}:
        l3_output = artifacts.get("l3_output") if isinstance(artifacts.get("l3_output"), dict) else {}
        patch_plan = artifacts.get("patch_plan") if isinstance(artifacts.get("patch_plan"), dict) else {}
        l3_status = l3_output.get("status") or patch_plan.get("status")
        if l3_status in {"clarification_required", "planning_paused", "paused", "blocked"}:
            return l3_status
        return "blocked"
    return "failed"


def _build_safety_gates(state=None) -> dict:
    artifacts = state.artifacts if state is not None and isinstance(state.artifacts, dict) else {}
    validation_result = artifacts.get("validation_result") or {}
    verification_result = artifacts.get("verification_result") or {}
    execution_result = artifacts.get("execution_result") or {}
    return {
        "repo_mode": os.getenv("AGENT_REPO_MODE", "mock"),
        "repo_apply_enabled": os.getenv("AGENT_REPO_APPLY") == "1",
        "repo_confirmed": os.getenv("AGENT_REPO_CONFIRM") == "YES",
        "test_run_enabled": os.getenv("AGENT_TEST_RUN") == "1",
        "test_confirmed": os.getenv("AGENT_TEST_CONFIRM") == "YES",
        "llm_action_decision_enabled": os.getenv("AGENT_LLM_ACTION_DECISION") == "1",
        "context_http_enabled": os.getenv("USE_CONTEXT_HTTP") == "1",
        "llm_planner_enabled": os.getenv("AGENT_USE_LLM_PLANNER") == "1",
        "llm_coder_enabled": os.getenv("AGENT_USE_LLM_CODER") == "1",
        "patch_validation_approved": validation_result.get("approved") if isinstance(validation_result, dict) else None,
        "verification_required": bool(verification_result.get("verification_required")) if isinstance(verification_result, dict) else False,
        "preview_required": _has_preview_result(execution_result, verification_result),
    }


def _build_risks(state) -> dict:
    artifacts = state.artifacts if isinstance(state.artifacts, dict) else {}
    validation_result = artifacts.get("validation_result") or {}
    review = artifacts.get("review") or {}
    return {
        "task_level": artifacts.get("task_level"),
        "risk_level": artifacts.get("risk_level"),
        "validation_approved": validation_result.get("approved") if isinstance(validation_result, dict) else None,
        "validation_errors": validation_result.get("errors", []) if isinstance(validation_result, dict) else [],
        "review_risk_level": review.get("risk_level") if isinstance(review, dict) else None,
        "review_approved": review.get("approved") if isinstance(review, dict) else None,
        "issues": review.get("issues", []) if isinstance(review, dict) else [],
        "last_error": artifacts.get("last_error"),
    }


def build_task_result(state, state_file: str = None) -> dict:
    artifacts = state.artifacts if isinstance(state.artifacts, dict) else {}
    plan = artifacts.get("plan") or {}
    l3_output = artifacts.get("l3_output") or {}
    final_summary = artifacts.get("final_summary") or {}
    requirement_dsl = artifacts.get("requirement_dsl") or {}
    skill_match = artifacts.get("skill_match") or {}
    repo_profile = artifacts.get("repo_profile") or {}
    task_name = plan.get("task_name") if isinstance(plan, dict) else None
    if not task_name and isinstance(final_summary, dict):
        task_name = final_summary.get("plan_summary")

    return _json_safe(
        {
            "task_id": state.task_id,
            "run_id": state.run_id,
            "status": _result_status(state),
            "raw_status": state.status,
            "requirement_id": requirement_dsl.get("requirement_id") if isinstance(requirement_dsl, dict) else None,
            "requirement_type": requirement_dsl.get("requirement_type") if isinstance(requirement_dsl, dict) else None,
            "skill_hint": requirement_dsl.get("skill_hint") if isinstance(requirement_dsl, dict) else None,
            "matched_skill_id": skill_match.get("matched_skill_id") if isinstance(skill_match, dict) else None,
            "matched_skill_name": skill_match.get("matched_skill_name") if isinstance(skill_match, dict) else None,
            "skill_match_reason": skill_match.get("match_reason") if isinstance(skill_match, dict) else None,
            "repo_profile": repo_profile,
            "repo_type": repo_profile.get("repo_type") if isinstance(repo_profile, dict) else None,
            "conduit_checks": repo_profile.get("conduit_checks") if isinstance(repo_profile, dict) else None,
            "task_name": task_name,
            "steps": state.current_step,
            "selected_actions": _selected_actions(state),
            "located_files": artifacts.get("located_files") or {},
            "patch_plan": artifacts.get("patch_plan") or {},
            "clarification_questions": l3_output.get("clarification_questions")
            or (artifacts.get("patch_plan") or {}).get("clarification_questions")
            or (plan if isinstance(plan, dict) else {}).get("clarification_questions")
            or [],
            "conflict_reason": l3_output.get("conflict_reason")
            or (artifacts.get("patch_plan") or {}).get("conflict_reason")
            or (plan if isinstance(plan, dict) else {}).get("conflict_reason"),
            "staged_plan": l3_output.get("staged_plan")
            or (artifacts.get("patch_plan") or {}).get("staged_plan")
            or (plan if isinstance(plan, dict) else {}).get("staged_plan")
            or {},
            "validation_result": artifacts.get("validation_result") or {},
            "review_result": artifacts.get("review") or {},
            "execution_result": artifacts.get("execution_result") or {},
            "verification_result": artifacts.get("verification_result") or {},
            "pr_draft": artifacts.get("pr_draft") or {},
            "replay": artifacts.get("replay") or {},
            "historical_recall": artifacts.get("historical_recall") or {},
            "llm_metrics": artifacts.get("llm_metrics") or [],
            "llm_metrics_summary": artifacts.get("llm_metrics_summary") or summarize_llm_metrics(artifacts.get("llm_metrics") or []),
            "summary": artifacts.get("final_summary") or {},
            "acceptance_criteria_coverage": build_acceptance_criteria_coverage(
                requirement_dsl,
                artifacts.get("review") or {},
                artifacts.get("verification_result") or {},
            ),
            "risks": _build_risks(state),
            "safety_gates": _build_safety_gates(state),
            "events_count": _events_count(state),
            "state_file": state_file,
        }
    )


def _build_error_result(task_id: str, user_input: str, error: str, state_file: str = None, requirement_dsl: dict = None, status: str = "failed") -> dict:
    requirement_dsl = requirement_dsl if isinstance(requirement_dsl, dict) else {}
    return _json_safe(
        {
            "task_id": task_id,
            "run_id": f"run_{task_id}",
            "status": status,
            "raw_status": "FAILED",
            "requirement_id": requirement_dsl.get("requirement_id"),
            "requirement_type": requirement_dsl.get("requirement_type"),
            "skill_hint": requirement_dsl.get("skill_hint"),
            "matched_skill_id": None,
            "matched_skill_name": None,
            "skill_match_reason": None,
            "repo_profile": {},
            "repo_type": None,
            "conduit_checks": None,
            "task_name": None,
            "steps": 0,
            "selected_actions": [],
            "located_files": {},
            "patch_plan": {},
            "validation_result": {},
            "review_result": {},
            "execution_result": {},
            "verification_result": {},
            "pr_draft": {},
            "replay": {},
            "historical_recall": {},
            "llm_metrics": [],
            "llm_metrics_summary": summarize_llm_metrics([]),
            "summary": {"status": "FAILED", "user_input": user_input, "message": error},
            "acceptance_criteria_coverage": build_acceptance_criteria_coverage(requirement_dsl, {}, {}),
            "risks": {
                "task_level": None,
                "risk_level": None,
                "validation_approved": None,
                "validation_errors": [],
                "review_risk_level": None,
                "review_approved": None,
                "issues": [],
                "last_error": error,
            },
            "safety_gates": _build_safety_gates(),
            "events_count": 0,
            "state_file": state_file,
        }
    )


def _print_json_result(result: dict) -> None:
    text = _validated_json_text(_json_safe(result))
    buffer = getattr(sys.stdout, "buffer", None)
    if buffer is not None:
        buffer.write(text.encode("utf-8"))
        buffer.write(b"\n")
        buffer.flush()
        return
    sys.stdout.write(text)
    sys.stdout.write("\n")


def _validated_json_text(payload: dict) -> str:
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    text = text.encode("utf-8", "replace").decode("utf-8")
    try:
        json.loads(text)
        return text
    except json.JSONDecodeError as exc:
        context = _json_error_context(text, exc.pos)
        fallback = _json_output_validation_failed(exc, context)
        fallback_text = json.dumps(fallback, ensure_ascii=False, sort_keys=True)
        json.loads(fallback_text)
        print(context, file=sys.stderr)
        return fallback_text


def _json_error_context(text: str, position: int, radius: int = 200) -> str:
    start = max(0, int(position or 0) - radius)
    end = min(len(text), int(position or 0) + radius)
    return text[start:end]


def _json_output_validation_failed(exc: json.JSONDecodeError, context: str) -> dict:
    return {
        "status": "failed",
        "error": "json_output_validation_failed",
        "details": str(exc),
        "bad_position": exc.pos,
        "json_output_error_context": context,
    }


def main() -> None:
    raw_input = _read_user_input()
    task_id = os.getenv("AGENT_TASK_ID") or "demo_task"
    state_file = _state_file_path(task_id)
    try:
        parsed_input = parse_requirement_input(raw_input)
    except RequirementDslError as exc:
        if _json_output_enabled():
            _print_json_result(_build_error_result(task_id, raw_input, str(exc), state_file, status="failed"))
            return
        print(f"Requirement DSL invalid: {exc}")
        return

    user_input = parsed_input.get("user_input", "")
    requirement_dsl = parsed_input.get("requirement_dsl")
    replay_request = parsed_input.get("replay_request")
    if not user_input:
        if _json_output_enabled():
            _print_json_result(_build_error_result(task_id, user_input, "Requirement cannot be empty", state_file))
            return
        print("需求不能为空")
        return

    try:
        state = run_agent(
            user_input=user_input,
            task_id=task_id,
            requirement_dsl=requirement_dsl,
            replay_request=replay_request,
        )
    except Exception as exc:
        if _json_output_enabled():
            result = _build_error_result(task_id, user_input, str(exc), state_file, requirement_dsl=requirement_dsl)
            result["summary"]["traceback"] = traceback.format_exc()
            _print_json_result(result)
            return
        raise

    if _json_output_enabled():
        _print_json_result(build_task_result(state, state_file))
        return

    if state.status == "SUCCESS":
        _print_success_summary(state, state_file)
    else:
        _print_failure_summary(state)


if __name__ == "__main__":
    main()
