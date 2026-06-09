import fs from "node:fs/promises";
import path from "node:path";

export const PROJECT_API_CONFIG_PATH = path.resolve("configs", "api_config.local.json");
export const EXTERNAL_DSL_V2_API_CONFIG_PATH = "F:\\dsl-v2\\configs\\api_config.local.json";
export const EXTERNAL_DSL_V2_WARNING = "External F:\\dsl-v2 config fallback used. Standalone mode should use configs/api_config.local.json.";

export async function resolveApiConfigPath(options = {}) {
  const explicitPath = options.apiConfigPath || options.configPath;
  if (explicitPath) {
    const resolvedPath = path.resolve(explicitPath);
    if (await exists(resolvedPath)) {
      return {
        configPath: resolvedPath,
        source: "options",
        usedExternalDslV2Fallback: false
      };
    }
    return {
      configPath: resolvedPath,
      source: "missing",
      usedExternalDslV2Fallback: false
    };
  }

  const candidates = [
    { path: process.env.API_CONFIG_PATH, source: "API_CONFIG_PATH" },
    { path: process.env.DOUBAO_API_CONFIG, source: "DOUBAO_API_CONFIG" },
    { path: process.env.SKILL_MODEL_API_CONFIG, source: "SKILL_MODEL_API_CONFIG" },
    { path: PROJECT_API_CONFIG_PATH, source: "project_local" },
    { path: path.resolve("configs", "api_config.local.json"), source: "project_relative" },
    { path: EXTERNAL_DSL_V2_API_CONFIG_PATH, source: "external_dsl_v2_fallback" }
  ].filter((candidate) => candidate.path);

  for (const candidate of candidates) {
    const resolvedPath = path.resolve(candidate.path);
    if (await exists(resolvedPath)) {
      if (candidate.source === "external_dsl_v2_fallback") {
        console.warn(EXTERNAL_DSL_V2_WARNING);
      }
      return {
        configPath: resolvedPath,
        source: candidate.source,
        usedExternalDslV2Fallback: candidate.source === "external_dsl_v2_fallback"
      };
    }
  }

  return {
    configPath: path.resolve(options.apiConfigPath || options.configPath || process.env.API_CONFIG_PATH || PROJECT_API_CONFIG_PATH),
    source: "missing",
    usedExternalDslV2Fallback: false
  };
}

export async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
