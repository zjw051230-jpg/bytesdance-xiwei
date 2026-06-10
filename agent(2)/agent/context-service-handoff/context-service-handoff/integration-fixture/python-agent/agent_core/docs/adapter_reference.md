# Adapter Reference

## BaseLLMAdapter

File: `agent_core/interfaces/llm_adapter.py`

Responsibility:

- Select the next action from state, available actions, and model metadata.

Interface:

```python
def decide_action(self, state, available_actions, model_info):
    raise NotImplementedError
```

Current implementation:

- `MockLLMAdapter`

## BaseMemoryAdapter

File: `agent_core/interfaces/memory_adapter.py`

Responsibility:

- Retrieve previous cases.
- Save completed cases.
- Save runtime events.

Interface:

```python
def retrieve(self, query, top_k=3):
    raise NotImplementedError

def save_case(self, case_data):
    raise NotImplementedError

def save_event(self, event_data):
    raise NotImplementedError
```

Current implementation:

- `InMemoryMemoryAdapter`

## BaseRepoAdapter

File: `agent_core/interfaces/repo_adapter.py`

Responsibility:

- Read repository files.
- Apply patch plans.
- Return diffs.
- Run approved commands.

Interface:

```python
def read_file(self, path: str) -> dict:
    raise NotImplementedError

def apply_patch(self, file: str, changes: list) -> dict:
    raise NotImplementedError

def get_diff(self) -> dict:
    raise NotImplementedError

def run_command(self, command: str) -> dict:
    raise NotImplementedError
```

Current implementation:

- `MockRepoAdapter`

## BaseContextAdapter

File: `agent_core/interfaces/context_adapter.py`

Responsibility:

- Build Context Service-compatible context for a specific agent stage.

Interface:

```python
def build_context_for_agent(
    self,
    task_id: str,
    agent_name: str,
    current_node_id=None,
) -> dict:
    raise NotImplementedError
```

Current implementations:

- `MockContextAdapter`
- `ContextServiceAdapter`

## BaseEventAdapter

File: `agent_core/interfaces/event_adapter.py`

Responsibility:

- Append domain events.
- Track latest event sequence.

Interface:

```python
def append_event(self, task_id: str, event: dict, expected_seq=None) -> dict:
    raise NotImplementedError

def get_latest_event_seq(self, task_id: str) -> int:
    raise NotImplementedError
```

Current implementations:

- `MockEventAdapter`
- `ContextEventAdapter`

## BaseContextHttpAdapter

File: `agent_core/interfaces/context_http_adapter.py`

Responsibility:

- Represent the future HTTP boundary to the Node Context Service wrapper.
- Build context through `/context/build`.
- Append events through `/events/append`.

Interface:

```python
def build_context(self, task_id, agent_name, current_node_id=None):
    raise NotImplementedError

def append_event(self, task_id, event, expected_seq=None):
    raise NotImplementedError
```

Current implementation:

- `MockContextHttpAdapter`

## BaseTestAdapter

File: `agent_core/interfaces/test_adapter.py`

Responsibility:

- Run lint or test commands for verification.

Interface:

```python
def run_tests(self, commands: list[str]) -> dict:
    raise NotImplementedError
```

Current implementation:

- `MockTestAdapter`
