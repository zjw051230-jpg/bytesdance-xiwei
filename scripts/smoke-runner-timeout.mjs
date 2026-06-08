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
    server.once("error", () => reject(new Error(`Port ${port} is already in use; stop the existing dev server before running smoke-runner-timeout.`)));
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

async function enterWorkbench(page) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator(".mode-tabs button").nth(1).click();
  await page.locator(".enter-workbench-button").click();
  await page.locator('[data-testid="dsl-workbench"]').waitFor();
}

await cleanupKnownDevProcesses();
await assertPortAvailable(8787);
await assertPortAvailable(webPort);

const backend = startProcess(process.execPath, ["server/index.js"], {
  PORT: "8787",
  DSL_RUNNER_MODE: "mock",
  DSL_MOCK_DELAY_MS: "5000"
});
const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
const vite = startProcess(process.execPath, [viteBin, ...getViteDevArgs()]);

const result = {
  attempted: true,
  status: "unknown",
  url,
  runId: "",
  runnerStatus: "",
  timeoutErrorVisible: false,
  retryVisible: false,
  partialArtifactsVisible: false,
  partialArtifactsDialogVisible: false,
  pageVerticalScroll: null,
  screenshots: {
    running: path.join(outDir, "web-ui-runner-running.png"),
    longRunning: path.join(outDir, "web-ui-runner-long-running.png"),
    timeout: path.join(outDir, "web-ui-runner-timeout.png"),
    partialArtifacts: path.join(outDir, "web-ui-runner-partial-artifacts.png")
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
  await page.addInitScript(() => {
    window.__DSL_TEST_TIMEOUT_MS__ = 3000;
    window.__DSL_LONG_RUN_FIRST_MS__ = 300;
    window.__DSL_LONG_RUN_SECOND_MS__ = 1200;
  });
  page.on("pageerror", (error) => result.pageErrors.push(error.message));
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      result.consoleEntries.push({ type: msg.type(), text: msg.text() });
    }
  });

  await enterWorkbench(page);
  await page.locator(".chat-input-row input").fill("Trigger a mock long-running runner timeout.");
  await page.locator(".chat-input-row button").click();
  await page.locator(".run-state-pill.running").first().waitFor({ timeout: 15_000 });
  await page.locator(".run-status-panel code", { hasText: "RUN-" }).waitFor({ timeout: 15_000 });
  result.runId = ((await page.locator(".run-status-panel code").textContent()) || "").trim();
  await page.screenshot({ path: result.screenshots.running, fullPage: false });

  await page.locator(".run-long-message").waitFor({ timeout: 8_000 });
  await page.screenshot({ path: result.screenshots.longRunning, fullPage: false });

  await page.locator(".run-state-pill.timeout").first().waitFor({ timeout: 12_000 });
  result.runnerStatus = ((await page.locator(".run-state-pill.timeout").first().textContent()) || "").trim();
  result.timeoutErrorVisible = await page.getByText(/runner_timeout/).first().isVisible();
  result.retryVisible = await page.getByRole("button", { name: /重试|閲嶈瘯/ }).isVisible();
  result.partialArtifactsVisible = await page.getByRole("button", { name: /查看错误详情|partial artifacts/ }).isVisible();
  result.pageVerticalScroll = (await pageScrollMetrics(page)).hasVerticalPageScroll;
  await page.screenshot({ path: result.screenshots.timeout, fullPage: false });

  await page.getByRole("button", { name: /查看错误详情|partial artifacts/ }).click();
  await page.getByRole("dialog", { name: "partial artifacts" }).waitFor({ timeout: 5_000 });
  result.partialArtifactsDialogVisible = true;
  await page.screenshot({ path: result.screenshots.partialArtifacts, fullPage: false });

  result.status = (
    result.runId.startsWith("RUN-") &&
    result.runnerStatus === "timeout" &&
    result.timeoutErrorVisible &&
    result.retryVisible &&
    result.partialArtifactsVisible &&
    result.partialArtifactsDialogVisible &&
    result.pageVerticalScroll === false &&
    result.pageErrors.length === 0
  ) ? "passed" : "failed";

  await browser.close();
} catch (error) {
  result.status = "failed";
  result.error = String(error.message || error);
} finally {
  await fs.writeFile(path.join(outDir, "web-ui-runner-timeout-smoke-result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  await Promise.all([vite, backend].map(stopProcessTree));
  await cleanupKnownDevProcesses();
  if (result.status !== "passed") process.exitCode = 1;
}
