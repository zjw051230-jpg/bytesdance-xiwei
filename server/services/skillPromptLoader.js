import fs from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "./redactionService.js";

export const defaultSkillNames = ["prd_to_dsl", "clarification", "code_context"];

const promptCache = new Map();

export async function loadSkillPrompts(config = {}) {
  const dslRuntimeRoot = config.dslRuntimeRoot || "F:\\dsl-v2";
  const skillNames = config.skillNames || defaultSkillNames;
  const wrapperPath = config.wrapperPath || path.resolve("server", "prompts", "pm_to_dsl_fast_skill_turn.md");
  const cacheKey = JSON.stringify({ dslRuntimeRoot, skillNames, wrapperPath });
  if (promptCache.has(cacheKey)) return promptCache.get(cacheKey);

  const skills = {};

  for (const skillName of skillNames) {
    const skillPath = path.join(dslRuntimeRoot, "skills", skillName, "skill.md");
    let content = "";
    try {
      content = await fs.readFile(skillPath, "utf8");
    } catch (error) {
      const errorResult = {
        ok: false,
        data: null,
        error: redactSecrets({
          code: "skill_prompt_missing",
          message: `Skill prompt not found: ${skillName}`,
          details: { skillName, skillPath, reason: String(error.message || error) }
        })
      };
      promptCache.set(cacheKey, errorResult);
      return errorResult;
    }
    skills[skillName] = { name: skillName, path: skillPath, content };
  }

  let wrapper = "";
  try {
    wrapper = await fs.readFile(wrapperPath, "utf8");
  } catch (error) {
    const errorResult = {
      ok: false,
      data: null,
      error: redactSecrets({
        code: "skill_wrapper_missing",
        message: "Skill orchestration wrapper prompt not found",
        details: { wrapperPath, reason: String(error.message || error) }
      })
    };
    promptCache.set(cacheKey, errorResult);
    return errorResult;
  }

  const result = {
    ok: true,
    data: {
      dslRuntimeRoot,
      wrapper: { path: wrapperPath, content: wrapper },
      skills
    },
    error: null
  };
  promptCache.set(cacheKey, result);
  return result;
}
