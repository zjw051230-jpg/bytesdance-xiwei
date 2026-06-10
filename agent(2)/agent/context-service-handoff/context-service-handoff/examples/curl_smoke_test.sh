#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${CONTEXT_SERVICE_URL:-http://127.0.0.1:4000}"
TASK_ID="${1:-task_001}"

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  echo
  echo ">>> ${method} ${BASE_URL}${path}"
  if [[ -n "${body}" ]]; then
    curl -sS -X "${method}" "${BASE_URL}${path}" \
      -H "content-type: application/json" \
      --data "${body}"
  else
    curl -sS -X "${method}" "${BASE_URL}${path}"
  fi
  echo
}

request GET /context/health

request POST /events/append "$(cat <<JSON
{
  "taskId": "${TASK_ID}",
  "event": {
    "type": "PLAN_CREATED",
    "category": "domain_event",
    "producer": "planAgent",
    "trace_id": "${TASK_ID}",
    "span_id": "plan_2",
    "parent_span_id": null,
    "run_id": "run_${TASK_ID}",
    "payload": {
      "plan": {
        "task_name": "Add article word stats",
        "target_files_hint": ["frontend/src/pages/Article.jsx"]
      }
    },
    "idempotency_key": "PLAN_CREATED:${TASK_ID}:2"
  },
  "expectedSeq": 0
}
JSON
)"

request POST /events/append "$(cat <<JSON
{
  "taskId": "${TASK_ID}",
  "event": {
    "type": "PATCH_GENERATED",
    "category": "domain_event",
    "producer": "codegenAgent",
    "trace_id": "${TASK_ID}",
    "span_id": "patch_4",
    "parent_span_id": "plan_2",
    "run_id": "run_${TASK_ID}",
    "payload": {
      "summary": "Generate patch for article word stats",
      "patch_plan": {
        "summary": "Patch article page",
        "patches": [
          {
            "file": "frontend/src/pages/Article.jsx",
            "changes": ["Render word stats"]
          }
        ]
      }
    },
    "idempotency_key": "PATCH_GENERATED:${TASK_ID}:4"
  },
  "expectedSeq": 3
}
JSON
)"

request POST /events/append "$(cat <<JSON
{
  "taskId": "${TASK_ID}",
  "event": {
    "type": "REVIEW_COMPLETED",
    "category": "domain_event",
    "producer": "deliveryAgent",
    "trace_id": "${TASK_ID}",
    "span_id": "review_5",
    "parent_span_id": "patch_4",
    "run_id": "run_${TASK_ID}",
    "payload": {
      "review": {
        "approved": true,
        "summary": "Review passed"
      }
    },
    "idempotency_key": "REVIEW_COMPLETED:${TASK_ID}:5"
  },
  "expectedSeq": 5
}
JSON
)"

request POST /events/append "$(cat <<JSON
{
  "taskId": "${TASK_ID}",
  "event": {
    "type": "EXECUTION_COMPLETED",
    "category": "domain_event",
    "producer": "repairAgent",
    "trace_id": "${TASK_ID}",
    "span_id": "sandbox_6",
    "parent_span_id": "review_5",
    "run_id": "run_${TASK_ID}",
    "payload": {
      "execution_result": {
        "executed": false,
        "summary": "ReferenceError: wordCount is not defined"
      }
    },
    "idempotency_key": "EXECUTION_COMPLETED:${TASK_ID}:6"
  },
  "expectedSeq": 7
}
JSON
)"

request POST /trace/rebuild "{\"taskId\":\"${TASK_ID}\"}"
request POST /context/build "{\"taskId\":\"${TASK_ID}\",\"agentName\":\"repairAgent\",\"currentNodeId\":\"sandbox_6\"}"
request GET "/events/safe/${TASK_ID}"

