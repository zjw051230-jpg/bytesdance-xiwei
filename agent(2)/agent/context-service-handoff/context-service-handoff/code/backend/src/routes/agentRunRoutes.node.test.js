const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const test = require("node:test");
const express = require("express");

const {
  buildAgentEnv,
  createAgentRunRouter,
  runPythonAgent,
} = require("./agentRunRoutes");

function createMockChild({ stdout = "", stderr = "", code = 0, delayMs = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    data: "",
    end(data) {
      this.data += data || "";
    },
  };
  child.killSignal = null;
  child.kill = (signal) => {
    child.killSignal = signal;
    child.emit("close", null);
  };

  setTimeout(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", code);
  }, delayMs);

  return child;
}

function createSpawnMock(child) {
  const calls = [];
  function spawnMock(command, args, options) {
    calls.push({ command, args, options });
    return child;
  }
  spawnMock.calls = calls;
  return spawnMock;
}

async function createServer(runPythonAgentImpl) {
  const app = express();
  app.use(express.json());
  app.use(createAgentRunRouter({ runPythonAgent: runPythonAgentImpl }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function postJson(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    data: await response.json(),
  };
}

test("POST /api/agent/run returns normal JSON result", async () => {
  const server = await createServer(async () => ({
    ok: true,
    result: { task_id: "demo_task", status: "success" },
    error: null,
    stderr: "",
  }));

  try {
    const response = await postJson(server.baseUrl, "/api/agent/run", { task: "demo" });
    assert.equal(response.status, 200);
    assert.equal(response.data.ok, true);
    assert.equal(response.data.result.status, "success");
    assert.equal(response.data.error, null);
    assert.equal(response.data.stderr, "");
  } finally {
    await server.close();
  }
});

test("runPythonAgent reports Python exit non-zero with parsed result", async () => {
  const child = createMockChild({
    stdout: JSON.stringify({ task_id: "demo_task", status: "failed" }),
    stderr: "python stderr",
    code: 2,
  });
  const spawnMock = createSpawnMock(child);

  const response = await runPythonAgent({
    task: "demo",
    agentRoot: "D:/agent",
    spawnImpl: spawnMock,
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "PYTHON_AGENT_EXIT_NONZERO");
  assert.equal(response.result.status, "failed");
  assert.equal(response.stderr, "python stderr");
  assert.equal(response.exit_code, 2);
});

test("runPythonAgent reports invalid stdout JSON", async () => {
  const child = createMockChild({ stdout: "not json", code: 0 });
  const response = await runPythonAgent({
    task: "demo",
    agentRoot: "D:/agent",
    spawnImpl: createSpawnMock(child),
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "PYTHON_AGENT_JSON_PARSE_FAILED");
  assert.match(response.error.stdout, /not json/);
});

test("runPythonAgent reports timeout and kills child", async () => {
  const child = createMockChild({ stdout: "", code: 0, delayMs: 100 });
  const response = await runPythonAgent({
    task: "demo",
    agentRoot: "D:/agent",
    spawnImpl: createSpawnMock(child),
    timeoutMs: 5,
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "PYTHON_AGENT_TIMEOUT");
  assert.equal(child.killSignal, "SIGKILL");
});

test("buildAgentEnv blocks dangerous execution env injection", () => {
  const oldEnv = {
    AGENT_REPO_CONFIRM: process.env.AGENT_REPO_CONFIRM,
    AGENT_TEST_RUN: process.env.AGENT_TEST_RUN,
    AGENT_TEST_CONFIRM: process.env.AGENT_TEST_CONFIRM,
  };

  process.env.AGENT_REPO_CONFIRM = "YES";
  process.env.AGENT_TEST_RUN = "1";
  process.env.AGENT_TEST_CONFIRM = "YES";

  try {
    const env = buildAgentEnv({
      task: "demo",
      repoPath: "D:/repo",
      mode: "preview",
      AGENT_TEST_RUN: "1",
      AGENT_REPO_CONFIRM: "YES",
    });

    assert.equal(env.AGENT_OUTPUT_JSON, "1");
    assert.equal(env.AGENT_REPO_MODE, "real");
    assert.equal(env.AGENT_REPO_ROOT, "D:/repo");
    assert.equal(env.AGENT_REPO_APPLY, "1");
    assert.equal(env.AGENT_REPO_CONFIRM, undefined);
    assert.equal(env.AGENT_TEST_RUN, undefined);
    assert.equal(env.AGENT_TEST_CONFIRM, undefined);
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("runPythonAgent passes task via stdin and uses shell false", async () => {
  const child = createMockChild({
    stdout: JSON.stringify({ task_id: "demo_task", status: "success" }),
    code: 0,
  });
  const spawnMock = createSpawnMock(child);

  await runPythonAgent({
    task: "hello task",
    agentRoot: "D:/agent",
    spawnImpl: spawnMock,
  });

  assert.equal(child.stdin.data, "hello task");
  assert.equal(spawnMock.calls[0].options.shell, false);
  assert.equal(spawnMock.calls[0].options.env.AGENT_OUTPUT_JSON, "1");
});
