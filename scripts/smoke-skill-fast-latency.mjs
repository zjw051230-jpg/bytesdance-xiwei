import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const outDir = path.resolve("reporting");
const backendUrl = "http://127.0.0.1:8787";

await fs.mkdir(outDir, { recursive: true });

function startProcess(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

function stopProcessTree(child) {
  if (!child?.pid || child.killed) return Promise.resolve();
  if (process.platform !== "win32") {
    child.kill();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore"
    });
    killer.on("close", resolve);
    killer.on("error", resolve);
  });
}

function cleanupKnownDevProcesses() {
  if (process.platform !== "win32") return Promise.resolve();
  const command = [
    "Get-CimInstance Win32_Process |",
    "Where-Object {",
    "$_.ProcessId -ne $PID -and",
    "$_.CommandLine -match 'server/index.js'",
    "} |",
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
  ].join(" ");
  return new Promise((resolve) => {
    const cleaner = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      windowsHide: true,
      stdio: "ignore"
    });
    cleaner.on("close", resolve);
    cleaner.on("error", resolve);
  });
}

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Port ${port} is already in use; stop the existing backend before running smoke-skill-fast-latency.`)));
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
  });
}

async function waitForHttp(targetUrl, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(targetUrl);
      if (response.status < 500) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${targetUrl}`);
}

async function postJson(pathname, body) {
  const response = await fetch(`${backendUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload };
}

const pmMessages = [{
  role: "pm",
  content: "文章详情页现在只有正文内容，我希望在正文下面加一个简单的阅读信息提示，比如“本文共 XXX 字，预计阅读 X 分钟”。"
}];

const result = {
  attempted: true,
  status: "unknown",
  skillLatencyMs: null,
  runnerStartLatencyMs: null,
  runnerStatusImmediatelyAfterStart: "",
  skillReplyBeforeRunner: false,
  slowResponseLatencyMs: null,
  slowResponseMode: "",
  maxSkillLatencyMs: 12000,
  error: null
};

let backend = null;

try {
  await cleanupKnownDevProcesses();
  await assertPortAvailable(8787);

  backend = startProcess(process.execPath, ["server/index.js"], {
    PORT: "8787",
    DSL_RUNNER_MODE: "mock",
    DSL_MOCK_DELAY_MS: "3000",
    SKILL_MODEL_MODE: "mock"
  });
  await waitForHttp(`${backendUrl}/api/health`);

  let started = Date.now();
  const skill = await postJson("/api/skill/pm-dsl-turn", {
    mode: "fast",
    maxLatencyMs: 12000,
    projectId: "conduit-realworld-example-app",
    pmMessages
  });
  result.skillLatencyMs = Date.now() - started;

  started = Date.now();
  const runner = await postJson("/api/dsl/runs/start", {
    projectId: "conduit-realworld-example-app",
    pmMessages,
    timeoutMs: 10_000
  });
  result.runnerStartLatencyMs = Date.now() - started;
  result.runnerStatusImmediatelyAfterStart = runner.payload.data?.status || "";
  result.skillReplyBeforeRunner =
    skill.payload.ok === true &&
    skill.payload.data?.assistant_message &&
    result.runnerStatusImmediatelyAfterStart === "running" &&
    result.skillLatencyMs < 8000;

  await stopProcessTree(backend);
  backend = null;
  await cleanupKnownDevProcesses();
  await assertPortAvailable(8787);

  backend = startProcess(process.execPath, ["server/index.js"], {
    PORT: "8787",
    DSL_RUNNER_MODE: "mock",
    DSL_MOCK_DELAY_MS: "0",
    SKILL_MODEL_MODE: "mock-hang"
  });
  await waitForHttp(`${backendUrl}/api/health`);

  started = Date.now();
  const slow = await postJson("/api/skill/pm-dsl-turn", {
    mode: "fast",
    maxLatencyMs: 80,
    projectId: "conduit-realworld-example-app",
    pmMessages
  });
  result.slowResponseLatencyMs = Date.now() - started;
  result.slowResponseMode = slow.payload.data?.source?.mode || "";

  result.status = (
    result.skillReplyBeforeRunner === true &&
    result.skillLatencyMs < 8000 &&
    result.runnerStatusImmediatelyAfterStart === "running" &&
    result.slowResponseMode === "slow_response" &&
    result.slowResponseLatencyMs < 1500
  ) ? "passed" : "failed";
} catch (error) {
  result.status = "failed";
  result.error = String(error.message || error);
} finally {
  if (backend) await stopProcessTree(backend);
  await cleanupKnownDevProcesses();
  await fs.writeFile(path.join(outDir, "skill-fast-latency-smoke-result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") process.exitCode = 1;
}
