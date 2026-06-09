import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";
import { getApiBaseUrl, getViteDevArgs, getWebBaseUrl, getWebPort } from "./web-ui-runtime.mjs";

const url = getWebBaseUrl();
const backendUrl = getApiBaseUrl();
const frontendHealthUrl = new URL("/api/health", `${url}/`).toString();
const webPort = getWebPort();
const outDir = path.resolve("reporting");
const executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";

await fs.mkdir(outDir, { recursive: true });

async function pickMetrics(page, selector) {
  return page.evaluate((targetSelector) => {
    const el = document.querySelector(targetSelector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      left: Math.round(r.left),
      width: Math.round(r.width),
      height: Math.round(r.height),
      bottom: Math.round(r.bottom),
      overflowY: getComputedStyle(el).overflowY
    };
  }, selector);
}

async function pageScrollMetrics(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      bodyOverflowY: getComputedStyle(body).overflowY,
      rootOverflowY: getComputedStyle(root).overflowY,
      docScrollHeight: root.scrollHeight,
      bodyScrollHeight: body.scrollHeight,
      docClientHeight: root.clientHeight,
      hasVerticalPageScroll: root.scrollHeight > root.clientHeight || body.scrollHeight > innerHeight
    };
  });
}

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
    server.once("error", () => reject(new Error(`Port ${port} is already in use; stop the existing dev server before running verify-render.`)));
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
  });
}

async function enterWorkbench(page) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "监控台" }).waitFor();
  await page.getByRole("button", { name: "工作台" }).click();
  await page.getByRole("button", { name: "DSL 澄清台" }).waitFor();
  await page.getByRole("heading", { name: "选择你的项目" }).waitFor();
  await page.locator('[data-testid="project-rail"][data-state="collapsed"]').waitFor();
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.locator('[data-testid="dsl-workbench"]').waitFor();
  await page.getByRole("heading", { name: "需求澄清工作台" }).waitFor();
  await page.getByRole("heading", { name: "DSL 状态控制台" }).waitFor();
  await page.getByRole("button", { name: /打开(?:需求|草稿)报告/ }).waitFor();
}

async function enterDesignPlanning(page) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "监控台" }).waitFor();
  await page.getByRole("button", { name: "工作台" }).click();
  await page.getByRole("button", { name: "设计规划" }).click();
  await page.locator('[data-testid="design-planning-workbench"]').waitFor();
  await page.getByRole("heading", { name: "设计规划" }).waitFor();
}

async function verifyViewport(width, height) {
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width, height } });
  const consoleEntries = [];
  const pageErrors = [];

  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      consoleEntries.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await enterWorkbench(page);

  const initialMetrics = {
    hasDslWorkbench: await page.locator('[data-testid="dsl-workbench"]').count(),
    hasSendAnswer: await page.getByRole("button", { name: "发送回答" }).isVisible(),
    persistentGenerateDslCount: await page.getByRole("button", { name: "生成 DSL", exact: true }).count(),
    persistentRegenerateQuestionCount: await page.getByRole("button", { name: "重新生成问题", exact: true }).count(),
    runStatusIdle: await page.getByText("idle").first().isVisible(),
    shell: await pickMetrics(page, ".workspace-shell"),
    workbench: await pickMetrics(page, ".dsl-workbench"),
    statusConsole: await pickMetrics(page, ".dsl-status-console"),
    scroll: await pageScrollMetrics(page)
  };

  await page.getByLabel("输入 PM 回答或补充需求").fill("登录失败提示太模糊，希望用户知道下一步怎么做。");
  await page.getByRole("button", { name: "发送回答" }).click();
  await page.getByText("正在生成 DSL draft...").waitFor();

  const runningScreenshotPath = width === 1920
    ? path.join(outDir, "real-dsl-workbench-running-1920x1080.png")
    : path.join(outDir, `real-dsl-workbench-running-${width}x${height}.png`);
  await page.screenshot({ path: runningScreenshotPath, fullPage: false });

  await page.locator(".run-status-panel code", { hasText: "RUN-" }).waitFor({ timeout: 20_000 });
  await page.getByText("81%").waitFor({ timeout: 20_000 });

  const resultScreenshotPath = width === 1920
    ? path.join(outDir, "real-dsl-workbench-result-1920x1080.png")
    : path.join(outDir, `real-dsl-workbench-result-${width}x${height}.png`);
  await page.screenshot({ path: resultScreenshotPath, fullPage: false });

  const resultMetrics = {
    runIdText: await page.locator(".run-status-panel code").textContent(),
    statusPassedVisible: await page.locator(".run-state-pill.passed").first().isVisible(),
    completionVisible: await page.getByText("81%").isVisible(),
    evpiSourceVisible: await page.getByText("来源：EVPI-lite").isVisible(),
    noAgentPlanText: (await page.textContent("body")).includes("不会交给 Agent 执行"),
    scroll: await pageScrollMetrics(page)
  };

  await page.getByRole("button", { name: /打开(?:需求|草稿)报告/ }).click();
  await page.getByRole("dialog", { name: "需求报告（人类可读版）" }).waitFor();
  await page.getByRole("button", { name: "查看本轮 artifacts" }).waitFor();

  const modalMetrics = {
    hasDialog: await page.getByRole("dialog", { name: "需求报告（人类可读版）" }).isVisible(),
    hasRunId: (await page.textContent(".requirement-report-modal")).includes(resultMetrics.runIdText),
    hasBoundary: (await page.textContent(".requirement-report-modal")).includes("不进入 Agent Handoff"),
    modal: await pickMetrics(page, ".requirement-report-modal"),
    modalBody: await pickMetrics(page, ".report-modal-body"),
    scroll: await pageScrollMetrics(page)
  };

  const modalScreenshotPath = width === 1920
    ? path.join(outDir, "real-dsl-report-modal-1920x1080.png")
    : path.join(outDir, `real-dsl-report-modal-${width}x${height}.png`);
  await page.screenshot({ path: modalScreenshotPath, fullPage: false });

  await page.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("dialog", { name: "需求报告（人类可读版）" }).waitFor({ state: "detached" });
  await browser.close();

  return {
    viewport: `${width}x${height}`,
    url,
    backendUrl,
    frontendHealthUrl,
    executablePath,
    screenshots: {
      running: runningScreenshotPath,
      result: resultScreenshotPath,
      modal: modalScreenshotPath
    },
    initialMetrics,
    resultMetrics,
    modalMetrics,
    consoleEntries,
    pageErrors
  };
}

async function verifyDesignPlanningViewport(width, height) {
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width, height } });
  const consoleEntries = [];
  const pageErrors = [];

  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      consoleEntries.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await enterDesignPlanning(page);

  const screenshotPath = width === 1920
    ? path.join(outDir, "design-planning-page-1920x1080.png")
    : path.join(outDir, `design-planning-page-${width}x${height}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  let topTabsScreenshotPath = "";
  if (width === 1920) {
    topTabsScreenshotPath = path.join(outDir, "workspace-top-tabs.png");
    await page.locator(".workspace-top-tabs").screenshot({ path: topTabsScreenshotPath });
  }

  const text = await page.textContent("body");
  const metrics = {
    hasTopTabs: await page.locator(".workspace-top-tabs").count(),
    designTabSelected: await page.getByRole("button", { name: "设计规划" }).getAttribute("aria-pressed"),
    hasDesignPlanningWorkbench: await page.locator('[data-testid="design-planning-workbench"]').count(),
    dslStatusConsoleCount: await page.getByRole("heading", { name: "DSL 状态控制台" }).count(),
    hasMilestones: text.includes("实施阶段 / 里程碑"),
    hasTaskBreakdown: text.includes("任务拆解清单"),
    hasExecutionFeedback: text.includes("执行摘要 / 最新进展"),
    hasProgressPanel: text.includes("总体进度"),
    hasRiskPanel: text.includes("风险 / 阻塞项"),
    shell: await pickMetrics(page, ".workspace-shell"),
    workbench: await pickMetrics(page, ".design-planning-workbench"),
    rightPanel: await pickMetrics(page, ".planning-right-panel"),
    scroll: await pageScrollMetrics(page)
  };

  await browser.close();

  if (metrics.dslStatusConsoleCount !== 0) {
    throw new Error("Design planning page must not render DSL 状态控制台");
  }
  if (metrics.scroll.hasVerticalPageScroll) {
    throw new Error(`Design planning page has vertical page scroll at ${width}x${height}`);
  }
  if (consoleEntries.length > 0 || pageErrors.length > 0) {
    throw new Error(`Design planning page console/page errors at ${width}x${height}`);
  }

  return {
    viewport: `${width}x${height}`,
    url,
    executablePath,
    screenshots: {
      page: screenshotPath,
      topTabs: topTabsScreenshotPath || undefined
    },
    metrics,
    consoleEntries,
    pageErrors
  };
}

await assertPortAvailable(8787);
await assertPortAvailable(webPort);

const backend = startProcess(process.execPath, ["server/index.js"], {
  PORT: "8787",
  DSL_RUNNER_MODE: "mock",
  SKILL_MODEL_MODE: "mock",
  DSL_MOCK_DELAY_MS: "900"
});
const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
const vite = startProcess(process.execPath, [viteBin, ...getViteDevArgs()]);

try {
  await waitForHttp(`${backendUrl}/api/health`);
  await waitForHttp(frontendHealthUrl);
  await waitForHttp(url);

  const results = [
    await verifyViewport(1920, 1080),
    await verifyViewport(1440, 900)
  ];
  const designPlanningResults = [
    await verifyDesignPlanningViewport(1920, 1080),
    await verifyDesignPlanningViewport(1440, 900)
  ];

  await fs.writeFile(
    path.join(outDir, "real-dsl-render-verification.json"),
    JSON.stringify(results, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(outDir, "design-planning-render-verification.json"),
    JSON.stringify(designPlanningResults, null, 2),
    "utf8"
  );
  console.log(JSON.stringify({ dsl: results, designPlanning: designPlanningResults }, null, 2));
} finally {
  await Promise.all([vite, backend].map(stopProcessTree));
}
