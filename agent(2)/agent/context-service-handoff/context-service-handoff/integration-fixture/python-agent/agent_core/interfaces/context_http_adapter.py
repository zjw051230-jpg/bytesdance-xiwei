import json
import os
import urllib.error
import urllib.request
from datetime import datetime
from typing import Optional


class BaseContextHttpAdapter:
    def build_context(
        self,
        task_id,
        agent_name,
        current_node_id=None,
    ):
        raise NotImplementedError

    def append_event(
        self,
        task_id,
        event,
        expected_seq=None,
    ):
        raise NotImplementedError

    def get_latest_event_seq(self, task_id):
        raise NotImplementedError


def _mock_context_payload(task_id: str, agent_name: str, current_node_id: Optional[str] = None) -> dict:
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


class MockContextHttpAdapter(BaseContextHttpAdapter):
    def __init__(self, base_url: str = "http://localhost:8080"):
        self.base_url = base_url
        self.latest_seq_by_task = {}

    def build_context(
        self,
        task_id,
        agent_name,
        current_node_id=None,
    ):
        return {
            "ok": True,
            "source": "mock_http",
            "data": _mock_context_payload(task_id, agent_name, current_node_id),
        }

    def append_event(
        self,
        task_id,
        event,
        expected_seq=None,
    ):
        latest_seq = self.latest_seq_by_task.get(task_id, 0) + 1
        self.latest_seq_by_task[task_id] = latest_seq
        return {
            "ok": True,
            "source": "mock_http",
            "event_id": "evt_mock",
            "seq": latest_seq,
            "latest_seq": latest_seq,
        }

    def get_latest_event_seq(self, task_id):
        return self.latest_seq_by_task.get(task_id, 0)


class ContextHttpError(RuntimeError):
    def __init__(self, status_code, code, message, details=None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.details = details or {}


class RealContextHttpAdapter(BaseContextHttpAdapter):
    def __init__(self, base_url: str = "http://127.0.0.1:4000", timeout: float = 10.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def build_context(
        self,
        task_id,
        agent_name,
        current_node_id=None,
    ):
        return self._post("/context/build", {
            "taskId": task_id,
            "agentName": agent_name,
            "currentNodeId": current_node_id,
        })

    def append_event(
        self,
        task_id,
        event,
        expected_seq=None,
    ):
        return self._post("/events/append", {
            "taskId": task_id,
            "event": event,
            "expectedSeq": expected_seq,
        })

    def get_latest_event_seq(self, task_id):
        response = self._get(f"/events/latest-seq/{task_id}")
        return int(response.get("latest_seq", 0))

    def _get(self, path):
        request = urllib.request.Request(
            self.base_url + path,
            headers={"accept": "application/json"},
            method="GET",
        )
        return self._send(request)

    def _post(self, path, payload):
        request = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "accept": "application/json",
                "content-type": "application/json",
            },
            method="POST",
        )
        return self._send(request)

    def _send(self, request):
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8") if error.fp else ""
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                data = {"error": {"code": "HTTP_ERROR", "message": body or str(error), "details": {}}}
            error_payload = data.get("error", {})
            raise ContextHttpError(
                error.code,
                error_payload.get("code", "HTTP_ERROR"),
                error_payload.get("message", str(error)),
                error_payload.get("details", {}),
            ) from error
        except urllib.error.URLError as error:
            raise ContextHttpError(
                0,
                "CONTEXT_SERVICE_UNAVAILABLE",
                str(error.reason),
                {},
            ) from error

        if isinstance(data, dict) and data.get("ok") is False:
            error_payload = data.get("error", {})
            raise ContextHttpError(
                200,
                error_payload.get("code", "CONTEXT_SERVICE_ERROR"),
                error_payload.get("message", "Context service returned ok=false"),
                error_payload.get("details", {}),
            )
        return data


_DEFAULT_CONTEXT_HTTP_ADAPTER: Optional[BaseContextHttpAdapter] = None


def get_default_context_http_adapter() -> BaseContextHttpAdapter:
    global _DEFAULT_CONTEXT_HTTP_ADAPTER
    if _DEFAULT_CONTEXT_HTTP_ADAPTER is None:
        if os.getenv("USE_CONTEXT_HTTP") == "1":
            _DEFAULT_CONTEXT_HTTP_ADAPTER = RealContextHttpAdapter(
                base_url=os.getenv("CONTEXT_SERVICE_URL", "http://127.0.0.1:4000"),
            )
        else:
            _DEFAULT_CONTEXT_HTTP_ADAPTER = MockContextHttpAdapter()
    return _DEFAULT_CONTEXT_HTTP_ADAPTER
