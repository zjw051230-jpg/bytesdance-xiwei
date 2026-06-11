import { execFile as defaultExecFile, spawn as defaultSpawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const DEFAULT_PREVIEW_PORT = 3000;
const AUDIT_PREVIEW_PORT_START = 3100;
const AUDIT_PREVIEW_PORT_END = 3199;
const DEFAULT_PREVIEW_ROUTE = "#/login";
const previewProcesses = new Map();

export async function getPreviewStatus(requestBody = {}, config = {}, deps = {}) {
  const prepared = await preparePreviewContext(requestBody, config, deps);
  if (!prepared.ok) return prepared.payload;

  const { context } = prepared;
  cleanupDeadRecords();
  const record = getActiveRecord(context.cacheKey);
  const portRecord = findActiveRecordByPort(context.port);
  const probe = await probePreviewPort(context.port, config, deps);

  if (record) {
    if (probe.available) {
      return previewPayload(context, {
        status: "running",
        available: true,
        owner: "workbench",
        runningProjectRoot: record.localPath,
        message: "Workbench preview process is serving this project."
      });
    }
    if (probe.occupied) {
      return previewPayload(context, {
        status: "port_in_use",
        available: false,
        owner: "workbench",
        runningProjectRoot: record.localPath,
        canRestart: true,
        actionRequired: "retry",
        message: `Port ${context.port} is occupied, but the Workbench preview did not return HTML.`
      });
    }
    return previewPayload(context, {
      status: "starting",
      available: false,
      owner: "workbench",
      runningProjectRoot: record.localPath,
      message: "Workbench preview process is still starting."
    });
  }

  if (portRecord) {
    return previewPayload(context, {
      status: "workbench_project_mismatch",
      available: false,
      owner: "workbench",
      runningProjectRoot: portRecord.localPath,
      canRestart: true,
      actionRequired: "none",
      message: `Workbench is running a different project on port ${context.port}. Starting preview will switch to the requested path.`
    });
  }

  if (probe.available) {
    const trustedExternal = await resolveTrustedExternalPreview(context, config, deps);
    if (trustedExternal) {
      return previewPayload(context, {
        status: "external_verified",
        available: true,
        owner: "external_verified",
        runningProjectRoot: context.projectRoot,
        message: `External preview process ${trustedExternal.pid ? `PID ${trustedExternal.pid} ` : ""}matches the requested project path; Workbench will reuse it without owning its lifecycle.`
      });
    }
  }

  if (probe.available || probe.occupied) {
    return previewPayload(context, {
      status: "port_in_use_external",
      available: false,
      owner: "external",
      actionRequired: "close_external_port",
      message: `Port ${context.port} is already used by an external process; Workbench cannot prove it belongs to the requested path.`
    });
  }

  return previewPayload(context, {
    status: "not_running",
    available: false,
    owner: "none",
    message: "Conduit preview is not running."
  });
}

export async function startPreview(requestBody = {}, config = {}, deps = {}) {
  const prepared = await preparePreviewContext(requestBody, config, deps);
  if (!prepared.ok) return prepared.payload;

  let { context } = prepared;
  cleanupDeadRecords();
  const existingRecord = getActiveRecord(context.cacheKey);
  if (existingRecord) {
    return waitForPreviewAvailability(context, existingRecord, config, deps);
  }

  const portRecord = findActiveRecordByPort(context.port);
  if (portRecord) {
    stopRecord(portRecord);
    const released = await waitForPortToClose(context.port, config, deps);
    if (!released) {
      return previewPayload(context, {
        status: "port_in_use",
        available: false,
        owner: "workbench",
        runningProjectRoot: portRecord.localPath,
        canRestart: true,
        actionRequired: "retry",
        message: `Workbench stopped the previous preview, but port ${context.port} is still occupied.`
      });
    }
  }

  const currentStatus = await getPreviewStatus(requestBody, config, deps);
  if (currentStatus.data.available) {
    return currentStatus;
  }
  if (["port_in_use", "port_in_use_external"].includes(currentStatus.data.status)) {
    if (!requestBody?.allowPortFallback) return currentStatus;
    const fallbackContext = await contextWithFallbackPort(context, config, deps);
    if (!fallbackContext) return currentStatus;
    context = fallbackContext;
  }

  await ensurePreviewDependencyLinks(context);
  const viteBin = await findViteBinary(context);
  if (!viteBin) {
    return previewPayload(context, {
      status: "dependency_missing",
      available: false,
      owner: "none",
      actionRequired: "retry",
      message: "Vite binary was not found. Run npm install for the Conduit project before starting preview."
    });
  }

  const spawnImpl = deps.spawnImpl || defaultSpawn;
  const child = spawnImpl(
    process.execPath,
    [viteBin, "--host", "127.0.0.1", "--port", String(context.port), "--strictPort"],
    {
      cwd: context.frontendRoot,
      env: { ...process.env, BROWSER: "none" },
      shell: false,
      windowsHide: true
    }
  );
  const record = createProcessRecord(context, child);
  previewProcesses.set(context.cacheKey, record);

  return waitForPreviewAvailability(context, record, config, deps);
}

export async function stopPreview(requestBody = {}, config = {}, deps = {}) {
  const prepared = await preparePreviewContext(requestBody, config, deps);
  if (!prepared.ok) return prepared.payload;

  const { context } = prepared;
  const record = getActiveRecord(context.cacheKey);
  if (!record || !isProcessAlive(record)) {
    previewProcesses.delete(context.cacheKey);
    return getPreviewStatus(requestBody, config, deps);
  }

  stopRecord(record);
  return previewPayload(context, {
    status: "stopped",
    available: false,
    owner: "none",
    message: "Workbench preview process stopped."
  });
}

export function resetPreviewLauncherForTests() {
  for (const record of previewProcesses.values()) {
    if (isProcessAlive(record)) {
      try {
        record.child.kill();
      } catch {
        // Ignore cleanup errors in tests.
      }
    }
  }
  previewProcesses.clear();
}

async function waitForPreviewAvailability(context, record, config = {}, deps = {}) {
  const timeoutMs = Number(config.previewStartupTimeoutMs || 12_000);
  const pollIntervalMs = Number(config.previewPollIntervalMs || 250);
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const probe = await probePreviewPort(context.port, config, deps);
    if (probe.available) {
      return previewPayload(context, {
        status: "running",
        available: true,
        owner: "workbench",
        runningProjectRoot: record.localPath,
        message: "Workbench started the Conduit preview."
      });
    }
    if (probe.occupied) {
      return previewPayload(context, {
        status: "port_in_use",
        available: false,
        owner: "workbench",
        runningProjectRoot: record.localPath,
        canRestart: true,
        actionRequired: "retry",
        message: `Port ${context.port} is already in use but did not return an HTML preview.`
      });
    }
    if (!isProcessAlive(record)) {
      return previewPayload(context, {
        status: "start_failed",
        available: false,
        owner: "none",
        actionRequired: "retry",
        message: buildProcessFailureMessage(record)
      });
    }
    await sleep(pollIntervalMs);
  }

  return previewPayload(context, {
    status: "start_timeout",
    available: false,
    owner: "workbench",
    runningProjectRoot: record.localPath,
    canRestart: true,
    actionRequired: "retry",
    message: "Workbench started the preview process, but the page was not reachable before timeout."
  });
}

async function waitForPortToClose(port, config = {}, deps = {}) {
  const timeoutMs = Number(config.previewRestartReleaseTimeoutMs || 2_000);
  const pollIntervalMs = Number(config.previewPollIntervalMs || 100);
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const probe = await probePreviewPort(port, config, deps);
    if (!probe.occupied && !probe.available) return true;
    await sleep(pollIntervalMs);
  }
  return false;
}

async function preparePreviewContext(requestBody, config = {}, deps = {}) {
  const projectId = String(requestBody?.projectId || "active-project").trim() || "active-project";
  const localPath = String(requestBody?.localPath || "").trim();
  const previewMode = requestBody?.previewMode === "audit_workspace" ? "audit_workspace" : "project";
  if (!localPath) {
    return invalidPreviewPayload("project_path_missing", "localPath is required.", {
      projectId,
      projectRoot: ""
    });
  }
  if (!path.isAbsolute(localPath)) {
    return invalidPreviewPayload("project_path_not_absolute", "localPath must be an absolute path.", {
      projectId,
      projectRoot: localPath
    });
  }

  const projectRoot = path.resolve(localPath);
  let stats;
  try {
    stats = await fs.stat(projectRoot);
  } catch {
    return invalidPreviewPayload("project_path_missing", "Project path does not exist.", {
      projectId,
      projectRoot
    });
  }
  if (!stats.isDirectory()) {
    return invalidPreviewPayload("project_path_missing", "Project path is not a directory.", {
      projectId,
      projectRoot
    });
  }

  const frontendRoot = path.join(projectRoot, "frontend");
  const frontendPackagePath = path.join(frontendRoot, "package.json");
  const viteConfigPath = path.join(frontendRoot, "vite.config.js");
  const supported = await exists(frontendPackagePath) || await exists(viteConfigPath);
  if (!supported) {
    return invalidPreviewPayload("preview_not_supported", "Conduit frontend entry was not found.", {
      projectId,
      projectRoot
    });
  }

  const port = previewMode === "audit_workspace"
    ? await resolveAuditPreviewPort(projectRoot, config, deps)
    : await readPreviewPort(viteConfigPath);
  const previewUrl = `http://127.0.0.1:${port}/${DEFAULT_PREVIEW_ROUTE}`;
  const dependencyRoot = await resolveDependencyRoot(requestBody, projectRoot);
  const context = {
    projectId,
    projectRoot,
    dependencyRoot,
    frontendRoot,
    frontendPackagePath,
    viteConfigPath,
    previewMode,
    port,
    previewUrl,
    cacheKey: `${projectId}:${projectRoot.toLowerCase()}`
  };
  return { ok: true, context };
}

function invalidPreviewPayload(status, message, details = {}) {
  return {
    ok: false,
    payload: {
      ok: true,
      data: {
        status,
        available: false,
        previewUrl: "",
        port: null,
        projectRoot: details.projectRoot || "",
        requestedProjectRoot: details.projectRoot || "",
        runningProjectRoot: "",
        owner: "none",
        canRestart: false,
        actionRequired: status === "project_path_missing" ? "retry" : "none",
        message
      },
      error: null
    }
  };
}

function previewPayload(context, overrides) {
  return {
    ok: true,
    data: {
      status: overrides.status,
      available: Boolean(overrides.available),
      previewUrl: context.previewUrl,
      port: context.port,
      projectRoot: context.projectRoot,
      requestedProjectRoot: context.projectRoot,
      runningProjectRoot: overrides.runningProjectRoot || "",
      owner: overrides.owner || "none",
      canRestart: Boolean(overrides.canRestart),
      actionRequired: overrides.actionRequired || "none",
      message: overrides.message || ""
    },
    error: null
  };
}

async function readPreviewPort(viteConfigPath) {
  try {
    const viteConfig = await fs.readFile(viteConfigPath, "utf8");
    const match = viteConfig.match(/\bport\s*:\s*(\d{2,5})\b/);
    const parsed = match ? Number(match[1]) : DEFAULT_PREVIEW_PORT;
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535) return parsed;
  } catch {
    // Fall through to the Conduit default port.
  }
  return DEFAULT_PREVIEW_PORT;
}

async function findViteBinary(context) {
  const candidates = [
    path.join(context.projectRoot, "node_modules", "vite", "bin", "vite.js"),
    path.join(context.frontendRoot, "node_modules", "vite", "bin", "vite.js"),
    context.dependencyRoot ? path.join(context.dependencyRoot, "node_modules", "vite", "bin", "vite.js") : "",
    context.dependencyRoot ? path.join(context.dependencyRoot, "frontend", "node_modules", "vite", "bin", "vite.js") : ""
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return "";
}

async function contextWithFallbackPort(context, config = {}, deps = {}) {
  const maxAttempts = Number(config.previewFallbackPortAttempts || 10);
  const upperBound = context.previewMode === "audit_workspace"
    ? auditPreviewPortEnd(config)
    : Math.min(65_535, context.port + maxAttempts);
  const fallbackLimit = context.previewMode === "audit_workspace" ? upperBound : Math.min(upperBound, context.port + maxAttempts);
  for (let candidate = context.port + 1; candidate <= fallbackLimit; candidate += 1) {
    if (candidate > 65_535) break;
    const probe = await probePreviewPort(candidate, config, deps);
    if (!probe.available && !probe.occupied) {
      return {
        ...context,
        port: candidate,
        previewUrl: `http://127.0.0.1:${candidate}/${DEFAULT_PREVIEW_ROUTE}`,
        cacheKey: `${context.cacheKey}:fallback:${candidate}`
      };
    }
  }
  return null;
}

async function resolveAuditPreviewPort(projectRoot, config = {}, deps = {}) {
  const start = auditPreviewPortStart(config);
  const end = auditPreviewPortEnd(config);
  const activeRecord = findActiveRecordByProject(projectRoot, start, end);
  if (activeRecord) return activeRecord.port;

  for (let port = start; port <= end; port += 1) {
    const trustedExternal = await resolveTrustedExternalPreview({ port, projectRoot }, config, deps);
    if (trustedExternal) return port;
  }
  for (let port = start; port <= end; port += 1) {
    const probe = await probePreviewPort(port, config, deps);
    if (!probe.available && !probe.occupied) return port;
  }
  return start;
}

function auditPreviewPortStart(config = {}) {
  const value = Number(config.auditPreviewPortStart || process.env.AUDIT_PREVIEW_PORT_START || AUDIT_PREVIEW_PORT_START);
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : AUDIT_PREVIEW_PORT_START;
}

function auditPreviewPortEnd(config = {}) {
  const start = auditPreviewPortStart(config);
  const value = Number(config.auditPreviewPortEnd || process.env.AUDIT_PREVIEW_PORT_END || AUDIT_PREVIEW_PORT_END);
  return Number.isInteger(value) && value >= start && value <= 65_535 ? value : AUDIT_PREVIEW_PORT_END;
}

async function ensurePreviewDependencyLinks(context) {
  if (!context.dependencyRoot || context.dependencyRoot === context.projectRoot) return;
  await ensureDirectoryLink(
    path.join(context.dependencyRoot, "node_modules"),
    path.join(context.projectRoot, "node_modules")
  );
  await ensureDirectoryLink(
    path.join(context.dependencyRoot, "frontend", "node_modules"),
    path.join(context.frontendRoot, "node_modules")
  );
}

async function ensureDirectoryLink(sourcePath, linkPath) {
  const sourceStat = await fs.stat(sourcePath).catch(() => null);
  if (!sourceStat?.isDirectory?.()) return;
  const existing = await fs.lstat(linkPath).catch(() => null);
  if (existing) return;
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  try {
    await fs.symlink(sourcePath, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch {
    // Preview can still try to start with dependencyRoot's Vite binary.
  }
}

async function resolveDependencyRoot(requestBody, projectRoot) {
  const raw = String(requestBody?.dependencyPath || requestBody?.sourceRepoPath || "").trim();
  if (!raw || !path.isAbsolute(raw)) return "";
  const dependencyRoot = path.resolve(raw);
  if (dependencyRoot === projectRoot) return "";
  const stats = await fs.stat(dependencyRoot).catch(() => null);
  if (!stats?.isDirectory?.()) return "";
  const frontendRoot = path.join(dependencyRoot, "frontend");
  const supported = await exists(path.join(frontendRoot, "package.json")) || await exists(path.join(frontendRoot, "vite.config.js"));
  return supported ? dependencyRoot : "";
}

function createProcessRecord(context, child) {
  const record = {
    child,
    pid: child.pid || null,
    projectId: context.projectId,
    localPath: context.projectRoot,
    cacheKey: context.cacheKey,
    port: context.port,
    startedAt: new Date().toISOString(),
    exited: false,
    exitCode: null,
    logs: []
  };

  appendProcessLogs(record, child.stdout);
  appendProcessLogs(record, child.stderr);
  child.once?.("exit", (code) => {
    record.exited = true;
    record.exitCode = code;
  });
  child.once?.("error", (error) => {
    record.exited = true;
    record.exitCode = "error";
    pushLog(record, String(error?.message || error));
  });
  return record;
}

function getActiveRecord(cacheKey) {
  const record = previewProcesses.get(cacheKey);
  if (!record) return null;
  if (isProcessAlive(record)) return record;
  previewProcesses.delete(cacheKey);
  return null;
}

function findActiveRecordByPort(port) {
  cleanupDeadRecords();
  for (const record of previewProcesses.values()) {
    if (record.port === port && isProcessAlive(record)) return record;
  }
  return null;
}

function findActiveRecordByProject(projectRoot, minPort = 0, maxPort = 65_535) {
  cleanupDeadRecords();
  const normalizedRoot = normalizePathForComparison(projectRoot);
  for (const record of previewProcesses.values()) {
    if (record.port < minPort || record.port > maxPort || !isProcessAlive(record)) continue;
    if (normalizePathForComparison(record.localPath) === normalizedRoot) return record;
  }
  return null;
}

function cleanupDeadRecords() {
  for (const [cacheKey, record] of previewProcesses.entries()) {
    if (!isProcessAlive(record)) previewProcesses.delete(cacheKey);
  }
}

function stopRecord(record) {
  try {
    record.child.kill();
  } catch {
    // The process may have exited between the alive check and kill attempt.
  }
  record.exited = true;
  previewProcesses.delete(record.cacheKey);
}

function appendProcessLogs(record, stream) {
  stream?.on?.("data", (chunk) => {
    pushLog(record, chunk.toString("utf8"));
  });
}

function pushLog(record, text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  record.logs.push(...lines);
  if (record.logs.length > 80) record.logs.splice(0, record.logs.length - 80);
}

function buildProcessFailureMessage(record) {
  const output = record.logs.slice(-6).join(" ");
  const suffix = output ? ` Last output: ${output}` : "";
  return `Workbench preview process exited before serving HTML.${suffix}`;
}

function isProcessAlive(record) {
  return Boolean(record && !record.exited && record.child && record.child.killed !== true);
}

async function resolveTrustedExternalPreview(context, config = {}, deps = {}) {
  const processes = await resolvePortProcesses(context.port, config, deps);
  return processes.find((processInfo) => commandLineMatchesProject(processInfo?.commandLine, context.projectRoot)) || null;
}

async function resolvePortProcesses(port, config = {}, deps = {}) {
  if (typeof deps.portProcessResolver === "function") {
    return normalizeProcessList(await deps.portProcessResolver(port));
  }
  if (process.platform !== "win32") return [];

  const execFileImpl = deps.execFileImpl || defaultExecFile;
  const timeout = Number(config.previewPortProcessTimeoutMs || 1500);
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort <= 0 || numericPort > 65_535) return [];
  const netstatOutput = await execFileText(execFileImpl, "netstat.exe", ["-ano", "-p", "tcp"], timeout);
  const pids = parseListeningPids(netstatOutput, numericPort);
  const processes = [];
  for (const pid of pids) {
    const processOutput = await execFileText(
      execFileImpl,
      "wmic.exe",
      ["process", "where", `processid=${pid}`, "get", "ProcessId,ParentProcessId,CommandLine", "/format:list"],
      timeout
    );
    const processInfo = parseWmicProcess(processOutput);
    if (processInfo) processes.push(processInfo);
  }
  return processes;
}

function execFileText(execFileImpl, command, args, timeout) {
  return new Promise((resolve) => {
    execFileImpl(command, args, { windowsHide: true, timeout }, (error, stdout) => {
      resolve(error ? "" : String(stdout || ""));
    });
  });
}

function parseListeningPids(netstatOutput, port) {
  const suffix = `:${port}`;
  const pids = new Set();
  for (const line of String(netstatOutput || "").split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0].toUpperCase() !== "TCP") continue;
    const [localAddress,, state, pid] = parts.slice(1);
    if (state?.toUpperCase() === "LISTENING" && localAddress?.endsWith(suffix) && /^\d+$/.test(pid)) {
      pids.add(Number(pid));
    }
  }
  return [...pids];
}

function parseWmicProcess(output) {
  const record = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    record[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  if (!record.CommandLine && !record.ProcessId) return null;
  return {
    pid: Number(record.ProcessId || 0) || null,
    parentPid: Number(record.ParentProcessId || 0) || null,
    commandLine: record.CommandLine || ""
  };
}

function normalizeProcessList(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => ({
    pid: Number(item.pid ?? item.ProcessId ?? 0) || null,
    parentPid: Number(item.parentPid ?? item.ParentProcessId ?? 0) || null,
    commandLine: String(item.commandLine ?? item.CommandLine ?? "")
  })).filter((item) => item.commandLine);
}

function commandLineMatchesProject(commandLine, projectRoot) {
  const normalizedCommand = normalizePathForComparison(commandLine);
  const normalizedRoot = normalizePathForComparison(projectRoot);
  return Boolean(normalizedCommand && normalizedRoot && normalizedCommand.includes(normalizedRoot));
}

function normalizePathForComparison(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
}

async function probePreviewPort(port, config = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl === "function") {
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        `http://127.0.0.1:${port}/`,
        Number(config.previewProbeTimeoutMs || 1000)
      );
      const contentType = response.headers?.get?.("content-type") || "";
      const body = typeof response.text === "function" ? await response.text() : "";
      if (contentType.includes("text/html") || looksLikeHtml(body)) {
        return { available: true, occupied: true };
      }
      return { available: false, occupied: true, reason: "non_html" };
    } catch {
      // Fetch can fail for a closed port or for a non-HTTP listener; check TCP next.
    }
  }

  const portCheckImpl = deps.portCheckImpl || isPortListening;
  const listening = await portCheckImpl(port, "127.0.0.1", Number(config.previewProbeTimeoutMs || 1000));
  return listening
    ? { available: false, occupied: true, reason: "non_http" }
    : { available: false, occupied: false };
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  if (typeof AbortController !== "function") return fetchImpl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeHtml(body) {
  return /^\s*(?:<!doctype html>|<html|<div id=["']root["'])/i.test(String(body || ""));
}

function isPortListening(port, host, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let settled = false;
    const finish = (listening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
