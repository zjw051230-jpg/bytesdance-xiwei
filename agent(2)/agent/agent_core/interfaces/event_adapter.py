import os
from datetime import datetime
from typing import Dict, Optional

from .context_http_adapter import get_default_context_http_adapter


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
        response = self.context_http_adapter.append_event(
            task_id=task_id,
            event=event,
            expected_seq=expected_seq,
        )
        if not isinstance(response, dict):
            return {
                "ok": False,
                "error": {
                    "code": "CONTEXT_EVENT_APPEND_INVALID_RESPONSE",
                    "message": "Context append_event returned a non-object response",
                    "details": {},
                },
            }

        if response.get("ok") is False:
            error = response.get("error") or {}
            code = str(error.get("code", ""))
            message = str(error.get("message", ""))
            if "SEQ" in code.upper() or "SEQ" in message.upper() or "CONFLICT" in code.upper():
                sync_response = self.context_http_adapter.latest_seq(task_id)
                response["latest_seq_sync"] = sync_response
            return response

        source = response.get("source")
        if source == "mock_http":
            seq = self.get_latest_event_seq(task_id)
            next_seq = seq + 1 if isinstance(seq, int) else 1
            self.latest_seq_by_task[task_id] = next_seq
            return {
                **event,
                "event_id": response.get("event_id", "evt_mock"),
                "task_id": task_id,
                "seq": next_seq,
                "schema_version": "1",
                "created_at": datetime.utcnow().isoformat() + "Z",
                "source": source,
            }

        latest_seq = self._extract_latest_seq(response)
        if isinstance(latest_seq, int):
            self.latest_seq_by_task[task_id] = latest_seq
        return response

    def get_latest_event_seq(self, task_id: str):
        if task_id in self.latest_seq_by_task:
            return self.latest_seq_by_task[task_id]
        response = self.context_http_adapter.latest_seq(task_id)
        if not isinstance(response, dict) or response.get("ok") is False:
            return None
        return self._extract_latest_seq(response)

    def _extract_latest_seq(self, response: dict):
        for key in ("latest_seq", "latestSeq", "seq"):
            value = response.get(key)
            if isinstance(value, int):
                return value
        data = response.get("data")
        if isinstance(data, dict):
            for key in ("latest_seq", "latestSeq", "seq"):
                value = data.get(key)
                if isinstance(value, int):
                    return value
        return None


_DEFAULT_EVENT_ADAPTER: Optional[BaseEventAdapter] = None


def get_default_event_adapter() -> BaseEventAdapter:
    global _DEFAULT_EVENT_ADAPTER
    if _DEFAULT_EVENT_ADAPTER is None:
        if os.getenv("USE_CONTEXT_HTTP") == "1":
            _DEFAULT_EVENT_ADAPTER = ContextEventAdapter()
        else:
            _DEFAULT_EVENT_ADAPTER = MockEventAdapter()
    return _DEFAULT_EVENT_ADAPTER
