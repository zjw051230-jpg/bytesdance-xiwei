import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const excludedNames = new Set([
  ".git",
  ".env",
  ".ai-runs",
  "node_modules",
  "dist",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  ".vite"
]);

export class WorkspaceAdapter {
  async createRunWorkspace() {
    throw new Error("createRunWorkspace is not implemented");
  }

  async getChangedFiles() {
    throw new Error("getChangedFiles is not implemented");
  }

  async getFileDiff() {
    throw new Error("getFileDiff is not implemented");
  }

  async revertFile() {
    throw new Error("revertFile is not implemented");
  }

  async resetRunWorkspace() {
    throw new Error("resetRunWorkspace is not implemented");
  }

  async createCheckpoint() {
    throw new Error("createCheckpoint is not implemented");
  }

  async cleanupWorkspace() {
    throw new Error("cleanupWorkspace is not implemented");
  }
}

export class CopyWorkspaceAdapter extends WorkspaceAdapter {
  constructor(options = {}) {
    super();
    this.runsRoot = path.resolve(options.runsRoot || "runs");
  }

  async createRunWorkspace({ runId, sourceRepoPath }) {
    const sourceRoot = path.resolve(sourceRepoPath || "");
    const stat = await fs.stat(sourceRoot).catch(() => null);
    if (!stat?.isDirectory?.()) {
      throw Object.assign(new Error("source repo path must be an existing directory"), {
        code: "source_repo_invalid",
        details: { sourceRepoPath }
      });
    }

    const runRoot = path.join(this.runsRoot, "workspaces", safeSegment(runId));
    const workspacePath = path.join(runRoot, "workspace");
    const baselinePath = path.join(runRoot, "baseline");
    await fs.rm(runRoot, { recursive: true, force: true });
    await copyTree(sourceRoot, workspacePath);
    await copyTree(workspacePath, baselinePath);
    return {
      runId,
      adapterType: "copy",
      sourceRepoPath: sourceRoot,
      workspacePath,
      baselinePath,
      createdAt: new Date().toISOString()
    };
  }

  async getChangedFiles({ workspacePath, baselinePath }) {
    return getChangedFilesFromSnapshot({ workspacePath, baselinePath });
  }

  async getFileDiff({ workspacePath, baselinePath, filePath }) {
    return getFileDiffFromSnapshot({ workspacePath, baselinePath, filePath });
  }

  async revertFile({ workspacePath, baselinePath, filePath }) {
    const target = resolveInside(workspacePath, filePath);
    const baseline = resolveInside(baselinePath, filePath);
    const baselineStat = await fs.stat(baseline).catch(() => null);
    if (baselineStat?.isDirectory?.()) {
      throw Object.assign(new Error("cannot revert a directory"), { code: "invalid_file_path" });
    }
    if (!baselineStat) {
      await fs.rm(target, { force: true });
      return { filePath: normalizeRelative(filePath), restored: false, removedAddedFile: true };
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(baseline, target);
    return { filePath: normalizeRelative(filePath), restored: true, removedAddedFile: false };
  }

  async resetRunWorkspace({ workspacePath, baselinePath }) {
    const workspaceRoot = path.resolve(workspacePath || "");
    const baselineRoot = path.resolve(baselinePath || "");
    assertUsableRoot(workspaceRoot, "workspace");
    assertUsableRoot(baselineRoot, "baseline");
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    await copyTree(baselineRoot, workspaceRoot);
    return { workspacePath: workspaceRoot, baselinePath: baselineRoot, resetAt: new Date().toISOString() };
  }

  async createCheckpoint({ runId, workspacePath, label = "checkpoint" }) {
    const workspaceRoot = path.resolve(workspacePath || "");
    assertUsableRoot(workspaceRoot, "workspace");
    const checkpointPath = path.join(this.runsRoot, "workspaces", safeSegment(runId), "checkpoints", `${Date.now()}-${safeSegment(label)}`);
    await copyTree(workspaceRoot, checkpointPath);
    return { runId, checkpointPath, label, createdAt: new Date().toISOString() };
  }

  async cleanupWorkspace({ workspacePath }) {
    const workspaceRoot = path.resolve(workspacePath || "");
    assertUsableRoot(workspaceRoot, "workspace");
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    return { workspacePath: workspaceRoot, removed: true };
  }
}

export class GitWorktreeWorkspaceAdapter extends CopyWorkspaceAdapter {
  async createRunWorkspace({ runId, sourceRepoPath }) {
    const sourceRoot = path.resolve(sourceRepoPath || "");
    const runRoot = path.join(this.runsRoot, "workspaces", safeSegment(runId));
    const workspacePath = path.join(runRoot, "workspace");
    const baselinePath = path.join(runRoot, "baseline");
    await fs.rm(runRoot, { recursive: true, force: true });
    await fs.mkdir(runRoot, { recursive: true });
    await execFileAsync("git", ["-C", sourceRoot, "rev-parse", "--is-inside-work-tree"], { windowsHide: true });
    await execFileAsync("git", ["-C", sourceRoot, "worktree", "add", "--detach", workspacePath, "HEAD"], { windowsHide: true });
    await copyTree(workspacePath, baselinePath);
    return {
      runId,
      adapterType: "git_worktree",
      sourceRepoPath: sourceRoot,
      workspacePath,
      baselinePath,
      createdAt: new Date().toISOString()
    };
  }

  async cleanupWorkspace({ sourceRepoPath, workspacePath }) {
    const workspaceRoot = path.resolve(workspacePath || "");
    assertUsableRoot(workspaceRoot, "workspace");
    if (sourceRepoPath) {
      await execFileAsync("git", ["-C", path.resolve(sourceRepoPath), "worktree", "remove", "--force", workspaceRoot], { windowsHide: true }).catch(() => null);
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    return { workspacePath: workspaceRoot, removed: true };
  }
}

export class MockWorkspaceAdapter extends CopyWorkspaceAdapter {}

export async function selectWorkspaceAdapter(options = {}) {
  const runsRoot = options.runsRoot || "runs";
  if (options.adapterType === "copy") return new CopyWorkspaceAdapter({ runsRoot });
  if (options.adapterType === "mock") return new MockWorkspaceAdapter({ runsRoot });
  if (options.adapterType === "git_worktree") return new GitWorktreeWorkspaceAdapter({ runsRoot });
  if (await canUseGitWorktree(options.sourceRepoPath)) return new GitWorktreeWorkspaceAdapter({ runsRoot });
  return new CopyWorkspaceAdapter({ runsRoot });
}

export async function getChangedFilesFromSnapshot({ workspacePath, baselinePath }) {
  const workspaceRoot = path.resolve(workspacePath || "");
  const baselineRoot = path.resolve(baselinePath || "");
  assertUsableRoot(workspaceRoot, "workspace");
  assertUsableRoot(baselineRoot, "baseline");
  const [workspaceFiles, baselineFiles] = await Promise.all([
    fileMap(workspaceRoot),
    fileMap(baselineRoot)
  ]);
  const names = [...new Set([...workspaceFiles.keys(), ...baselineFiles.keys()])].sort();
  const changes = [];
  for (const filePath of names) {
    const current = workspaceFiles.get(filePath);
    const baseline = baselineFiles.get(filePath);
    if (current?.hash === baseline?.hash) continue;
    const status = !baseline ? "added" : !current ? "deleted" : "modified";
    changes.push({
      id: changeIdFor(filePath),
      filePath,
      status: "changed",
      changeType: status,
      beforeHash: baseline?.hash || "",
      afterHash: current?.hash || "",
      diffStat: {
        additions: current ? Math.max(0, current.lines - (baseline?.lines || 0)) : 0,
        deletions: baseline ? Math.max(0, baseline.lines - (current?.lines || 0)) : 0
      }
    });
  }
  return changes;
}

export async function getFileDiffFromSnapshot({ workspacePath, baselinePath, filePath }) {
  const normalized = normalizeRelative(filePath);
  const workspaceFile = resolveInside(workspacePath, normalized);
  const baselineFile = resolveInside(baselinePath, normalized);
  const before = await readMaybeText(baselineFile);
  const after = await readMaybeText(workspaceFile);
  return {
    filePath: normalized,
    beforeExists: before.exists,
    afterExists: after.exists,
    beforeText: before.text,
    afterText: after.text,
    unifiedDiff: buildSimpleUnifiedDiff(normalized, before.text, after.text)
  };
}

async function canUseGitWorktree(sourceRepoPath) {
  if (!sourceRepoPath) return false;
  try {
    const sourceRoot = path.resolve(sourceRepoPath);
    const { stdout } = await execFileAsync("git", ["-C", sourceRoot, "rev-parse", "--show-toplevel"], { windowsHide: true });
    return path.resolve(stdout.trim()) === sourceRoot;
  } catch {
    return false;
  }
}

async function copyTree(source, target) {
  const sourceRoot = path.resolve(source);
  const targetRoot = path.resolve(target);
  await fs.mkdir(targetRoot, { recursive: true });
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldExclude(entry.name)) continue;
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await copyTree(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function fileMap(root) {
  const map = new Map();
  await walkFiles(root, root, map);
  return map;
}

async function walkFiles(root, dir, map) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (shouldExclude(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walkFiles(root, fullPath, map);
      continue;
    }
    if (!entry.isFile()) continue;
    const buffer = await fs.readFile(fullPath);
    const relative = path.relative(root, fullPath).replaceAll("\\", "/");
    map.set(relative, {
      hash: crypto.createHash("sha256").update(buffer).digest("hex"),
      lines: buffer.toString("utf8").split(/\r?\n/).length
    });
  }
}

async function readMaybeText(filePath) {
  try {
    return { exists: true, text: await fs.readFile(filePath, "utf8") };
  } catch {
    return { exists: false, text: "" };
  }
}

function buildSimpleUnifiedDiff(filePath, beforeText, afterText) {
  if (beforeText === afterText) return `--- a/${filePath}\n+++ b/${filePath}\n`;
  const beforeLines = beforeText ? beforeText.split(/\r?\n/) : [];
  const afterLines = afterText ? afterText.split(/\r?\n/) : [];
  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    "@@ baseline current @@",
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`)
  ].join("\n");
}

function resolveInside(root, relativePath) {
  const rootPath = path.resolve(root || "");
  assertUsableRoot(rootPath, "root");
  const normalized = normalizeRelative(relativePath);
  const resolved = path.resolve(rootPath, normalized);
  if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`)) {
    throw Object.assign(new Error("path escapes run workspace"), { code: "invalid_file_path", details: { relativePath } });
  }
  return resolved;
}

function normalizeRelative(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) {
    throw Object.assign(new Error("invalid relative file path"), { code: "invalid_file_path", details: { filePath: value } });
  }
  return normalized;
}

function assertUsableRoot(rootPath, label) {
  if (!rootPath || rootPath === path.parse(rootPath).root) {
    throw Object.assign(new Error(`${label} path is unsafe`), { code: "unsafe_workspace_path" });
  }
}

function shouldExclude(name) {
  if (excludedNames.has(name)) return true;
  return /\.pyc$/i.test(name) || /\.sqlite(?:-\w+)?$/i.test(name) || /\.db(?:-\w+)?$/i.test(name);
}

function changeIdFor(filePath) {
  return `change-${crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 16)}`;
}

function safeSegment(value) {
  return String(value || "run").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80);
}
