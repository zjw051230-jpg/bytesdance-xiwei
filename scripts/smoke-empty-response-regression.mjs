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
    server.once("error", () => reject(new Error(`Port ${port} is already in use; stop the existing dev server before running smoke-empty-response-regression.`)));
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
  });
}

function timeout(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
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

await assertPortAvailable(8787);
await assertPortAvailable(webPort);

const backend = startProcess(process.execPath, ["server/index.js"], {
  PORT: "8787",
  DSL_RUNNER_MODE: "mock",
  FORCE_DSL_ROUTE_EXCEPTION: "1"
});
const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
const vite = startProcess(process.execPath, [viteBin, ...getViteDevArgs()]);

const result = {
  attempted: true,
  status: "unknown",
  url,
  apiStatus: 0,
  apiBodyLength: 0,
  apiErrorCode: "",
  runId: "",
  outputDir: "",
  errorCode: "",
  errorMessage: "",
  emptyResponseAppeared: true,
  systemReplyShown: false,
  rightPanelUpdated: false,
  serverErrorFileWritten: false,
  pageVerticalScroll: null,
  screenshots: {
    fixed: path.join(outDir, "web-ui-empty-response-fixed.png")
  },
  expectedNetworkConsoleEntries: [],
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
      const entry = { type: msg.type(), text: msg.text() };
      if (/Failed to load resource/i.test(entry.text) && /500/.test(entry.text)) {
        result.expectedNetworkConsoleEntries.push(entry);
      } else {
        result.consoleEntries.push(entry);
      }
    }
  });

  let resolveApiResponse;
  const apiResponsePromise = new Promise((resolve) => {
    resolveApiResponse = resolve;
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/api/dsl/runs") || response.request().method() !== "POST") return;
    const text = await response.text().catch((error) => `<<read failed: ${String(error.message || error)}>>`);
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    resolveApiResponse({
      status: response.status(),
      bodyLength: text.length,
      errorCode: payload?.error?.code || "",
      text
    });
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator(".mode-tabs button").nth(1).click();
  await page.locator(".enter-workbench-button").click();
  await page.locator('[data-testid="dsl-workbench"]').waitFor();

  await page.locator(".chat-input-row input").fill("Trigger backend exception regression from UI.");
  await page.locator(".chat-input-row button").click();
  await page.locator(".run-state-pill.failed").first().waitFor({ timeout: 60_000 });

  const apiResponse = await Promise.race([
    apiResponsePromise,
    timeout(10_000, { status: 0, bodyLength: 0, errorCode: "", text: "" })
  ]);
  result.apiStatus = apiResponse.status;
  result.apiBodyLength = apiResponse.bodyLength;
  result.apiErrorCode = apiResponse.errorCode;

  result.runId = ((await page.locator(".run-status-panel code").textContent()) || "").trim();
  result.outputDir = ((await page.locator(".run-status-panel dd").first().textContent()) || "").trim();
  const errorText = ((await page.locator(".run-error-text").textContent()) || "").trim();
  const [code, ...messageParts] = errorText.split(":");
  result.errorCode = code.trim();
  result.errorMessage = messageParts.join(":").trim();
  const latestSystemReply = await page.evaluate(() => {
    const messages = [...document.querySelectorAll(".chat-message.system")];
    return messages.at(-1)?.textContent || "";
  });
  result.systemReplyShown = /DSL|backend_exception|failed|失败/.test(latestSystemReply);
  result.rightPanelUpdated = result.errorCode === "backend_exception" && result.runId.startsWith("RUN-");

  const bodyText = await page.textContent("body");
  result.emptyResponseAppeared = /empty_response|Empty response from DSL API/.test(bodyText || "");
  result.pageVerticalScroll = (await pageScrollMetrics(page)).hasVerticalPageScroll;

  if (result.runId.startsWith("RUN-")) {
    const serverErrorPath = path.resolve("runs", result.runId, "server_error.json");
    result.serverErrorFileWritten = await fs.access(serverErrorPath).then(() => true, () => false);
  }

  await page.screenshot({ path: result.screenshots.fixed, fullPage: false });

  result.status = (
    result.apiStatus === 500 &&
    result.apiBodyLength > 0 &&
    result.apiErrorCode === "backend_exception" &&
    !result.emptyResponseAppeared &&
    result.systemReplyShown &&
    result.rightPanelUpdated &&
    result.serverErrorFileWritten &&
    result.consoleEntries.length === 0 &&
    result.pageErrors.length === 0
  ) ? "passed" : "failed";

  await browser.close();
} catch (error) {
  result.status = "failed";
  result.error = String(error.message || error);
} finally {
  await fs.writeFile(
    path.join(outDir, "web-ui-empty-response-smoke-result.json"),
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
