// @vitest-environment node
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAppServer } from "./index.js";

const testRunsRoot = path.resolve("runs", "test-agent2-route");
const listeners = [];

async function startTestServer(options = {}) {
  const server = createAppServer({
    runsRoot: testRunsRoot,
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
  it("routes agent2 dry-run requests through the agent2 adapter and keeps the JSON envelope intact", async () => {
    const baseUrl = await startTestServer();

    const response = await fetch(`${baseUrl}/api/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "conduit-realworld-example-app",
        taskTitle: "Agent2 integration test",
        dryRun: true,
        agentProvider: "agent2",
        agent2Result: {
          task_id: "demo_task",
          task_name: "Add article word count and reading time",
          status: "success",
          selected_actions: [
            { selected_action: "plan_task", selected_tool: "make_plan", reason: "Analyze RequirementDSL" },
            { selected_action: "locate_files", selected_tool: "locate_files", reason: "Locate Files" },
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
            approved: false,
            risk_level: "high",
            summary: "Patch plan has review issues that should be resolved before execution."
          },
          pr_draft: {
            title: "Add article word count and reading time",
            summary: "Prepare a low-risk frontend patch for article stats display.",
            changed_files: [{ file: "frontend/src/routes/Article/Article.jsx", operation: "replace", risk_level: "low" }],
            test_commands: ["npm run lint", "npm test"],
            manual_checklist: ["Review generated patch preview before any real write."]
          },
          safety_gates: {
            repo_apply_enabled: false,
            repo_confirmed: false,
            test_run_enabled: false,
            test_confirmed: false,
            repo_mode: "mock"
          }
        }
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.error).toBeNull();
    expect(payload.data.plan.mode).toBe("agent2_dry_run_adapter");
    expect(payload.data.realWritePerformed).toBe(false);
    expect(payload.data.review.changedFiles[0].file).toBe("frontend/src/routes/Article/Article.jsx");
    expect(payload.data.prDraft.title).toBe("Add article word count and reading time");
    expect(payload.data.artifacts["agent2_result_preview.json"].json.safety.realWritePerformed).toBe(false);

    const artifactsResponse = await fetch(`${baseUrl}/api/agent/runs/${payload.data.runId}/artifacts`);
    const artifactsPayload = await artifactsResponse.json();
    expect(artifactsResponse.status).toBe(200);
    expect(artifactsPayload.ok).toBe(true);
    expect(artifactsPayload.data.review.changedFiles[0].file).toBe("frontend/src/routes/Article/Article.jsx");
    expect(artifactsPayload.data.prDraft.title).toBe("Add article word count and reading time");
    expect(JSON.stringify(artifactsPayload)).not.toMatch(/api_key|Authorization|Bearer|sk-/i);
  });
});
