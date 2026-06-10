# Architecture

## Pipeline View

```text
User
 ↓
Runtime Core
 ↓
Planner
 ↓
Locator
 ↓
Coder
 ↓
Reviewer
 ↓
Executor
 ↓
Verifier
 ↓
Summary
```

## Runtime Components

```text
                      ┌──────────────────────┐
                      │        User          │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌──────────────────────┐
                      │    Runtime Core      │
                      │  orchestrator/loop   │
                      └──────────┬───────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
          ▼                      ▼                      ▼
 ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
 │ Agent Pipeline │     │     Hooks      │     │  Agent State   │
 │ actions/tools  │     │ safety guards  │     │ artifacts/json │
 └───────┬────────┘     └────────────────┘     └────────────────┘
         │
         ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ analyze → skill → plan → locate → code → review → execute   │
 │             → verify → finish                               │
 └──────────────────────────────────────────────────────────────┘
```

## Adapter Relationships

```text
Runtime Core
 ├─ LLM Adapter
 │   └─ MockLLMAdapter today
 │
 ├─ Memory Adapter
 │   └─ InMemoryMemoryAdapter today
 │
 ├─ Repo Adapter
 │   └─ MockRepoAdapter today
 │
 ├─ Context Adapter
 │   ├─ MockContextAdapter today
 │   └─ ContextServiceAdapter for future HTTP mode
 │
 ├─ Event Adapter
 │   ├─ MockEventAdapter today
 │   └─ ContextEventAdapter for future HTTP mode
 │
 ├─ Context HTTP Adapter
 │   └─ MockContextHttpAdapter today
 │
 └─ Test Adapter
     └─ MockTestAdapter today
```

## Context and Event Flow

Before key stages, the runtime builds a context snapshot:

```text
make_plan       → planAgent
generate_patch  → codegenAgent
review_patch    → deliveryAgent
execute_patch   → repairAgent
verify_result   → deliveryAgent
```

After key tools complete, the runtime appends a domain event and records a node:

```text
make_plan       → PLAN_CREATED
generate_patch  → PATCH_GENERATED
review_patch    → REVIEW_COMPLETED
execute_patch   → EXECUTION_COMPLETED
verify_result   → VERIFICATION_COMPLETED
finish          → TASK_FINISHED
```

State, nodes, context snapshots, and artifacts are saved through `AgentState.save()`.
