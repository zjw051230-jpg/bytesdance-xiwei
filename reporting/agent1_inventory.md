## Agent(1) Inventory

- type: mixed_python_agent_runtime_and_node_context_service
- root: C:\Users\www30\Desktop\oka\bytesdance-xiwei\agent(1)\agent
- file count: 267
- entrypoints: agent/agent_core/main.py, agent/agent_core/scripts/llm_smoke.py, agent/context-service-handoff/context-service-handoff/code/backend/package.json, agent/context-service-handoff/context-service-handoff/code/backend/src/server.js
- dependencies: python=true, node=true
- config env: AGENT_LLM_PROVIDER, DOUBAO_API_KEY, DOUBAO_ENDPOINT, DOUBAO_BASE_URL, AGENT_USE_LLM_PLANNER, AGENT_USE_LLM_CODER, AGENT_REPO_MODE, AGENT_REPO_ROOT, AGENT_REPO_APPLY, AGENT_REPO_CONFIRM, USE_CONTEXT_HTTP, CONTEXT_SERVICE_URL
- input: stdin text requirement; workbench=RequirementDSL/current planning task plus project metadata
- output: dry-run plan, review summary, PR draft, artifacts JSON
- invocation: python agent_core/main.py

### Safety Risks
- can write files: true
- can execute shell: true
- can access target repo: true
- depends on F:\dsl-v2: false
- depends on API key env: true

### Reusable Modules
- agent_core/docs/* as contract documentation
- agent_core/interfaces/repo_adapter.py safety gates
- agent_core/storage/states/*.json as example artifacts
- context-service-handoff HTTP contract docs

### Do Not Directly Integrate
- node_modules
- __pycache__
- raw storage states as production state
- real_repo_apply mode
- AGENT_REPO_CONFIRM=YES path
- context-service backend as embedded source without dependency review