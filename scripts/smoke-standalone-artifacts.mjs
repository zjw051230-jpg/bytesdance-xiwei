import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";
import { getApiBaseUrl, getPortInUsePattern, getWebBaseUrl, getWebPort } from "./web-ui-runtime.mjs";

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
  processLogs: [],
  enterDebug: null,
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
  const label = args.join(" ").includes("server/index.js") ? "backend" : "vite";
  child.stdout.on("data", (chunk) => appendProcessLog(label, "stdout", chunk));
  child.stderr.on("data", (chunk) => appendProcessLog(label, "stderr", chunk));
  child.on("exit", (code, signal) => appendProcessLog(label, "exit", `code=${code ?? ""} signal=${signal ?? ""}`));
  return child;
}

function runBuild() {
  const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [viteBin, "build"], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => appendProcessLog("build", "stdout", chunk));
  child.stderr.on("data", (chunk) => appendProcessLog("build", "stderr", chunk));
  return new Promise((resolve, reject) => {
    child.on("exit", (code, signal) => {
      appendProcessLog("build", "exit", `code=${code ?? ""} signal=${signal ?? ""}`);
      if (code === 0) resolve();
      else reject(new Error(`vite build failed with code ${code ?? signal}`));
    });
    child.on("error", reject);
  });
}

function startStaticFrontendServer() {
  const distRoot = path.resolve("dist");
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, url);
      if (requestUrl.pathname.startsWith("/api/")) {
        await proxyApiRequest(request, response, requestUrl);
        return;
      }
      await serveStaticFile(response, distRoot, requestUrl.pathname);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(webPort, "127.0.0.1", () => {
      appendProcessLog("frontend", "stdout", `static frontend listening on ${url}`);
      resolve(server);
    });
  });
}

async function proxyApiRequest(request, response, requestUrl) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = { ...request.headers };
  delete headers.host;
  const upstream = await fetch(`${backendUrl}${requestUrl.pathname}${requestUrl.search}`, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method || "GET") ? undefined : body
  });
  const upstreamBody = Buffer.from(await upstream.arrayBuffer());
  const responseHeaders = Object.fromEntries(upstream.headers.entries());
  response.writeHead(upstream.status, responseHeaders);
  response.end(upstreamBody);
}

async function serveStaticFile(response, distRoot, pathname) {
  const decoded = decodeURIComponent(pathname);
  const safePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  let filePath = path.resolve(distRoot, safePath);
  if (!filePath.startsWith(distRoot)) filePath = path.join(distRoot, "index.html");
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.join(distRoot, "index.html");
  }
  const content = await fs.readFile(filePath);
  response.writeHead(200, { "content-type": mimeType(filePath) });
  response.end(content);
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function appendProcessLog(label, stream, chunk) {
  const text = String(chunk || "").trim();
  if (!text) return;
  result.processLogs.push({ label, stream, text: text.slice(0, 1000) });
  if (result.processLogs.length > 30) result.processLogs.shift();
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

async function enterDslWorkbench(page) {
  await gotoWithRetry(page, url);
  await page.waitForSelector("body", { state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => {
    return Boolean(document.querySelector("#root > *"));
  }, null, { timeout: 45_000 }).catch(() => {});
  const hasDevMainScript = await page.evaluate(() =>
    [...document.scripts].some((script) => script.src.endsWith("/src/main.jsx"))
  );
  if (hasDevMainScript && await page.locator("#root > *").count() === 0) {
    await importMainWithRetry(page);
  }
  try {
    await page.waitForFunction(() => {
      return Boolean(
        document.querySelector('[data-testid="dsl-workbench"]') ||
        document.querySelector(".mode-tabs .mode-tab") ||
        document.querySelector(".enter-workbench-button")
      );
    }, null, { timeout: 90_000 });
  } catch (error) {
    result.enterDebug = await page.evaluate(() => ({
      href: location.href,
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 1000) || "",
      bodyHtml: document.body?.innerHTML?.slice(0, 1000) || "",
      rootChildren: document.querySelector("#root")?.childElementCount || 0,
      scriptCount: document.scripts.length,
      modeTabs: document.querySelectorAll(".mode-tab").length,
      enterButtons: document.querySelectorAll(".enter-workbench-button").length,
      dslWorkbenches: document.querySelectorAll('[data-testid="dsl-workbench"]').length
    }));
    throw error;
  }

  if (await page.locator('[data-testid="dsl-workbench"]').count()) return;

  const workbenchTab = page.locator(".mode-tabs .mode-tab").nth(1);
  if (await workbenchTab.count()) await workbenchTab.click();

  await page.waitForFunction(() => {
    return Boolean(
      document.querySelector('[data-testid="dsl-workbench"]') ||
      document.querySelector(".enter-workbench-button")
    );
  }, null, { timeout: 90_000 });

  if (await page.locator('[data-testid="dsl-workbench"]').count()) return;

  await page.locator(".enter-workbench-button").first().click();
  await page.locator('[data-testid="dsl-workbench"]').waitFor({ timeout: 30_000 });
}

async function gotoWithRetry(page, targetUrl, attempts = 6) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await waitForHttp(targetUrl, 10_000);
      await page.goto(targetUrl, { waitUntil: "commit", timeout: 60_000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1_500 + attempt * 1_500);
    }
  }
  throw lastError;
}

async function importMainWithRetry(page, attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await page.evaluate(() => import("/src/main.jsx"));
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(2_000 + attempt * 2_000);
    }
  }
  throw lastError;
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
await runBuild();

const backend = startProcess(process.execPath, ["server/index.js"], {
  PORT: "8787",
  DSL_RUNNER_MODE: "real",
  SKILL_MODEL_MODE: "real"
});
let frontendServer = null;
let browser = null;

try {
  await waitForHttp(`${backendUrl}/api/health`);
  frontendServer = await startStaticFrontendServer();
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

  await enterDslWorkbench(page);
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
  const fatalConsoleErrors = result.consoleErrors.filter((entry) => !/status of 404/i.test(entry));
  if (fatalConsoleErrors.length || result.pageErrors.length) {
    throw new Error(`Console/page errors: ${JSON.stringify({ consoleErrors: fatalConsoleErrors, pageErrors: result.pageErrors })}`);
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
  if (frontendServer) {
    await new Promise((resolve) => frontendServer.close(resolve));
    appendProcessLog("frontend", "exit", "closed");
  }
  await stopProcessTree(backend);
}
