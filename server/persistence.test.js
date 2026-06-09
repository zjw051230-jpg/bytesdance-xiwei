// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAppServer } from "./index.js";
import { openWorkbenchDatabase } from "./db/connection.js";
import { migrateDatabase } from "./db/migrate.js";
import { createPersistenceService } from "./services/persistence/persistenceService.js";
import { withPersistence } from "./services/persistence/workbenchPersistenceAdapter.js";

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

async function stopServers() {
  while (listeners.length) {
    const server = listeners.pop();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  return { response, payload: await response.json() };
}

function expectOkEnvelope(response, payload) {
  expect(response.headers.get("content-type")).toMatch(/application\/json/);
  expect(payload).toEqual(expect.objectContaining({
    ok: true,
    error: null
  }));
  expect(payload).toHaveProperty("data");
}

function expectErrorEnvelope(response, payload, code) {
  expect(response.headers.get("content-type")).toMatch(/application\/json/);
  expect(payload).toEqual({
    ok: false,
    data: null,
    error: expect.objectContaining({
      code,
      message: expect.any(String),
      details: expect.any(Object)
    })
  });
}

afterEach(async () => {
  await stopServers();
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

  it("persists project create/list APIs and returns the standard envelope", async () => {
    const baseUrl = await startServer("api");
    const { response: createProject, payload: projectPayload } = await requestJson(baseUrl, "/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "API Project", description: "From API" })
    });
    expect(createProject.status).toBe(201);
    expectOkEnvelope(createProject, projectPayload);
    expect(projectPayload.data.name).toBe("API Project");

    await stopServers();
    const restartedUrl = await startServer("api");
    const { response: listProjects, payload: projects } = await requestJson(restartedUrl, "/api/projects");
    expect(listProjects.status).toBe(200);
    expectOkEnvelope(listProjects, projects);
    expect(projects.data.some((project) => project.id === projectPayload.data.id)).toBe(true);
  });

  it("persists requirement create/read APIs", async () => {
    const baseUrl = await startServer("requirement-api");
    const { payload: projectPayload } = await requestJson(baseUrl, "/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Requirement API Project" })
    });
    const { response: createRequirement, payload: requirementPayload } = await requestJson(baseUrl, `/api/projects/${projectPayload.data.id}/requirements`, {
      method: "POST",
      body: JSON.stringify({ title: "API Requirement", rawPmInput: "persist me", completionPercent: 21 })
    });
    expect(createRequirement.status).toBe(201);
    expectOkEnvelope(createRequirement, requirementPayload);

    await stopServers();
    const restartedUrl = await startServer("requirement-api");
    const { response: getRequirement, payload: readRequirement } = await requestJson(restartedUrl, `/api/requirements/${requirementPayload.data.id}`);
    expect(getRequirement.status).toBe(200);
    expectOkEnvelope(getRequirement, readRequirement);
    expect(readRequirement.data.rawPmInput).toBe("persist me");

    const { payload: requirements } = await requestJson(restartedUrl, `/api/projects/${projectPayload.data.id}/requirements`);
    expect(requirements.data[0].id).toBe(requirementPayload.data.id);
  });

  it("persists clarification turn create/list APIs", async () => {
    const baseUrl = await startServer("clarification-api");
    const { payload: projectPayload } = await requestJson(baseUrl, "/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Clarification API Project" })
    });
    const { payload: requirementPayload } = await requestJson(baseUrl, `/api/projects/${projectPayload.data.id}/requirements`, {
      method: "POST",
      body: JSON.stringify({ title: "Clarification Requirement", rawPmInput: "need answers" })
    });
    const { response: createTurn, payload: turnPayload } = await requestJson(baseUrl, `/api/requirements/${requirementPayload.data.id}/clarifications`, {
      method: "POST",
      body: JSON.stringify({ role: "pm", content: "Persist this clarification", source: "test" })
    });
    expect(createTurn.status).toBe(201);
    expectOkEnvelope(createTurn, turnPayload);

    await stopServers();
    const restartedUrl = await startServer("clarification-api");
    const { response: listTurns, payload: turns } = await requestJson(restartedUrl, `/api/requirements/${requirementPayload.data.id}/clarifications`);
    expect(listTurns.status).toBe(200);
    expectOkEnvelope(listTurns, turns);
    expect(turns.data.map((turn) => turn.id)).toContain(turnPayload.data.id);
  });

  it("persists design plan create/read APIs", async () => {
    const { baseUrl, requirementId } = await createRequirementFixture("design-plan-api");
    const { response: createPlan, payload: planPayload } = await requestJson(baseUrl, `/api/requirements/${requirementId}/design-plan`, {
      method: "POST",
      body: JSON.stringify({ title: "Persistent design plan", summary: "API plan", overallProgress: 33 })
    });
    expect(createPlan.status).toBe(201);
    expectOkEnvelope(createPlan, planPayload);

    await stopServers();
    const restartedUrl = await startServer("design-plan-api");
    const { response: getPlan, payload: readPlan } = await requestJson(restartedUrl, `/api/requirements/${requirementId}/design-plan`);
    expect(getPlan.status).toBe(200);
    expectOkEnvelope(getPlan, readPlan);
    expect(readPlan.data.id).toBe(planPayload.data.id);
    expect(readPlan.data.summary).toBe("API plan");
  });

  it("persists planning task update APIs", async () => {
    const { baseUrl, requirementId } = await createRequirementFixture("planning-task-api");
    const { payload: planPayload } = await requestJson(baseUrl, `/api/requirements/${requirementId}/design-plan`, {
      method: "POST",
      body: JSON.stringify({ title: "Task plan" })
    });
    const { payload: taskPayload } = await requestJson(baseUrl, `/api/design-plans/${planPayload.data.id}/tasks`, {
      method: "POST",
      body: JSON.stringify({ title: "Persist update task", status: "todo", progress: 0 })
    });
    const { response: updateTask, payload: updatedTask } = await requestJson(baseUrl, `/api/planning-tasks/${taskPayload.data.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done", progress: 100, blockedReason: "" })
    });
    expect(updateTask.status).toBe(200);
    expectOkEnvelope(updateTask, updatedTask);

    await stopServers();
    const restartedUrl = await startServer("planning-task-api");
    const { payload: tasks } = await requestJson(restartedUrl, `/api/design-plans/${planPayload.data.id}/tasks`);
    expect(tasks.data[0].status).toBe("done");
    expect(tasks.data[0].progress).toBe(100);
  });

  it("persists agent run read APIs after backend restart", async () => {
    const dbName = "agent-run-api";
    const baseUrl = await startServer(dbName);
    const { response: startRun, payload: runPayload } = await requestJson(baseUrl, "/api/agent/run", {
      method: "POST",
      body: JSON.stringify({ projectId: "api-agent-project", taskTitle: "Persistent agent run", dryRun: true })
    });
    expect(startRun.status).toBe(200);
    expectOkEnvelope(startRun, runPayload);

    await stopServers();
    const restartedUrl = await startServer(dbName);
    const { response: getRun, payload: persistedRun } = await requestJson(restartedUrl, `/api/agent/runs/${runPayload.data.runId}`);
    expect(getRun.status).toBe(200);
    expectOkEnvelope(getRun, persistedRun);
    expect(persistedRun.data.id).toBe(runPayload.data.runId);
    expect(persistedRun.data.status).toBe("completed");

    const { response: getArtifacts, payload: artifacts } = await requestJson(restartedUrl, `/api/agent/runs/${runPayload.data.runId}/artifacts`);
    expect(getArtifacts.status).toBe(200);
    expectOkEnvelope(getArtifacts, artifacts);
    expect(artifacts.data.artifactList.some((artifact) => artifact.name === "agent_context.json")).toBe(true);
  });

  it("persists review item update APIs", async () => {
    const { baseUrl, runId } = await createAgentRunFixture("review-api");
    const { payload: reviewItems } = await requestJson(baseUrl, `/api/agent/runs/${runId}/review`);
    expect(reviewItems.data.length).toBeGreaterThan(0);
    const { response: updateReview, payload: updatedReview } = await requestJson(baseUrl, `/api/review-items/${reviewItems.data[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ humanStatus: "approved", humanComment: "Looks good" })
    });
    expect(updateReview.status).toBe(200);
    expectOkEnvelope(updateReview, updatedReview);

    await stopServers();
    const restartedUrl = await startServer("review-api");
    const { payload: persistedReview } = await requestJson(restartedUrl, `/api/agent/runs/${runId}/review`);
    expect(persistedReview.data[0].humanStatus).toBe("approved");
    expect(persistedReview.data[0].humanComment).toBe("Looks good");
  });

  it("persists PR draft save/read APIs", async () => {
    const { baseUrl, requirementId, runId } = await createAgentRunFixture("pr-draft-api");
    const { response: saveDraft, payload: draftPayload } = await requestJson(baseUrl, `/api/requirements/${requirementId}/pr-draft`, {
      method: "POST",
      body: JSON.stringify({ runId, title: "Persist PR draft", body: "Body", checklistJson: ["checked"], status: "draft" })
    });
    expect(saveDraft.status).toBe(201);
    expectOkEnvelope(saveDraft, draftPayload);

    await stopServers();
    const restartedUrl = await startServer("pr-draft-api");
    const { response: readDraft, payload: persistedDraft } = await requestJson(restartedUrl, `/api/requirements/${requirementId}/pr-draft`);
    expect(readDraft.status).toBe(200);
    expectOkEnvelope(readDraft, persistedDraft);
    expect(persistedDraft.data.title).toBe("Persist PR draft");
    expect(persistedDraft.data.checklistJson).toEqual(["checked"]);
  });

  it("persists project activity log list APIs", async () => {
    const dbName = "activity-api";
    const { projectId } = await createDirectPersistenceFixture(dbName);
    const baseUrl = await startServer(dbName);
    const { response: listActivity, payload: activity } = await requestJson(baseUrl, `/api/projects/${projectId}/activity`);
    expect(listActivity.status).toBe(200);
    expectOkEnvelope(listActivity, activity);
    expect(activity.data.some((item) => item.message === "Activity API persisted")).toBe(true);
  });

  it("returns required error envelopes for bad requests and missing records", async () => {
    const baseUrl = await startServer("error-api");
    const malformed = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json"
    });
    const malformedPayload = await malformed.json();
    expect(malformed.status).toBe(400);
    expectErrorEnvelope(malformed, malformedPayload, "bad_request");

    const missingProject = await requestJson(baseUrl, "/api/projects/missing-project");
    expect(missingProject.response.status).toBe(404);
    expectErrorEnvelope(missingProject.response, missingProject.payload, "project_not_found");

    const invalidProject = await requestJson(baseUrl, "/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "" })
    });
    expect(invalidProject.response.status).toBe(422);
    expectErrorEnvelope(invalidProject.response, invalidProject.payload, "validation_failed");

    const missingTask = await requestJson(baseUrl, "/api/planning-tasks/missing-task", {
      method: "PATCH",
      body: JSON.stringify({ status: "done" })
    });
    expect(missingTask.response.status).toBe(404);
    expectErrorEnvelope(missingTask.response, missingTask.payload, "task_not_found");
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

async function createRequirementFixture(dbName) {
  const baseUrl = await startServer(dbName);
  const { payload: projectPayload } = await requestJson(baseUrl, "/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: `${dbName} project` })
  });
  const { payload: requirementPayload } = await requestJson(baseUrl, `/api/projects/${projectPayload.data.id}/requirements`, {
    method: "POST",
    body: JSON.stringify({ title: `${dbName} requirement`, rawPmInput: "persist fixture" })
  });
  return { baseUrl, projectId: projectPayload.data.id, requirementId: requirementPayload.data.id };
}

async function createAgentRunFixture(dbName) {
  const baseUrl = await startServer(dbName);
  const { payload: runPayload } = await requestJson(baseUrl, "/api/agent/run", {
    method: "POST",
    body: JSON.stringify({ projectId: `${dbName}-project`, taskTitle: `${dbName} task`, dryRun: true })
  });
  const runId = runPayload.data.runId;
  const requirementId = `req-agent-${runId}`;
  return { baseUrl, runId, requirementId };
}

async function createDirectPersistenceFixture(dbName) {
  return withPersistence({ workbenchDbPath: await dbPath(dbName) }, (service) => {
    const project = service.projects.create({ name: "Activity API Project" });
    const requirement = service.requirements.create(project.id, { title: "Activity Requirement", rawPmInput: "activity" });
    const run = service.agentRuns.create({ requirementId: requirement.id, status: "completed" });
    service.activity.create({
      projectId: project.id,
      requirementId: requirement.id,
      runId: run.id,
      type: "activity_api",
      message: "Activity API persisted",
      payloadJson: { persisted: true }
    });
    return { projectId: project.id, requirementId: requirement.id, runId: run.id };
  });
}

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
