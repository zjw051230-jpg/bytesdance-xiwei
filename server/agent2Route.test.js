// @vitest-environment node
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppServer } from "./index.js";

const testRunsRoot = path.resolve("runs", "test-agent2-route");
const listeners = [];

async function startTestServer(options = {}) {
  const apiConfigPath = path.join(testRunsRoot, "configs", "api_config.local.json");
  await fs.mkdir(path.dirname(apiConfigPath), { recursive: true });
  await fs.writeFile(apiConfigPath, JSON.stringify({
    provider: "doubao_ark",
    api_key: "db-test-fixture-secret",
    model: "ep-test-fixture"
  }, null, 2), "utf8");
  const server = createAppServer({
    runsRoot: testRunsRoot,
    apiConfigPath,
    runnerMode: "mock",
    skillModelMode: "mock",
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  listeners.push(server);
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(
    listeners.splice(0).map((server) => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      const timer = setTimeout(resolve, 250);
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    }))
  );
});

describe("Agent(2) route integration", () => {
  it("routes real Agent(2) requests through the runner and keeps the JSON envelope intact", async () => {
    const targetRepoPath = path.join(testRunsRoot, "target-repo");
    await fs.mkdir(targetRepoPath, { recursive: true });
    const agent2Runner = vi.fn(async ({ env, input }) => ({
      exitCode: 0,
      timedOut: false,
      stderr: "",
      stdout: JSON.stringify({
        task_id: "demo_task",
        task_name: "Add article word count and reading time",
        status: "success",
        selected_actions: [
          { selected_action: "plan_task", selected_tool: "make_plan", reason: "Analyze RequirementDSL" },
          { selected_action: "locate_files", selected_tool: "locate_files", reason: "Locate Files" },
          { selected_action: "execute_patch", selected_tool: "execute_patch", reason: "Apply Patch" },
          { selected_action: "review_patch", selected_tool: "review_patch", reason: "Review Patch" }
        ],
        located_files: {
          files: [
            { relative_path: "frontend/src/routes/Article/Article.jsx", reason: "Matched article detail page" }
          ]
        },
        patch_plan: {
          summary: "Prepare a low-risk frontend patch for article stats display.",
          patches: [
            {
              file: "frontend/src/routes/Article/Article.jsx",
              operation: "replace",
              changes: ["Add word count calculation", "Add reading time calculation"],
              reason: "Article detail page needs word count and reading time display",
              risk_level: "low"
            }
          ]
        },
        review_result: {
          approved: true,
          risk_level: "low",
          summary: "Patch was applied and reviewed."
        },
        execution_result: {
          executed: true,
          mode: "real_repo_apply",
          summary: "Applied one file.",
          files: [
            { file: "frontend/src/routes/Article/Article.jsx", status: "applied", real_write: true, bytes_written: 42 }
          ]
        },
        pr_draft: {
          title: "Add article word count and reading time",
          summary: "Prepare a low-risk frontend patch for article stats display.",
          changed_files: [{ file: "frontend/src/routes/Article/Article.jsx", operation: "replace", risk_level: "low" }],
          test_commands: ["npm run lint", "npm test"],
          manual_checklist: ["Review generated real patch."]
        },
        safety_gates: {
          repo_apply_enabled: true,
          repo_confirmed: true,
          test_run_enabled: false,
          test_confirmed: false,
          repo_mode: "real"
        },
        input_echo: JSON.parse(input)
      })
    }));
    const baseUrl = await startTestServer({ agent2Runner });

    const response = await fetch(`${baseUrl}/api/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        taskTitle: "Agent2 integration test",
        requirementDsl: {
          task_name: "把 UI 改成黑红配色",
          user_story: "把 Conduit Home 页面改成黑红配色主题"
        },
        dryRun: false,
        agentProvider: "agent2",
        targetRepoPath
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.error).toBeNull();
    expect(agent2Runner).toHaveBeenCalledOnce();
    expect(agent2Runner.mock.calls[0][0].env.AGENT_REPO_ROOT).toBe(targetRepoPath);
    expect(agent2Runner.mock.calls[0][0].env.AGENT_REPO_APPLY).toBe("1");
    expect(agent2Runner.mock.calls[0][0].env.AGENT_USE_LLM_PLANNER).toBe("1");
    expect(agent2Runner.mock.calls[0][0].env.AGENT_USE_LLM_CODER).toBe("1");
    expect(agent2Runner.mock.calls[0][0].env.AGENT_TASK_ID).toMatch(/^RUN-/);
    expect(agent2Runner.mock.calls[0][0].env.AGENT_STATE_DIR).toContain("agent2_state");
    const agentInput = JSON.parse(agent2Runner.mock.calls[0][0].input);
    expect(agentInput.skill_hint).toBe("conduit-theme");
    expect(agentInput.target_modules).toContain("frontend/src/index.css");
    expect(payload.data.plan.mode).toBe("agent2_real_execution");
    expect(payload.data.realWritePerformed).toBe(true);
    expect(payload.data.review.changedFiles[0].file).toBe("frontend/src/routes/Article/Article.jsx");
    expect(payload.data.prDraft.title).toBe("Add article word count and reading time");
    expect(payload.data.artifacts["agent2_result_preview.json"].json.safety.realWritePerformed).toBe(true);

    const artifactsResponse = await fetch(`${baseUrl}/api/agent/runs/${payload.data.runId}/artifacts`);
    const artifactsPayload = await artifactsResponse.json();
    expect(artifactsResponse.status).toBe(200);
    expect(artifactsPayload.ok).toBe(true);
    expect(artifactsPayload.data.review.changedFiles[0].file).toBe("frontend/src/routes/Article/Article.jsx");
    expect(artifactsPayload.data.prDraft.title).toBe("Add article word count and reading time");
    expect(JSON.stringify(artifactsPayload)).not.toMatch(/api_key|Authorization|Bearer|sk-/i);
  });
});
