from typing import Any, Dict, List


class BaseMemoryAdapter:
    def retrieve(self, query, top_k=3):
        raise NotImplementedError

    def save_case(self, case_data):
        raise NotImplementedError

    def save_event(self, event_data):
        raise NotImplementedError


class InMemoryMemoryAdapter(BaseMemoryAdapter):
    def __init__(self):
        self.cases: List[Dict[str, Any]] = []
        self.events: List[Dict[str, Any]] = []

    def retrieve(self, query, top_k=3):
        if not isinstance(query, str) or not query.strip():
            return []

        needle = query.lower()
        matches = []
        for case in self.cases:
            requirement = str(case.get("requirement", "")).lower()
            if needle in requirement:
                matches.append(case)
                if len(matches) >= top_k:
                    break
        return matches

    def save_case(self, case_data):
        normalized = {
            "requirement": case_data.get("requirement", ""),
            "skill": case_data.get("skill", ""),
            "summary": case_data.get("summary", ""),
        }
        self.cases.append(normalized)
        return normalized

    def save_event(self, event_data):
        normalized = {
            "stage": event_data.get("stage", ""),
            "action": event_data.get("action", ""),
            "timestamp": event_data.get("timestamp", ""),
            "payload": event_data.get("payload", {}),
        }
        self.events.append(normalized)
        return normalized


def get_default_memory_adapter() -> BaseMemoryAdapter:
    return InMemoryMemoryAdapter()
