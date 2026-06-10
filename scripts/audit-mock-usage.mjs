import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outputJson = path.join(root, "reporting", "mock_usage_audit.json");
const outputMd = path.join(root, "reporting", "mock_usage_audit.md");
const extensions = new Set([".js", ".jsx", ".mjs", ".json", ".md", ".ts", ".tsx"]);
const excludedSegments = new Set([".git", "node_modules", "dist", "runs", "data"]);
const keywordPattern = /mock|fake|demo|placeholder|hardcoded|sample|fixture|fallback|dummy|canned|conduit-realworld-example-app|LoginForm\.jsx|ErrorMessage\.jsx|fallback_safe_default/ig;

const records = [];
walk(root);

records.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const counts = records.reduce((summary, record) => {
  summary[record.classification] = (summary[record.classification] || 0) + 1;
  return summary;
}, {});

const summary = {
  totalMatches: records.length,
  production_mock: counts.production_mock || 0,
  test_fixture: counts.test_fixture || 0,
  safe_fallback: counts.safe_fallback || 0,
  docs_only: counts.docs_only || 0,
  unknown: counts.unknown || 0
};

fs.mkdirSync(path.dirname(outputJson), { recursive: true });
fs.writeFileSync(outputJson, `${JSON.stringify({ summary, records }, null, 2)}\n`, "utf8");
fs.writeFileSync(outputMd, renderMarkdown(summary, records), "utf8");
console.log(JSON.stringify(summary, null, 2));

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excludedSegments.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !extensions.has(path.extname(entry.name))) continue;
    if (sameFile(fullPath, outputJson) || sameFile(fullPath, outputMd) || fullPath.endsWith(path.join("scripts", "audit-mock-usage.mjs"))) continue;
    scanFile(fullPath);
  }
}

function scanFile(fullPath) {
  const relative = path.relative(root, fullPath).replaceAll(path.sep, "/");
  const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
  lines.forEach((lineText, index) => {
    keywordPattern.lastIndex = 0;
    const matches = [...lineText.matchAll(keywordPattern)];
    for (const match of matches) {
      const keyword = match[0];
      const classification = classify(relative, lineText, keyword);
      records.push({
        file: relative,
        line: index + 1,
        keyword,
        context: lineText.trim().slice(0, 240),
        classification,
        action: actionFor(classification)
      });
    }
  });
}

function classify(file, context, keyword) {
  const normalized = file.toLowerCase();
  const text = context.toLowerCase();
  const word = keyword.toLowerCase();
  if (normalized.startsWith("reporting/") || normalized.endsWith(".md")) return "docs_only";
  if (normalized.includes(".test.") || normalized.includes("/test/") || normalized.includes("/tests/") || normalized.includes("fixture")) return "test_fixture";
  if (normalized.startsWith("scripts/smoke") || normalized.includes("smoke-")) return "test_fixture";
  if (normalized.includes("dslworkbench") || normalized.includes("dslstatusconsole") || normalized.includes("clarificationchat")) return "unknown";
  if (word.includes("fallback")) return "safe_fallback";
  if (text.includes("sourcemode") || text.includes("mockllmused") || text.includes("mock model")) return "safe_fallback";
  if (text.includes("placeholder comments")) return "unknown";
  if (normalized.includes("dslartifactadapter") && (word.includes("mock") || word.includes("fallback"))) return "safe_fallback";
  if (normalized.startsWith("src/components/") || normalized.startsWith("src/api/") || normalized.startsWith("src/adapters/") || normalized.startsWith("src/data/")) {
    if (text.includes("placeholder=")) return "unknown";
    return "production_mock";
  }
  return "unknown";
}

function actionFor(classification) {
  if (classification === "production_mock") return "replace";
  if (classification === "test_fixture") return "keep_as_fixture";
  if (classification === "safe_fallback") return "keep_as_safe_fallback";
  if (classification === "docs_only") return "ignore_docs";
  return "needs_review";
}

function renderMarkdown(summary, items) {
  const rows = items.map((item) => (
    `| ${escapeCell(item.file)} | ${item.line} | ${escapeCell(item.keyword)} | ${item.classification} | ${item.action} | ${escapeCell(item.context)} |`
  ));
  return [
    "# Mock Usage Audit",
    "",
    "## Summary",
    "",
    `- total matches: ${summary.totalMatches}`,
    `- production_mock: ${summary.production_mock}`,
    `- test_fixture: ${summary.test_fixture}`,
    `- safe_fallback: ${summary.safe_fallback}`,
    `- docs_only: ${summary.docs_only}`,
    `- unknown: ${summary.unknown}`,
    "",
    "## Records",
    "",
    "| file | line | keyword | classification | action | context |",
    "| ---- | ---- | ------- | -------------- | ------ | ------- |",
    ...rows,
    ""
  ].join("\n");
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function sameFile(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
