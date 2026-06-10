import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isKebabCaseName, loadSkillMarkdown } from "./skillMarkdownLoader.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillsRoot = path.resolve(currentDir, "..", "..", "skills");
let cachedRegistry = null;

export async function loadSkillRegistry(options = {}) {
  const skillsRoot = options.skillsRoot || defaultSkillsRoot;
  if (cachedRegistry && !options.forceRefresh && cachedRegistry.skillsRoot === skillsRoot) {
    return cachedRegistry;
  }

  const entries = await fs.readdir(skillsRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

  const skills = [];
  const errors = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const skillDir = path.join(skillsRoot, entry.name);
    const skillPath = path.join(skillDir, "skill.md");
    const metadataPath = path.join(skillDir, "metadata.json");
    const folderErrors = [];

    if (!isKebabCaseName(entry.name)) {
      folderErrors.push("folder name must be kebab-case");
    }

    let markdownInfo = null;
    try {
      markdownInfo = await loadSkillMarkdown(skillDir);
      if (markdownInfo.missingSections.length > 0) {
        folderErrors.push(`missing sections: ${markdownInfo.missingSections.join(", ")}`);
      }
      if (markdownInfo.sensitiveMatches.length > 0) {
        folderErrors.push(`sensitive patterns: ${markdownInfo.sensitiveMatches.join(", ")}`);
      }
    } catch (error) {
      folderErrors.push(error.code === "ENOENT" ? "missing skill.md" : `skill.md read failed: ${error.message}`);
    }

    let metadata = {};
    try {
      metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    } catch (error) {
      folderErrors.push(error.code === "ENOENT" ? "missing metadata.json" : `metadata.json parse failed: ${error.message}`);
    }

    const skill = {
      id: metadata.id || entry.name,
      name: markdownInfo?.name || entry.name,
      type: metadata.type || "utility",
      path: skillPath,
      description: markdownInfo?.description || metadata.description || "",
      dryRunOnly: metadata.dryRunOnly !== false,
      realWriteAllowed: metadata.realWriteAllowed === true,
      source: metadata.source || "",
      errors: folderErrors
    };
    skills.push(skill);
    for (const error of folderErrors) {
      errors.push({ id: skill.id, path: skillPath, error });
    }
  }

  cachedRegistry = {
    skillsRoot,
    skills,
    errors,
    passed: errors.length === 0
  };
  return cachedRegistry;
}

export function clearSkillRegistryCache() {
  cachedRegistry = null;
}

export { defaultSkillsRoot };
