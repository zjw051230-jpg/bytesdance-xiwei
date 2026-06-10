// @vitest-environment node
import { describe, expect, it } from "vitest";
import { dryRunSkills } from "./services/skillDryRunExecutor.js";
import { loadSkillRegistry } from "./services/skillRegistry.js";

describe("skill registry", () => {
  it("loads runnable project skills without calling live runtimes", async () => {
    const registry = await loadSkillRegistry({ forceRefresh: true });

    expect(registry.passed).toBe(true);
    expect(registry.skills.length).toBeGreaterThanOrEqual(9);
    expect(registry.skills.every((skill) => skill.path.endsWith("skill.md"))).toBe(true);
    expect(registry.skills.every((skill) => skill.dryRunOnly === true)).toBe(true);
    expect(registry.skills.every((skill) => skill.realWriteAllowed === false)).toBe(true);
    expect(registry.skills.some((skill) => skill.id === "dsl-requirement-router")).toBe(true);
    expect(registry.skills.some((skill) => skill.id === "agent-plan-generation")).toBe(true);

    const dryRun = await dryRunSkills(registry.skills);
    expect(dryRun.status).toBe("passed");
    expect(dryRun.realLlmCalled).toBe(false);
    expect(dryRun.agentRuntimeCalled).toBe(false);
    expect(dryRun.realRepoWritePerformed).toBe(false);
  });
});
