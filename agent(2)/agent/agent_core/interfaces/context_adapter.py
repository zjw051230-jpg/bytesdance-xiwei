import os
from datetime import datetime
from typing import Optional

from .context_http_adapter import get_default_context_http_adapter


class BaseContextAdapter:
    def build_context_for_agent(
        self,
        task_id: str,
        agent_name: str,
        current_node_id: Optional[str] = None,
    ) -> dict:
        raise NotImplementedError


class MockContextAdapter(BaseContextAdapter):
    def build_context_for_agent(
        self,
        task_id: str,
        agent_name: str,
        current_node_id: Optional[str] = None,
    ) -> dict:
        return {
            "task_id": task_id,
            "agent_name": agent_name,
            "current_node_id": current_node_id,
            "context": {
                "final_dsl_core": {
                    "value": [],
                    "source_node_ids": [],
                },
                "dependency_summary": {
                    "value": {
                        "source_node_ids": [],
                    },
                    "source_node_ids": [],
                },
                "failed_patch_summary": {
                    "value": [],
                    "source_node_ids": [],
                },
                "sandbox_error_summary": {
                    "value": [],
                    "source_node_ids": [],
                },
                "verified_plan_summary": {
                    "value": [],
                    "source_node_ids": [],
                },
                "active_interrupts": {
                    "value": [],
                    "source_node_ids": [],
                },
            },
            "source_node_ids": [],
            "source_event_ids": [],
            "budget_report": {
                "before_chars": 0,
                "after_chars": 0,
                "truncated_fields": [],
                "removed_fields": [],
            },
            "privacy_report": {
                "redacted": False,
                "redacted_paths": [],
            },
            "created_at": datetime.utcnow().isoformat() + "Z",
        }


class ContextServiceAdapter(BaseContextAdapter):
    def __init__(self, context_http_adapter=None):
        self.context_http_adapter = context_http_adapter or get_default_context_http_adapter()

    def build_context_for_agent(
        self,
        task_id: str,
        agent_name: str,
        current_node_id: Optional[str] = None,
    ) -> dict:
        response = self.context_http_adapter.build_context(
            task_id=task_id,
            agent_name=agent_name,
            current_node_id=current_node_id,
        )
        if not isinstance(response, dict):
            return {}
        if response.get("ok") is False:
            return {
                "ok": False,
                "error": response.get("error"),
                "context": {},
            }
        return response.get("data", {})


_DEFAULT_CONTEXT_ADAPTER: Optional[BaseContextAdapter] = None


def get_default_context_adapter() -> BaseContextAdapter:
    global _DEFAULT_CONTEXT_ADAPTER
    if _DEFAULT_CONTEXT_ADAPTER is None:
        if os.getenv("USE_CONTEXT_HTTP") == "1":
            _DEFAULT_CONTEXT_ADAPTER = ContextServiceAdapter()
        else:
            _DEFAULT_CONTEXT_ADAPTER = MockContextAdapter()
    return _DEFAULT_CONTEXT_ADAPTER
