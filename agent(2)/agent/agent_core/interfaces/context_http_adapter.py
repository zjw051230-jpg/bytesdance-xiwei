import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Optional


class BaseContextHttpAdapter:
    def health(self):
        raise NotImplementedError

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

    def latest_seq(self, task_id):
        raise NotImplementedError

    def read_safe_events(self, task_id):
        raise NotImplementedError

    def rebuild_trace(self, task_id):
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

    def health(self):
        return {
            "ok": True,
            "source": "mock_http",
            "status": "healthy",
        }

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
        return {
            "ok": True,
            "source": "mock_http",
            "event_id": "evt_mock",
        }

    def latest_seq(self, task_id):
        return {
            "ok": True,
            "source": "mock_http",
            "task_id": task_id,
            "latest_seq": 0,
        }

    def read_safe_events(self, task_id):
        return {
            "ok": True,
            "source": "mock_http",
            "task_id": task_id,
            "events": [],
            "latest_seq": 0,
        }

    def rebuild_trace(self, task_id):
        return {
            "ok": True,
            "source": "mock_http",
            "task_id": task_id,
            "data": {
                "trace_view": {
                    "nodes": [],
                    "edges": [],
                },
                "projection_report": {},
            },
        }


def _error(code: str, message: str, details: Optional[dict] = None) -> dict:
    return {
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        },
    }


def _read_timeout() -> float:
    raw_timeout = os.getenv("CONTEXT_HTTP_TIMEOUT", "5")
    try:
        return float(raw_timeout)
    except (TypeError, ValueError):
        return 5.0


class RealContextHttpAdapter(BaseContextHttpAdapter):
    def __init__(self, base_url: Optional[str] = None, timeout: Optional[float] = None):
        self.base_url = (base_url or os.getenv("CONTEXT_SERVICE_URL", "http://127.0.0.1:4000")).rstrip("/")
        self.timeout = timeout if timeout is not None else _read_timeout()
        self.api_prefix = "/api/context"

    def health(self):
        return self._request("GET", "/health")

    def build_context(
        self,
        task_id,
        agent_name,
        current_node_id=None,
    ):
        payload = {
            "taskId": task_id,
            "agentName": agent_name,
        }
        if current_node_id is not None:
            payload["currentNodeId"] = current_node_id
        return self._request("POST", "/build", payload)

    def append_event(
        self,
        task_id,
        event,
        expected_seq=None,
    ):
        payload = {
            "taskId": task_id,
            "event": event,
        }
        if expected_seq is not None:
            payload["expectedSeq"] = expected_seq
        return self._request("POST", "/events/append", payload)

    def latest_seq(self, task_id):
        return self._request("GET", f"/events/latest-seq/{self._quote_task_id(task_id)}")

    def read_safe_events(self, task_id):
        return self._request("GET", f"/events/safe/{self._quote_task_id(task_id)}")

    def rebuild_trace(self, task_id):
        return self._request("POST", "/trace/rebuild", {"taskId": task_id})

    def _quote_task_id(self, task_id) -> str:
        return urllib.parse.quote(str(task_id), safe="")

    def _url(self, path: str) -> str:
        return f"{self.base_url}{self.api_prefix}{path}"

    def _request(self, method: str, path: str, payload: Optional[dict] = None) -> dict:
        data = None
        headers = {
            "Accept": "application/json",
        }
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = urllib.request.Request(
            self._url(path),
            data=data,
            headers=headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            return self._handle_http_error(exc)
        except (urllib.error.URLError, ConnectionError) as exc:
            return _error("CONTEXT_HTTP_CONNECTION_FAILED", str(exc), {"path": path})
        except (TimeoutError, socket.timeout) as exc:
            return _error("CONTEXT_HTTP_TIMEOUT", str(exc), {"path": path})
        except OSError as exc:
            return _error("CONTEXT_HTTP_ERROR", str(exc), {"path": path})

        return self._parse_json(body, path)

    def _handle_http_error(self, exc: urllib.error.HTTPError) -> dict:
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except OSError:
            body = ""

        parsed = self._parse_json(body, exc.filename or "")
        if parsed.get("ok") is False:
            return parsed

        return _error(
            "CONTEXT_HTTP_STATUS_ERROR",
            f"HTTP {exc.code}",
            {
                "status": exc.code,
                "reason": exc.reason,
            },
        )

    def _parse_json(self, body: str, path: str) -> dict:
        try:
            parsed = json.loads(body or "{}")
        except json.JSONDecodeError as exc:
            return _error(
                "CONTEXT_HTTP_JSON_PARSE_FAILED",
                "Context service returned invalid JSON",
                {
                    "path": path,
                    "message": str(exc),
                },
            )

        if not isinstance(parsed, dict):
            return _error(
                "CONTEXT_HTTP_INVALID_RESPONSE",
                "Context service response must be a JSON object",
                {"path": path},
            )
        return parsed


_DEFAULT_CONTEXT_HTTP_ADAPTER: Optional[BaseContextHttpAdapter] = None


def get_default_context_http_adapter() -> BaseContextHttpAdapter:
    global _DEFAULT_CONTEXT_HTTP_ADAPTER
    if _DEFAULT_CONTEXT_HTTP_ADAPTER is None:
        if os.getenv("USE_CONTEXT_HTTP") == "1":
            _DEFAULT_CONTEXT_HTTP_ADAPTER = RealContextHttpAdapter()
        else:
            _DEFAULT_CONTEXT_HTTP_ADAPTER = MockContextHttpAdapter()
    return _DEFAULT_CONTEXT_HTTP_ADAPTER
