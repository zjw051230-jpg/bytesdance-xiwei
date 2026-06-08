import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";
import { getApiBaseUrl, getPortInUsePattern, getViteDevArgs, getWebBaseUrl, getWebPort } from "./web-ui-runtime.mjs";

const outDir = path.resolve("reporting");
const url = getWebBaseUrl();
const backendUrl = getApiBaseUrl();
const webPort = getWebPort();
const executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const l1Input = "文章详情页现在只有正文内容，我希望在正文下面加一个简单的阅读信息提示，比如“本文共 XXX 字，预计阅读 X 分钟”。先只在前端根据文章正文计算，不需要改后端，也不需要保存数据。希望空正文时不要报错，展示上也别太突兀。";
const rawEvpiQuestion = "你希望用什么用户可见现象或测试结果判断这个需求已经完成？";

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
    server.once("error", () => reject(new Error(`Port ${port} is already in use; stop the existing dev server before running smoke-skill-driven-l1.`)));
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

await cleanupKnownDevProcesses();
await assertPortAvailable(8787);
await assertPortAvailable(webPort);

const backend = startProcess(process.execPath, ["server/index.js"], {
  PORT: "8787",
  DSL_RUNNER_MODE: "mock",
  SKILL_MODEL_MODE: "mock",
  DSL_MOCK_DELAY_MS: "500"
});
const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
const vite = startProcess(process.execPath, [viteBin, ...getViteDevArgs()]);

const result = {
  attempted: true,
  status: "unknown",
  url,
  runId: "",
  assistantMessage: "",
  containsCandidateAcceptanceCriteria: false,
  rawEvpiQuestionExposed: true,
  readyForAgent: null,
  safetyBoundaryVisible: false,
  handoffDecision: "",
  reportModalOpened: false,
  pageVerticalScroll: null,
  screenshots: {
    main: path.join(outDir, "web-ui-skill-driven-l1-main.png"),
    report: path.join(outDir, "web-ui-skill-driven-l1-report.png")
  },
  consoleEntries: [],
  pageErrors: [],
  error: null
};

try {
  await waitForHttp(`${backendUrl}/api/health`);
  await waitForHttp(url);

  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (error) => result.pageErrors.push(error.message));
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      result.consoleEntries.push({ type: msg.type(), text: msg.text() });
    }
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator(".mode-tabs button").nth(1).click();
  await page.locator(".enter-workbench-button").click();
  await page.locator('[data-testid="dsl-workbench"]').waitFor();
  await page.locator(".chat-input-row input").fill(l1Input);
  await page.locator(".chat-input-row button").click();

  await page.getByText("候选验收口径").waitFor({ timeout: 30_000 });
  result.assistantMessage = await page.evaluate(() => {
    const messages = [...document.querySelectorAll(".chat-message.system")];
    return messages.at(-1)?.textContent || "";
  });
  await page.locator(".run-state-pill.passed").first().waitFor({ timeout: 60_000 });
  result.runId = ((await page.locator(".run-status-panel code").textContent()) || "").trim();

  const bodyText = await page.textContent("body");
  result.containsCandidateAcceptanceCriteria = /候选验收口径|本文共 XXX 字|每分钟 400/.test(result.assistantMessage);
  result.rawEvpiQuestionExposed = (bodyText || "").includes(rawEvpiQuestion);
  result.readyForAgent = /ready_for_agent\\s*true|ready_for_agenttrue|\\bready\\b/.test(bodyText || "") && !/not ready/.test(bodyText || "");
  result.safetyBoundaryVisible = /ready_for_agent\\s*false|ready_for_agentfalse|not ready/.test(bodyText || "");
  result.handoffDecision = (bodyText || "").includes("clarify_first") ? "clarify_first" : "";
  result.pageVerticalScroll = (await pageScrollMetrics(page)).hasVerticalPageScroll;
  await page.screenshot({ path: result.screenshots.main, fullPage: false });

  await page.locator(".report-cta").click();
  await page.locator(".requirement-report-modal").waitFor({ timeout: 10_000 });
  result.reportModalOpened = true;
  await page.screenshot({ path: result.screenshots.report, fullPage: false });

  result.status = (
    result.runId.startsWith("RUN-") &&
    result.containsCandidateAcceptanceCriteria &&
    result.rawEvpiQuestionExposed === false &&
    result.readyForAgent === false &&
    result.safetyBoundaryVisible === true &&
    result.handoffDecision === "clarify_first" &&
    result.reportModalOpened &&
    result.pageVerticalScroll === false &&
    result.consoleEntries.length === 0 &&
    result.pageErrors.length === 0
  ) ? "passed" : "failed";

  await browser.close();
} catch (error) {
  result.status = "failed";
  result.error = String(error.message || error);
} finally {
  await fs.writeFile(path.join(outDir, "web-ui-skill-driven-l1-smoke-result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  await Promise.all([vite, backend].map(stopProcessTree));
  await cleanupKnownDevProcesses();
  if (result.status !== "passed") process.exitCode = 1;
}
