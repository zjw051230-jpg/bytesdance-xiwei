import sys
import unittest
import json
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from interfaces.context_adapter import ContextServiceAdapter
from interfaces.context_http_adapter import MockContextHttpAdapter, RealContextHttpAdapter
from interfaces.event_adapter import ContextEventAdapter


class ContextHttpAdapterTest(unittest.TestCase):
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

    def test_real_http_adapter_builds_context_appends_event_and_reads_latest_seq(self):
        server = FakeContextServer()
        server.start()
        try:
            adapter = RealContextHttpAdapter(base_url=server.base_url)

            context_response = adapter.build_context(
                task_id="real_http_task",
                agent_name="repairAgent",
                current_node_id="sandbox_6",
            )
            event_response = adapter.append_event(
                task_id="real_http_task",
                event={"type": "PLAN_CREATED"},
                expected_seq=0,
            )
            latest_seq = adapter.get_latest_event_seq("real_http_task")

            self.assertTrue(context_response["ok"])
            self.assertEqual(context_response["data"]["agent_name"], "repairAgent")
            self.assertEqual(event_response["event_id"], "evt_1")
            self.assertEqual(event_response["latest_seq"], 1)
            self.assertEqual(latest_seq, 1)
        finally:
            server.stop()


class FakeContextRequestHandler(BaseHTTPRequestHandler):
    latest_seq_by_task = {}

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))).decode("utf-8"))
        if self.path == "/context/build":
            self.respond({
                "ok": True,
                "data": {
                    "task_id": body["taskId"],
                    "agent_name": body["agentName"],
                    "current_node_id": body.get("currentNodeId"),
                    "context": {},
                    "source_node_ids": [],
                    "source_event_ids": [],
                    "budget_report": {},
                    "privacy_report": {},
                    "created_at": "2026-06-07T00:00:00.000Z",
                },
                "latest_seq": self.latest_seq_by_task.get(body["taskId"], 0),
            })
            return
        if self.path == "/events/append":
            task_id = body["taskId"]
            next_seq = self.latest_seq_by_task.get(task_id, 0) + 1
            self.latest_seq_by_task[task_id] = next_seq
            self.respond({
                "ok": True,
                "event_id": f"evt_{next_seq}",
                "seq": next_seq,
                "latest_seq": next_seq,
                "event": {
                    **body["event"],
                    "event_id": f"evt_{next_seq}",
                    "task_id": task_id,
                    "seq": next_seq,
                    "schema_version": "1",
                    "created_at": "2026-06-07T00:00:00.000Z",
                },
            })
            return
        self.send_error(404)

    def do_GET(self):
        if self.path.startswith("/events/latest-seq/"):
            task_id = self.path.rsplit("/", 1)[-1]
            self.respond({
                "ok": True,
                "task_id": task_id,
                "latest_seq": self.latest_seq_by_task.get(task_id, 0),
            })
            return
        self.send_error(404)

    def log_message(self, format, *args):
        return

    def respond(self, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class FakeContextServer:
    def __init__(self):
        FakeContextRequestHandler.latest_seq_by_task = {}
        self.server = HTTPServer(("127.0.0.1", 0), FakeContextRequestHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def start(self):
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()


if __name__ == "__main__":
    unittest.main()
