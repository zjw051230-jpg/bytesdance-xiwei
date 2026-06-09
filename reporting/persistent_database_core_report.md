# Task 13.6-A Persistent Database Core Report

## Scope

Implemented the local persistent database core around SQLite file storage. The work stayed within the allowed database, repository, script, and reporting paths for this task.

## Database

- Type: SQLite via Node `node:sqlite` `DatabaseSync`
- Default path: `data/workbench.sqlite`
- Environment override: `WORKBENCH_DB_PATH`
- Connection settings: `busy_timeout = 5000`, `journal_mode = WAL`, `foreign_keys = ON`
- Initialization behavior: creates the parent `data/` directory, opens/creates the database file, runs idempotent schema SQL, and does not delete or overwrite existing data.

## Schema Coverage

The existing `server/db/schema.sql` covers the required persistent objects:

1. Project
2. Requirement
3. ClarificationTurn
4. DesignPlan
5. PlanningTask
6. AgentRun
7. AgentArtifact
8. ReviewItem
9. PrDraft
10. ActivityLog

## Repository Layer

Added `server/repositories/` with one repository per core object plus shared helpers:

- `projectRepository.js`
- `requirementRepository.js`
- `clarificationRepository.js`
- `designPlanRepository.js`
- `planningTaskRepository.js`
- `agentRunRepository.js`
- `agentArtifactRepository.js`
- `reviewRepository.js`
- `prDraftRepository.js`
- `activityRepository.js`
- `index.js`
- `utils.js`

Each object supports create, getById, list/listByParent, and update. Inputs accept snake_case and common camelCase names; returned records use database field names.

## Scripts

- `db:init`: now performs migration-only initialization without seeding sample data.
- `db:smoke`: writes, updates, reads, and verifies all 10 core objects.
- `smoke:persistence`: writes all 10 object types, closes the connection, opens a new connection, and verifies the records still exist.

The required package scripts were already present in `package.json`:

- `db:init`
- `db:smoke`
- `smoke:persistence`

## Verification

Required commands:

- `npm run db:init`: passed
- `npm run db:smoke`: passed
- `npm run smoke:persistence`: passed
- `npm test`: failed

Additional targeted verification:

- `npm run test:server`: passed, 57 tests
- `npm test -- server/persistence.test.js`: passed, 12 tests
- `npm test -- src/api/persistenceClient.test.js`: passed, 5 tests

`npm test` failure is outside this task's allowed modification area:

- `src/components/frontendPersistence.test.jsx`: 4 failing frontend persistence wiring tests; components render fallback/static state instead of mocked persistent API data.
- `src/App.test.jsx`: 1 failing frontend project creation assertion; "Research Workspace" button is not found after the mocked create flow.

The failing files are under `src/`, which was explicitly forbidden for this task, so no frontend fixes were made.

## Safety Checks

- Required `.gitignore` entries are present:
  - `data/*.sqlite`
  - `data/*.sqlite-*`
  - `data/*.db`
  - `*.sqlite`
  - `*.db`
- `git ls-files` returned no tracked matches for database files, local config files, `runs/`, `node_modules/`, or `dist/`.
- Local ignored paths exist (`configs/api_config.local.json`, `data/`, `runs/`, `node_modules/`, `dist/`) but are not tracked.
- Secret scan found only an existing dummy redaction fixture in `server/server.test.js`; no real credential-shaped secret was added by this task.

## Git

No commit was created because the required full `npm test` command failed. The requested commit message `feat: add persistent database core` should be used after the frontend-side test failures are resolved or explicitly accepted by integration.

## Recommendation

Database core: no rework recommended.

Integration follow-up: fix or reconcile the failing frontend persistence tests in `src/` before committing this task branch.
