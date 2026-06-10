import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";
import { getApiBaseUrl, getPortInUsePattern, getViteDevArgs, getWebBaseUrl, getWebPort } from "./web-ui-runtime.mjs";

const outDir = path.resolve("reporting");
const runsDir = path.resolve("runs");
const url = getWebBaseUrl();
const backendUrl = getApiBaseUrl();
const webPort = getWebPort();
const executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const realSkillTurnTimeoutMs = 90_000;
const uiWaitTimeoutMs = realSkillTurnTimeoutMs + 20_000;
const l1Input = "文章详情页现在只有正文内容，我希望在正文下面加一个简单的阅读信息提示，比如“本文共 XXX 字，预计阅读 X 分钟”。先只在前端根据文章正文计算，不需要改后端，也不需要保存数据。希望空正文时不要报错，展示上也别太突兀。";
const cannedMockFragments = [
  "我先按你的描述沉淀一个候选验收口径",
  "如果你没有特别要求，可以先按每分钟 400 个中文字估算"
];

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
    "($_.CommandLine -match 'server/index.js'",
    `-or $_.CommandLine -match '${getPortInUsePattern(webPort)}')`,
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

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Port ${port} is already in use; stop the existing dev server before running smoke-real-skill-l1.`)));
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
  });
}

async function pageScrollMetrics(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      docScrollHeight: root.scrollHeight,
      docClientHeight: root.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      hasVerticalPageScroll: root.scrollHeight > root.clientHeight || body.scrollHeight > innerHeight
    };
  });
}

async function findLatestSkillRun(startedAtMs) {
  const entries = await fs.readdir(runsDir, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("RUN-")) continue;
    const runPath = path.join(runsDir, entry.name);
    const parsedPath = path.join(runPath, "skill_turn_response_parsed.json");
    try {
      const stat = await fs.stat(parsedPath);
      if (stat.mtimeMs + 1000 < startedAtMs) continue;
      const parsed = JSON.parse(await fs.readFile(parsedPath, "utf8"));
      candidates.push({ runId: entry.name, runPath, parsedPath, parsed, mtimeMs: stat.mtimeMs });
    } catch {
      // skip non-skill run directories
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] || null;
}

async function artifactExists(runPath, filename) {
  try {
    await fs.access(path.join(runPath, filename));
    return true;
  } catch {
    return false;
  }
}

async function artifactText(runPath, filename) {
  try {
    return await fs.readFile(path.join(runPath, filename), "utf8");
  } catch {
    return "";
  }
}

await cleanupKnownDevProcesses();
await assertPortAvailable(8787);
await assertPortAvailable(webPort);

const backend = startProcess(process.execPath, ["server/index.js"], {
  PORT: "8787",
  DSL_RUNNER_MODE: "mock",
  DSL_MOCK_DELAY_MS: "500",
  SKILL_MODEL_MODE: "real"
});
const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
const vite = startProcess(process.execPath, [viteBin, ...getViteDevArgs()]);
const startedAtMs = Date.now();

const result = {
  attempted: true,
  status: "unknown",
  url,
  runId: "",
  model: "",
  sourceProvider: "",
  sourceMode: "",
  sourceClient: "",
  assistantMessage: "",
  readyForAgent: null,
  latencyMs: 0,
  promptChars: 0,
  diagnosticsStatus: "",
  mockUsed: false,
  artifactsGenerated: [],
  artifactLeakage: false,
  pageVerticalScroll: null,
  consoleEntries: [],
  pageErrors: [],
  screenshots: {
    main: path.join(outDir, "doubao-l1-main.png"),
    sourceBadge: path.join(outDir, "doubao-l1-source-badge.png"),
    report: path.join(outDir, "doubao-l1-report.png"),
    externalBlocked: path.join(outDir, "doubao-l1-error.png"),
    fastSuccess: path.join(outDir, "doubao-skill-l1-fast-success.png"),
    fastSourceBadge: path.join(outDir, "doubao-skill-l1-source-badge.png"),
    timeoutDiagnostics: path.join(outDir, "doubao-skill-l1-timeout-diagnostics.png")
  },
  errorCode: "",
  error: null
};

let browser = null;

try {
  await waitForHttp(`${backendUrl}/api/health`);
  await waitForHttp(url);

  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (error) => result.pageErrors.push(error.message));
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      result.consoleEntries.push({ type: msg.type(), text: msg.text() });
    }
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "工作台" }).click();
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.locator('[data-testid="dsl-workbench"]').waitFor();
  await page.evaluate((timeoutMs) => {
    globalThis.__SKILL_FAST_TIMEOUT_MS__ = timeoutMs;
  }, realSkillTurnTimeoutMs);
  await page.screenshot({ path: result.screenshots.main, fullPage: false });

  await page.getByLabel("请输入你的补充回答，系统会继续更新 DSL").fill(l1Input);
  await page.getByRole("button", { name: "发送回答" }).click();

  await page.waitForFunction(() => (
    /回复来源：Real model|回复来源：Fallback guardrail|回复来源：External blocked|sdk_auth_failed|sdk_timeout|sdk_connection_failed|sdk_request_failed|model_invalid_response|model_invalid_json|doubao_config_missing|doubao_key_missing|doubao_endpoint_missing|doubao_auth_failed|doubao_timeout|doubao_invalid_json|doubao_http_error/
      .test(document.body?.innerText || "")
  ), null, { timeout: uiWaitTimeoutMs });

  await page.screenshot({ path: result.screenshots.sourceBadge, fullPage: false });
  await page.screenshot({ path: result.screenshots.fastSourceBadge, fullPage: false });
  const bodyText = await page.textContent("body");
  result.assistantMessage = await page.evaluate(() => {
    const messages = [...document.querySelectorAll(".chat-message.system")];
    return messages.at(-1)?.textContent || "";
  });
  result.pageVerticalScroll = (await pageScrollMetrics(page)).hasVerticalPageScroll;

  const skillRun = await findLatestSkillRun(startedAtMs);
  if (skillRun) {
    result.runId = skillRun.runId;
    result.sourceMode = skillRun.parsed.source?.mode || "";
    result.sourceProvider = skillRun.parsed.source?.provider || skillRun.parsed.error?.details?.provider || "";
    result.sourceClient = skillRun.parsed.source?.client || skillRun.parsed.error?.details?.client || "";
    result.model = skillRun.parsed.source?.model || "";
    result.readyForAgent = skillRun.parsed.risk_boundary?.ready_for_agent ?? skillRun.parsed.readiness?.ready_for_agent ?? null;
    result.errorCode = skillRun.parsed.error?.code || skillRun.parsed.source?.errorCode || "";
    for (const filename of [
      "skill_turn_input.json",
      "skill_turn_prompt.md",
      "skill_turn_doubao_request.json",
      "skill_turn_doubao_response_raw.json",
      "skill_turn_sdk_request.json",
      "skill_turn_sdk_response_raw.json",
      "skill_turn_diagnostics.json",
      "skill_turn_response_parsed.json"
    ]) {
      if (await artifactExists(skillRun.runPath, filename)) {
        result.artifactsGenerated.push(path.join(skillRun.runPath, filename));
      }
    }
    const diagnosticsText = await artifactText(skillRun.runPath, "skill_turn_diagnostics.json");
    if (diagnosticsText) {
      const diagnostics = JSON.parse(diagnosticsText);
      result.promptChars = diagnostics.promptChars || 0;
      result.latencyMs = diagnostics.latencyMs || 0;
      result.diagnosticsStatus = diagnostics.status || "";
    }
    const artifactBlob = await Promise.all(result.artifactsGenerated.map((file) => fs.readFile(file, "utf8").catch(() => "")));
    result.artifactLeakage = /sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]+|api_key|Authorization/i.test(artifactBlob.join("\n"));
  }

  result.mockUsed =
    result.sourceMode === "mock" ||
    /Mock model/i.test(bodyText || "") ||
    cannedMockFragments.every((fragment) => result.assistantMessage.includes(fragment));

  if (result.sourceMode === "model_generated_real") {
    await page.locator(".run-state-pill.passed").first().waitFor({ timeout: 60_000 }).catch(() => {});
    await page.screenshot({ path: result.screenshots.fastSuccess, fullPage: false });
    await page.getByRole("button", { name: /打开(?:需求|草稿)报告/ }).click();
    await page.locator(".requirement-report-modal").waitFor({ timeout: 10_000 });
    await page.screenshot({ path: result.screenshots.report, fullPage: false });
    result.status = (
      /回复来源：Real model/.test(bodyText || "") &&
      /doubao_ark/.test(bodyText || "") &&
      result.sourceProvider === "doubao_ark" &&
      result.sourceClient === "doubao_ark" &&
      result.artifactsGenerated.some((file) => file.endsWith("skill_turn_doubao_request.json")) &&
      result.artifactsGenerated.some((file) => file.endsWith("skill_turn_doubao_response_raw.json")) &&
      result.artifactsGenerated.some((file) => file.endsWith("skill_turn_diagnostics.json")) &&
      result.promptChars > 0 &&
      result.readyForAgent === false &&
      result.mockUsed === false &&
      result.artifactLeakage === false &&
      result.pageVerticalScroll === false &&
      result.consoleEntries.length === 0 &&
      result.pageErrors.length === 0
    ) ? "passed" : "failed";
  } else {
    await page.screenshot({ path: result.screenshots.externalBlocked, fullPage: false });
    await page.screenshot({ path: result.screenshots.timeoutDiagnostics, fullPage: false });
    result.status = "external_blocked";
    if (!result.errorCode) result.errorCode = /doubao_invalid_json|model_invalid_json/.test(bodyText || "") ? "doubao_invalid_json" : "doubao_http_error";
  }
} catch (error) {
  result.status = "failed";
  result.error = String(error.message || error);
} finally {
  if (browser) await browser.close().catch(() => {});
  await fs.writeFile(path.join(outDir, "real-skill-l1-smoke-result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  await Promise.all([vite, backend].map(stopProcessTree));
  await cleanupKnownDevProcesses();
  if (result.status !== "passed") process.exitCode = 1;
}
