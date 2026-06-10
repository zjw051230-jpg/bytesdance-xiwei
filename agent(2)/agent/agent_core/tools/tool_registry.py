import os
from typing import Any, Dict

from agent_core.agents.coder_agent import generate_patch_plan
from agent_core.agents.executor_agent import execute_patch_plan
from agent_core.agents.locator_agent import locate_files as locate_files_impl
from agent_core.agents.planner_agent import create_plan
from agent_core.agents.pr_draft_agent import generate_pr_draft
from agent_core.agents.reviewer_agent import review_patch_plan
from agent_core.agents.validator_agent import validate_patch
from agent_core.agents.verifier_agent import verify_execution
from agent_core.interfaces.event_adapter import get_default_event_adapter
from agent_core.interfaces.memory_adapter import get_default_memory_adapter
from agent_core.interfaces.repo_adapter import RealRepoAdapter, get_default_repo_adapter
from agent_core.interfaces.test_adapter import RealTestAdapter, get_default_test_adapter
from agent_core.memory.historical_recall import recall_historical_cases
from agent_core.observability.llm_metrics import record_llm_metric
from agent_core.skills.registry import match_skill


EVENT_TYPES = {
    "select_skill": "SKILL_MATCHED",
    "make_plan": "PLAN_CREATED",
    "locate_files": "FILES_LOCATED",
    "generate_patch": "PATCH_GENERATED",
    "validate_patch": "PATCH_VALIDATED",
    "review_patch": "REVIEW_COMPLETED",
    "execute_patch": "EXECUTION_COMPLETED",
    "verify_result": "VERIFICATION_COMPLETED",
    "create_pr_draft": "PR_DRAFT_CREATED",
    "historical_recall": "HISTORICAL_RECALL_COMPLETED",
    "finish": "TASK_FINISHED",
}

EVENT_PRODUCERS = {
    "select_skill": "plannerAgent",
    "make_plan": "planAgent",
    "locate_files": "locatorAgent",
    "generate_patch": "codegenAgent",
    "validate_patch": "validatorAgent",
    "review_patch": "deliveryAgent",
    "execute_patch": "repairAgent",
    "verify_result": "deliveryAgent",
    "create_pr_draft": "summaryAgent",
    "historical_recall": "memoryAgent",
    "finish": "deliveryAgent",
}

NODE_PREFIXES = {
    "select_skill": ("skill", "skill"),
    "make_plan": ("plan", "plan"),
    "locate_files": ("locate", "locate"),
    "generate_patch": ("patch", "patch"),
    "validate_patch": ("validate", "validate"),
    "review_patch": ("review", "review"),
    "execute_patch": ("sandbox", "sandbox"),
    "verify_result": ("verify", "verify"),
    "create_pr_draft": ("summary", "summary"),
    "historical_recall": ("memory", "memory"),
    "finish": ("finish", "finish"),
}


def _append_domain_event(state, tool_name: str, payload: Dict[str, Any]) -> None:
    event_type = EVENT_TYPES.get(tool_name)
    producer = EVENT_PRODUCERS.get(tool_name)
    node_config = NODE_PREFIXES.get(tool_name)
    if not event_type or not producer or not node_config:
        return

    old_node_id = state.current_node_id
    node_prefix, node_type = node_config
    node_id = f"{node_prefix}_{state.current_step}"
    event_adapter = get_default_event_adapter()
    event = {
        "type": event_type,
        "category": "domain_event",
        "producer": producer,
        "trace_id": state.task_id,
        "span_id": node_id,
        "parent_span_id": old_node_id,
        "run_id": state.run_id,
        "payload": payload,
        "idempotency_key": f"{event_type}:{state.task_id}:{state.current_step}",
    }
    expected_seq = event_adapter.get_latest_event_seq(state.task_id)
    appended_event = event_adapter.append_event(state.task_id, event, expected_seq=expected_seq)
    state.artifacts["last_event"] = appended_event
    state.add_node(node_id, node_type, [old_node_id] if old_node_id else [])


def _requirement_dsl(state) -> Dict[str, Any]:
    dsl = state.artifacts.get("requirement_dsl") if isinstance(state.artifacts, dict) else None
    return dsl if isinstance(dsl, dict) else {}


def _requirement_id(state):
    return _requirement_dsl(state).get("requirement_id")


def _attach_requirement_id(state, payload):
    requirement_id = _requirement_id(state)
    if requirement_id and isinstance(payload, dict):
        payload.setdefault("requirement_id", requirement_id)
    return payload


def _repo_path_from_profile(state) -> str:
    dsl = _requirement_dsl(state)
    profile = state.artifacts.get("repo_profile") if isinstance(state.artifacts, dict) else None
    if not dsl.get("target_repo") or not isinstance(profile, dict):
        return ""
    if profile.get("repo_type") == "invalid":
        return ""
    return str(profile.get("repo_path") or "")


def _repo_adapter_for_state(state):
    repo_path = _repo_path_from_profile(state)
    if repo_path:
        return RealRepoAdapter(repo_path)
    return get_default_repo_adapter()


def _test_adapter_for_state(state):
    repo_path = _repo_path_from_profile(state)
    if repo_path:
        repo_type = (state.artifacts.get("repo_profile") or {}).get("repo_type")
        reason = "Conduit repository verification preview" if repo_type == "conduit" else "real repository verification preview"
        return RealTestAdapter(working_directory=repo_path, reason=reason)
    return get_default_test_adapter()


def _record_result_llm_metrics(state, payload: Dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        return
    metrics = payload.pop("llm_metrics", []) if isinstance(payload.get("llm_metrics"), list) else []
    if not metrics:
        return
    memory = get_default_memory_adapter()
    event_adapter = get_default_event_adapter()
    for metric in metrics:
        record_llm_metric(state, metric, memory_adapter=memory, event_adapter=event_adapter)


def _pause_for_non_executable_l3(state, patch_plan: Dict[str, Any]) -> None:
    if not isinstance(patch_plan, dict):
        return
    metadata = patch_plan.get("metadata") if isinstance(patch_plan.get("metadata"), dict) else {}
    if metadata.get("stop_before_execute") is not True:
        return
    status = metadata.get("workflow_status") or patch_plan.get("status") or "clarification_required"
    reason = patch_plan.get("conflict_reason") or patch_plan.get("summary") or "L3 requirement requires clarification before execution."
    state.status = "PAUSED"
    state.artifacts["blocked_reason"] = reason
    state.artifacts["last_error"] = reason
    state.artifacts["l3_output"] = {
        "status": status,
        "clarification_questions": patch_plan.get("clarification_questions", []),
        "conflict_reason": patch_plan.get("conflict_reason"),
        "staged_plan": patch_plan.get("staged_plan"),
        "possible_interpretations": patch_plan.get("possible_interpretations", []),
        "feasible_alternatives": patch_plan.get("feasible_alternatives", []),
    }


def _record_skill_match(state, matched: Dict[str, Any]) -> None:
    skill = matched.get("skill") if isinstance(matched, dict) else None
    payload = {
        "task_id": state.task_id,
        "requirement_id": _requirement_id(state),
        "matched": bool(matched.get("matched")) if isinstance(matched, dict) else False,
        "matched_skill": skill,
        "matched_skill_id": skill.get("id") if isinstance(skill, dict) else None,
        "matched_skill_name": skill.get("name") if isinstance(skill, dict) else None,
        "score": matched.get("score") if isinstance(matched, dict) else 0,
        "match_reason": matched.get("match_reason") if isinstance(matched, dict) else None,
    }
    state.artifacts["matched_skill"] = skill
    state.artifacts["skill_match"] = payload
    state.add_context_snapshot(
        "plannerAgent",
        {
            "task_id": state.task_id,
            "agent_name": "plannerAgent",
            "current_node_id": state.current_node_id,
            "skill_match": payload,
        },
    )
    memory = get_default_memory_adapter()
    memory.save_event({
        "stage": "select_skill",
        "action": "match_skill",
        "timestamp": "runtime",
        "payload": payload,
    })
    _append_domain_event(state, "select_skill", {"skill_match": payload})


def _ensure_matched_skill(state) -> Dict[str, Any]:
    if isinstance(state.matched_skill, dict):
        return state.matched_skill

    dsl = _requirement_dsl(state)
    matched = match_skill(state.user_input, requirement_dsl=dsl or None)
    state.matched_skill = matched.get("skill") if isinstance(matched, dict) else None
    _record_skill_match(state, matched)
    if "historical_recall" not in state.artifacts:
        _run_historical_recall(state)
    return state.matched_skill if isinstance(state.matched_skill, dict) else {}


def _run_historical_recall(state) -> Dict[str, Any]:
    memory = get_default_memory_adapter()
    event_adapter = get_default_event_adapter()
    recall = recall_historical_cases(
        requirement_dsl=_requirement_dsl(state) or None,
        matched_skill=state.matched_skill,
        memory_adapter=memory,
        event_adapter=event_adapter,
        task_id=state.task_id,
    )
    _attach_requirement_id(state, recall)
    state.artifacts["historical_recall"] = recall
    memory.save_event(
        {
            "stage": "historical_recall",
            "action": "recall_similar_cases",
            "timestamp": "runtime",
            "payload": {
                "task_id": state.task_id,
                "requirement_id": _requirement_id(state),
                "similarity_score": recall.get("similarity_score"),
                "matched_fields": recall.get("matched_fields", []),
                "recalled_count": len(recall.get("recalled_cases", []) or []),
            },
        }
    )
    state.add_context_snapshot(
        "memoryAgent",
        {
            "task_id": state.task_id,
            "agent_name": "memoryAgent",
            "current_node_id": state.current_node_id,
            "historical_recall": recall,
        },
    )
    previous_last_event = state.artifacts.get("last_event")
    _append_domain_event(state, "historical_recall", {"historical_recall": recall})
    if isinstance(state.artifacts.get("last_event"), dict):
        state.artifacts["last_historical_recall_event"] = state.artifacts["last_event"]
    if previous_last_event is not None:
        state.artifacts["last_event"] = previous_last_event
    return recall


def _append_test_executed_event(state, verification_result: Dict[str, Any]) -> None:
    test_result = verification_result.get("test_result") if isinstance(verification_result, dict) else None
    if not isinstance(test_result, dict) or test_result.get("executed") is not True:
        return

    event_adapter = get_default_event_adapter()
    event = {
        "type": "TEST_EXECUTED",
        "category": "domain_event",
        "producer": "verifierAgent",
        "trace_id": state.task_id,
        "span_id": f"test_{state.current_step}",
        "parent_span_id": state.current_node_id,
        "run_id": state.run_id,
        "payload": {
            "verification_result": verification_result,
            "test_result": test_result,
        },
        "idempotency_key": f"TEST_EXECUTED:{state.task_id}:{state.current_step}",
    }
    expected_seq = event_adapter.get_latest_event_seq(state.task_id)
    appended_event = event_adapter.append_event(state.task_id, event, expected_seq=expected_seq)
    state.artifacts["last_test_event"] = appended_event
    memory = get_default_memory_adapter()
    memory.save_event({
        "stage": "verify_result",
        "action": "test_executed",
        "timestamp": "runtime",
        "payload": {
            "task_id": state.task_id,
            "passed": test_result.get("passed"),
            "mode": test_result.get("mode"),
            "commands": test_result.get("commands", []),
            "rejected_commands": test_result.get("rejected_commands", []),
        },
    })
    state.add_context_snapshot(
        "verifierAgent",
        {
            "task_id": state.task_id,
            "agent_name": "verifierAgent",
            "current_node_id": state.current_node_id,
            "test_result": test_result,
        },
    )


def _create_pr_draft_artifact(state, status: str = None) -> Dict[str, Any]:
    pr_draft = generate_pr_draft(
        state_status=status or state.status,
        user_input=state.user_input,
        artifacts=state.artifacts,
        matched_skill=state.matched_skill,
    )
    _attach_requirement_id(state, pr_draft)
    state.artifacts["pr_draft"] = pr_draft
    memory = get_default_memory_adapter()
    memory.save_event(
        {
            "stage": "create_pr_draft",
            "action": "generate_pr_draft",
            "timestamp": "runtime",
            "payload": {
                "task_id": state.task_id,
                "requirement_id": _requirement_id(state),
                "status": pr_draft.get("status"),
                "title": pr_draft.get("title"),
                "changed_files": pr_draft.get("changed_files", []),
            },
        }
    )
    state.add_context_snapshot(
        "summaryAgent",
        {
            "task_id": state.task_id,
            "agent_name": "summaryAgent",
            "current_node_id": state.current_node_id,
            "pr_draft": pr_draft,
        },
    )
    _append_domain_event(state, "create_pr_draft", {"pr_draft": pr_draft})
    if isinstance(state.artifacts.get("last_event"), dict):
        state.artifacts["last_pr_draft_event"] = state.artifacts["last_event"]
    return pr_draft


def execute(action: Dict[str, Any], state) -> Dict[str, Any]:
    tool_name = action.get("tool")

    if os.getenv("AGENT_TEST_TOOL_FAIL") == "1" and tool_name == "make_plan":
        return {"ok": False, "error": "Simulated tool failure"}

    if tool_name == "analyze_requirement":
        return {"ok": True, "result": f"理解需求：{state.user_input}，需要做文章详情页的字数统计能力。"}

    if tool_name == "select_skill":
        dsl = _requirement_dsl(state)
        matched = match_skill(state.user_input, requirement_dsl=dsl or None)
        state.matched_skill = matched.get("skill")
        _record_skill_match(state, matched)
        recall = _run_historical_recall(state)
        return {"ok": True, "result": {"matched_skill": matched, "historical_recall": recall}}

    if tool_name == "make_plan":
        if not isinstance(state.matched_skill, dict):
            _ensure_matched_skill(state)
        plan = create_plan(
            user_input=state.user_input,
            matched_skill=action.get("args", {}).get("matched_skill") or state.matched_skill,
            runtime_instructions=action.get("args", {}).get("runtime_instructions") or state.instructions,
            requirement_dsl=_requirement_dsl(state) or None,
            repo_profile=state.artifacts.get("repo_profile"),
            historical_recall=state.artifacts.get("historical_recall"),
        )
        _record_result_llm_metrics(state, plan)
        _attach_requirement_id(state, plan)
        state.artifacts["plan"] = plan
        _append_domain_event(state, "make_plan", {"plan": plan})
        return {
            "ok": True,
            "result": {"plan": plan},
        }

    if tool_name == "locate_files":
        plan = state.artifacts.get("plan")
        matched_skill = action.get("args", {}).get("matched_skill") or state.matched_skill
        repo_adapter = _repo_adapter_for_state(state)
        located = locate_files_impl(
            plan=plan,
            matched_skill=matched_skill,
            repo_adapter=repo_adapter,
            user_input=state.user_input,
            repo_profile=state.artifacts.get("repo_profile"),
            historical_recall=state.artifacts.get("historical_recall"),
        )
        _attach_requirement_id(state, located)
        state.artifacts["located_files"] = located
        memory = get_default_memory_adapter()
        memory.save_event({
            "stage": "locate_files",
            "action": "search_repo",
            "timestamp": "runtime",
            "payload": {
                "task_id": state.task_id,
                "requirement_id": _requirement_id(state),
                "strategy": located.get("strategy") if isinstance(located, dict) else None,
                "located": located.get("located") if isinstance(located, dict) else False,
                "files": located.get("files", []) if isinstance(located, dict) else [],
                "search_terms": located.get("search_terms", []) if isinstance(located, dict) else [],
            },
        })
        _append_domain_event(state, "locate_files", {"located_files": located})
        return {
            "ok": True,
            "result": {"located_files": located},
        }

    if tool_name == "generate_patch":
        repo_adapter = _repo_adapter_for_state(state)
        patch_plan = generate_patch_plan(
            user_input=state.user_input,
            matched_skill=action.get("args", {}).get("matched_skill") or state.matched_skill,
            plan=action.get("args", {}).get("plan") or state.artifacts.get("plan"),
            located_files=action.get("args", {}).get("located_files") or state.artifacts.get("located_files"),
            historical_recall=state.artifacts.get("historical_recall"),
            repo_adapter=repo_adapter,
        )
        _record_result_llm_metrics(state, patch_plan)
        _attach_requirement_id(state, patch_plan)
        state.artifacts["patch_plan"] = patch_plan
        _pause_for_non_executable_l3(state, patch_plan)
        _append_domain_event(state, "generate_patch", {"patch_plan": patch_plan})
        return {
            "ok": True,
            "result": {"patch_plan": patch_plan},
        }

    if tool_name == "validate_patch":
        validation_result = validate_patch(
            patch_plan=state.artifacts.get("patch_plan"),
            repo_profile=state.artifacts.get("repo_profile"),
        )
        _attach_requirement_id(state, validation_result)
        state.artifacts["validation_result"] = validation_result
        _append_domain_event(state, "validate_patch", {"validation_result": validation_result})
        return {
            "ok": True,
            "result": {"validation_result": validation_result},
        }

    if tool_name == "review_patch":
        review = review_patch_plan(
            plan=state.artifacts.get("plan"),
            located_files=state.artifacts.get("located_files"),
            patch_plan=state.artifacts.get("patch_plan"),
            matched_skill=state.matched_skill,
            historical_recall=state.artifacts.get("historical_recall"),
            validation_result=state.artifacts.get("validation_result"),
        )
        _attach_requirement_id(state, review)
        state.artifacts["review"] = review
        _append_domain_event(state, "review_patch", {"review": review})
        return {
            "ok": True,
            "result": {"review": review},
        }

    if tool_name == "execute_patch":
        repo_adapter = _repo_adapter_for_state(state)
        execution_result = execute_patch_plan(
            patch_plan=state.artifacts.get("patch_plan"),
            review=state.artifacts.get("review"),
            repo_adapter=repo_adapter,
        )
        _attach_requirement_id(state, execution_result)
        state.artifacts["execution_result"] = execution_result
        if execution_result.get("preview_result"):
            state.artifacts["preview_result"] = execution_result["preview_result"]
        _append_domain_event(state, "execute_patch", {"execution_result": execution_result})
        return {
            "ok": True,
            "result": {"execution_result": execution_result},
        }

    if tool_name == "verify_result":
        test_adapter = _test_adapter_for_state(state)
        verification_result = verify_execution(
            plan=state.artifacts.get("plan"),
            execution_result=state.artifacts.get("execution_result"),
            test_adapter=test_adapter,
            repo_profile=state.artifacts.get("repo_profile"),
        )
        _attach_requirement_id(state, verification_result)
        state.artifacts["verification_result"] = verification_result
        if verification_result.get("verify_preview"):
            state.artifacts["verify_preview"] = verification_result["verify_preview"]
        _append_domain_event(state, "verify_result", {"verification_result": verification_result})
        _append_test_executed_event(state, verification_result)
        return {
            "ok": True,
            "result": {"verification_result": verification_result},
        }

    if tool_name == "apply_patch":
        target_file = None
        for key in ("path", "file", "filepath", "target_file"):
            if action.get("args", {}).get(key):
                target_file = action.get("args", {}).get(key)
                break
        return {"ok": True, "result": {"patched": True, "file": target_file}}

    if tool_name == "finish":
        state.status = "SUCCESS"

        plan = state.artifacts.get("plan") or {}
        located_files = state.artifacts.get("located_files") or {}
        patch_plan = state.artifacts.get("patch_plan") or {}
        validation_result = state.artifacts.get("validation_result") or {}
        review = state.artifacts.get("review") or {}
        execution_result = state.artifacts.get("execution_result") or {}
        verification_result = state.artifacts.get("verification_result") or {}
        pr_draft = _create_pr_draft_artifact(state, status="SUCCESS")

        final_summary = {
            "status": "SUCCESS",
            "requirement_id": _requirement_id(state),
            "requirement_type": _requirement_dsl(state).get("requirement_type"),
            "user_input": state.user_input,
            "skill": state.matched_skill,
            "skill_match": state.artifacts.get("skill_match"),
            "repo_profile": state.artifacts.get("repo_profile"),
            "repo_type": (state.artifacts.get("repo_profile") or {}).get("repo_type") if isinstance(state.artifacts.get("repo_profile"), dict) else None,
            "conduit_checks": (state.artifacts.get("repo_profile") or {}).get("conduit_checks") if isinstance(state.artifacts.get("repo_profile"), dict) else None,
            "plan_summary": plan.get("task_name") if isinstance(plan, dict) else None,
            "located_files_count": len(located_files.get("files", [])) if isinstance(located_files, dict) else 0,
            "patch_count": len(patch_plan.get("patches", [])) if isinstance(patch_plan, dict) else 0,
            "validation_approved": bool(validation_result.get("approved")) if isinstance(validation_result, dict) else False,
            "review_approved": bool(review.get("approved")) if isinstance(review, dict) else False,
            "execution_executed": bool(execution_result.get("executed")) if isinstance(execution_result, dict) else False,
            "execution_mode": execution_result.get("mode") if isinstance(execution_result, dict) else None,
            "verification_passed": verification_result.get("passed") if isinstance(verification_result, dict) else None,
            "pr_draft": pr_draft,
            "model_calls": len(state.model_trace),
            "total_steps": state.current_step + 1,
            "message": "Agent task completed successfully",
        }
        memory = get_default_memory_adapter()
        memory.save_case({
            "requirement": state.user_input,
            "skill": state.matched_skill,
            "summary": final_summary,
        })
        memory.save_event({
            "stage": "finish",
            "action": "save_case",
            "timestamp": "runtime",
        })
        state.artifacts["final_summary"] = final_summary
        _append_domain_event(state, "finish", {"final_summary": final_summary})
        return {
            "ok": True,
            "result": {"final_summary": final_summary},
        }

    return {"ok": False, "error": f"Unknown tool: {tool_name}"}
