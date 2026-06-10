# Adapter Reference

Last synchronized: 2026-06-09.

The runtime is adapter-first. Mock adapters remain the default where they preserve safe deterministic behavior, while real adapters are available behind explicit gates.

## BaseLLMAdapter

File: `agent_core/interfaces/llm_adapter.py`

Responsibilities:

- Generate model text.
- Support planner/coder LLM gates.
- Optionally select the next action through strict JSON action decision.

Interface:

```python
def generate(self, prompt, **kwargs):
    raise NotImplementedError

def decide_action(self, state, available_actions, model_info):
    raise NotImplementedError
```

Current implementations:

- `MockLLMAdapter`: default deterministic/fixed behavior for tests and local runs.
- `DoubaoLLMAdapter`: real Doubao generate capability, enabled through provider/API environment variables.

Related gates:

```text
AGENT_LLM_PROVIDER=doubao
AGENT_USE_LLM_PLANNER=1
AGENT_USE_LLM_CODER=1
AGENT_LLM_ACTION_DECISION=1
```

LLM action decision can only choose from the runtime whitelist and falls back to the fixed sequence on invalid JSON, unknown action, low confidence, unavailable tool, or hook guard rejection.

## BaseMemoryAdapter

File: `agent_core/interfaces/memory_adapter.py`

Responsibilities:

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

Current limitation:

- This is not a persistent vector database. Durable semantic memory, embeddings, vector search, and cross-session memory indexing are not implemented.

## BaseRepoAdapter

File: `agent_core/interfaces/repo_adapter.py`

Responsibilities:

- Read repository files.
- List and search repository contents.
- Apply structured patch plans.
- Return diffs or previews.
- Keep repo access inside the configured root.

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

Current implementations:

- `MockRepoAdapter`: default mock execution path.
- `RealRepoAdapter`: real file tree read/search plus dry-run, preview, and controlled apply modes.

Supported real modes:

```text
real_repo_dry_run
real_repo_preview
real_repo_apply
```

Real writes require:

```text
AGENT_REPO_MODE=real
AGENT_REPO_ROOT=<repo path>
AGENT_REPO_APPLY=1
AGENT_REPO_CONFIRM=YES
```

Node `/api/agent/run` does not set `AGENT_REPO_CONFIRM=YES`, so backend-driven repo work remains preview-safe.

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

Responsibilities:

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

Events are written for action decisions, planning, file location, patch generation, review, execution, verification, controlled test execution, and task finish.

## BaseContextHttpAdapter

File: `agent_core/interfaces/context_http_adapter.py`

Responsibilities:

- Represent the HTTP boundary to the Node Context Service wrapper.
- Build context through `/context/build`.
- Append events through `/events/append`.
- Read safe events and latest sequence when needed.

Interface:

```python
def build_context(self, task_id, agent_name, current_node_id=None):
    raise NotImplementedError

def append_event(self, task_id, event, expected_seq=None):
    raise NotImplementedError
```

Current implementations:

- `MockContextHttpAdapter`: default, no live service required.
- `RealContextHttpAdapter`: enabled with `USE_CONTEXT_HTTP=1`.

Related environment:

```text
USE_CONTEXT_HTTP=1
CONTEXT_SERVICE_URL=http://127.0.0.1:4000
CONTEXT_HTTP_TIMEOUT=5
```

## BaseTestAdapter

File: `agent_core/interfaces/test_adapter.py`

Responsibility:

- Preview or run allowed verification commands.

Interface:

```python
def run_tests(self, commands: list[str]) -> dict:
    raise NotImplementedError
```

Current implementations:

- `MockTestAdapter`: default deterministic verification result.
- `RealTestAdapter`: preview by default, controlled execution only with explicit double confirmation.

Real execution gates:

```text
AGENT_TEST_RUN=1
AGENT_TEST_CONFIRM=YES
```

Execution restrictions:

- whitelist-only commands
- `shell=False`
- repo-root constrained cwd
- timeout
- stdout/stderr capture
- exit-code recording
- no chained commands, redirects, pipes, deletes, downloads, or dependency installs
