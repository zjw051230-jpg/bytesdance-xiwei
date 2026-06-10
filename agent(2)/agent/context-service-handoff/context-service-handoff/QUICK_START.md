# Quick Start

This page is for local smoke testing the minimal Context HTTP Wrapper.

## 1. Start The Service

Run from the handoff package root:

```powershell
cd code/backend
npm install
npm start
```

The default port is:

```text
PORT=4000
```

You can override it with `PORT`.

## 2. Health Checks

```powershell
curl http://127.0.0.1:4000/context/health
curl http://127.0.0.1:4000/api/context/health
```

Expected response:

```json
{
  "ok": true,
  "service": "context-http-wrapper"
}
```

## 3. Python Agent Integration

```powershell
$env:USE_CONTEXT_HTTP="1"
$env:CONTEXT_SERVICE_URL="http://127.0.0.1:4000"
```

## 4. Append Event

```powershell
curl -X POST http://127.0.0.1:4000/events/append `
  -H "content-type: application/json" `
  -d '{
    "taskId": "task_001",
    "event": {
      "type": "PLAN_CREATED",
      "category": "domain_event",
      "producer": "planAgent",
      "trace_id": "task_001",
      "span_id": "plan_2",
      "parent_span_id": null,
      "run_id": "run_task_001",
      "payload": {
        "plan": {
          "task_name": "Add article word stats"
        }
      },
      "idempotency_key": "PLAN_CREATED:task_001:2"
    },
    "expectedSeq": 0
  }'
```

Use the service response `latest_seq` / `seq` as the source of truth for later writes.

## 5. Rebuild Trace

```powershell
curl -X POST http://127.0.0.1:4000/trace/rebuild `
  -H "content-type: application/json" `
  -d '{"taskId":"task_001"}'
```

## 6. Build Agent Context

```powershell
curl -X POST http://127.0.0.1:4000/context/build `
  -H "content-type: application/json" `
  -d '{
    "taskId": "task_001",
    "agentName": "repairAgent",
    "currentNodeId": "sandbox_6"
  }'
```

`currentNodeId` must be a node id that exists in the JS trace.

## 7. Read Safe Events

```powershell
curl http://127.0.0.1:4000/events/safe/task_001
curl http://127.0.0.1:4000/api/context/events/safe/task_001
```

Use this API instead of reading raw event files directly.
