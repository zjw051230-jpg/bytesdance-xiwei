import fs from "node:fs/promises";
import path from "node:path";

export const REQUIRED_SKILL_SECTIONS = [
  "Description",
  "When to Use",
  "Inputs",
  "Outputs",
  "Steps",
  "Safety Rules",
  "Validation",
  "Example"
];

export const SENSITIVE_SKILL_PATTERNS = [
  /api_key/i,
  /sk-/i,
  /Authorization/i,
  /Bearer/i,
  /password/i,
  /secret/i
];

export function isKebabCaseName(name) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

export function extractSkillName(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

export function extractDescription(markdown) {
  const match = markdown.match(/## Description\s+([\s\S]*?)(?=\n## |\s*$)/);
  return match ? match[1].trim().split(/\r?\n/)[0].trim() : "";
}

export function findMissingSections(markdown) {
  return REQUIRED_SKILL_SECTIONS.filter((section) => !new RegExp(`^## ${escapeRegExp(section)}\\s*$`, "m").test(markdown));
}

export function findSensitiveMatches(markdown) {
  return SENSITIVE_SKILL_PATTERNS
    .filter((pattern) => pattern.test(markdown))
    .map((pattern) => pattern.source.replace(/\\/g, ""));
}

export async function loadSkillMarkdown(skillDir) {
  const skillPath = path.join(skillDir, "skill.md");
  const markdown = await fs.readFile(skillPath, "utf8");
  return {
    skillPath,
    markdown,
    name: extractSkillName(markdown),
    description: extractDescription(markdown),
    missingSections: findMissingSections(markdown),
    sensitiveMatches: findSensitiveMatches(markdown)
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
