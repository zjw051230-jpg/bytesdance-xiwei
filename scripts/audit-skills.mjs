import { loadSkillRegistry } from "../server/services/skillRegistry.js";

const registry = await loadSkillRegistry({ forceRefresh: true });
const output = {
  status: registry.passed ? "passed" : "failed",
  skillsRoot: registry.skillsRoot,
  count: registry.skills.length,
  skills: registry.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    type: skill.type,
    path: skill.path,
    dryRunOnly: skill.dryRunOnly,
    realWriteAllowed: skill.realWriteAllowed,
    errors: skill.errors
  })),
  errors: registry.errors
};

console.log(JSON.stringify(output, null, 2));
if (!registry.passed) {
  process.exitCode = 1;
}
