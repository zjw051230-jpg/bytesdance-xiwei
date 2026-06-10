const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAgentRunPayload,
  postAgentRun,
  renderAgentResult,
} = require("./agentRunPanel");

test("buildAgentRunPayload only includes allowed request fields", () => {
  const payload = buildAgentRunPayload({
    task: "  add tests  ",
    repoPath: "  D:/repo  ",
    skill: " article-word-stats ",
    mode: "preview",
    AGENT_TEST_RUN: "1",
    AGENT_REPO_CONFIRM: "YES",
    confirm: "YES",
  });

  assert.deepEqual(payload, {
    task: "add tests",
    repoPath: "D:/repo",
    skill: "article-word-stats",
    mode: "preview",
  });
  assert.equal(Object.hasOwn(payload, "AGENT_TEST_RUN"), false);
  assert.equal(Object.hasOwn(payload, "AGENT_REPO_CONFIRM"), false);
  assert.equal(Object.hasOwn(payload, "confirm"), false);
});

test("renderAgentResult includes structured agent sections", () => {
  const html = renderAgentResult({
    ok: true,
    result: {
      status: "preview",
      task_name: "Add article stats",
      steps: 9,
      events_count: 12,
      selected_actions: [{ selected_action: "locate_files" }],
      located_files: { files: [{ path: "Article.jsx" }] },
      patch_plan: { patches: [] },
      review_result: { approved: true },
      execution_result: { mode: "real_repo_dry_run" },
      verification_result: { mode: "verify_preview_only" },
      risks: { risk_level: "low" },
    },
    stderr: "stderr text",
  });

  assert.match(html, /Status/);
  assert.match(html, /Add article stats/);
  assert.match(html, /Selected Actions/);
  assert.match(html, /Verification Result/);
  assert.match(html, /stderr text/);
});

test("postAgentRun calls backend endpoint with safe payload", async () => {
  let requestUrl = "";
  let requestOptions = null;
  const response = await postAgentRun(
    { task: "demo", mode: "dry_run" },
    async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return {
        async json() {
          return { ok: true, result: { status: "success" } };
        },
      };
    },
  );

  assert.equal(requestUrl, "/api/agent/run");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(requestOptions.body), { task: "demo", mode: "dry_run" });
  assert.equal(response.ok, true);
});
