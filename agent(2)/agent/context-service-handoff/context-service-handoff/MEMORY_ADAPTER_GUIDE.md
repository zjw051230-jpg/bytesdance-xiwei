# Memory Adapter Guide

最小 Memory Adapter 只需要接这些能力：

- `appendEvent`
- `buildContextForAgent`
- `readSafeEvents`
- `getLatestSeq`
- `rebuildTrace`

不要直接读写 `.ai-runs`。Runtime 侧只消费 HTTP Wrapper 的返回值。

## 环境变量

```text
USE_CONTEXT_HTTP=1
CONTEXT_SERVICE_URL=http://127.0.0.1:4000
```

## Python 伪代码

```python
import requests


class RealContextHttpAdapter:
    def __init__(self, base_url):
        self.base_url = base_url.rstrip("/")

    def append_event(self, task_id, event, expected_seq=None):
        payload = {
            "taskId": task_id,
            "event": event,
        }
        if expected_seq is not None:
            payload["expectedSeq"] = expected_seq

        response = requests.post(
            f"{self.base_url}/events/append",
            json=payload,
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        return {
            "event_id": data.get("event_id"),
            "seq": data.get("seq"),
            "latest_seq": data.get("latest_seq"),
            "event": data.get("event"),
            "appended_events": data.get("appended_events", []),
        }

    def build_context(self, task_id, agent_name, current_node_id=None):
        payload = {
            "taskId": task_id,
            "agentName": agent_name,
            "currentNodeId": current_node_id,
        }
        response = requests.post(
            f"{self.base_url}/context/build",
            json=payload,
            timeout=10,
        )
        response.raise_for_status()
        return response.json()["data"]

    def latest_seq(self, task_id):
        response = requests.get(
            f"{self.base_url}/events/latest-seq/{task_id}",
            timeout=10,
        )
        response.raise_for_status()
        return response.json()["latest_seq"]

    def read_safe_events(self, task_id):
        response = requests.get(
            f"{self.base_url}/events/safe/{task_id}",
            timeout=10,
        )
        response.raise_for_status()
        return response.json()["events"]

    def rebuild_trace(self, task_id):
        response = requests.post(
            f"{self.base_url}/trace/rebuild",
            json={"taskId": task_id},
            timeout=10,
        )
        response.raise_for_status()
        return response.json()["data"]
```

## 调用时机建议

- Planner 开始前：`build_context(task_id, "planAgent", current_node_id)`。
- Coder 开始前：`build_context(task_id, "codegenAgent", current_node_id)`。
- Repair 开始前：`build_context(task_id, "repairAgent", current_node_id)`。
- Delivery / Review 前：`build_context(task_id, "deliveryAgent", current_node_id)`。
- 用户补充 / 中断后重新进入关键阶段时：重新 build 一次。

不要每个 token 或每个 action 都 build context。优先在关键阶段入口调用。

## Seq 使用规则

- 写事件后保存响应里的 `latest_seq`。
- 出现冲突时调用 `GET /events/latest-seq/:taskId` 重新同步。
- 不要本地猜 seq。
- 不要把 `event_id` / `seq` / `created_at` 当作输入事件字段传回服务端。

## currentNodeId 使用规则

- `currentNodeId` 传 JS trace 中存在的 node id。
- Python `span_id` 会映射成 JS trace node id。
- Python `parent_span_id` 会映射成 depends_on edge。
- 如果 `build_context` 返回空或依赖链不完整，先查 `POST /trace/rebuild` 的 trace nodes。

