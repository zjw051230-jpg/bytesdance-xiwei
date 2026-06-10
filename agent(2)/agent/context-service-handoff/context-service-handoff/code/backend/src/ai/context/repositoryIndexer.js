const fs = require("node:fs");
const path = require("node:path");

const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".ai-runs"]);
const INDEXABLE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".example",
]);

function buildRepositoryIndex(repoRoot) {
  const root = path.resolve(repoRoot);
  const entries = [];
  walk(root, root, entries);
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function walk(root, currentDirectory, entries) {
  for (const directoryEntry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
    if (directoryEntry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(directoryEntry.name)) {
        walk(root, path.join(currentDirectory, directoryEntry.name), entries);
      }
      continue;
    }

    if (!directoryEntry.isFile()) continue;

    const absolutePath = path.join(currentDirectory, directoryEntry.name);
    const relativePath = toPosix(path.relative(root, absolutePath));
    if (!isIndexable(relativePath)) continue;

    const content = fs.readFileSync(absolutePath, "utf8");
    entries.push({
      relativePath,
      absolutePath,
      layer: inferLayer(relativePath),
      moduleType: inferModuleType(relativePath),
      size: Buffer.byteLength(content),
      content: content.slice(0, 30000),
    });
  }
}

function isIndexable(relativePath) {
  if (relativePath.endsWith(".env.example")) return true;
  return INDEXABLE_EXTENSIONS.has(path.extname(relativePath));
}

function inferLayer(relativePath) {
  if (relativePath.startsWith("frontend/")) return "frontend";
  if (relativePath.startsWith("backend/")) return "backend";
  return "repo";
}

function inferModuleType(relativePath) {
  if (relativePath.includes("/routes/")) return "route";
  if (relativePath.includes("/components/")) return "component";
  if (relativePath.includes("/controllers/")) return "controller";
  if (relativePath.includes("/models/")) return "model";
  if (relativePath.includes("/services/")) return "service";
  if (relativePath.includes("/helpers/")) return "helper";
  if (relativePath.includes("/migrations/")) return "migration";
  return "file";
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

module.exports = { buildRepositoryIndex, EXCLUDED_DIRS, INDEXABLE_EXTENSIONS };
