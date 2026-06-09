import { openWorkbenchDatabase, resolveWorkbenchDbPath } from "../server/db/connection.js";
import { migrateDatabase } from "../server/db/migrate.js";
import { createWorkbenchRepositories } from "../server/repositories/index.js";

const dbPath = resolveWorkbenchDbPath();
const database = openWorkbenchDatabase({ dbPath });
try {
  migrateDatabase(database);
  const repositories = createWorkbenchRepositories(database);
  const suffix = Date.now();
  const project = repositories.projects.create({
    id: `db-smoke-project-${suffix}`,
    name: `DB Smoke Project ${suffix}`,
    description: "Created by db:smoke",
    status: "current"
  });
  const requirement = repositories.requirements.create({
    id: `db-smoke-requirement-${suffix}`,
    project_id: project.id,
    title: "DB smoke requirement",
    raw_pm_input: "Persist a local smoke requirement.",
    dsl_json: { source: "db-smoke" },
    readiness_status: "clarify_first",
    ready_for_agent: false,
    handoff_decision: "clarify_first",
    source_provider: "local",
    source_model: "smoke",
    completion_percent: 12
  });
  const turn = repositories.clarifications.create({
    requirement_id: requirement.id,
    role: "pm",
    content: "This turn should be readable.",
    source: "db-smoke"
  });
  const plan = repositories.designPlans.create({
    id: `db-smoke-plan-${suffix}`,
    requirement_id: requirement.id,
    title: "DB smoke design plan",
    summary: "Smoke plan",
    current_stage: "design",
    overall_progress: 20
  });
  const task = repositories.planningTasks.create({
    id: `db-smoke-workitem-${suffix}`,
    plan_id: plan.id,
    title: "DB smoke planning task",
    status: "todo",
    progress: 0
  });
  const run = repositories.agentRuns.create({
    id: `db-smoke-run-${suffix}`,
    requirement_id: requirement.id,
    plan_id: plan.id,
    task_id: task.id,
    status: "completed",
    dry_run: true,
    real_write_performed: false,
    target_repo_path: "F:\\字节比赛\\最终程序",
    context_snapshot: { source: "db-smoke" },
    plan_json: { steps: ["persist"] },
    result_summary: "DB smoke run persisted."
  });
  const artifact = repositories.agentArtifacts.create({
    id: `db-smoke-artifact-${suffix}`,
    run_id: run.id,
    type: "report",
    name: "db-smoke-report.md",
    path: "reporting/persistent_database_core_report.md",
    summary: "Smoke artifact index."
  });
  const review = repositories.reviewItems.create({
    id: `db-smoke-review-${suffix}`,
    run_id: run.id,
    file_path: "server/db/schema.sql",
    change_summary: "Schema persisted",
    reason: "Smoke verification",
    requirement_mapping: requirement.id,
    risk_level: "low",
    test_status: "pending",
    human_status: "pending"
  });
  const prDraft = repositories.prDrafts.create({
    id: `db-smoke-pr-${suffix}`,
    requirement_id: requirement.id,
    run_id: run.id,
    title: "DB smoke PR draft",
    summary: "Smoke PR draft persisted.",
    body: "Smoke body",
    checklist_json: ["db smoke passed"],
    status: "draft"
  });
  const activity = repositories.activityLogs.create({
    id: `db-smoke-activity-${suffix}`,
    project_id: project.id,
    requirement_id: requirement.id,
    run_id: run.id,
    type: "db_smoke",
    level: "info",
    message: "DB smoke wrote all core objects.",
    payload_json: { ok: true }
  });

  const updated = {
    project: repositories.projects.update(project.id, { status: "verified" }),
    requirement: repositories.requirements.update(requirement.id, { completion_percent: 34 }),
    turn: repositories.clarifications.update(turn.id, { source: "db-smoke-updated" }),
    plan: repositories.designPlans.update(plan.id, { overall_progress: 45 }),
    task: repositories.planningTasks.update(task.id, { progress: 15 }),
    run: repositories.agentRuns.update(run.id, { result_summary: "DB smoke update persisted." }),
    artifact: repositories.agentArtifacts.update(artifact.id, { summary: "Updated artifact summary." }),
    review: repositories.reviewItems.update(review.id, { test_status: "passed" }),
    prDraft: repositories.prDrafts.update(prDraft.id, { status: "ready" }),
    activity: repositories.activityLogs.update(activity.id, { level: "debug" })
  };

  const checks = {
    project: repositories.projects.getById(project.id)?.status === "verified",
    requirement: repositories.requirements.getById(requirement.id)?.completion_percent === 34,
    turn: repositories.clarifications.listByParent(requirement.id).some((item) => item.id === turn.id && item.source === "db-smoke-updated"),
    plan: repositories.designPlans.listByParent(requirement.id).some((item) => item.id === plan.id && item.overall_progress === 45),
    task: repositories.planningTasks.listByParent(plan.id).some((item) => item.id === task.id && item.progress === 15),
    run: repositories.agentRuns.getById(run.id)?.result_summary === "DB smoke update persisted.",
    artifact: repositories.agentArtifacts.listByParent(run.id).some((item) => item.id === artifact.id && item.summary === "Updated artifact summary."),
    review: repositories.reviewItems.listByParent(run.id).some((item) => item.id === review.id && item.test_status === "passed"),
    prDraft: repositories.prDrafts.listByParent(requirement.id).some((item) => item.id === prDraft.id && item.status === "ready"),
    activity: repositories.activityLogs.listByParent(project.id).some((item) => item.id === activity.id && item.level === "debug"),
    updates: Object.values(updated).every(Boolean)
  };
  const passed = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({
    status: passed ? "passed" : "failed",
    dbPath,
    ids: {
      project: project.id,
      requirement: requirement.id,
      clarification: turn.id,
      plan: plan.id,
      task: task.id,
      run: run.id,
      artifact: artifact.id,
      review: review.id,
      prDraft: prDraft.id,
      activity: activity.id
    },
    checks
  }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  database.close();
}
