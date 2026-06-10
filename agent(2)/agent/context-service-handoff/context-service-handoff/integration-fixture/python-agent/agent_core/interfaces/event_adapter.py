import os
from datetime import datetime
from typing import Dict, Optional

from .context_http_adapter import get_default_context_http_adapter


USE_CONTEXT_HTTP = os.getenv("USE_CONTEXT_HTTP") == "1"


class BaseEventAdapter:
    def append_event(self, task_id: str, event: dict, expected_seq=None) -> dict:
        raise NotImplementedError

    def get_latest_event_seq(self, task_id: str) -> int:
        raise NotImplementedError


class MockEventAdapter(BaseEventAdapter):
    def __init__(self):
        self.events_by_task: Dict[str, list] = {}

    def append_event(self, task_id: str, event: dict, expected_seq=None) -> dict:
        current_seq = self.get_latest_event_seq(task_id)
        seq = current_seq + 1
        full_event = {
            **event,
            "event_id": f"evt_{seq}",
            "task_id": task_id,
            "seq": seq,
            "schema_version": "1",
            "created_at": datetime.utcnow().isoformat() + "Z",
        }
        self.events_by_task.setdefault(task_id, []).append(full_event)
        return full_event

    def get_latest_event_seq(self, task_id: str) -> int:
        events = self.events_by_task.get(task_id, [])
        if not events:
            return 0
        return max(int(event.get("seq", 0)) for event in events)


class ContextEventAdapter(BaseEventAdapter):
    def __init__(self, context_http_adapter=None):
        self.context_http_adapter = context_http_adapter or get_default_context_http_adapter()
        self.latest_seq_by_task: Dict[str, int] = {}

    def append_event(self, task_id: str, event: dict, expected_seq=None) -> dict:
        if expected_seq is None:
            expected_seq = self.get_latest_event_seq(task_id)
        response = self.context_http_adapter.append_event(
            task_id=task_id,
            event=event,
            expected_seq=expected_seq,
        )

        event_id = "evt_mock"
        source = "mock_http"
        seq = expected_seq + 1
        schema_version = "1"
        created_at = datetime.utcnow().isoformat() + "Z"
        if isinstance(response, dict):
            event_id = response.get("event_id", event_id)
            source = response.get("source", source)
            seq = int(response.get("seq", response.get("latest_seq", seq)))
            event_payload = response.get("event") if isinstance(response.get("event"), dict) else {}
            schema_version = event_payload.get("schema_version", schema_version)
            created_at = event_payload.get("created_at", created_at)
            if response.get("latest_seq") is not None:
                self.latest_seq_by_task[task_id] = int(response["latest_seq"])
            else:
                self.latest_seq_by_task[task_id] = seq

        return {
            **event,
            "event_id": event_id,
            "task_id": task_id,
            "seq": seq,
            "schema_version": schema_version,
            "created_at": created_at,
            "source": source,
        }

    def get_latest_event_seq(self, task_id: str) -> int:
        if hasattr(self.context_http_adapter, "get_latest_event_seq"):
            try:
                latest_seq = int(self.context_http_adapter.get_latest_event_seq(task_id))
                self.latest_seq_by_task[task_id] = latest_seq
                return latest_seq
            except NotImplementedError:
                pass
        return self.latest_seq_by_task.get(task_id, 0)


_DEFAULT_EVENT_ADAPTER: Optional[BaseEventAdapter] = None


def get_default_event_adapter() -> BaseEventAdapter:
    global _DEFAULT_EVENT_ADAPTER
    if _DEFAULT_EVENT_ADAPTER is None:
        _DEFAULT_EVENT_ADAPTER = ContextEventAdapter() if USE_CONTEXT_HTTP else MockEventAdapter()
    return _DEFAULT_EVENT_ADAPTER
