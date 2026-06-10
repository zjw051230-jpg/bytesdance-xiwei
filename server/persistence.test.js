// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createAppServer } from "./index.js";
import { openWorkbenchDatabase } from "./db/connection.js";
import { migrateDatabase } from "./db/migrate.js";
import { createPersistenceService } from "./services/persistence/persistenceService.js";
import { withPersistence } from "./services/persistence/workbenchPersistenceAdapter.js";

const testRoot = path.resolve("runs", `test-persistence-${process.pid}-${Date.now()}`);
const listeners = [];
const fetchBlockedPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161,
  179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563,
  587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080
]);

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

async function startServer(name, options = {}) {
  const apiConfigPath = path.join(testRoot, "configs", `${name}.api_config.local.json`);
  await fs.mkdir(path.dirname(apiConfigPath), { recursive: true });
  await fs.writeFile(apiConfigPath, JSON.stringify({
    provider: "doubao_ark",
    api_key: "db-test-fixture-secret",
    model: "ep-test-fixture"
  }, null, 2), "utf8");
  const workbenchDbPath = await dbPath(name);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const server = createAppServer({
      workbenchDbPath,
      apiConfigPath,
      runnerMode: "mock",
      skillModelMode: "mock",
      ...options
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    if (!fetchBlockedPorts.has(port)) {
      listeners.push(server);
      return `http://127.0.0.1:${port}`;
    }
    await new Promise((resolve) => server.close(resolve));
  }
  throw new Error("Unable to allocate a fetch-safe random test port");
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

  it("deletes projects through the persistence API", async () => {
    const baseUrl = await startServer("delete-project-api");
    const { payload: projectPayload } = await requestJson(baseUrl, "/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Delete Me" })
    });
    const { response: deleteProject, payload: deletedProject } = await requestJson(baseUrl, `/api/projects/${projectPayload.data.id}`, {
      method: "DELETE"
    });
    expect(deleteProject.status).toBe(200);
    expectOkEnvelope(deleteProject, deletedProject);
    expect(deletedProject.data.id).toBe(projectPayload.data.id);

    await stopServers();
    const restartedUrl = await startServer("delete-project-api");
    const { response: getProject, payload: missingProject } = await requestJson(restartedUrl, `/api/projects/${projectPayload.data.id}`);
    expect(getProject.status).toBe(404);
    expect(missingProject.error.code).toBe("project_not_found");
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
    const targetRepoPath = await createTargetRepo(dbName);
    await fs.mkdir(targetRepoPath, { recursive: true });
    const baseUrl = await startServer(dbName, { agent2Runner: createFakeAgent2Runner() });
    const { response: startRun, payload: runPayload } = await requestJson(baseUrl, "/api/agent/run", {
      method: "POST",
      body: JSON.stringify({
        projectId: "api-agent-project",
        taskTitle: "Persistent agent run",
        dryRun: false,
        realRunConfirm: true,
        agentProvider: "agent2",
        targetRepoPath
      })
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
    expect(artifacts.data.artifactList.some((artifact) => artifact.name === "agent2_real_request.json")).toBe(true);
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

  it("creates baseline snapshots and rolls back files after a direct target repo write", async () => {
    const dbName = "rollback-file-api";
    const targetRepoPath = await createTargetRepo(dbName);
    await fs.mkdir(path.join(targetRepoPath, "src"), { recursive: true });
    await fs.writeFile(path.join(targetRepoPath, "src", "App.jsx"), "baseline app\n", "utf8");
    const agent2Runner = async ({ env }) => {
      await fs.writeFile(path.join(env.AGENT_REPO_ROOT, "src", "App.jsx"), "changed app\n", "utf8");
      return fakeAgent2Stdout({ file: "src/App.jsx" });
    };
    const baseUrl = await startServer(dbName, { agent2Runner, workspaceAdapterType: "copy" });
    const { response: startRun, payload: runPayload } = await requestJson(baseUrl, "/api/agent/run", {
      method: "POST",
      body: JSON.stringify({
        projectId: `${dbName}-project`,
        taskTitle: "Rollback file test",
        dryRun: false,
        realRunConfirm: true,
        agentProvider: "agent2",
        targetRepoPath
      })
    });
    expect(startRun.status).toBe(200);
    expectOkEnvelope(startRun, runPayload);
    expect(runPayload.data.workspace.baselineSnapshotId).toBeTruthy();
    expect(await fs.readFile(path.join(targetRepoPath, "src", "App.jsx"), "utf8")).toBe("changed app\n");

    const runId = runPayload.data.runId;
    const changes = await requestJson(baseUrl, `/api/agent/runs/${runId}/changes`);
    expectOkEnvelope(changes.response, changes.payload);
    expect(changes.payload.data.available).toBe(true);
    expect(changes.payload.data.changes[0].filePath).toBe("src/App.jsx");
    expect(changes.payload.data.changes[0].status).toBe("changed");

    const revert = await requestJson(baseUrl, `/api/agent/runs/${runId}/rollback/file`, {
      method: "POST",
      body: JSON.stringify({ changeId: changes.payload.data.changes[0].id, reason: "test revert" })
    });
    expect(revert.response.status).toBe(200);
    expectOkEnvelope(revert.response, revert.payload);
    expect(revert.payload.data.change.status).toBe("reverted");

    const after = await requestJson(baseUrl, `/api/agent/runs/${runId}/changes`);
    expect(after.payload.data.verificationStatus).toBe("stale");
    expect(after.payload.data.changes[0].status).toBe("reverted");
    expect(after.payload.data.rollbackHistory[0].operationType).toBe("file_revert");
    const events = await requestJson(baseUrl, `/api/agent/runs/${runId}/events`);
    const eventList = Array.isArray(events.payload.data) ? events.payload.data : events.payload.data.stageEvents;
    const eventBlob = JSON.stringify(eventList);
    expect(eventBlob).toContain("RequirementAgent");
    expect(eventBlob).toContain("ReviewAgent");
    expect(eventBlob).toContain("SummaryAgent");
    expect(await fs.readFile(path.join(targetRepoPath, "src", "App.jsx"), "utf8")).toBe("baseline app\n");
  });

  it("resets the full run workspace to baseline and leaves PR readiness data stale", async () => {
    const dbName = "rollback-reset-api";
    const targetRepoPath = await createTargetRepo(dbName);
    await fs.mkdir(path.join(targetRepoPath, "src"), { recursive: true });
    await fs.writeFile(path.join(targetRepoPath, "src", "App.jsx"), "baseline app\n", "utf8");
    await fs.writeFile(path.join(targetRepoPath, "src", "Theme.css"), "baseline css\n", "utf8");
    const agent2Runner = async ({ env }) => {
      await fs.writeFile(path.join(env.AGENT_REPO_ROOT, "src", "App.jsx"), "changed app\n", "utf8");
      await fs.writeFile(path.join(env.AGENT_REPO_ROOT, "src", "Theme.css"), "changed css\n", "utf8");
      return fakeAgent2Stdout({ file: "src/App.jsx" });
    };
    const baseUrl = await startServer(dbName, { agent2Runner, workspaceAdapterType: "copy" });
    const { payload: runPayload } = await requestJson(baseUrl, "/api/agent/run", {
      method: "POST",
      body: JSON.stringify({
        projectId: `${dbName}-project`,
        taskTitle: "Rollback reset test",
        dryRun: false,
        realRunConfirm: true,
        agentProvider: "agent2",
        targetRepoPath
      })
    });
    const runId = runPayload.data.runId;
    const reset = await requestJson(baseUrl, `/api/agent/runs/${runId}/rollback`, {
      method: "POST",
      body: JSON.stringify({ reason: "test reset" })
    });
    expect(reset.response.status).toBe(200);
    expectOkEnvelope(reset.response, reset.payload);
    expect(reset.payload.data.changes.every((change) => change.status === "reset")).toBe(true);

    const workspacePath = runPayload.data.workspace.workspacePath;
    expect(await fs.readFile(path.join(workspacePath, "src", "App.jsx"), "utf8")).toBe("baseline app\n");
    expect(await fs.readFile(path.join(workspacePath, "src", "Theme.css"), "utf8")).toBe("baseline css\n");
    expect(await fs.readFile(path.join(targetRepoPath, "src", "App.jsx"), "utf8")).toBe("baseline app\n");

    const run = await requestJson(baseUrl, `/api/agent/runs/${runId}`);
    expect(run.payload.data.verificationStatus).toBe("stale");
    const changes = await requestJson(baseUrl, `/api/agent/runs/${runId}/changes`);
    expect(changes.payload.data.rollbackHistory[0].operationType).toBe("run_reset");
    expect(changes.payload.data.changes.every((change) => change.status === "reset")).toBe(true);
  });

  it("returns workspace_not_initialized for old runs without baseline snapshots", async () => {
    const dbName = "rollback-old-run";
    const { runId } = await createDirectPersistenceFixture(dbName);
    const baseUrl = await startServer(dbName);
    const { response, payload } = await requestJson(baseUrl, `/api/agent/runs/${runId}/rollback`, {
      method: "POST",
      body: JSON.stringify({ reason: "old run" })
    });
    expect(response.status).toBe(409);
    expectErrorEnvelope(response, payload, "workspace_not_initialized");
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

function createFakeAgent2Runner() {
  return async ({ env }) => {
    const targetFile = path.join(env.AGENT_REPO_ROOT, "src", "App.jsx");
    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    await fs.writeFile(targetFile, "changed app\n", "utf8");
    return {
      exitCode: 0,
      timedOut: false,
      stderr: "",
      stdout: JSON.stringify({
      task_id: "persistence_real_agent",
      task_name: "Persistent agent run",
      status: "success",
      selected_actions: [
        { selected_action: "plan_task", selected_tool: "make_plan", reason: "Analyze RequirementDSL" },
        { selected_action: "execute_patch", selected_tool: "execute_patch", reason: "Apply Patch" }
      ],
      patch_plan: {
        summary: "Persist a real Agent(2) run.",
        patches: [{ file: "src/App.jsx", operation: "replace", changes: ["Update UI"], risk_level: "low" }]
      },
      review_result: {
        approved: true,
        risk_level: "low",
        summary: "Real patch approved."
      },
      execution_result: {
        executed: true,
        mode: "real_repo_apply",
        summary: "Applied patch.",
        files: [{ file: "src/App.jsx", status: "applied", real_write: true, bytes_written: 12 }]
      },
      pr_draft: {
        title: "Persistent agent run",
        summary: "Persist a real Agent(2) run.",
        changed_files: [{ file: "src/App.jsx", operation: "replace", risk_level: "low" }],
        test_commands: ["npm test"],
        manual_checklist: ["Review real patch."]
      },
      safety_gates: {
        repo_apply_enabled: true,
        repo_confirmed: true,
        test_run_enabled: false,
        test_confirmed: false,
        repo_mode: "real"
      }
      })
    };
  };
}

function fakeAgent2Stdout({ file = "src/App.jsx" } = {}) {
  return {
    exitCode: 0,
    timedOut: false,
    stderr: "",
    stdout: JSON.stringify({
      task_id: "rollback_agent",
      task_name: "Rollback test",
      status: "success",
      selected_actions: [
        { selected_action: "execute_patch", selected_tool: "execute_patch", reason: "Apply Patch" }
      ],
      patch_plan: {
        summary: "Apply rollback test patch.",
        patches: [{ file, operation: "replace", changes: ["Update file"], risk_level: "low" }]
      },
      review_result: {
        approved: true,
        risk_level: "low",
        summary: "Rollback patch approved."
      },
      execution_result: {
        executed: true,
        mode: "real_repo_apply",
        summary: "Applied patch.",
        files: [{ file, status: "applied", real_write: true, bytes_written: 12 }]
      },
      pr_draft: {
        title: "Rollback test",
        summary: "Apply rollback test patch.",
        changed_files: [{ file, operation: "replace", risk_level: "low" }],
        test_commands: ["npm test"],
        manual_checklist: ["Review rollback patch."]
      },
      safety_gates: {
        repo_apply_enabled: true,
        repo_confirmed: true,
        test_run_enabled: false,
        test_confirmed: false,
        repo_mode: "real"
      }
    })
  };
}

async function createAgentRunFixture(dbName) {
  const targetRepoPath = await createTargetRepo(dbName);
  await fs.mkdir(targetRepoPath, { recursive: true });
  const baseUrl = await startServer(dbName, { agent2Runner: createFakeAgent2Runner() });
  const { payload: runPayload } = await requestJson(baseUrl, "/api/agent/run", {
    method: "POST",
    body: JSON.stringify({
      projectId: `${dbName}-project`,
      taskTitle: `${dbName} task`,
      dryRun: false,
      realRunConfirm: true,
      agentProvider: "agent2",
      targetRepoPath
    })
  });
  const runId = runPayload.data.runId;
  const requirementId = `req-agent-${runId}`;
  return { baseUrl, runId, requirementId };
}

async function createTargetRepo(name) {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-target-`));
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
