from __future__ import annotations

import os
import re
import time
from datetime import datetime
from typing import Any, Dict, Optional


SECRET_PATTERNS = (
    re.compile(r"api[_-]?key", re.IGNORECASE),
    re.compile(r"secret", re.IGNORECASE),
    re.compile(r"token", re.IGNORECASE),
    re.compile(r"\.env", re.IGNORECASE),
)


def now_ms() -> float:
    return time.perf_counter() * 1000.0


def _safe_text_for_count(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    if any(pattern.search(text) for pattern in SECRET_PATTERNS):
        return "[redacted]"
    return text


def estimate_tokens(text: Any) -> int:
    safe = _safe_text_for_count(text)
    if not safe:
        return 0
    return max(1, int((len(safe) + 3) / 4))


def _usage_from_result(result: Dict[str, Any]) -> Dict[str, int]:
    raw = result.get("raw") if isinstance(result.get("raw"), dict) else {}
    usage = result.get("usage") if isinstance(result.get("usage"), dict) else raw.get("usage") if isinstance(raw.get("usage"), dict) else {}
    prompt = usage.get("prompt_tokens") or usage.get("promptTokens") or usage.get("input_tokens") or 0
    completion = usage.get("completion_tokens") or usage.get("completionTokens") or usage.get("output_tokens") or 0
    total = usage.get("total_tokens") or usage.get("totalTokens") or 0
    try:
        prompt = int(prompt or 0)
    except (TypeError, ValueError):
        prompt = 0
    try:
        completion = int(completion or 0)
    except (TypeError, ValueError):
        completion = 0
    try:
        total = int(total or 0)
    except (TypeError, ValueError):
        total = 0
    if total <= 0:
        total = prompt + completion
    return {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": total}


def _error_type(result: Dict[str, Any]) -> Optional[str]:
    if result.get("ok") is True:
        return None
    error = str(result.get("error") or "unknown_error")
    return error.split(":", 1)[0][:80]


def _estimated_cost(provider: str, model: str, prompt_tokens: int, completion_tokens: int) -> float:
    # Optional env rates are dollars per 1K tokens. Defaults keep demos cost-safe.
    prefix = f"LLM_COST_{str(provider or 'unknown').upper()}"
    prompt_rate = os.getenv(prefix + "_PROMPT_PER_1K", "0")
    completion_rate = os.getenv(prefix + "_COMPLETION_PER_1K", "0")
    try:
        prompt_cost = (prompt_tokens / 1000.0) * float(prompt_rate)
        completion_cost = (completion_tokens / 1000.0) * float(completion_rate)
    except (TypeError, ValueError):
        return 0.0
    return round(prompt_cost + completion_cost, 8)


def build_llm_call_metric(
    stage: str,
    result: Dict[str, Any],
    prompt: str = "",
    system_prompt: str = "",
    started_ms: Optional[float] = None,
    ended_ms: Optional[float] = None,
) -> Dict[str, Any]:
    result = result if isinstance(result, dict) else {}
    ended = ended_ms if ended_ms is not None else now_ms()
    started = started_ms if started_ms is not None else ended
    provider = result.get("provider") or "unknown"
    model = result.get("model") or "unknown"
    usage = _usage_from_result(result)
    prompt_tokens = usage["prompt_tokens"] or estimate_tokens((system_prompt or "") + "\n" + (prompt or ""))
    completion_tokens = usage["completion_tokens"] or estimate_tokens(result.get("text", ""))
    total_tokens = usage["total_tokens"] or prompt_tokens + completion_tokens
    call_id = f"llm_{stage}_{int(time.time() * 1000)}_{abs(hash((stage, provider, model, started))) % 100000}"
    return {
        "call_id": call_id,
        "stage": stage,
        "provider": provider,
        "model": model,
        "prompt_tokens": int(prompt_tokens),
        "completion_tokens": int(completion_tokens),
        "total_tokens": int(total_tokens),
        "latency_ms": max(0, int(ended - started)),
        "success": result.get("ok") is True,
        "error_type": _error_type(result),
        "estimated_cost": _estimated_cost(provider, model, int(prompt_tokens), int(completion_tokens)),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


def summarize_llm_metrics(metrics: Any) -> Dict[str, Any]:
    items = metrics if isinstance(metrics, list) else []
    calls_by_stage: Dict[str, int] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        stage = str(item.get("stage") or "unknown")
        calls_by_stage[stage] = calls_by_stage.get(stage, 0) + 1
    return {
        "total_calls": len([item for item in items if isinstance(item, dict)]),
        "successful_calls": len([item for item in items if isinstance(item, dict) and item.get("success") is True]),
        "failed_calls": len([item for item in items if isinstance(item, dict) and item.get("success") is False]),
        "total_tokens": sum(int(item.get("total_tokens") or 0) for item in items if isinstance(item, dict)),
        "total_latency_ms": sum(int(item.get("latency_ms") or 0) for item in items if isinstance(item, dict)),
        "estimated_total_cost": round(sum(float(item.get("estimated_cost") or 0.0) for item in items if isinstance(item, dict)), 8),
        "calls_by_stage": calls_by_stage,
    }


def record_llm_metric(state, metric: Dict[str, Any], memory_adapter=None, event_adapter=None) -> None:
    if state is None or not isinstance(metric, dict):
        return
    state.artifacts.setdefault("llm_metrics", []).append(metric)
    state.artifacts["llm_metrics_summary"] = summarize_llm_metrics(state.artifacts.get("llm_metrics"))
    if memory_adapter is not None:
        memory_adapter.save_event(
            {
                "stage": "llm_metrics",
                "action": "record_llm_call",
                "timestamp": "runtime",
                "payload": metric,
            }
        )
    state.add_context_snapshot(
        "observabilityAgent",
        {
            "task_id": state.task_id,
            "agent_name": "observabilityAgent",
            "current_node_id": state.current_node_id,
            "llm_metric": metric,
            "llm_metrics_summary": state.artifacts["llm_metrics_summary"],
        },
    )
    if event_adapter is not None:
        expected_seq = event_adapter.get_latest_event_seq(state.task_id)
        event = {
            "type": "LLM_CALL_RECORDED",
            "category": "domain_event",
            "producer": "observabilityAgent",
            "trace_id": state.task_id,
            "span_id": metric.get("call_id"),
            "parent_span_id": state.current_node_id,
            "run_id": state.run_id,
            "payload": {"llm_metric": metric},
            "idempotency_key": f"LLM_CALL_RECORDED:{state.task_id}:{metric.get('call_id')}",
        }
        state.artifacts["last_llm_metric_event"] = event_adapter.append_event(state.task_id, event, expected_seq=expected_seq)
