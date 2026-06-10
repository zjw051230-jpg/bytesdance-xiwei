from agents.fake_agent import decide_next_action
from hooks.hook_runner import run_post_hooks, run_pre_hooks
from interfaces.context_adapter import get_default_context_adapter
from interfaces.memory_adapter import get_default_memory_adapter
from tools.tool_registry import execute
from .model_router import select_model
from .runtime_controller import apply_control_signal, read_control_signal
from .state import AgentState


def map_action_to_agent_name(tool_name: str):
    return {
        "make_plan": "planAgent",
        "generate_patch": "codegenAgent",
        "review_patch": "deliveryAgent",
        "execute_patch": "repairAgent",
        "verify_result": "deliveryAgent",
    }.get(tool_name)


def run_agent(user_input: str, task_id: str = "demo_task"):
    memory = get_default_memory_adapter()
    hits = memory.retrieve(user_input)

    state = AgentState(task_id=task_id, user_input=user_input, memory_hits=hits)
    state.artifacts["memory_hit_count"] = len(hits)
    state.save()

    while not state.is_finished():
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
        action = decide_next_action(state, model_info)
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

        hook_result = run_pre_hooks(state, action)

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
