from pathlib import Path
import sys


AGENT_CORE_DIR = Path(__file__).resolve().parents[1]
if str(AGENT_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_CORE_DIR))

from interfaces.llm_adapter import get_default_llm_adapter


def _raw_error_summary(raw):
    if not raw:
        return None

    raw_error = raw.get("error") if isinstance(raw, dict) else getattr(raw, "error", None)
    if not raw_error:
        return None

    if isinstance(raw_error, dict):
        error_type = raw_error.get("type") or raw_error.get("code") or "unknown"
        message = raw_error.get("message") or raw_error.get("msg") or ""
    else:
        error_type = type(raw_error).__name__
        message = getattr(raw_error, "message", None) or str(raw_error)

    return f"{error_type}: {message}".strip()


def main() -> None:
    adapter = get_default_llm_adapter()
    result = adapter.generate("Only reply OK")
    provider = result.get("provider")
    model = result.get("model")
    ok = result.get("ok")
    text = (result.get("text") or "").strip()
    error = result.get("error")
    raw_error = _raw_error_summary(result.get("raw"))

    print(f"provider={provider}")
    print(f"model={model}")
    print(f"ok={ok}")
    print(f"text={text}")
    print(f"error={error}")
    if raw_error:
        print(f"raw_error={raw_error}")


if __name__ == "__main__":
    main()
