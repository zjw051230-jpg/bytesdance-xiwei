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
const appReadyTimeoutMs = 90_000;
const scrollTolerancePx = 6;

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
  return page.evaluate((tolerance) => {
    const root = document.documentElement;
    const body = document.body;
    return {
      bodyOverflowY: getComputedStyle(body).overflowY,
      rootOverflowY: getComputedStyle(root).overflowY,
      docScrollHeight: root.scrollHeight,
      bodyScrollHeight: body.scrollHeight,
      docClientHeight: root.clientHeight,
      allowedTolerance: tolerance,
      hasVerticalPageScroll: root.scrollHeight > root.clientHeight + tolerance || body.scrollHeight > innerHeight + tolerance
    };
  }, scrollTolerancePx);
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

async function gotoApp(page) {
  await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.locator("#root > *").waitFor({ timeout: appReadyTimeoutMs });
  await page.getByText("Codex Workbench").first().waitFor({ timeout: appReadyTimeoutMs });
  await waitForStableEntry(page);
}

async function waitForStableEntry(page) {
  await page.waitForFunction(() => {
    return Boolean(
      document.querySelector(".workspace-top-tabs") ||
      document.querySelector('[data-testid="workspace-shell"]') ||
      document.querySelector('[data-testid="workspace-project-picker"]') ||
      document.querySelector('[data-testid="dsl-workbench"]') ||
      document.querySelector('[data-testid="design-planning-workbench"]') ||
      [...document.querySelectorAll("button")].some((button) => ["工作台", "DSL 澄清台", "设计规划", "审计页面", "PR 页面"].includes(button.textContent?.trim()))
    );
  }, null, { timeout: appReadyTimeoutMs });
}

async function ensureWorkbenchMode(page) {
  if (await page.locator(".workspace-top-tabs").count()) return;
  if (await page.locator('[data-testid="workspace-shell"]').count()) return;
  const workbenchButton = page.getByRole("button", { name: "工作台" });
  if (await workbenchButton.count()) {
    await workbenchButton.click();
    await page.locator('[data-testid="workspace-shell"]').waitFor({ timeout: appReadyTimeoutMs });
    return;
  }
  await waitForStableEntry(page);
}

async function ensureDslWorkbench(page) {
  if (await page.locator('[data-testid="dsl-workbench"]').count()) return;
  await ensureWorkbenchMode(page);

  if (await page.locator('[data-testid="workspace-project-picker"]').count()) {
    await page.getByRole("heading", { name: "选择你的项目" }).waitFor({ timeout: appReadyTimeoutMs });
    await page.locator('[data-testid="project-rail"][data-state="collapsed"]').waitFor({ timeout: appReadyTimeoutMs });
    await page.getByRole("button", { name: "进入工作台" }).click();
  } else if (await page.locator(".workspace-top-tabs").count()) {
    await page.getByRole("button", { name: "DSL 澄清台", exact: true }).click();
  }

  await page.locator('[data-testid="dsl-workbench"]').waitFor({ timeout: appReadyTimeoutMs });
}

async function assertWorkspaceChrome(page) {
  const checks = {
    topTabs: await page.locator(".workspace-top-tabs").count(),
    dslTab: await page.getByRole("button", { name: "DSL 澄清台", exact: true }).isVisible(),
    designTab: await page.getByRole("button", { name: "设计规划", exact: true }).isVisible(),
    reviewTab: await page.getByRole("button", { name: "审计页面", exact: true }).isVisible(),
    prTab: await page.getByRole("button", { name: "PR 页面", exact: true }).isVisible(),
    leftRail: await page.locator('[data-testid="project-rail"]').count(),
    shell: await page.locator('[data-testid="workspace-shell"]').count(),
    mainContent: await page.locator(".workspace-content").count()
  };
  const failed = Object.entries(checks).filter(([, value]) => value === false || value === 0).map(([key]) => key);
  if (failed.length > 0) {
    throw new Error(`Workspace chrome check failed: ${failed.join(", ")}`);
  }
  return checks;
}

function assertNoVerticalPageScroll(metrics, label) {
  if (metrics.hasVerticalPageScroll) {
    throw new Error(`${label} has page-level vertical scroll: document=${metrics.docScrollHeight}, body=${metrics.bodyScrollHeight}, viewport=${metrics.docClientHeight}, tolerance=${scrollTolerancePx}`);
  }
}

function isGenericNotFoundConsoleEntry(entry) {
  return entry?.type === "error" && /Failed to load resource: the server responded with a status of 404/.test(entry.text || "");
}

function isExpectedMissingDesignPlanResponse(response) {
  if (response?.status !== 404) return false;
  try {
    const parsed = new URL(response.url);
    return /^\/api\/requirements\/[^/]+\/design-plan$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function collectUnexpectedDesignPlanningIssues(consoleEntries, pageErrors, responseErrors) {
  const unexpectedResponses = responseErrors.filter((response) => !isExpectedMissingDesignPlanResponse(response));
  const onlyExpectedDesignPlanMisses = responseErrors.length > 0 && unexpectedResponses.length === 0;
  const unexpectedConsoleEntries = onlyExpectedDesignPlanMisses
    ? consoleEntries.filter((entry) => !isGenericNotFoundConsoleEntry(entry))
    : consoleEntries;

  return {
    unexpectedConsoleEntries,
    pageErrors,
    unexpectedResponses,
    expectedDesignPlanMisses: responseErrors.filter(isExpectedMissingDesignPlanResponse)
  };
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
  await gotoApp(page);
  await ensureDslWorkbench(page);
  await assertWorkspaceChrome(page);
  await page.getByRole("heading", { name: "需求澄清工作台" }).waitFor();
  await page.getByRole("heading", { name: "DSL 状态控制台" }).waitFor();
  await page.getByRole("button", { name: /打开(?:需求|草稿)报告/ }).waitFor();
}

async function enterDesignPlanning(page) {
  await gotoApp(page);
  await ensureDslWorkbench(page);
  await assertWorkspaceChrome(page);
  await page.getByRole("button", { name: "设计规划", exact: true }).click();
  await page.locator('[data-testid="design-planning-workbench"]').waitFor();
  await page.getByRole("heading", { name: "设计规划" }).waitFor();
}

async function verifyViewport(width, height) {
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--headless=new", "--no-proxy-server", "--disable-gpu"]
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const consoleEntries = [];
  const pageErrors = [];
  const responseErrors = [];

  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      consoleEntries.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      responseErrors.push({ status: response.status(), url: response.url() });
    }
  });

  await enterWorkbench(page);
  const chromeChecks = await assertWorkspaceChrome(page);

  const renderScreenshotPath = path.join(outDir, `render-${width}x${height}.png`);
  await page.screenshot({ path: renderScreenshotPath, fullPage: false });

  const initialMetrics = {
    chrome: chromeChecks,
    hasDslWorkbench: await page.locator('[data-testid="dsl-workbench"]').count(),
    hasSendAnswer: await page.getByRole("button", { name: "发送回答" }).isVisible(),
    persistentGenerateDslCount: await page.getByRole("button", { name: "生成 DSL", exact: true }).count(),
    persistentRegenerateQuestionCount: await page.getByRole("button", { name: "重新生成问题", exact: true }).count(),
    runStatusIdle: await page.getByText("idle").first().isVisible(),
    shell: await pickMetrics(page, ".workspace-shell"),
    leftRail: await pickMetrics(page, '[data-testid="project-rail"]'),
    topTabs: await pickMetrics(page, ".workspace-top-tabs"),
    mainContent: await pickMetrics(page, ".workspace-content"),
    workbench: await pickMetrics(page, ".dsl-workbench"),
    statusConsole: await pickMetrics(page, ".dsl-status-console"),
    scroll: await pageScrollMetrics(page)
  };
  assertNoVerticalPageScroll(initialMetrics.scroll, `DSL initial ${width}x${height}`);

  await page.getByLabel("请输入你的补充回答，系统会继续更新 DSL").fill("登录失败提示太模糊，希望用户知道下一步怎么做。");
  await page.getByRole("button", { name: "发送回答" }).click();
  await page.getByText("正在生成 DSL draft...").waitFor();

  const runningScreenshotPath = width === 1920
    ? path.join(outDir, "real-dsl-workbench-running-1920x1080.png")
    : path.join(outDir, `real-dsl-workbench-running-${width}x${height}.png`);
  await page.screenshot({ path: runningScreenshotPath, fullPage: false });

  await page.locator(".run-status-panel code", { hasText: "RUN-" }).waitFor({ timeout: 20_000 });
  await page.getByText("86%").waitFor({ timeout: 20_000 });

  const resultScreenshotPath = width === 1920
    ? path.join(outDir, "real-dsl-workbench-result-1920x1080.png")
    : path.join(outDir, `real-dsl-workbench-result-${width}x${height}.png`);
  await page.screenshot({ path: resultScreenshotPath, fullPage: false });

  const resultMetrics = {
    runIdText: await page.locator(".run-status-panel code").textContent(),
    statusPassedVisible: await page.locator(".run-state-pill.passed").first().isVisible(),
    artifactsDoneVisible: await page.locator(".status-split-grid .run-state-pill.done").isVisible(),
    completionVisible: await page.getByText("86%").isVisible(),
    evpiSourceVisible: await page.getByText("来源：EVPI-lite").isVisible(),
    noAgentPlanText: (await page.textContent("body")).includes("不会交给 Agent 执行"),
    scroll: await pageScrollMetrics(page)
  };
  assertNoVerticalPageScroll(resultMetrics.scroll, `DSL result ${width}x${height}`);

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
  assertNoVerticalPageScroll(modalMetrics.scroll, `DSL modal ${width}x${height}`);

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
      render: renderScreenshotPath,
      running: runningScreenshotPath,
      result: resultScreenshotPath,
      modal: modalScreenshotPath
    },
    initialMetrics,
    resultMetrics,
    modalMetrics,
    consoleEntries,
    pageErrors,
    responseErrors
  };
}

async function verifyDesignPlanningViewport(width, height) {
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--headless=new", "--no-proxy-server", "--disable-gpu"]
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const consoleEntries = [];
  const pageErrors = [];
  const responseErrors = [];

  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      consoleEntries.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      responseErrors.push({ status: response.status(), url: response.url() });
    }
  });

  await enterDesignPlanning(page);
  const chromeChecks = await assertWorkspaceChrome(page);

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
    chrome: chromeChecks,
    hasTopTabs: await page.locator(".workspace-top-tabs").count(),
    hasDslTab: await page.getByRole("button", { name: "DSL 澄清台", exact: true }).isVisible(),
    hasDesignTab: await page.getByRole("button", { name: "设计规划", exact: true }).isVisible(),
    hasReviewTab: await page.getByRole("button", { name: "审计页面", exact: true }).isVisible(),
    hasPrTab: await page.getByRole("button", { name: "PR 页面", exact: true }).isVisible(),
    hasLeftRail: await page.locator('[data-testid="project-rail"]').count(),
    hasMainContent: await page.locator(".workspace-content").count(),
    designTabSelected: await page.getByRole("button", { name: "设计规划", exact: true }).getAttribute("aria-pressed"),
    hasDesignPlanningWorkbench: await page.locator('[data-testid="design-planning-workbench"]').count(),
    dslStatusConsoleCount: await page.getByRole("heading", { name: "DSL 状态控制台" }).count(),
    hasMilestones: text.includes("实施阶段 / 里程碑"),
    hasTaskBreakdown: text.includes("任务拆解清单"),
    hasExecutionFeedback: text.includes("执行摘要 / 最新进展"),
    hasProgressPanel: text.includes("总体进度"),
    hasRiskPanel: text.includes("风险 / 阻塞项"),
    hasAgentExecutionPanel: await page.getByText("Agent Execution Orchestrator").isVisible(),
    hasAgentContextButton: await page.locator(".agent-action-row button").first().isVisible(),
    shell: await pickMetrics(page, ".workspace-shell"),
    leftRail: await pickMetrics(page, '[data-testid="project-rail"]'),
    topTabs: await pickMetrics(page, ".workspace-top-tabs"),
    mainContent: await pickMetrics(page, ".workspace-content"),
    workbench: await pickMetrics(page, ".design-planning-workbench"),
    rightPanel: await pickMetrics(page, ".planning-right-panel"),
    scroll: await pageScrollMetrics(page)
  };

  await browser.close();

  if (metrics.dslStatusConsoleCount !== 0) {
    throw new Error("Design planning page must not render DSL 状态控制台");
  }
  if (!metrics.hasAgentExecutionPanel || !metrics.hasAgentContextButton) {
    throw new Error("Design planning page must render Agent execution entry controls.");
  }
  if (metrics.scroll.hasVerticalPageScroll) {
    throw new Error(`Design planning page has vertical page scroll at ${width}x${height}`);
  }
  const pageIssues = collectUnexpectedDesignPlanningIssues(consoleEntries, pageErrors, responseErrors);
  if (pageIssues.unexpectedConsoleEntries.length > 0 || pageIssues.pageErrors.length > 0 || pageIssues.unexpectedResponses.length > 0) {
    throw new Error(
      `Design planning page console/page errors at ${width}x${height}: ${JSON.stringify(pageIssues, null, 2)}`
    );
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
    pageErrors,
    responseErrors,
    expectedDesignPlanMisses: pageIssues.expectedDesignPlanMisses
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
