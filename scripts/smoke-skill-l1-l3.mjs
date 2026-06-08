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
const rawEvpiQuestion = "你希望用什么用户可见现象或测试结果判断这个需求已经完成？";

const cases = [
  {
    key: "L1",
    input: "文章详情页现在只有正文内容，我希望在正文下面加一个简单的阅读信息提示，比如“本文共 XXX 字，预计阅读 X 分钟”。先只在前端根据文章正文计算，不需要改后端，也不需要保存数据。希望空正文时不要报错，展示上也别太突兀。",
    waitFor: /候选验收口径|每分钟 400|阅读时间/,
    askedQuestion: /阅读时间|400|字\/分钟|空正文/,
    screenshot: path.join(outDir, "skill-l1-not-pass.png")
  },
  {
    key: "L2",
    input: "我们想给文章加封面图。创建和编辑文章时可以填写一个封面图 URL，文章列表卡片和文章详情页都展示封面图。这个字段需要从后端保存和返回。封面图为空时不要显示破图，也不要影响原来的文章发布、编辑、列表和详情流程。",
    waitFor: /封面图|coverImage|API|字段/,
    askedQuestion: /字段名|URL|空值|兼容|破图/,
    screenshot: path.join(outDir, "skill-l2-not-pass.png")
  },
  {
    key: "L3",
    input: "用户看完一篇文章后，希望系统能推荐一些相关内容，最好让用户继续阅读。你看现有代码自己判断怎么做，先做一个不要太复杂的版本。",
    waitFor: /相关推荐|CodeContext|tag|标签/,
    askedQuestion: /tag|标签|作者|热门|发布时间|规则/,
    screenshot: path.join(outDir, "skill-l3-not-pass.png")
  }
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
    server.once("error", () => reject(new Error(`Port ${port} is already in use; stop the existing dev server before running smoke-skill-l1-l3.`)));
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

async function latestSystemText(page) {
  return page.evaluate(() => {
    const messages = [...document.querySelectorAll(".chat-message.system")];
    return messages.at(-1)?.textContent || "";
  });
}

await cleanupKnownDevProcesses();
await assertPortAvailable(8787);
await assertPortAvailable(webPort);

const backend = startProcess(process.execPath, ["server/index.js"], {
  PORT: "8787",
  DSL_RUNNER_MODE: "mock",
  SKILL_MODEL_MODE: "mock",
  DSL_MOCK_DELAY_MS: "3000"
});
const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
const vite = startProcess(process.execPath, [viteBin, ...getViteDevArgs()]);

const result = {
  attempted: true,
  status: "unknown",
  url,
  cases: {},
  rawEvpiQuestionExposed: true,
  pageVerticalScroll: null,
  consoleEntries: [],
  pageErrors: [],
  screenshots: {
    ...Object.fromEntries(cases.map((item) => [item.key, item.screenshot])),
    fastReplyRunnerBackground: path.join(outDir, "skill-fast-reply-runner-background.png")
  },
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
  await page.locator(".mode-tabs button").nth(1).click();
  await page.locator(".enter-workbench-button").click();
  await page.locator('[data-testid="dsl-workbench"]').waitFor();

  for (const item of cases) {
    await page.locator(".chat-input-row input").fill(item.input);
    await page.locator(".chat-input-row button").click();
    await page.waitForFunction(
      (source) => new RegExp(source).test([...document.querySelectorAll(".chat-message.system")].at(-1)?.textContent || ""),
      item.waitFor.source,
      { timeout: 30_000 }
    );
    const assistantMessage = await latestSystemText(page);
    if (item.key === "L1") {
      await page.locator(".run-state-pill.running").first().waitFor({ timeout: 10_000 }).catch(() => {});
      await page.screenshot({ path: result.screenshots.fastReplyRunnerBackground, fullPage: false });
    }
    await page.locator(".run-state-pill.passed").first().waitFor({ timeout: 60_000 });
    const bodyText = await page.textContent("body");
    result.cases[item.key] = {
      assistantMessage,
      directPass: /需求已完成|已经生成\s*DSL|可以继续|没有新的高优先级/.test(assistantMessage),
      askedQuestion: item.askedQuestion.test(assistantMessage),
      readyForAgent: /ready_for_agent\s*true|ready_for_agenttrue|\bready\b/.test(bodyText || "") && !/not ready/.test(bodyText || ""),
      safetyBoundaryVisible: /ready_for_agent\s*false|ready_for_agentfalse|not ready/.test(bodyText || ""),
      handoffDecision: (bodyText || "").includes("clarify_first") ? "clarify_first" : ""
    };
    await page.screenshot({ path: item.screenshot, fullPage: false });
  }

  const bodyText = await page.textContent("body");
  result.rawEvpiQuestionExposed = (bodyText || "").includes(rawEvpiQuestion);
  result.pageVerticalScroll = (await pageScrollMetrics(page)).hasVerticalPageScroll;
  result.status = cases.every((item) => {
    const current = result.cases[item.key];
    return current &&
      current.directPass === false &&
      current.askedQuestion === true &&
      current.readyForAgent === false &&
      current.safetyBoundaryVisible === true &&
      current.handoffDecision === "clarify_first";
  }) &&
    result.rawEvpiQuestionExposed === false &&
    result.pageVerticalScroll === false &&
    result.consoleEntries.length === 0 &&
    result.pageErrors.length === 0
      ? "passed"
      : "failed";
} catch (error) {
  result.status = "failed";
  result.error = String(error.message || error);
} finally {
  if (browser) await browser.close().catch(() => {});
  await fs.writeFile(path.join(outDir, "skill-l1-l3-smoke-result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  await Promise.all([vite, backend].map(stopProcessTree));
  await cleanupKnownDevProcesses();
  if (result.status !== "passed") process.exitCode = 1;
}
