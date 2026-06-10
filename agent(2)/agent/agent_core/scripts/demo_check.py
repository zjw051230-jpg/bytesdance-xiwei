from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "context-service-handoff" / "context-service-handoff" / "code" / "backend"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _request_json(method: str, url: str, payload: dict | None = None, timeout: float = 30.0) -> tuple[int, dict]:
    data = None
    headers = {"accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["content-type"] = "application/json"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            return int(response.status), json.loads(body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return int(exc.code), json.loads(body)


def _wait_for_backend(base_url: str, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            status, data = _request_json("GET", f"{base_url}/context/health", timeout=2.0)
            if status == 200 and data.get("ok") is True:
                return
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            last_error = exc
        time.sleep(0.25)
    raise RuntimeError(f"backend did not become ready: {last_error}")


def _start_backend(port: int) -> subprocess.Popen:
    if not BACKEND_DIR.exists():
        raise RuntimeError(f"backend directory not found: {BACKEND_DIR}")

    env = dict(os.environ)
    env["PORT"] = str(port)
    return subprocess.Popen(
        ["node", "src/contextServiceServer.js"],
        cwd=str(BACKEND_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _assert_agent_response(response: dict) -> None:
    if response.get("ok") is not True:
        raise AssertionError(f"agent response not ok: {response}")
    result = response.get("result")
    if not isinstance(result, dict):
        raise AssertionError(f"agent result missing: {response}")
    for key in ("task_id", "status", "selected_actions", "verification_result", "safety_gates"):
        if key not in result:
            raise AssertionError(f"agent result missing {key}: {result}")


def main() -> int:
    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    backend = _start_backend(port)
    try:
        _wait_for_backend(base_url)
        print(f"backend_ok {base_url}")

        status, response = _request_json(
            "POST",
            f"{base_url}/api/agent/run",
            {"task": "文章详情页新增字数统计和阅读时间", "mode": "dry_run"},
            timeout=60.0,
        )
        if status != 200:
            raise AssertionError(f"mock task HTTP status {status}: {response}")
        _assert_agent_response(response)
        print("mock_agent_json_ok")

        with tempfile.TemporaryDirectory() as repo_root:
            note_path = Path(repo_root) / "note.txt"
            status, preview_response = _request_json(
                "POST",
                f"{base_url}/api/agent/run",
                {
                    "task": "创建 note.txt 文件，内容为 hello",
                    "repoPath": repo_root,
                    "mode": "preview",
                },
                timeout=60.0,
            )
            if status != 200:
                raise AssertionError(f"preview task HTTP status {status}: {preview_response}")
            _assert_agent_response(preview_response)
            if note_path.exists():
                raise AssertionError("repo preview unexpectedly wrote note.txt")
            gates = preview_response["result"].get("safety_gates", {})
            if gates.get("repo_confirmed") is True:
                raise AssertionError("repo preview unexpectedly confirmed real writes")
        print("repo_preview_no_write_ok")
        print("demo_check_ok")
        return 0
    finally:
        backend.terminate()
        try:
            backend.wait(timeout=5)
        except subprocess.TimeoutExpired:
            backend.kill()
            backend.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
