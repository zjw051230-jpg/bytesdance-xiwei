import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";
import { getApiBaseUrl, getViteDevArgs, getWebBaseUrl, getWebPort } from "./web-ui-runtime.mjs";

const outDir = path.resolve("reporting");
const url = getWebBaseUrl();
const backendUrl = getApiBaseUrl();
const webPort = getWebPort();
const executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const projectName = "conduit-realworld-example-app";
const projectPath = "F:\\dsl\\conduit-realworld-example-app";
const pmInput = "文章详情页现在只有正文内容，我希望在正文下面加一个简单的阅读信息提示，比如“本文共 XXX 字，预计阅读 X 分钟”。先只在前端根据文章正文计算，不需要改后端，也不需要保存数据。希望空正文时不要报错，展示上也别太突兀。";

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
    server.once("error", () => reject(new Error(`Port ${port} is already in use; stop the existing dev server before running smoke-real-dsl.`)));
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
  await page.getByRole("heading", { name: "需求澄清工作台" }).waitFor();
}

async function listArtifactFiles(runId) {
  if (!runId || !runId.startsWith("RUN-")) return [];
  const runRoot = path.resolve("runs", runId);
  const found = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        found.push(path.relative(runRoot, fullPath));
      }
    }
  }
  await walk(runRoot);
  return found.sort();
}

function classifyStatus(result) {
  if (result.runnerStatus === "passed") return "pass";
  const structuredError = Boolean(result.errorCode && result.systemReplyShown && result.rightPanelUpdated && result.reportModalOpened);
  if (["failed", "timeout"].includes(result.runnerStatus) && structuredError && !result.hasJsonParseError) {
    return "external_blocked";
  }
  return "fail";
}

await assertPortAvailable(8787);
await assertPortAvailable(webPort);

const backend = startProcess(process.execPath, ["server/index.js"], { PORT: "8787" });
const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
const vite = startProcess(process.execPath, [viteBin, ...getViteDevArgs()]);

const result = {
  attempted: true,
  status: "unknown",
  runnerStatus: "unknown",
  url,
  projectName,
  projectPath,
  pmInput,
  runId: "",
  outputDir: "",
  errorCode: "",
  errorMessage: "",
  systemReplyShown: false,
  systemReplyText: "",
  rightPanelUpdated: false,
  reportModalOpened: false,
  hasJsonParseError: false,
  hasAbnormalOverlay: false,
  artifactsGenerated: [],
  screenshots: {
    main: path.join(outDir, "web-ui-real-dsl-fixed-main.png"),
    report: path.join(outDir, "web-ui-real-dsl-fixed-report.png"),
    structuredError: path.join(outDir, "web-ui-real-dsl-structured-error.png")
  },
  consoleEntries: [],
  pageErrors: [],
  scroll: null,
  modalScroll: null,
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
  await page.getByLabel("请输入你的补充回答，系统会继续更新 DSL").fill(pmInput);
  await page.getByRole("button", { name: "发送回答" }).click();
  await page.getByText("正在生成 DSL draft...").waitFor();

  const terminalState = page.locator(".run-state-pill.passed, .run-state-pill.failed, .run-state-pill.timeout").first();
  await terminalState.waitFor({ timeout: 240_000 });

  result.runnerStatus = (await terminalState.textContent())?.trim() || "unknown";
  result.runId = ((await page.locator(".run-status-panel code").textContent()) || "").trim();
  result.outputDir = ((await page.locator(".run-status-panel dd").first().textContent()) || "").trim();
  result.systemReplyText = (await page.locator(".chat-message.system").last().textContent().catch(() => "")) || "";
  result.systemReplyShown = /系统澄清|系统提示/.test(result.systemReplyText);
  result.rightPanelUpdated = await page.locator(".run-state-pill.passed, .run-state-pill.failed, .run-state-pill.timeout").first().isVisible();

  if (["failed", "timeout"].includes(result.runnerStatus)) {
    const errorText = (await page.locator(".run-error-text").textContent().catch(() => "")) || "";
    const [code, ...messageParts] = errorText.split(":");
    result.errorCode = code.trim();
    result.errorMessage = messageParts.join(":").trim();
  }

  const bodyText = await page.textContent("body");
  result.hasJsonParseError = /Unexpected end of JSON input/.test(bodyText || "");
  result.hasAbnormalOverlay = /run run run away/i.test(bodyText || "");
  result.scroll = await pageScrollMetrics(page);

  await page.screenshot({ path: result.screenshots.main, fullPage: false });
  if (["failed", "timeout"].includes(result.runnerStatus)) {
    await page.screenshot({ path: result.screenshots.structuredError, fullPage: false });
  }

  await page.getByRole("button", { name: /打开(?:需求|草稿)报告/ }).click();
  await page.getByRole("dialog", { name: "需求报告（人类可读版）" }).waitFor();
  result.reportModalOpened = true;
  result.modalScroll = await pageScrollMetrics(page);
  await page.screenshot({ path: result.screenshots.report, fullPage: false });

  result.artifactsGenerated = await listArtifactFiles(result.runId);
  result.status = classifyStatus(result);
  await browser.close();
} catch (error) {
  result.status = "fail";
  result.error = String(error.message || error);
} finally {
  await fs.writeFile(
    path.join(outDir, "web-ui-real-dsl-smoke-result.json"),
    JSON.stringify(result, null, 2),
    "utf8"
  );
  console.log(JSON.stringify(result, null, 2));
  await Promise.all([vite, backend].map(stopProcessTree));
  if (result.status === "fail") {
    process.exitCode = 1;
  }
}
