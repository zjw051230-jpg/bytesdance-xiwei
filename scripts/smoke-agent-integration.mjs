import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";
import { getApiBaseUrl, getViteDevArgs, getWebBaseUrl, getWebPort } from "./web-ui-runtime.mjs";

const webUrl = getWebBaseUrl();
const backendUrl = getApiBaseUrl();
const webPort = getWebPort();
const reportingDir = path.resolve("reporting");
const executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";

await fs.mkdir(reportingDir, { recursive: true });

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

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Port ${port} is already in use.`)));
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

async function pageScrollMetrics(page) {
  return page.evaluate(() => ({
    hasVerticalPageScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight ||
      document.body.scrollHeight > window.innerHeight,
    docScrollHeight: document.documentElement.scrollHeight,
    docClientHeight: document.documentElement.clientHeight,
    bodyScrollHeight: document.body.scrollHeight,
    innerHeight: window.innerHeight
  }));
}

async function assertNoPageScroll(page, label) {
  const metrics = await pageScrollMetrics(page);
  if (metrics.hasVerticalPageScroll) {
    throw new Error(`${label} has vertical page scroll: ${JSON.stringify(metrics)}`);
  }
  return metrics;
}

async function main() {
  await assertPortAvailable(8787);
  await assertPortAvailable(webPort);

  const backend = startProcess(process.execPath, ["server/index.js"], {
    PORT: "8787",
    DSL_RUNNER_MODE: "mock",
    SKILL_MODEL_MODE: "mock"
  });
  const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
  const vite = startProcess(process.execPath, [viteBin, ...getViteDevArgs()]);

  try {
    await waitForHttp(`${backendUrl}/api/health`);
    await waitForHttp(new URL("/api/health", `${webUrl}/`).toString());
    await waitForHttp(webUrl);

    const browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const consoleEntries = [];
    const pageErrors = [];
    page.on("console", (msg) => {
      if (["error", "warning"].includes(msg.type())) {
        consoleEntries.push({ type: msg.type(), text: msg.text() });
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(webUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "工作台" }).click();
    await page.getByRole("button", { name: "设计规划" }).click();
    await page.locator('[data-testid="design-planning-workbench"]').waitFor();
    await page.getByText("Agent Execution Orchestrator").waitFor();
    const entryScroll = await assertNoPageScroll(page, "agent design planning entry");
    const designPlanningEntry = path.join(reportingDir, "agent-design-planning-entry.png");
    await page.screenshot({ path: designPlanningEntry, fullPage: false });

    await page.locator(".agent-action-row button").nth(0).click();
    await page.locator('[data-testid="agent-context-preview"]').waitFor();
    const contextText = await page.locator('[data-testid="agent-context-preview"]').textContent();
    if (!contextText.includes("dry-run preview only")) {
      throw new Error("Agent context preview did not include dry-run boundary.");
    }
    const contextScroll = await assertNoPageScroll(page, "agent context preview");
    const contextPreview = path.join(reportingDir, "agent-context-preview.png");
    await page.screenshot({ path: contextPreview, fullPage: false });

    await page.locator(".agent-action-row button").nth(1).click();
    await page.getByText("Analyze RequirementDSL").waitFor();
    await page.getByText("Dry-run plan generated from agent(1) contract; no target repo writes performed.").waitFor();
    const bodyAfterRun = await page.textContent("body");
    if (!bodyAfterRun.includes("Ready for dry-run preview")) {
      throw new Error("Agent readiness did not remain visible after dry-run.");
    }

    await page.locator(".agent-action-row button").nth(3).click();
    await page.locator('[data-testid="review-check-workbench"]').waitFor();
    await page.getByText("src/components/LoginForm.jsx").waitFor();
    const reviewScroll = await assertNoPageScroll(page, "agent review check page");
    const reviewCheck = path.join(reportingDir, "agent-review-check-page.png");
    await page.screenshot({ path: reviewCheck, fullPage: false });

    await page.locator(".review-side button").click();
    await page.locator('[data-testid="pr-workbench"]').waitFor();
    await page.getByText("Improve login failure guidance").waitFor();
    await page.getByText("No API keys or local configs committed").waitFor();
    const prScroll = await assertNoPageScroll(page, "agent PR page");
    const prPage = path.join(reportingDir, "agent-pr-page.png");
    await page.screenshot({ path: prPage, fullPage: false });

    await browser.close();

    if (consoleEntries.length > 0 || pageErrors.length > 0) {
      throw new Error(`Console/page errors: ${JSON.stringify({ consoleEntries, pageErrors })}`);
    }

    const result = {
      status: "passed",
      webUrl,
      backendUrl,
      screenshots: {
        designPlanningEntry,
        contextPreview,
        reviewCheck,
        prPage
      },
      scroll: {
        entry: entryScroll,
        context: contextScroll,
        review: reviewScroll,
        pr: prScroll
      },
      consoleEntries,
      pageErrors,
      dryRunOnly: true,
      realWritePerformed: false
    };
    await fs.writeFile(path.join(reportingDir, "agent-integration-smoke.json"), JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await Promise.all([vite, backend].map(stopProcessTree));
  }
}

await main();
