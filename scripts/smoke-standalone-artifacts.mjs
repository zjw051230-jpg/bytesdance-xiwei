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
const requirementText = [
  "PM request: improve login failure guidance.",
  "Show different copy for account not found, wrong password, locked account, and network errors.",
  "Do not enter agent handoff or code execution yet; generate clarification and standalone DSL artifacts only."
].join(" ");

await fs.mkdir(outDir, { recursive: true });

const result = {
  status: "unknown",
  webUrl: url,
  backendUrl,
  quickClarificationStatus: "",
  artifactStatus: "",
  runId: "",
  outputDirVisible: false,
  sourceProviderVisible: false,
  realModelVisible: false,
  mockUsed: false,
  retryExercised: false,
  retryRunId: "",
  oldRunnerMissingVisible: false,
  pageVerticalScroll: null,
  consoleErrors: [],
  pageErrors: [],
  screenshots: {
    done: path.join(outDir, "standalone-artifacts-done.png"),
    retry: path.join(outDir, "standalone-artifacts-retry.png")
  }
};

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

async function bodyText(page) {
  return page.locator("body").innerText({ timeout: 5_000 });
}

async function waitForTerminalArtifactState(page, expectedRunId = "", timeoutMs = 240_000) {
  await page.waitForFunction((runId) => {
    const text = document.body?.innerText || "";
    if (/pm_dsl_runner|runner_missing/.test(text)) return true;
    const currentRunId = document.querySelector(".run-status-panel code")?.textContent || "";
    if (runId && currentRunId !== runId) return false;
    const split = [...document.querySelectorAll(".status-split-grid > div")].map((node) => node.innerText);
    const artifactLine = split.find((textLine) => /DSL artifacts/.test(textLine)) || "";
    return /\bdone\b|\bfailed\b|\btimeout\b|\bcancelled\b/.test(artifactLine);
  }, expectedRunId, { timeout: timeoutMs });
}

async function readStatus(page) {
  return page.evaluate(() => {
    const panels = [...document.querySelectorAll(".status-split-grid > div")].map((node) => node.innerText);
    const quick = panels.find((text) => text.includes("done") || text.includes("understanding") || text.includes("failed")) || "";
    const artifacts = panels.find((text) => text.includes("DSL artifacts")) || "";
    const runText = document.querySelector(".run-status-panel code")?.textContent || "";
    const text = document.body?.innerText || "";
    return { quick, artifacts, runText, text };
  });
}

async function clickRetryIfAvailable(page) {
  const buttons = await page.locator(".run-action-row button").all();
  for (const button of buttons) {
    const text = await button.innerText();
    if (text.includes("retry") || text.includes("重试") || text.includes("閲嶈瘯")) {
      await button.click();
      return true;
    }
  }
  return false;
}

async function clickCancelIfRunning(page) {
  const buttons = await page.locator(".run-action-row button").all();
  for (const button of buttons) {
    const text = await button.innerText();
    if (text.includes("cancel") || text.includes("取消") || text.includes("鍙栨秷")) {
      await button.click();
      return true;
    }
  }
  return false;
}

async function waitAndClickCancelIfRunning(page, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await clickCancelIfRunning(page)) return true;
    const status = await readStatus(page).catch(() => ({ artifacts: "" }));
    if (/\bdone\b|\bfailed\b|\btimeout\b|\bcancelled\b/.test(status.artifacts)) return false;
    await page.waitForTimeout(250);
  }
  return false;
}

async function waitAndClickRetryIfAvailable(page, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await clickRetryIfAvailable(page)) return true;
    const status = await readStatus(page).catch(() => ({ artifacts: "" }));
    if (/\bdone\b/.test(status.artifacts)) return false;
    await page.waitForTimeout(250);
  }
  return false;
}

async function waitForArtifactsRunningOrTerminal(page, timeoutMs = 30_000) {
  await page.waitForFunction(() => {
    const split = [...document.querySelectorAll(".status-split-grid > div")].map((node) => node.innerText);
    const artifactLine = split.find((textLine) => /DSL artifacts/.test(textLine)) || "";
    return /\brunning\b|\bdone\b|\bfailed\b|\btimeout\b|\bcancelled\b/.test(artifactLine);
  }, null, { timeout: timeoutMs });
  return readStatus(page);
}

await cleanupKnownDevProcesses();
await assertPortAvailable(8787);
await assertPortAvailable(webPort);

const backend = startProcess(process.execPath, ["server/index.js"], {
  PORT: "8787",
  DSL_RUNNER_MODE: "real",
  SKILL_MODEL_MODE: "real"
});
const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
const vite = startProcess(process.execPath, [viteBin, ...getViteDevArgs()]);
let browser = null;

try {
  await waitForHttp(`${backendUrl}/api/health`);
  await waitForHttp(new URL("/api/health", `${url}/`).toString());
  await waitForHttp(url);

  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--headless=new", "--no-proxy-server", "--disable-gpu"]
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") result.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => result.pageErrors.push(error.message));

  await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
  await page.locator(".mode-tab").nth(1).click();
  await page.locator(".enter-workbench-button").click();
  await page.locator('[data-testid="dsl-workbench"]').waitFor();
  await page.locator(".chat-input-row input").fill(requirementText);
  await page.locator(".chat-input-row button").click();

  await page.waitForFunction(() => /Real model/.test(document.body?.innerText || ""), null, { timeout: 120_000 });
  await page.waitForFunction(() => /doubao_ark/.test(document.body?.innerText || ""), null, { timeout: 5_000 });
  result.realModelVisible = true;
  result.sourceProviderVisible = true;
  await waitForArtifactsRunningOrTerminal(page).catch(() => {});
  await waitForTerminalArtifactState(page);
  let status = await readStatus(page);

  if (/\bfailed\b|\btimeout\b|\bcancelled\b/.test(status.artifacts) && await waitAndClickRetryIfAvailable(page)) {
    const originalRunId = status.runText;
    result.retryExercised = true;
    await page.waitForFunction((oldRunId) => {
      const currentRunId = document.querySelector(".run-status-panel code")?.textContent || "";
      return /RUN-/.test(currentRunId) && currentRunId !== oldRunId;
    }, originalRunId, { timeout: 20_000 });
    result.retryRunId = await page.locator(".run-status-panel code").innerText();
    await waitForTerminalArtifactState(page, result.retryRunId);
    status = await readStatus(page);
  }

  result.oldRunnerMissingVisible = /pm_dsl_runner|runner_missing/.test(status.text);
  if (result.oldRunnerMissingVisible) {
    throw new Error("Legacy runner_missing text is visible after standalone artifact run.");
  }
  if (/\brunning\b/.test(status.artifacts)) {
    await waitForTerminalArtifactState(page, status.runText, 240_000);
    status = await readStatus(page);
  }
  result.quickClarificationStatus = status.quick;
  result.artifactStatus = status.artifacts;
  result.runId = status.runText;
  const text = status.text;
  result.outputDirVisible = /runs\\RUN-|runs\/RUN-/.test(text);
  result.mockUsed = /Mock model|mockUsed=true/i.test(text);
  result.pageVerticalScroll = (await pageScrollMetrics(page)).hasVerticalPageScroll;

  if (!/\bdone\b/.test(result.artifactStatus)) {
    throw new Error(`Standalone artifacts did not finish as done. Artifact status: ${result.artifactStatus}`);
  }
  if (!/\bdone\b/.test(result.quickClarificationStatus)) {
    throw new Error(`Quick clarification did not show done. Quick status: ${result.quickClarificationStatus}`);
  }
  if (!result.outputDirVisible) {
    throw new Error("Output directory runs\\RUN-* is not visible.");
  }
  if (result.mockUsed) {
    throw new Error("Mock model text is visible in standalone artifacts smoke.");
  }
  if (result.pageVerticalScroll) {
    throw new Error("Page has vertical scroll.");
  }
  if (result.consoleErrors.length || result.pageErrors.length) {
    throw new Error(`Console/page errors: ${JSON.stringify({ consoleErrors: result.consoleErrors, pageErrors: result.pageErrors })}`);
  }

  await page.screenshot({ path: result.screenshots.retry, fullPage: false });
  await page.screenshot({ path: result.screenshots.done, fullPage: false });
  result.status = "passed";
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.status = "failed";
  result.error = String(error?.message || error);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await fs.writeFile(path.join(outDir, "standalone-artifacts-smoke.json"), JSON.stringify(result, null, 2), "utf8");
  await Promise.all([vite, backend].map(stopProcessTree));
}
