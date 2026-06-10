import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

import interfaces.context_http_adapter as context_http_module
from interfaces.context_adapter import ContextServiceAdapter
from interfaces.context_http_adapter import (
    MockContextHttpAdapter,
    RealContextHttpAdapter,
    get_default_context_http_adapter,
)
from interfaces.event_adapter import ContextEventAdapter


class FakeHttpResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self.payload.encode("utf-8")


class ContextHttpAdapterTest(unittest.TestCase):
    def tearDown(self):
        context_http_module._DEFAULT_CONTEXT_HTTP_ADAPTER = None

    def test_mock_http_adapter_build_context(self):
        adapter = MockContextHttpAdapter()

        response = adapter.build_context(
            task_id="http_context_test",
            agent_name="planAgent",
            current_node_id="plan_1",
        )

        self.assertTrue(response["ok"])
        self.assertEqual(response["source"], "mock_http")
        self.assertEqual(response["data"]["task_id"], "http_context_test")
        self.assertEqual(response["data"]["agent_name"], "planAgent")
        self.assertEqual(response["data"]["current_node_id"], "plan_1")

    def test_mock_http_adapter_append_event(self):
        adapter = MockContextHttpAdapter()

        response = adapter.append_event(
            task_id="http_event_test",
            event={"type": "PLAN_CREATED"},
            expected_seq=0,
        )

        self.assertTrue(response["ok"])
        self.assertEqual(response["source"], "mock_http")
        self.assertEqual(response["event_id"], "evt_mock")

    def test_context_service_adapter_returns_context_data(self):
        adapter = ContextServiceAdapter(context_http_adapter=MockContextHttpAdapter())

        context = adapter.build_context_for_agent(
            task_id="service_context_test",
            agent_name="codegenAgent",
            current_node_id=None,
        )

        self.assertEqual(context["task_id"], "service_context_test")
        self.assertEqual(context["agent_name"], "codegenAgent")
        self.assertIn("budget_report", context)
        self.assertIn("privacy_report", context)

    def test_context_event_adapter_returns_complete_event(self):
        adapter = ContextEventAdapter(context_http_adapter=MockContextHttpAdapter())

        event = adapter.append_event(
            task_id="service_event_test",
            event={
                "type": "PLAN_CREATED",
                "category": "domain_event",
                "producer": "planAgent",
            },
            expected_seq=0,
        )

        self.assertEqual(event["event_id"], "evt_mock")
        self.assertEqual(event["task_id"], "service_event_test")
        self.assertEqual(event["seq"], 1)
        self.assertEqual(event["schema_version"], "1")
        self.assertEqual(event["source"], "mock_http")
        self.assertEqual(adapter.get_latest_event_seq("service_event_test"), 1)

    def test_default_context_http_adapter_still_mock(self):
        with patch.dict(os.environ, {}, clear=True):
            context_http_module._DEFAULT_CONTEXT_HTTP_ADAPTER = None
            adapter = get_default_context_http_adapter()

        self.assertIsInstance(adapter, MockContextHttpAdapter)

    def test_use_context_http_returns_real_adapter(self):
        with patch.dict(os.environ, {"USE_CONTEXT_HTTP": "1"}, clear=True):
            context_http_module._DEFAULT_CONTEXT_HTTP_ADAPTER = None
            adapter = get_default_context_http_adapter()

        self.assertIsInstance(adapter, RealContextHttpAdapter)

    def test_real_http_health_success(self):
        adapter = RealContextHttpAdapter(base_url="http://example.test", timeout=1)

        with patch(
            "interfaces.context_http_adapter.urllib.request.urlopen",
            return_value=FakeHttpResponse('{"ok": true, "status": "healthy"}'),
        ) as urlopen:
            response = adapter.health()

        request = urlopen.call_args.args[0]
        self.assertTrue(response["ok"])
        self.assertEqual(request.full_url, "http://example.test/api/context/health")
        self.assertEqual(request.get_method(), "GET")

    def test_real_http_build_context_sends_payload(self):
        adapter = RealContextHttpAdapter(base_url="http://example.test", timeout=1)

        with patch(
            "interfaces.context_http_adapter.urllib.request.urlopen",
            return_value=FakeHttpResponse('{"ok": true, "data": {"context": {}}}'),
        ) as urlopen:
            response = adapter.build_context("task_1", "planAgent", "node_1")

        request = urlopen.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertTrue(response["ok"])
        self.assertEqual(request.full_url, "http://example.test/api/context/build")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(payload["taskId"], "task_1")
        self.assertEqual(payload["agentName"], "planAgent")
        self.assertEqual(payload["currentNodeId"], "node_1")

    def test_real_http_append_event_sends_payload(self):
        adapter = RealContextHttpAdapter(base_url="http://example.test", timeout=1)

        with patch(
            "interfaces.context_http_adapter.urllib.request.urlopen",
            return_value=FakeHttpResponse('{"ok": true, "eventId": "evt_1"}'),
        ) as urlopen:
            response = adapter.append_event("task_1", {"type": "PLAN_CREATED"}, expected_seq=3)

        request = urlopen.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertTrue(response["ok"])
        self.assertEqual(request.full_url, "http://example.test/api/context/events/append")
        self.assertEqual(payload["taskId"], "task_1")
        self.assertEqual(payload["event"]["type"], "PLAN_CREATED")
        self.assertEqual(payload["expectedSeq"], 3)

    def test_real_http_latest_seq_uses_endpoint(self):
        adapter = RealContextHttpAdapter(base_url="http://example.test", timeout=1)

        with patch(
            "interfaces.context_http_adapter.urllib.request.urlopen",
            return_value=FakeHttpResponse('{"ok": true, "latestSeq": 7}'),
        ) as urlopen:
            response = adapter.latest_seq("task/id")

        request = urlopen.call_args.args[0]
        self.assertTrue(response["ok"])
        self.assertEqual(request.full_url, "http://example.test/api/context/events/latest-seq/task%2Fid")

    def test_real_http_read_safe_events_uses_safe_endpoint(self):
        adapter = RealContextHttpAdapter(base_url="http://example.test", timeout=1)

        with patch(
            "interfaces.context_http_adapter.urllib.request.urlopen",
            return_value=FakeHttpResponse('{"ok": true, "events": []}'),
        ) as urlopen:
            response = adapter.read_safe_events("task_1")

        request = urlopen.call_args.args[0]
        self.assertTrue(response["ok"])
        self.assertEqual(request.full_url, "http://example.test/api/context/events/safe/task_1")

    def test_real_http_rebuild_trace_uses_endpoint(self):
        adapter = RealContextHttpAdapter(base_url="http://example.test", timeout=1)

        with patch(
            "interfaces.context_http_adapter.urllib.request.urlopen",
            return_value=FakeHttpResponse('{"ok": true, "data": {"nodes": []}}'),
        ) as urlopen:
            response = adapter.rebuild_trace("task_1")

        request = urlopen.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertTrue(response["ok"])
        self.assertEqual(request.full_url, "http://example.test/api/context/trace/rebuild")
        self.assertEqual(payload["taskId"], "task_1")

    def test_real_http_connection_failure_returns_structured_error(self):
        adapter = RealContextHttpAdapter(base_url="http://example.test", timeout=1)

        with patch(
            "interfaces.context_http_adapter.urllib.request.urlopen",
            side_effect=URLError("service unavailable"),
        ):
            response = adapter.health()

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "CONTEXT_HTTP_CONNECTION_FAILED")

    def test_real_http_json_parse_failure_returns_structured_error(self):
        adapter = RealContextHttpAdapter(base_url="http://example.test", timeout=1)

        with patch(
            "interfaces.context_http_adapter.urllib.request.urlopen",
            return_value=FakeHttpResponse("not json"),
        ):
            response = adapter.health()

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "CONTEXT_HTTP_JSON_PARSE_FAILED")


if __name__ == "__main__":
    unittest.main()
