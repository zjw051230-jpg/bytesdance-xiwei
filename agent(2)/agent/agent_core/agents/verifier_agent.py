import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def _safe_create_file_verify_commands(execution_result: Optional[Dict[str, Any]]) -> list:
    if not isinstance(execution_result, dict):
        return []

    commands = []
    for item in execution_result.get("files", []) or []:
        if not isinstance(item, dict):
            continue
        if item.get("operation") != "create_file":
            continue

        file_path = item.get("file")
        content = item.get("content_preview")
        if not file_path or content is None:
            adapter_result = item.get("adapter_result") if isinstance(item.get("adapter_result"), dict) else {}
            file_path = file_path or adapter_result.get("path") or adapter_result.get("file")
            content = content if content is not None else adapter_result.get("content_preview")
        if not file_path or content is None:
            continue

        safe_path = repr(str(file_path))
        safe_content = repr(str(content).strip())
        code = (
            "from pathlib import Path\n"
            f"p=Path({safe_path})\n"
            "assert p.exists()\n"
            f"assert p.read_text(encoding='utf-8').strip()=={safe_content}"
        )
        commands.append("python -c " + repr(code))
    return commands


def _conduit_commands_from_profile(repo_profile: Optional[Dict[str, Any]]) -> list:
    if not isinstance(repo_profile, dict) or repo_profile.get("repo_type") != "conduit":
        return []
    available = repo_profile.get("available_scripts") or {}
    root_scripts = _scripts_for_scope(available, "root")
    frontend_scripts = _scripts_for_scope(available, "frontend")
    commands = []

    if "build" in frontend_scripts:
        commands.append("npm run build -w frontend")
    if "test" in root_scripts:
        commands.append("npm test")
    if "lint" in root_scripts:
        commands.append("npm run lint")
    return commands


def _scripts_for_scope(available_scripts: Any, scope: str) -> Dict[str, str]:
    if not isinstance(available_scripts, dict):
        return {}
    scripts = available_scripts.get(scope) or {}
    if not isinstance(scripts, dict):
        return {}
    return {str(name): str(command) for name, command in scripts.items()}


def _conduit_command_script(command: str) -> Optional[Tuple[str, str]]:
    normalized = " ".join(str(command or "").strip().split())
    if normalized == "npm test":
        return ("root", "test")
    if normalized == "npm run lint":
        return ("root", "lint")
    if normalized == "npm run build -w frontend":
        return ("frontend", "build")
    return None


def _filter_conduit_commands(commands: List[str], repo_profile: Optional[Dict[str, Any]]) -> Tuple[List[str], List[Dict[str, str]]]:
    if not isinstance(repo_profile, dict) or repo_profile.get("repo_type") != "conduit":
        return commands, []

    available = repo_profile.get("available_scripts") or {}
    selected = []
    skipped = []
    for command in commands:
        script_ref = _conduit_command_script(command)
        if script_ref is None:
            if str(command or "").strip() == "npm run test":
                skipped.append(
                    {
                        "command": command,
                        "reason": "use_root_npm_test_for_conduit",
                        "scope": "root",
                        "script": "test",
                    }
                )
            else:
                selected.append(command)
            continue
        scope, script_name = script_ref
        scripts = _scripts_for_scope(available, scope)
        if script_name in scripts:
            selected.append(command)
        else:
            skipped.append(
                {
                    "command": command,
                    "reason": "missing_package_script",
                    "scope": scope,
                    "script": script_name,
                }
            )
    return selected, skipped


def _git_diff_stat(test_adapter=None) -> Optional[Dict[str, Any]]:
    working_directory = getattr(test_adapter, "working_directory", None)
    if not working_directory:
        return None
    root = Path(working_directory).expanduser()
    if not root.exists() or not root.is_dir():
        return {
            "ok": False,
            "command": "git diff --stat",
            "error": f"working_directory does not exist or is not a directory: {working_directory}",
        }
    try:
        completed = subprocess.run(
            ["git", "diff", "--stat"],
            cwd=str(root.resolve()),
            capture_output=True,
            text=True,
            shell=False,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {
            "ok": False,
            "command": "git diff --stat",
            "error": str(exc),
        }
    return {
        "ok": completed.returncode == 0,
        "command": "git diff --stat",
        "exit_code": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def verify_execution(
    plan: Optional[Dict[str, Any]],
    execution_result: Optional[Dict[str, Any]],
    test_adapter=None,
    repo_profile: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not isinstance(execution_result, dict) or execution_result.get("executed") is not True:
        return {
            "verified": False,
            "passed": False,
            "reason": "Execution result missing or not executed",
            "test_result": None,
        }

    commands = []
    skipped_commands: List[Dict[str, str]] = []
    if isinstance(plan, dict):
        commands = plan.get("test_commands") or []
    if isinstance(repo_profile, dict) and repo_profile.get("repo_type") == "conduit":
        commands = commands or _conduit_commands_from_profile(repo_profile)
        profile_commands, skipped_commands = _filter_conduit_commands(list(commands), repo_profile)
        if not profile_commands:
            profile_commands = _conduit_commands_from_profile(repo_profile)
        commands = profile_commands
    if getattr(test_adapter, "is_real_test_adapter", False):
        safe_plan_commands = [command for command in commands if test_adapter._is_allowed(command)]
        generated_commands = _safe_create_file_verify_commands(execution_result)
        if isinstance(repo_profile, dict) and repo_profile.get("repo_type") == "conduit":
            commands = safe_plan_commands
        else:
            commands = generated_commands or safe_plan_commands
    if not commands:
        if getattr(test_adapter, "is_real_test_adapter", False):
            commands = []
        else:
            commands = ["npm run lint"]

    if test_adapter is not None:
        test_result = test_adapter.run_tests(commands)
        mode = test_result.get("mode", "mock_test")
        passed = test_result.get("passed")
        result = {
            "verified": bool(test_result.get("executed", True)),
            "passed": passed,
            "mode": mode,
            "verify_preview": test_result.get("verify_preview"),
            "verification_required": test_result.get("verification_required", False),
            "test_result": test_result,
        }
        if skipped_commands:
            test_result["skipped_commands"] = skipped_commands
            result["skipped_commands"] = skipped_commands
        git_stat = _git_diff_stat(test_adapter)
        if git_stat is not None:
            result["git_diff_stat"] = git_stat
        return result

    return {
        "verified": False,
        "passed": False,
        "reason": "Test adapter missing",
        "test_result": None,
    }
