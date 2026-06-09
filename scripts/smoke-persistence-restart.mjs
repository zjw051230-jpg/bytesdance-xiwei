import fs from "node:fs/promises";
import path from "node:path";
import { openWorkbenchDatabase } from "../server/db/connection.js";
import { migrateDatabase } from "../server/db/migrate.js";
import { createPersistenceService } from "../server/services/persistence/persistenceService.js";

const dbPath = process.env.WORKBENCH_DB_PATH || path.resolve("data", "persistence-smoke.sqlite");
await fs.mkdir(path.dirname(dbPath), { recursive: true });

const suffix = Date.now();
const projectId = `restart-project-${suffix}`;
const requirementId = `restart-requirement-${suffix}`;

let first = openWorkbenchDatabase({ dbPath });
try {
  migrateDatabase(first);
  const service = createPersistenceService(first);
  const project = service.projects.create({ id: projectId, name: "Restart Project", description: "Connection restart smoke" });
  const requirement = service.requirements.create(project.id, { id: requirementId, title: "Restart Requirement", rawPmInput: "Connection restart" });
  service.clarifications.create(requirement.id, { role: "pm", content: "Restart should keep this.", source: "smoke:persistence" });
  const plan = service.designPlans.upsert(requirement.id, { title: "Restart Plan", summary: "Persistent plan", overallProgress: 10 });
  service.planningTasks.create(plan.id, { title: "Restart Task", status: "todo" });
} finally {
  first.close();
}

let second = openWorkbenchDatabase({ dbPath });
try {
  migrateDatabase(second);
  const service = createPersistenceService(second);
  const checks = {
    project: service.projects.get(projectId)?.id === projectId,
    requirement: service.requirements.get(requirementId)?.id === requirementId,
    clarifications: service.clarifications.list(requirementId).length === 1,
    designPlan: Boolean(service.designPlans.getByRequirement(requirementId)),
    planningTask: service.planningTasks.list(service.designPlans.getByRequirement(requirementId).id).length === 1
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
