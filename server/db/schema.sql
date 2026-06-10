PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'current',
  icon TEXT NOT NULL DEFAULT 'folder',
  rail_subtitle TEXT NOT NULL DEFAULT '',
  local_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT
);

CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  raw_pm_input TEXT NOT NULL DEFAULT '',
  dsl_json TEXT NOT NULL DEFAULT '{}',
  readiness_status TEXT NOT NULL DEFAULT 'clarify_first',
  ready_for_agent INTEGER NOT NULL DEFAULT 0,
  handoff_decision TEXT NOT NULL DEFAULT 'clarify_first',
  source_provider TEXT NOT NULL DEFAULT '',
  source_model TEXT NOT NULL DEFAULT '',
  completion_percent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clarification_turns (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('pm', 'system', 'assistant')),
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS design_plans (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL UNIQUE REFERENCES requirements(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  current_stage TEXT NOT NULL DEFAULT 'design',
  overall_progress INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS planning_tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES design_plans(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'running', 'blocked', 'done', 'needs_review', 'cancelled')),
  priority TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL DEFAULT '',
  blocked_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  requirement_id TEXT REFERENCES requirements(id) ON DELETE SET NULL,
  plan_id TEXT REFERENCES design_plans(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES planning_tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'created',
  dry_run INTEGER NOT NULL DEFAULT 1,
  real_write_performed INTEGER NOT NULL DEFAULT 0,
  target_repo_path TEXT NOT NULL DEFAULT '',
  context_snapshot TEXT NOT NULL DEFAULT '{}',
  plan_json TEXT NOT NULL DEFAULT '{}',
  result_summary TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('dsl', 'context', 'report', 'patch', 'test_log', 'screenshot', 'pr_summary')),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  requirement_mapping TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT '',
  test_status TEXT NOT NULL DEFAULT '',
  human_status TEXT NOT NULL DEFAULT 'pending' CHECK (human_status IN ('pending', 'approved', 'needs_change', 'blocked')),
  human_comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pr_drafts (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL UNIQUE REFERENCES requirements(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  checklist_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'blocked', 'merged', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  requirement_id TEXT REFERENCES requirements(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requirements_project_id ON requirements(project_id);
CREATE INDEX IF NOT EXISTS idx_clarification_requirement_id ON clarification_turns(requirement_id);
CREATE INDEX IF NOT EXISTS idx_tasks_plan_id ON planning_tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_requirement_id ON agent_runs(requirement_id);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_run_id ON agent_artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_review_items_run_id ON review_items(run_id);
CREATE INDEX IF NOT EXISTS idx_activity_project_id ON activity_logs(project_id);
