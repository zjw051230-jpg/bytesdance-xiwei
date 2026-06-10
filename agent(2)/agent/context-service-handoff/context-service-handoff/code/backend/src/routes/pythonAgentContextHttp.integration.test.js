const express = require("express");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createContextHttpRouter } = require("./contextHttpRoutes");

const servers = [];
const cleanupRoots = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  for (const root of cleanupRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function createContextServer() {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "python-agent-context-http-"));
  cleanupRoots.push(storageRoot);

  const app = express();
  app.use(express.json());
  app.use(createContextHttpRouter({ storageRoot }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

function runPythonAgent({ baseUrl, taskId }) {
  const agentRoot = path.resolve(__dirname, "../../../integrations/python-agent");
  const script = `
import json
import sys
from pathlib import Path

agent_core = Path.cwd() / "agent_core"
sys.path.insert(0, str(agent_core))

from orchestrator.agent_loop import run_agent

state = run_agent("给文章详情页增加字数统计和阅读时间", task_id="${taskId}")
print(json.dumps({
    "status": state.status,
    "steps": state.current_step,
    "context_snapshots": len(state.context_snapshots),
    "nodes": len(state.node_history),
    "last_event_type": state.artifacts.get("last_event", {}).get("type"),
    "latest_context_source_nodes": state.artifacts.get("latest_agent_context", {}).get("source_node_ids", []),
}, ensure_ascii=False))
`;

  return new Promise((resolve, reject) => {
    const child = spawn("python", ["-c", script], {
      cwd: agentRoot,
      env: {
        ...process.env,
        USE_CONTEXT_HTTP: "1",
        CONTEXT_SERVICE_URL: baseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      const stateFile = path.join(agentRoot, "agent_core", "storage", "states", `${taskId}.json`);
      if (fs.existsSync(stateFile)) fs.rmSync(stateFile, { force: true });
      if (code !== 0) {
        reject(new Error(`python exited ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout.trim()));
    });
  });
}

function runPythonAgentWithRealDryRunAdapters({ baseUrl, taskId, repoRoot }) {
  const agentRoot = path.resolve(__dirname, "../../../integrations/python-agent");
  const script = `
import json
import sys
from pathlib import Path

agent_core = Path.cwd() / "agent_core"
sys.path.insert(0, str(agent_core))

from orchestrator.agent_loop import run_agent

state = run_agent("给文章详情页增加字数统计和阅读时间", task_id="${taskId}")
execution = state.artifacts.get("execution_result", {})
verification = state.artifacts.get("verification_result", {})
print(json.dumps({
    "status": state.status,
    "steps": state.current_step,
    "last_event_type": state.artifacts.get("last_event", {}).get("type"),
    "execution_mode": execution.get("mode"),
    "execution_files": execution.get("files", []),
    "verification_mode": verification.get("mode"),
    "verification_passed": verification.get("passed"),
}, ensure_ascii=False))
`;

  return new Promise((resolve, reject) => {
    const child = spawn("python", ["-c", script], {
      cwd: agentRoot,
      env: {
        ...process.env,
        USE_CONTEXT_HTTP: "1",
        CONTEXT_SERVICE_URL: baseUrl,
        USE_REAL_REPO: "1",
        REAL_REPO_DRY_RUN: "1",
        USE_REAL_TEST: "1",
        REAL_TEST_DRY_RUN: "1",
        AGENT_REPO_ROOT: repoRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      const stateFile = path.join(agentRoot, "agent_core", "storage", "states", `${taskId}.json`);
      if (fs.existsSync(stateFile)) fs.rmSync(stateFile, { force: true });
      if (code !== 0) {
        reject(new Error(`python exited ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout.trim()));
    });
  });
}

async function request(baseUrl, method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { status: response.status, data };
}

describe("Python Agent real Context HTTP integration", () => {
  test("runs copied Python Agent mock flow through JS Context HTTP wrapper", async () => {
    const { baseUrl } = await createContextServer();
    const taskId = "python_agent_real_http_flow";

    const result = await runPythonAgent({ baseUrl, taskId });
    const trace = await request(baseUrl, "POST", "/trace/rebuild", { taskId });
    const repairContext = await request(baseUrl, "POST", "/context/build", {
      taskId,
      agentName: "repairAgent",
      currentNodeId: "sandbox_6",
    });

    expect(result).toMatchObject({
      status: "SUCCESS",
      steps: 9,
      context_snapshots: 5,
      nodes: 6,
      last_event_type: "TASK_FINISHED",
    });
    expect(trace.status).toBe(200);
    expect(trace.data.data.trace_view.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "dsl_root",
      "plan_2",
      "patch_4",
      "review_5",
      "sandbox_6",
    ]));
    expect(repairContext.status).toBe(200);
    expect(repairContext.data.data.source_node_ids).toEqual([
      "sandbox_6",
      "review_5",
      "patch_4",
      "plan_2",
      "dsl_root",
    ]);
    expect(repairContext.data.data.context).toEqual(expect.objectContaining({
      dependency_summary: expect.any(Object),
      failed_patch_summary: expect.any(Object),
      sandbox_error_summary: expect.any(Object),
      verified_plan_summary: expect.any(Object),
    }));
  });

  test("runs copied Python Agent against a real repo adapter in dry-run mode", async () => {
    const { baseUrl } = await createContextServer();
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "python-agent-real-repo-dry-run-"));
    cleanupRoots.push(repoRoot);
    const targetFile = path.join(repoRoot, "frontend", "src", "pages", "Article.jsx");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, "export default function Article() { return null; }\n", "utf8");
    const beforeContent = fs.readFileSync(targetFile, "utf8");

    const result = await runPythonAgentWithRealDryRunAdapters({
      baseUrl,
      taskId: "python_agent_real_repo_dry_run",
      repoRoot,
    });
    const afterContent = fs.readFileSync(targetFile, "utf8");

    expect(result.status).toBe("SUCCESS");
    expect(result.execution_mode).toBe("real_repo_dry_run");
    expect(result.execution_files[0]).toMatchObject({
      file: "frontend/src/pages/Article.jsx",
      applied: false,
      mode: "real_repo_dry_run",
    });
    expect(result.verification_mode).toBe("real_test_dry_run");
    expect(result.verification_passed).toBe(true);
    expect(afterContent).toBe(beforeContent);
  });
});
