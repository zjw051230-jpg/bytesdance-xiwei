// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAppServer } from "./index.js";
import { openWorkbenchDatabase } from "./db/connection.js";
import { migrateDatabase } from "./db/migrate.js";
import { createPersistenceService } from "./services/persistence/persistenceService.js";

const testRoot = path.resolve("runs", `test-persistence-${process.pid}-${Date.now()}`);
const listeners = [];

async function dbPath(name) {
  await fs.mkdir(testRoot, { recursive: true });
  return path.join(testRoot, `${name}.sqlite`);
}

async function openService(name) {
  const database = openWorkbenchDatabase({ dbPath: await dbPath(name) });
  migrateDatabase(database);
  return {
    database,
    service: createPersistenceService(database),
    close: () => database.close()
  };
}

async function startServer(name) {
  const server = createAppServer({
    workbenchDbPath: await dbPath(name),
    runnerMode: "mock",
    skillModelMode: "mock"
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  listeners.push(server);
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  while (listeners.length) {
    const server = listeners.pop();
    await new Promise((resolve) => server.close(resolve));
  }
  await rmWithRetry(testRoot);
});

describe("persistent workbench database", () => {
  it("creates the schema and persists core records after connection restart", async () => {
    const dbName = "restart-core";
    const first = await openService(dbName);
    const project = first.service.projects.create({
      name: "Persisted Project",
      description: "Survives backend restart",
      status: "current"
    });
    const requirement = first.service.requirements.create(project.id, {
      title: "Persist login guidance",
      rawPmInput: "PM request with api_key=\"sk-real-secret-value\" and Bearer hidden-token",
      dslJson: { title: "Persist login guidance", safe: true },
      readinessStatus: "clarify_first",
      readyForAgent: false,
      handoffDecision: "clarify_first",
      sourceProvider: "doubao_ark",
      sourceModel: "ep-test",
      completionPercent: 78
    });
    first.service.clarifications.create(requirement.id, {
      role: "pm",
      content: "Keep this turn after restart",
      source: "manual"
    });
    const plan = first.service.designPlans.upsert(requirement.id, {
      title: "Persisted plan",
      summary: "Plan summary",
      currentStage: "design",
      overallProgress: 35
    });
    const task = first.service.planningTasks.create(plan.id, {
      title: "Persist task",
      status: "todo",
      priority: "P1",
      progress: 5
    });
    const run = first.service.agentRuns.create({
      requirementId: requirement.id,
      planId: plan.id,
      taskId: task.id,
      status: "completed",
      dryRun: true,
      realWritePerformed: false,
      targetRepoPath: "F:\\target\\repo",
      contextSnapshot: { safe: true },
      planJson: { steps: ["inspect"] },
      resultSummary: "Dry-run only"
    });
    first.service.agentArtifacts.create(run.id, {
      type: "report",
      name: "summary.md",
      path: "runs\\RUN-test\\summary.md",
      summary: "Small summary only"
    });
    const review = first.service.reviewItems.create(run.id, {
      filePath: "src/LoginForm.jsx",
      changeSummary: "Copy change",
      reason: "Requirement mapping",
      requirementMapping: "login guidance",
      riskLevel: "P1",
      testStatus: "pending",
      humanStatus: "pending"
    });
    const prDraft = first.service.prDrafts.upsert(requirement.id, {
      runId: run.id,
      title: "Persist PR draft",
      summary: "Draft summary",
      body: "PR body",
      checklistJson: ["reviewed"],
      status: "draft"
    });
    first.service.activity.create({
      projectId: project.id,
      requirementId: requirement.id,
      runId: run.id,
      type: "test_event",
      level: "info",
      message: "Activity survives restart",
      payloadJson: { ok: true }
    });
    first.close();

    const second = await openService(dbName);
    expect(second.service.projects.get(project.id).name).toBe("Persisted Project");
    expect(second.service.requirements.get(requirement.id).title).toBe("Persist login guidance");
    expect(second.service.clarifications.list(requirement.id)).toHaveLength(1);
    expect(second.service.designPlans.getByRequirement(requirement.id).id).toBe(plan.id);
    expect(second.service.planningTasks.list(plan.id)[0].id).toBe(task.id);
    expect(second.service.agentRuns.get(run.id).id).toBe(run.id);
    expect(second.service.agentArtifacts.list(run.id)).toHaveLength(1);
    expect(second.service.reviewItems.listByRun(run.id)[0].id).toBe(review.id);
    expect(second.service.prDrafts.getByRequirement(requirement.id).id).toBe(prDraft.id);
    expect(second.service.activity.listByProject(project.id)).toHaveLength(1);

    const rawDbText = await fs.readFile(await dbPath(dbName), "latin1");
    expect(rawDbText).not.toMatch(/sk-real-secret-value|Bearer hidden-token|api_key/i);
    second.close();
  });

  it("exposes project and requirement APIs with the standard envelope", async () => {
    const baseUrl = await startServer("api");
    const createProject = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "API Project", description: "From API" })
    });
    const projectPayload = await createProject.json();
    expect(projectPayload.ok).toBe(true);
    expect(projectPayload.data.name).toBe("API Project");

    const createRequirement = await fetch(`${baseUrl}/api/projects/${projectPayload.data.id}/requirements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "API Requirement", rawPmInput: "persist me" })
    });
    const requirementPayload = await createRequirement.json();
    expect(requirementPayload.ok).toBe(true);

    const requirements = await fetch(`${baseUrl}/api/projects/${projectPayload.data.id}/requirements`).then((res) => res.json());
    expect(requirements.ok).toBe(true);
    expect(requirements.data[0].id).toBe(requirementPayload.data.id);

    const projects = await fetch(`${baseUrl}/api/projects`).then((res) => res.json());
    expect(projects.ok).toBe(true);
    expect(projects.data.some((project) => project.id === projectPayload.data.id)).toBe(true);
  });

  it("keeps local database files ignored by git", async () => {
    const gitignore = await fs.readFile(path.resolve(".gitignore"), "utf8");
    expect(gitignore).toMatch(/data\/\*\.sqlite/);
    expect(gitignore).toMatch(/data\/\*\.sqlite-\*/);
    expect(gitignore).toMatch(/data\/\*\.db/);
    expect(gitignore).toMatch(/\*\.sqlite/);
    expect(gitignore).toMatch(/\*\.db/);
  });
});

async function rmWithRetry(target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM"].includes(error?.code) || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}
