from agent_core.agents.fake_agent import decide_next_action, fixed_next_action
from agent_core.agents.pr_draft_agent import generate_pr_draft
from agent_core.hooks.hook_runner import run_post_hooks, run_pre_hooks
from agent_core.interfaces.context_adapter import get_default_context_adapter
from agent_core.interfaces.event_adapter import get_default_event_adapter
from agent_core.interfaces.memory_adapter import get_default_memory_adapter
from agent_core.interfaces.repo_profiler import profile_runtime_repo
from agent_core.observability.llm_metrics import record_llm_metric
from agent_core.tools.tool_registry import execute
from .model_router import select_model
from .replay import (
    REPLAY_STAGES,
    apply_replay_overrides,
    find_parent_state,
    prune_replayed_artifacts,
    replay_metadata,
    state_from_snapshot,
    validate_replay_request,
)
from .runtime_controller import apply_control_signal, read_control_signal
from .state import AgentState


def map_action_to_agent_name(tool_name: str):
    return {
        "make_plan": "planAgent",
        "locate_files": "locatorAgent",
        "generate_patch": "codegenAgent",
        "validate_patch": "validatorAgent",
        "review_patch": "deliveryAgent",
        "execute_patch": "repairAgent",
        "verify_result": "deliveryAgent",
        "finish": "summaryAgent",
    }.get(tool_name)


def _build_replay_action(tool_name: str, state, model_info) -> dict:
    args = {"input": state.user_input, "selected_model": model_info["model"]}
    if tool_name == "make_plan":
        args["matched_skill"] = state.matched_skill
        args["runtime_instructions"] = list(state.instructions)
    if tool_name == "locate_files":
        args["plan"] = state.artifacts.get("plan")
        args["matched_skill"] = state.matched_skill
    if tool_name == "generate_patch":
        args["user_input"] = state.user_input
        args["matched_skill"] = state.matched_skill
        args["plan"] = state.artifacts.get("plan")
        args["located_files"] = state.artifacts.get("located_files")
    if tool_name == "validate_patch":
        args["patch_plan"] = state.artifacts.get("patch_plan")
        args["repo_profile"] = state.artifacts.get("repo_profile")
    if tool_name == "verify_result":
        args["plan"] = state.artifacts.get("plan")
        args["execution_result"] = state.artifacts.get("execution_result")
    return {
        "tool": tool_name,
        "args": args,
        "__decision": {
            "decision_source": "replay",
            "selected_action": tool_name,
            "selected_tool": tool_name,
            "rejected_action": None,
            "reason": "Replay selected next downstream action",
            "confidence": 1.0,
        },
    }


def _decision_from_action(action: dict) -> dict:
    decision = action.get("__decision") if isinstance(action, dict) else None
    if isinstance(decision, dict):
        return dict(decision)
    tool_name = action.get("tool") if isinstance(action, dict) else None
    return {
        "decision_source": "mock",
        "selected_action": tool_name,
        "selected_tool": tool_name,
        "rejected_action": None,
        "reason": "Action decision metadata was not provided",
        "confidence": 1.0,
    }


def _record_action_decision(state, action: dict, decision: dict, memory) -> None:
    selected_tool = action.get("tool") if isinstance(action, dict) else None
    record = {
        "step": state.current_step,
        "decision_source": decision.get("decision_source") or "mock",
        "selected_action": decision.get("selected_action") or selected_tool,
        "selected_tool": decision.get("selected_tool") or selected_tool,
        "rejected_action": decision.get("rejected_action"),
        "reason": decision.get("reason", ""),
        "confidence": decision.get("confidence"),
        "provider": decision.get("provider"),
        "model": decision.get("model"),
    }
    state.artifacts.setdefault("action_decisions", []).append(record)
    state.artifacts["last_action_decision"] = record
    state.add_context_snapshot(
        "actionSelector",
        {
            "task_id": state.task_id,
            "agent_name": "actionSelector",
            "current_node_id": state.current_node_id,
            "decision": record,
        },
    )
    memory.save_event({
        "stage": "action_decision",
        "action": "select_next_action",
        "timestamp": "runtime",
        "payload": record,
    })

    event_adapter = get_default_event_adapter()
    expected_seq = event_adapter.get_latest_event_seq(state.task_id)
    appended_event = event_adapter.append_event(
        state.task_id,
        {
            "type": "ACTION_DECIDED",
            "category": "runtime_event",
            "producer": "actionSelector",
            "trace_id": state.task_id,
            "span_id": f"decision_{state.current_step}",
            "parent_span_id": state.current_node_id,
            "run_id": state.run_id,
            "payload": record,
            "idempotency_key": f"ACTION_DECIDED:{state.task_id}:{state.current_step}",
        },
        expected_seq=expected_seq,
    )
    state.artifacts["last_action_decision_event"] = appended_event


def _record_action_llm_metrics(state, action: dict, memory) -> None:
    if not isinstance(action, dict):
        return
    decision = action.get("__decision") if isinstance(action.get("__decision"), dict) else {}
    metrics = decision.pop("llm_metrics", []) if isinstance(decision.get("llm_metrics"), list) else []
    if action.get("__decision") is not decision and isinstance(action.get("__decision"), dict):
        action["__decision"].pop("llm_metrics", None)
    if not metrics:
        return
    event_adapter = get_default_event_adapter()
    for metric in metrics:
        record_llm_metric(state, metric, memory_adapter=memory, event_adapter=event_adapter)


def _requires_conduit_repo(requirement_dsl: dict = None) -> bool:
    if not isinstance(requirement_dsl, dict):
        return False
    fields = [
        requirement_dsl.get("requirement_type"),
        requirement_dsl.get("skill_hint"),
        requirement_dsl.get("task_name"),
        requirement_dsl.get("user_story"),
    ]
    return any("conduit" in str(item or "").lower() for item in fields)


def _block_for_repo_profile(state, repo_profile: dict, reason: str) -> None:
    state.status = "PAUSED"
    state.artifacts["last_error"] = reason
    state.artifacts["blocked_reason"] = reason
    pr_draft = generate_pr_draft(
        state_status=state.status,
        user_input=state.user_input,
        artifacts=state.artifacts,
        matched_skill=state.matched_skill,
    )
    state.artifacts["pr_draft"] = pr_draft
    memory = get_default_memory_adapter()
    memory.save_event(
        {
            "stage": "create_pr_draft",
            "action": "generate_pr_draft",
            "timestamp": "runtime",
            "payload": {
                "task_id": state.task_id,
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
    event_adapter = get_default_event_adapter()
    expected_seq = event_adapter.get_latest_event_seq(state.task_id)
    appended_event = event_adapter.append_event(
        state.task_id,
        {
            "type": "PR_DRAFT_CREATED",
            "category": "domain_event",
            "producer": "summaryAgent",
            "trace_id": state.task_id,
            "span_id": "summary_blocked",
            "parent_span_id": state.current_node_id,
            "run_id": state.run_id,
            "payload": {"pr_draft": pr_draft},
            "idempotency_key": f"PR_DRAFT_CREATED:{state.task_id}:blocked",
        },
        expected_seq=expected_seq,
    )
    state.artifacts["last_pr_draft_event"] = appended_event
    state.artifacts["final_summary"] = {
        "status": "BLOCKED",
        "user_input": state.user_input,
        "message": reason,
        "pr_draft": pr_draft,
        "repo_profile": repo_profile,
        "repo_type": repo_profile.get("repo_type") if isinstance(repo_profile, dict) else None,
        "conduit_checks": repo_profile.get("conduit_checks") if isinstance(repo_profile, dict) else None,
    }


def _append_replay_event(state, event_type: str, payload: dict) -> None:
    event_adapter = get_default_event_adapter()
    expected_seq = event_adapter.get_latest_event_seq(state.task_id)
    event = {
        "type": event_type,
        "category": "domain_event",
        "producer": "replayAgent",
        "trace_id": state.task_id,
        "span_id": f"replay_{state.current_step}_{event_type.lower()}",
        "parent_span_id": state.current_node_id,
        "run_id": state.run_id,
        "payload": payload,
        "idempotency_key": f"{event_type}:{state.task_id}:{payload.get('replay_id', 'unknown')}",
    }
    appended_event = event_adapter.append_event(state.task_id, event, expected_seq=expected_seq)
    key = "last_replay_started_event" if event_type == "REPLAY_STARTED" else "last_replay_completed_event"
    state.artifacts[key] = appended_event


def _block_replay(task_id: str, user_input: str, request: dict, reason: str) -> AgentState:
    state = AgentState(task_id=task_id, user_input=user_input or "")
    metadata = {
        "replay_id": request.get("replay_id") if isinstance(request, dict) else None,
        "replay_from_stage": request.get("from_stage") if isinstance(request, dict) else None,
        "replay_overrides_keys": sorted((request.get("overrides") or {}).keys()) if isinstance(request, dict) and isinstance(request.get("overrides"), dict) else [],
        "replay_parent_requirement_id": request.get("requirement_id") if isinstance(request, dict) else None,
        "status": "blocked",
        "reason": reason,
    }
    state.status = "PAUSED"
    state.artifacts["replay"] = metadata
    state.artifacts["blocked_reason"] = reason
    state.artifacts["last_error"] = reason
    memory = get_default_memory_adapter()
    memory.save_event({"stage": "replay", "action": "blocked", "timestamp": "runtime", "payload": metadata})
    state.add_context_snapshot("replayAgent", {"task_id": task_id, "agent_name": "replayAgent", "replay": metadata})
    _append_replay_event(state, "REPLAY_STARTED", metadata)
    _append_replay_event(state, "REPLAY_COMPLETED", metadata)
    state.save()
    return state


def _prepare_replay_state(user_input: str, task_id: str, replay_request: dict) -> tuple:
    request, error = validate_replay_request(replay_request)
    if error:
        return _block_replay(task_id, user_input, replay_request if isinstance(replay_request, dict) else {}, error), None, error

    parent = find_parent_state(requirement_id=request.get("requirement_id") or "", task_id=request.get("task_id") or "")
    if parent:
        state = state_from_snapshot(parent, fallback_user_input=user_input)
        state.task_id = task_id
        state.run_id = f"run_{task_id}"
        state.status = "RUNNING"
        state.current_step = 0
        state.max_steps = 11
        state.current_node_id = None
        state.node_history = []
        state.context_snapshots = []
        state.history = []
        state.model_trace = []
        state.available_actions_history = []
        state.artifacts.pop("action_decisions", None)
        state.artifacts.pop("last_action_decision", None)
        state.artifacts.pop("last_action_decision_event", None)
    else:
        state = AgentState(task_id=task_id, user_input=user_input or request.get("requirement_id") or "replay")
        if request.get("requirement_id"):
            state.artifacts["requirement_dsl"] = {
                "requirement_id": request.get("requirement_id"),
                "task_name": user_input or request.get("requirement_id"),
                "user_story": user_input or request.get("requirement_id"),
                "requirement_type": "feature",
            }
            state.artifacts["requirement_id"] = request.get("requirement_id")

    state.user_input = state.user_input or user_input or ""
    metadata = replay_metadata(request)
    metadata["status"] = "running"
    prune_replayed_artifacts(state.artifacts, request["from_stage"])
    apply_replay_overrides(state, request.get("overrides") or {})
    state.artifacts["replay"] = metadata
    state.status = "RUNNING"
    memory = get_default_memory_adapter()
    memory.save_event({"stage": "replay", "action": "started", "timestamp": "runtime", "payload": metadata})
    state.add_context_snapshot("replayAgent", {"task_id": state.task_id, "agent_name": "replayAgent", "replay": metadata})
    _append_replay_event(state, "REPLAY_STARTED", metadata)
    state.save()
    return state, request, None


def _run_action_sequence(state: AgentState, stages: list, replay_mode: bool = False) -> AgentState:
    memory = get_default_memory_adapter()
    while not state.is_finished():
        if replay_mode and not stages:
            break

        signal = read_control_signal(state.task_id)
        should_continue, message = apply_control_signal(state, signal)

        if message:
            state.history.append(
                {
                    "step": state.current_step,
                    "action": {"tool": "runtime_control", "args": signal or {}},
                    "observation": {"ok": should_continue, "message": message},
                }
            )
            state.save()

        if not should_continue:
            break

        model_info = select_model(state)
        state.add_model_trace(model_info)
        action = _build_replay_action(stages.pop(0), state, model_info) if replay_mode else decide_next_action(state, model_info)
        hook_result = run_pre_hooks(state, action)
        _record_action_llm_metrics(state, action, memory)
        decision = _decision_from_action(action)

        if not replay_mode and not hook_result.ok and decision.get("decision_source") == "llm":
            rejected_action = decision.get("selected_action") or action.get("tool")
            fallback_action = fixed_next_action(
                state,
                model_info,
                source="fallback",
                rejected_action=rejected_action,
                reason=f"hook_rejected: {hook_result.reason}",
            )
            fallback_hook_result = run_pre_hooks(state, fallback_action)
            action = fallback_action
            hook_result = fallback_hook_result
            decision = _decision_from_action(action)

        _record_action_decision(state, action, decision, memory)

        agent_name = map_action_to_agent_name(action.get("tool"))
        if agent_name:
            context_adapter = get_default_context_adapter()
            context = context_adapter.build_context_for_agent(
                task_id=state.task_id,
                agent_name=agent_name,
                current_node_id=state.current_node_id,
            )
            state.add_context_snapshot(agent_name, context)
            state.artifacts["latest_agent_context"] = context

        if not hook_result.ok:
            observation = {"ok": False, "error": hook_result.reason, "source": "hook"}
            state.add_step(action, observation)
            if hook_result.should_stop:
                state.status = "FAILED"
            state.save()
            break

        observation = execute(action, state)
        post_result = run_post_hooks(state, action, observation)
        state.add_step(action, observation)

        if not post_result.ok:
            state.status = "FAILED"
            state.artifacts["last_error"] = post_result.reason
            state.save()
            break

        state.save()

        if action.get("tool") == "finish":
            break

    return state


def run_agent(user_input: str, task_id: str = "demo_task", requirement_dsl: dict = None, replay_request: dict = None):
    if isinstance(replay_request, dict):
        state, request, error = _prepare_replay_state(user_input, task_id, replay_request)
        if error:
            return state
        start = REPLAY_STAGES.index(request["from_stage"])
        stages = list(REPLAY_STAGES[start:])
        state = _run_action_sequence(state, stages, replay_mode=True)
        replay = state.artifacts.get("replay") if isinstance(state.artifacts.get("replay"), dict) else {}
        replay["status"] = "completed" if state.status == "SUCCESS" else "blocked" if state.status == "PAUSED" else "failed"
        state.artifacts["replay"] = replay
        memory = get_default_memory_adapter()
        memory.save_event({"stage": "replay", "action": "completed", "timestamp": "runtime", "payload": replay})
        _append_replay_event(state, "REPLAY_COMPLETED", replay)
        state.save()
        return state

    memory = get_default_memory_adapter()
    hits = memory.retrieve(user_input)

    state = AgentState(task_id=task_id, user_input=user_input, memory_hits=hits)
    if isinstance(requirement_dsl, dict):
        state.artifacts["requirement_dsl"] = dict(requirement_dsl)
        state.artifacts["requirement_id"] = requirement_dsl.get("requirement_id")
        state.artifacts["requirement_type"] = requirement_dsl.get("requirement_type")
        state.artifacts["task_level"] = requirement_dsl.get("task_level") or state.artifacts.get("task_level")
        state.artifacts["risk_level"] = requirement_dsl.get("risk_level") or state.artifacts.get("risk_level")
        if requirement_dsl.get("constraints"):
            state.instructions.extend(requirement_dsl.get("constraints") or [])
    repo_profile = profile_runtime_repo(requirement_dsl if isinstance(requirement_dsl, dict) else None)
    state.artifacts["repo_profile"] = repo_profile
    state.artifacts["repo_type"] = repo_profile.get("repo_type")
    state.artifacts["conduit_checks"] = repo_profile.get("conduit_checks")
    if isinstance(requirement_dsl, dict) and requirement_dsl.get("target_repo") and repo_profile.get("repo_type") == "invalid":
        _block_for_repo_profile(state, repo_profile, repo_profile.get("error") or "target_repo is invalid")
    elif _requires_conduit_repo(requirement_dsl) and repo_profile.get("repo_type") != "conduit":
        _block_for_repo_profile(
            state,
            repo_profile,
            "Requirement explicitly targets Conduit, but target_repo/repoPath is not a valid Conduit realworld monorepo.",
        )
    state.artifacts["memory_hit_count"] = len(hits)
    state.save()

    return _run_action_sequence(state, [], replay_mode=False)
