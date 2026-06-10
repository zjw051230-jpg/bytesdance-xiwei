import { loadSkillRegistry } from "../server/services/skillRegistry.js";
import { dryRunSkills } from "../server/services/skillDryRunExecutor.js";

const registry = await loadSkillRegistry({ forceRefresh: true });
const dryRun = await dryRunSkills(registry.skills);
const status = registry.passed && dryRun.status === "passed" ? "passed" : "failed";

console.log(JSON.stringify({
  status,
  count: registry.skills.length,
  auditPassed: registry.passed,
  smokePassed: dryRun.status === "passed",
  realLlmCalled: false,
  agentRuntimeCalled: dryRun.agentRuntimeCalled,
  realRepoWritePerformed: dryRun.realRepoWritePerformed,
  results: dryRun.results
}, null, 2));

if (status !== "passed") {
  process.exitCode = 1;
}
