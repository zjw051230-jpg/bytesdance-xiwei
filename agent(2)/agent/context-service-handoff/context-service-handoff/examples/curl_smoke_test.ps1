$BaseUrl = $env:CONTEXT_SERVICE_URL
if (-not $BaseUrl) {
  $BaseUrl = "http://127.0.0.1:4000"
}

$TaskId = "task_001"
if ($args.Count -gt 0) {
  $TaskId = $args[0]
}

function Invoke-JsonCurl {
  param(
    [string]$Method,
    [string]$Path,
    [string]$Body
  )

  $Url = "$BaseUrl$Path"
  Write-Host ""
  Write-Host ">>> $Method $Url"
  if ($Body) {
    curl.exe -sS -X $Method $Url -H "content-type: application/json" --data $Body
  } else {
    curl.exe -sS -X $Method $Url
  }
  Write-Host ""
}

Invoke-JsonCurl -Method "GET" -Path "/context/health"

$PlanBody = @"
{
  "taskId": "$TaskId",
  "event": {
    "type": "PLAN_CREATED",
    "category": "domain_event",
    "producer": "planAgent",
    "trace_id": "$TaskId",
    "span_id": "plan_2",
    "parent_span_id": null,
    "run_id": "run_$TaskId",
    "payload": {
      "plan": {
        "task_name": "Add article word stats",
        "target_files_hint": ["frontend/src/pages/Article.jsx"]
      }
    },
    "idempotency_key": "PLAN_CREATED:$TaskId:2"
  },
  "expectedSeq": 0
}
"@
Invoke-JsonCurl -Method "POST" -Path "/events/append" -Body $PlanBody

$PatchBody = @"
{
  "taskId": "$TaskId",
  "event": {
    "type": "PATCH_GENERATED",
    "category": "domain_event",
    "producer": "codegenAgent",
    "trace_id": "$TaskId",
    "span_id": "patch_4",
    "parent_span_id": "plan_2",
    "run_id": "run_$TaskId",
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
    "idempotency_key": "PATCH_GENERATED:$TaskId:4"
  },
  "expectedSeq": 3
}
"@
Invoke-JsonCurl -Method "POST" -Path "/events/append" -Body $PatchBody

$ReviewBody = @"
{
  "taskId": "$TaskId",
  "event": {
    "type": "REVIEW_COMPLETED",
    "category": "domain_event",
    "producer": "deliveryAgent",
    "trace_id": "$TaskId",
    "span_id": "review_5",
    "parent_span_id": "patch_4",
    "run_id": "run_$TaskId",
    "payload": {
      "review": {
        "approved": true,
        "summary": "Review passed"
      }
    },
    "idempotency_key": "REVIEW_COMPLETED:$TaskId:5"
  },
  "expectedSeq": 5
}
"@
Invoke-JsonCurl -Method "POST" -Path "/events/append" -Body $ReviewBody

$ExecutionBody = @"
{
  "taskId": "$TaskId",
  "event": {
    "type": "EXECUTION_COMPLETED",
    "category": "domain_event",
    "producer": "repairAgent",
    "trace_id": "$TaskId",
    "span_id": "sandbox_6",
    "parent_span_id": "review_5",
    "run_id": "run_$TaskId",
    "payload": {
      "execution_result": {
        "executed": false,
        "summary": "ReferenceError: wordCount is not defined"
      }
    },
    "idempotency_key": "EXECUTION_COMPLETED:$TaskId:6"
  },
  "expectedSeq": 7
}
"@
Invoke-JsonCurl -Method "POST" -Path "/events/append" -Body $ExecutionBody

$TraceBody = @"
{
  "taskId": "$TaskId"
}
"@
Invoke-JsonCurl -Method "POST" -Path "/trace/rebuild" -Body $TraceBody

$ContextBody = @"
{
  "taskId": "$TaskId",
  "agentName": "repairAgent",
  "currentNodeId": "sandbox_6"
}
"@
Invoke-JsonCurl -Method "POST" -Path "/context/build" -Body $ContextBody

Invoke-JsonCurl -Method "GET" -Path "/events/safe/$TaskId"

