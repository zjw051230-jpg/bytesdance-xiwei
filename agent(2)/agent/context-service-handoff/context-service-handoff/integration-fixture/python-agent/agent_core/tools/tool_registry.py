import os
from typing import Any, Dict

from agents.coder_agent import generate_patch_plan
from agents.executor_agent import execute_patch_plan
from agents.locator_agent import locate_files as locate_files_impl
from agents.planner_agent import create_plan
from agents.reviewer_agent import review_patch_plan
from agents.verifier_agent import verify_execution
from interfaces.event_adapter import get_default_event_adapter
from interfaces.memory_adapter import get_default_memory_adapter
from interfaces.repo_adapter import get_default_repo_adapter
from interfaces.test_adapter import get_default_test_adapter
from skills.registry import match_skill


EVENT_TYPES = {
    "make_plan": "PLAN_CREATED",
    "generate_patch": "PATCH_GENERATED",
    "review_patch": "REVIEW_COMPLETED",
    "execute_patch": "EXECUTION_COMPLETED",
    "verify_result": "VERIFICATION_COMPLETED",
    "finish": "TASK_FINISHED",
}

EVENT_PRODUCERS = {
    "make_plan": "planAgent",
    "generate_patch": "codegenAgent",
    "review_patch": "deliveryAgent",
    "execute_patch": "repairAgent",
    "verify_result": "deliveryAgent",
    "finish": "deliveryAgent",
}

NODE_PREFIXES = {
    "make_plan": ("plan", "plan"),
    "generate_patch": ("patch", "patch"),
    "review_patch": ("review", "review"),
    "execute_patch": ("sandbox", "sandbox"),
    "verify_result": ("verify", "verify"),
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


def execute(action: Dict[str, Any], state) -> Dict[str, Any]:
    tool_name = action.get("tool")

    if os.getenv("AGENT_TEST_TOOL_FAIL") == "1" and tool_name == "make_plan":
        return {"ok": False, "error": "Simulated tool failure"}

    if tool_name == "analyze_requirement":
        return {"ok": True, "result": f"理解需求：{state.user_input}，需要做文章详情页的字数统计能力。"}

    if tool_name == "select_skill":
        matched = match_skill(state.user_input)
        state.matched_skill = matched.get("skill") if matched.get("matched") else None
        return {"ok": True, "result": {"matched_skill": matched}}

    if tool_name == "make_plan":
        plan = create_plan(
            user_input=state.user_input,
            matched_skill=action.get("args", {}).get("matched_skill") or state.matched_skill,
            runtime_instructions=action.get("args", {}).get("runtime_instructions") or state.instructions,
        )
        state.artifacts["plan"] = plan
        _append_domain_event(state, "make_plan", {"plan": plan})
        return {
            "ok": True,
            "result": {"plan": plan},
        }

    if tool_name == "locate_files":
        plan = state.artifacts.get("plan")
        matched_skill = action.get("args", {}).get("matched_skill") or state.matched_skill
        located = locate_files_impl(plan=plan, matched_skill=matched_skill)
        state.artifacts["located_files"] = located
        return {
            "ok": True,
            "result": {"located_files": located},
        }

    if tool_name == "generate_patch":
        patch_plan = generate_patch_plan(
            user_input=state.user_input,
            matched_skill=action.get("args", {}).get("matched_skill") or state.matched_skill,
            plan=action.get("args", {}).get("plan") or state.artifacts.get("plan"),
            located_files=action.get("args", {}).get("located_files") or state.artifacts.get("located_files"),
        )
        state.artifacts["patch_plan"] = patch_plan
        _append_domain_event(state, "generate_patch", {"patch_plan": patch_plan})
        return {
            "ok": True,
            "result": {"patch_plan": patch_plan},
        }

    if tool_name == "review_patch":
        review = review_patch_plan(
            plan=state.artifacts.get("plan"),
            located_files=state.artifacts.get("located_files"),
            patch_plan=state.artifacts.get("patch_plan"),
        )
        state.artifacts["review"] = review
        _append_domain_event(state, "review_patch", {"review": review})
        return {
            "ok": True,
            "result": {"review": review},
        }

    if tool_name == "execute_patch":
        repo_adapter = get_default_repo_adapter()
        execution_result = execute_patch_plan(
            patch_plan=state.artifacts.get("patch_plan"),
            review=state.artifacts.get("review"),
            repo_adapter=repo_adapter,
        )
        state.artifacts["execution_result"] = execution_result
        _append_domain_event(state, "execute_patch", {"execution_result": execution_result})
        return {
            "ok": True,
            "result": {"execution_result": execution_result},
        }

    if tool_name == "verify_result":
        test_adapter = get_default_test_adapter()
        verification_result = verify_execution(
            plan=state.artifacts.get("plan"),
            execution_result=state.artifacts.get("execution_result"),
            test_adapter=test_adapter,
        )
        state.artifacts["verification_result"] = verification_result
        _append_domain_event(state, "verify_result", {"verification_result": verification_result})
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
        review = state.artifacts.get("review") or {}
        execution_result = state.artifacts.get("execution_result") or {}
        verification_result = state.artifacts.get("verification_result") or {}

        final_summary = {
            "status": "SUCCESS",
            "user_input": state.user_input,
            "skill": state.matched_skill,
            "plan_summary": plan.get("task_name") if isinstance(plan, dict) else None,
            "located_files_count": len(located_files.get("files", [])) if isinstance(located_files, dict) else 0,
            "patch_count": len(patch_plan.get("patches", [])) if isinstance(patch_plan, dict) else 0,
            "review_approved": bool(review.get("approved")) if isinstance(review, dict) else False,
            "execution_executed": bool(execution_result.get("executed")) if isinstance(execution_result, dict) else False,
            "execution_mode": execution_result.get("mode") if isinstance(execution_result, dict) else None,
            "verification_passed": bool(verification_result.get("passed")) if isinstance(verification_result, dict) else False,
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
