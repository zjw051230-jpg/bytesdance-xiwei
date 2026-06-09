import fs from "node:fs/promises";
import path from "node:path";
import { openWorkbenchDatabase } from "../server/db/connection.js";
import { migrateDatabase } from "../server/db/migrate.js";
import { createWorkbenchRepositories } from "../server/repositories/index.js";

const dbPath = process.env.WORKBENCH_DB_PATH || path.resolve("data", "persistence-smoke.sqlite");
await fs.mkdir(path.dirname(dbPath), { recursive: true });

const suffix = Date.now();
const projectId = `restart-project-${suffix}`;
const requirementId = `restart-requirement-${suffix}`;
const runId = `restart-run-${suffix}`;

let first = openWorkbenchDatabase({ dbPath });
try {
  migrateDatabase(first);
  const repositories = createWorkbenchRepositories(first);
  const project = repositories.projects.create({ id: projectId, name: "Restart Project", description: "Connection restart smoke" });
  const requirement = repositories.requirements.create({ id: requirementId, project_id: project.id, title: "Restart Requirement", raw_pm_input: "Connection restart" });
  repositories.clarifications.create({ requirement_id: requirement.id, role: "pm", content: "Restart should keep this.", source: "smoke:persistence" });
  const plan = repositories.designPlans.create({ requirement_id: requirement.id, title: "Restart Plan", summary: "Persistent plan", overall_progress: 10 });
  const task = repositories.planningTasks.create({ plan_id: plan.id, title: "Restart Task", status: "todo" });
  const run = repositories.agentRuns.create({ id: runId, requirement_id: requirement.id, plan_id: plan.id, task_id: task.id, status: "completed", result_summary: "restart smoke" });
  repositories.agentArtifacts.create({ run_id: run.id, type: "report", name: "restart.md", path: "reporting/restart.md", summary: "restart artifact" });
  repositories.reviewItems.create({ run_id: run.id, file_path: "server/db/schema.sql", change_summary: "restart review", reason: "restart", requirement_mapping: requirement.id });
  repositories.prDrafts.create({ requirement_id: requirement.id, run_id: run.id, title: "Restart PR Draft", summary: "restart pr" });
  repositories.activityLogs.create({ project_id: project.id, requirement_id: requirement.id, run_id: run.id, type: "restart_smoke", level: "info", message: "Restart smoke wrote data." });
} finally {
  first.close();
}

let second = openWorkbenchDatabase({ dbPath });
try {
  migrateDatabase(second);
  const repositories = createWorkbenchRepositories(second);
  const plan = repositories.designPlans.listByParent(requirementId)[0];
  const checks = {
    project: repositories.projects.getById(projectId)?.id === projectId,
    requirement: repositories.requirements.getById(requirementId)?.id === requirementId,
    clarification: repositories.clarifications.listByParent(requirementId).length === 1,
    designPlan: Boolean(plan),
    planningTask: plan ? repositories.planningTasks.listByParent(plan.id).length === 1 : false,
    agentRun: repositories.agentRuns.getById(runId)?.id === runId,
    agentArtifact: repositories.agentArtifacts.listByParent(runId).length === 1,
    reviewItem: repositories.reviewItems.listByParent(runId).length === 1,
    prDraft: repositories.prDrafts.listByParent(requirementId).length === 1,
    activityLog: repositories.activityLogs.listByParent(projectId).length === 1
  };
  const passed = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({
    status: passed ? "passed" : "failed",
    dbPath,
    connectionRestartVerified: passed,
    checks
  }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  second.close();
}
