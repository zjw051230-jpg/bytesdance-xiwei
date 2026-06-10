import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from interfaces.llm_adapter import RealLLMAdapter, parse_json_object
from orchestrator.state import AgentState


class LLMAdapterTest(unittest.TestCase):
    def test_parse_json_object_handles_plain_and_fenced_json(self):
        self.assertEqual(parse_json_object('{"tool":"finish"}')["tool"], "finish")
        self.assertEqual(parse_json_object('```json\n{"tool":"finish"}\n```')["tool"], "finish")

    def test_real_llm_adapter_uses_chat_completion_contract(self):
        server = FakeLLMServer()
        server.start()
        try:
            adapter = RealLLMAdapter(
                api_key="test-key",
                model="ep-test",
                base_url=server.base_url,
            )
            state = AgentState(task_id="llm_adapter_test", user_input="demo")
            action = adapter.decide_action(
                state,
                [{"name": "finish", "description": "Finish", "category": "done"}],
                {"model": "ep-test", "provider": "ark"},
            )

            self.assertEqual(action["tool"], "finish")
            self.assertEqual(action["args"]["selected_model"], "ep-test")
            self.assertEqual(server.last_request["model"], "ep-test")
            self.assertIn("authorization", server.last_headers)
        finally:
            server.stop()


class FakeLLMRequestHandler(BaseHTTPRequestHandler):
    last_request = None
    last_headers = None

    def do_POST(self):
        if self.path != "/chat/completions":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))).decode("utf-8"))
        self.__class__.last_request = body
        self.__class__.last_headers = {key.lower(): value for key, value in self.headers.items()}
        self.respond({
            "choices": [
                {
                    "message": {
                        "content": json.dumps({
                            "thought": "Finish safely",
                            "tool": "finish",
                            "args": {},
                        })
                    }
                }
            ]
        })

    def log_message(self, format, *args):
        return

    def respond(self, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class FakeLLMServer:
    def __init__(self):
        FakeLLMRequestHandler.last_request = None
        FakeLLMRequestHandler.last_headers = None
        self.server = HTTPServer(("127.0.0.1", 0), FakeLLMRequestHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    @property
    def last_request(self):
        return FakeLLMRequestHandler.last_request

    @property
    def last_headers(self):
        return FakeLLMRequestHandler.last_headers

    def start(self):
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()


if __name__ == "__main__":
    unittest.main()
