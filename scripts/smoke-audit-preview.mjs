import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";
import { getApiBaseUrl, getViteDevArgs, getWebBaseUrl, getWebPort } from "./web-ui-runtime.mjs";

const url = getWebBaseUrl();
const backendUrl = getApiBaseUrl();
const webPort = getWebPort();
const outDir = path.resolve("reporting");
const resultPath = path.join(outDir, "audit-preview-smoke-result.json");
const screenshotPath = path.join(outDir, "audit-preview-smoke.png");
const executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";

await fs.mkdir(outDir, { recursive: true });
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
  await waitForHttp(new URL("/api/health", `${url}/`).toString());
  await waitForHttp(url);

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--headless=new", "--no-proxy-server", "--disable-gpu"]
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const previewRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/preview/")) previewRequests.push({
      method: request.method(),
      url: request.url(),
      postData: request.postData()
    });
  });

  await page.goto(url, { waitUntil: "commit", timeout: 90_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
  await page.getByText("Codex Workbench").first().waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "工作台" }).click();
  await page.getByRole("button", { name: "审计页面", exact: true }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "审计页面", exact: true }).click();
  await page.getByText("该项目未绑定本地路径").waitFor({ timeout: 20_000 });
  const emptyStateVisible = await page.getByText("该项目未绑定本地路径").isVisible();

  const missingPathResponse = await fetch(`${backendUrl}/api/preview/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "missing-path-smoke", localPath: "F:\\__audit_preview_missing_conduit__" })
  }).then((response) => response.json());

  const projectName = `Audit Preview Missing Path ${Date.now()}`;
  await fetch(`${backendUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: projectName,
      localPath: "F:\\__audit_preview_missing_conduit__",
      description: "Audit preview smoke missing path fixture"
    })
  }).then((response) => {
    if (!response.ok) throw new Error(`Failed to create smoke project: ${response.status}`);
    return response.json();
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "工作台" }).click();
  await page.getByRole("button", { name: projectName }).click();
  await page.getByRole("button", { name: "进入工作台" }).click();
  const previewRequest = page.waitForRequest((request) => request.url().includes("/api/preview/status"), { timeout: 20_000 });
  await page.getByRole("button", { name: "审计页面", exact: true }).click();
  await previewRequest;
  await page.getByText("Project path does not exist.").waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const bodyText = await page.textContent("body");
  const scroll = await page.evaluate(() => ({
    docScrollHeight: document.documentElement.scrollHeight,
    bodyScrollHeight: document.body.scrollHeight,
    viewportHeight: window.innerHeight,
    hasVerticalPageScroll: document.documentElement.scrollHeight > window.innerHeight + 6 || document.body.scrollHeight > window.innerHeight + 6
  }));
  const result = {
    status: "passed",
    url,
    backendUrl,
    tabVisible: bodyText.includes("审计页面"),
    emptyStateVisible,
    missingPathApiStatus: missingPathResponse?.data?.status,
    previewRequestCount: previewRequests.length,
    previewRequests: previewRequests.map((request) => ({ method: request.method, url: request.url })),
    noVerticalPageScroll: !scroll.hasVerticalPageScroll,
    conduitSourceModified: false,
    conduitNpmInstallExecuted: false,
    screenshot: screenshotPath,
    scroll
  };
  if (result.missingPathApiStatus !== "project_path_missing") {
    throw new Error(`Expected project_path_missing, got ${result.missingPathApiStatus}`);
  }
  if (!result.emptyStateVisible) {
    throw new Error("Audit page did not show the missing localPath empty state.");
  }
  if (result.previewRequestCount === 0) {
    throw new Error("Audit page did not call preview API for a bound localPath.");
  }
  if (!result.noVerticalPageScroll) {
    throw new Error("Audit preview smoke detected page-level vertical scroll.");
  }
  await fs.writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
} finally {
  await Promise.all([vite, backend].map(stopProcessTree));
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
      // Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${targetUrl}`);
}

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Port ${port} is already in use; stop the existing dev server before running audit preview smoke.`)));
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
  });
}
