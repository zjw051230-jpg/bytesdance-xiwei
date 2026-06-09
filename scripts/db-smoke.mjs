import { openWorkbenchDatabase, resolveWorkbenchDbPath } from "../server/db/connection.js";
import { migrateDatabase } from "../server/db/migrate.js";
import { seedWorkbenchDatabase } from "../server/db/seed.js";
import { createPersistenceService } from "../server/services/persistence/persistenceService.js";

const dbPath = resolveWorkbenchDbPath();
const database = openWorkbenchDatabase({ dbPath });
try {
  migrateDatabase(database);
  seedWorkbenchDatabase(database);
  const service = createPersistenceService(database);
  const suffix = Date.now();
  const project = service.projects.create({
    id: `db-smoke-project-${suffix}`,
    name: `DB Smoke Project ${suffix}`,
    description: "Created by db:smoke",
    status: "current"
  });
  const requirement = service.requirements.create(project.id, {
    id: `db-smoke-requirement-${suffix}`,
    title: "DB smoke requirement",
    rawPmInput: "Persist a local smoke requirement.",
    completionPercent: 12
  });
  const turn = service.clarifications.create(requirement.id, {
    role: "pm",
    content: "This turn should be readable.",
    source: "db-smoke"
  });
  const plan = service.designPlans.upsert(requirement.id, {
    id: `db-smoke-plan-${suffix}`,
    title: "DB smoke design plan",
    summary: "Smoke plan",
    currentStage: "design",
    overallProgress: 20
  });
  const task = service.planningTasks.create(plan.id, {
    id: `db-smoke-workitem-${suffix}`,
    title: "DB smoke planning task",
    status: "todo",
    progress: 0
  });

  const checks = {
    project: service.projects.get(project.id)?.id === project.id,
    requirement: service.requirements.get(requirement.id)?.id === requirement.id,
    turn: service.clarifications.list(requirement.id).some((item) => item.id === turn.id),
    plan: service.designPlans.getByRequirement(requirement.id)?.id === plan.id,
    task: service.planningTasks.list(plan.id).some((item) => item.id === task.id)
  };
  const passed = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({
    status: passed ? "passed" : "failed",
    dbPath,
    ids: { project: project.id, requirement: requirement.id, plan: plan.id, task: task.id },
    checks
  }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  database.close();
}
