"""Agent Runtime package.

The runtime is intended to work both as ``python -m agent_core.main`` and with
older local tests that imported modules from ``agent_core`` as top-level
packages after adding the package directory to ``sys.path``.  Runtime code uses
package-qualified imports; these aliases keep historical patch paths such as
``tools.tool_registry`` from creating a second package object.
"""

from __future__ import annotations

import importlib
import sys


_TOP_LEVEL_COMPAT_PACKAGES = (
    "actions",
    "agents",
    "hooks",
    "interfaces",
    "memory",
    "observability",
    "orchestrator",
    "prompts",
    "skills",
    "tools",
)

_TOP_LEVEL_COMPAT_MODULES = (
    "agents.coder_agent",
    "agents.executor_agent",
    "agents.fake_agent",
    "agents.locator_agent",
    "agents.planner_agent",
    "agents.pr_draft_agent",
    "agents.reviewer_agent",
    "agents.verifier_agent",
    "interfaces.context_adapter",
    "interfaces.context_http_adapter",
    "interfaces.event_adapter",
    "interfaces.llm_adapter",
    "interfaces.memory_adapter",
    "interfaces.repo_adapter",
    "interfaces.repo_profiler",
    "interfaces.test_adapter",
    "memory.historical_recall",
    "observability.llm_metrics",
    "orchestrator.agent_loop",
    "orchestrator.replay",
    "orchestrator.runtime_controller",
    "orchestrator.state",
    "skills.registry",
    "tools.tool_registry",
)


def _install_compat_aliases() -> None:
    for name in _TOP_LEVEL_COMPAT_PACKAGES:
        module = importlib.import_module(f"{__name__}.{name}")
        sys.modules.setdefault(name, module)

    requirement_dsl = importlib.import_module(f"{__name__}.requirement_dsl")
    sys.modules.setdefault("requirement_dsl", requirement_dsl)

    for name in _TOP_LEVEL_COMPAT_MODULES:
        module = importlib.import_module(f"{__name__}.{name}")
        sys.modules.setdefault(name, module)
        parent_name, _, child_name = name.rpartition(".")
        parent = sys.modules.get(parent_name)
        if parent is not None and not hasattr(parent, child_name):
            setattr(parent, child_name, module)


_install_compat_aliases()
