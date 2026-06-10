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
const projectName = "conduit-realworld-example-app";
const projectPath = "F:\\dsl\\conduit-realworld-example-app";
const firstInput = "文章详情页现在只有正文内容，我希望在正文下面加一个简单的阅读信息提示，比如“本文共 XXX 字，预计阅读 X 分钟”。先只在前端根据文章正文计算，不需要改后端，也不需要保存数据。希望空正文时不要报错，展示上也别太突兀。";
const secondInput = "用户可见现象：进入文章详情页后，在正文下方能看到一行阅读信息，格式类似“本文共 XXX 字，预计阅读 X 分钟”。如果正文为空，就不展示这行信息，页面不报错、不出现 NaN 或 0 分钟这类异常内容。不需要后端保存，也不需要新增数据库字段；只要前端根据当前文章正文实时计算并展示即可。";
const repeatedQuestionPatterns = [
  /你希望用什么用户可见现象或测试结果判断这个需求已经完成/,
  /请补充验收标准/,
  /用什么测试结果证明需求完成/,
  /完成后用户能看到什么/
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
    server.once("error", () => reject(new Error(`Port ${port} is already in use; stop the existing dev server before running smoke-l1-dedup.`)));
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
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

async function enterWorkbenchFromNewProject(page) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "监控台" }).waitFor();
  await page.getByRole("button", { name: "工作台" }).click();
  await page.getByRole("heading", { name: "选择你的项目" }).waitFor();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("dialog", { name: "新建项目" }).waitFor();
  await page.getByLabel("项目名称").fill(projectName);
  await page.getByLabel("本地路径").fill(projectPath);
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByRole("status").filter({ hasText: `已创建 ${projectName}` }).waitFor();
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.locator('[data-testid="dsl-workbench"]').waitFor();
}

async function sendAndWait(page, text, previousRunId = "") {
  await page.getByLabel("请按序号回答，也可以只回答你确定的部分").fill(text);
  await page.getByRole("button", { name: "发送回答" }).click();
  await page.getByText("正在生成 DSL draft...").waitFor();
  await page.waitForFunction(
    (oldRunId) => {
      const status = document.querySelector(".run-state-pill.passed, .run-state-pill.failed, .run-state-pill.timeout")?.textContent?.trim();
      const runId = document.querySelector(".run-status-panel code")?.textContent?.trim();
      return status && runId && runId !== oldRunId && runId.startsWith("RUN-");
    },
    previousRunId,
    { timeout: 240_000 }
  );
  const runId = ((await page.locator(".run-status-panel code").textContent()) || "").trim();
  const status = ((await page.locator(".run-state-pill.passed, .run-state-pill.failed, .run-state-pill.timeout").first().textContent()) || "").trim();
  const systemText = await latestSystemText(page);
  return { runId, status, systemText };
}

async function latestSystemText(page) {
  return page.evaluate(() => {
    const messages = [...document.querySelectorAll(".chat-message.system")];
    return messages.at(-1)?.textContent || "";
  });
}

async function scrollChatToBottom(page) {
  await page.evaluate(() => {
    const stream = document.querySelector(".chat-stream");
    if (stream) stream.scrollTop = stream.scrollHeight;
  });
}

function hasRepeatedQuestion(text) {
  return repeatedQuestionPatterns.some((pattern) => pattern.test(text || ""));
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
  firstRunId: "",
  firstStatus: "",
  firstSystemQuestion: "",
  secondRunId: "",
  secondStatus: "",
  pmAnswer: secondInput,
  secondSystemReply: "",
  repeatedQuestionAppeared: true,
  suggestionCardVisibleAfterSecond: false,
  suggestionCardTextAfterSecond: "",
  reportModalOpened: false,
  naturalSkillReplyShown: false,
  screenshots: {
    afterAnswer: path.join(outDir, "web-ui-l1-dedup-after-answer.png"),
    report: path.join(outDir, "web-ui-l1-dedup-report.png")
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

  await enterWorkbenchFromNewProject(page);
  const first = await sendAndWait(page, firstInput);
  result.firstRunId = first.runId;
  result.firstStatus = first.status;
  result.firstSystemQuestion = first.systemText;

  const second = await sendAndWait(page, secondInput, first.runId);
  result.secondRunId = second.runId;
  result.secondStatus = second.status;
  result.secondSystemReply = second.systemText;
  result.suggestionCardVisibleAfterSecond = await page.locator('[data-testid="suggested-question"]').isVisible().catch(() => false);
  result.suggestionCardTextAfterSecond = result.suggestionCardVisibleAfterSecond
    ? ((await page.locator('[data-testid="suggested-question"]').textContent()) || "")
    : "";
  result.repeatedQuestionAppeared = hasRepeatedQuestion(result.secondSystemReply) || hasRepeatedQuestion(result.suggestionCardTextAfterSecond);
  result.naturalSkillReplyShown = /XXX|400|NaN/.test((await page.textContent("body")) || "");

  await scrollChatToBottom(page);
  await page.screenshot({ path: result.screenshots.afterAnswer, fullPage: false });

  await page.getByRole("button", { name: /打开(?:需求|草稿)报告/ }).click();
  await page.getByRole("dialog", { name: "需求报告（人类可读版）" }).waitFor();
  result.reportModalOpened = true;
  await page.screenshot({ path: result.screenshots.report, fullPage: false });

  const structured = result.firstStatus === "passed" && result.secondStatus === "passed" && result.reportModalOpened && result.naturalSkillReplyShown && !result.repeatedQuestionAppeared;
  result.status = structured ? "passed" : "failed";
  await browser.close();
} catch (error) {
  result.status = "failed";
  result.error = String(error.message || error);
} finally {
  await fs.writeFile(
    path.join(outDir, "web-ui-l1-dedup-smoke-result.json"),
    JSON.stringify(result, null, 2),
    "utf8"
  );
  console.log(JSON.stringify(result, null, 2));
  await Promise.all([vite, backend].map(stopProcessTree));
  await cleanupKnownDevProcesses();
  if (result.status !== "passed") {
    process.exitCode = 1;
  }
}
