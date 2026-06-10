# Context Service Handoff

这个包是给 Agent Runtime / Memory Adapter 对接方使用的 Context Service + HTTP Wrapper 交付包。Runtime 可以通过 HTTP 写入事件、重建 trace、构建 Agent 上下文、读取安全事件和查询服务端最新 seq。

## 这个包是什么

- Context Service + HTTP Wrapper 对接包。
- 用于 Agent Runtime 通过 HTTP 读写上下文。
- 包含当前 JS Context 核心代码、HTTP Wrapper 代码、ContextEventMapper、测试文件和一份项目内复制版 Python Agent integration fixture。
- 包含 curl smoke 示例，方便对接方先验证 HTTP 合同，再接入自己的 Memory Adapter。

## 这个包不是什么

本包不负责：

- Runtime。
- Agent Loop。
- 真实 LLM。
- 真实 Repo patch。
- Sandbox 执行。
- 队友正式 Agent 源码维护。

## 队友需要做什么

- 在 Agent Runtime 的 Memory Adapter 中调用 HTTP 接口。
- 使用 `POST /events/append` 写事件。
- 使用 `POST /context/build` 获取不同 Agent 的上下文。
- 使用 `GET /events/safe/:taskId` 做安全事件读取。
- 使用 `GET /events/latest-seq/:taskId` 获取服务端最新 seq。
- 不直接读写 `.ai-runs` 文件。
- 不直接猜 seq；以服务端返回的 `latest_seq` / `seq` 为准。
- `currentNodeId` 必须使用 JS trace 中已经存在的 node id。

## 当前已验证

- Python Agent mock flow 通过。
- Context HTTP Wrapper smoke 通过。
- 跨语言 HTTP integration test 通过。
- `npm test` 通过：`34` 个测试文件、`208` 条测试。

## 包内重要目录

```text
context-service-handoff/
  README_HANDOFF.md
  QUICK_START.md
  HTTP_CONTRACT.md
  EVENT_MAPPING.md
  MEMORY_ADAPTER_GUIDE.md
  SMOKE_TEST_CHECKLIST.md
  TROUBLESHOOTING.md
  TEST_REPORT.md
  examples/
  code/
    backend/src/ai/context/
    backend/src/routes/contextHttpRoutes.js
    backend/src/routes/contextHttpRoutes.test.js
    backend/src/routes/pythonAgentContextHttp.integration.test.js
    backend/src/server.js
  integration-fixture/python-agent/
```

`integration-fixture/python-agent/` 是项目内复制版 integration fixture，不是队友正式 Agent 源码。

## 建议阅读顺序

1. `QUICK_START.md`
2. `HTTP_CONTRACT.md`
3. `EVENT_MAPPING.md`
4. `MEMORY_ADAPTER_GUIDE.md`
5. `SMOKE_TEST_CHECKLIST.md`
6. `TROUBLESHOOTING.md`

