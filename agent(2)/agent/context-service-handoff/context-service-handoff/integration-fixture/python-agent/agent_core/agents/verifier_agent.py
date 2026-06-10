from typing import Any, Dict, Optional


def verify_execution(
    plan: Optional[Dict[str, Any]],
    execution_result: Optional[Dict[str, Any]],
    test_adapter=None,
) -> Dict[str, Any]:
    if not isinstance(execution_result, dict) or execution_result.get("executed") is not True:
        return {
            "verified": False,
            "passed": False,
            "reason": "Execution result missing or not executed",
            "test_result": None,
        }

    commands = []
    if isinstance(plan, dict):
        commands = plan.get("test_commands") or []
    if not commands:
        commands = ["npm run lint"]

    if test_adapter is not None:
        test_result = test_adapter.run_tests(commands)
        return {
            "verified": True,
            "passed": test_result["passed"],
            "mode": test_result.get("mode", "mock_test"),
            "test_result": test_result,
        }

    return {
        "verified": False,
        "passed": False,
        "reason": "Test adapter missing",
        "test_result": None,
    }
