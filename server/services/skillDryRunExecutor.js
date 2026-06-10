import { loadSkillMarkdown } from "./skillMarkdownLoader.js";

export async function dryRunSkill(skill) {
  const markdownInfo = await loadSkillMarkdown(skill.path.replace(/[\\/]skill\.md$/, ""));
  const checks = {
    hasName: Boolean(markdownInfo.name),
    hasDescription: Boolean(markdownInfo.description),
    hasRequiredSections: markdownInfo.missingSections.length === 0,
    hasNoSensitivePatterns: markdownInfo.sensitiveMatches.length === 0,
    dryRunOnly: skill.dryRunOnly === true,
    realWriteBlocked: skill.realWriteAllowed === false
  };
  return {
    id: skill.id,
    status: Object.values(checks).every(Boolean) ? "passed" : "failed",
    checks,
    agentRuntimeCalled: false,
    realLlmCalled: false,
    realRepoWritePerformed: false
  };
}

export async function dryRunSkills(skills) {
  const results = [];
  for (const skill of skills) {
    results.push(await dryRunSkill(skill));
  }
  return {
    status: results.every((result) => result.status === "passed") ? "passed" : "failed",
    results,
    agentRuntimeCalled: false,
    realLlmCalled: false,
    realRepoWritePerformed: false
  };
}
