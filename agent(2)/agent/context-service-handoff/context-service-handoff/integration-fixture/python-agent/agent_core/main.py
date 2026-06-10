from pathlib import Path

from orchestrator.agent_loop import run_agent


def _state_file_path(task_id: str) -> str:
    path = Path(__file__).resolve().parent / "storage" / "states" / f"{task_id}.json"
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

    skill = state.matched_skill or final_summary.get("skill") or {}
    skill_name = skill.get("name") if isinstance(skill, dict) else skill
    plan_name = plan.get("task_name") if isinstance(plan, dict) else final_summary.get("plan_summary")
    located_count = len(located_files.get("files", [])) if isinstance(located_files, dict) else 0
    patch_count = len(patch_plan.get("patches", [])) if isinstance(patch_plan, dict) else 0
    review_passed = bool(review.get("approved")) if isinstance(review, dict) else False
    verify_passed = bool(verification_result.get("passed")) if isinstance(verification_result, dict) else False
    execution_mode = execution_result.get("mode") if isinstance(execution_result, dict) else None

    print("任务完成")
    print(f"状态：{state.status}")
    print(f"执行步数：{state.current_step}")
    print(f"匹配 Skill：{skill_name or 'None'}")
    print(f"计划：{plan_name or 'None'}")
    print(f"定位文件数：{located_count}")
    print(f"Patch 数量：{patch_count}")
    print(f"Review 通过：{review_passed}")
    print(f"Verify 通过：{verify_passed}")
    print(f"执行模式：{execution_mode or 'None'}")
    print(f"状态文件：{state_file}")


def _print_failure_summary(state) -> None:
    final_summary = state.artifacts.get("final_summary") or {}
    error = state.artifacts.get("last_error") or final_summary.get("message") or "Unknown error"

    print("任务失败")
    print(f"错误原因：{error}")


def main() -> None:
    user_input = input("请输入需求：").strip()
    if not user_input:
        print("需求不能为空")
        return

    task_id = "demo_task"
    state = run_agent(user_input=user_input, task_id=task_id)
    state_file = _state_file_path(task_id)

    if state.status == "SUCCESS":
        _print_success_summary(state, state_file)
    else:
        _print_failure_summary(state)


if __name__ == "__main__":
    main()
