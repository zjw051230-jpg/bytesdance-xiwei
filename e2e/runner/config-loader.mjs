import fs from "node:fs/promises";
import path from "node:path";

export const projectConfigPath = path.resolve("configs", "api_config.local.json");
export const externalDslV2ConfigPath = "F:\\dsl-v2\\configs\\api_config.local.json";
export const externalDslV2Warning = "External F:\\dsl-v2 config fallback used. Standalone mode should use configs/api_config.local.json.";

export async function resolveStandaloneConfigPath({ allowExternalFallback = true, configPath = "" } = {}) {
  const candidates = [
    { source: "explicit", value: configPath },
    { source: "API_CONFIG_PATH", value: process.env.API_CONFIG_PATH },
    { source: "project_local", value: projectConfigPath },
    { source: "project_relative", value: path.resolve("configs", "api_config.local.json") }
  ].filter((item) => item.value);
  if (allowExternalFallback) {
    candidates.push({ source: "external_dsl_v2_fallback", value: externalDslV2ConfigPath });
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate.value);
    if (await exists(resolved)) {
      if (candidate.source === "external_dsl_v2_fallback") {
        console.warn(externalDslV2Warning);
      }
      return {
        path: resolved,
        source: candidate.source,
        usedExternalDslV2Fallback: candidate.source === "external_dsl_v2_fallback"
      };
    }
  }

  return {
    path: path.resolve(process.env.API_CONFIG_PATH || projectConfigPath),
    source: "missing",
    usedExternalDslV2Fallback: false
  };
}

export async function loadStandaloneConfig(options = {}) {
  const resolved = await resolveStandaloneConfigPath({
    allowExternalFallback: options.allowExternalFallback !== false,
    configPath: options.configPath
  });
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(resolved.path, "utf8"));
  } catch (error) {
    const err = new Error(`standalone_config_missing:${resolved.path}`);
    err.details = { configPath: resolved.path, reason: String(error.message || error) };
    throw err;
  }

  const provider = String(raw.provider || "doubao_ark").trim();
  const baseURL = String(raw.base_url || raw.baseURL || defaultBaseURL(provider)).trim().replace(/\/+$/, "");
  const chatCompletionsPath = String(raw.chat_completions_path || raw.chatCompletionsPath || "/chat/completions").trim();
  const model = String(raw.model || raw.endpoint_id || raw.endpointId || "").trim();
  const apiKey = String(raw.api_key || raw.apiKey || "").trim();
  const timeoutSeconds = Number(raw.timeout_seconds || raw.timeoutSeconds || 120);
  const maxRetries = Number(raw.max_retries || raw.maxRetries || 1);

  if (!model) throw new Error("standalone_config_model_missing");
  if (!apiKey) throw new Error("standalone_config_api_key_missing");

  return {
    provider,
    baseURL,
    chatCompletionsPath,
    model,
    apiKey,
    timeoutSeconds: Number.isFinite(timeoutSeconds) ? timeoutSeconds : 120,
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : 1,
    configPath: resolved.path,
    configSource: resolved.source,
    usedExternalDslV2Fallback: resolved.usedExternalDslV2Fallback,
    apiKeyPresent: true
  };
}

export function safeConfig(config) {
  return {
    provider: config.provider,
    baseURL: config.baseURL,
    chatCompletionsPath: config.chatCompletionsPath,
    model: config.model,
    timeoutSeconds: config.timeoutSeconds,
    maxRetries: config.maxRetries,
    configPath: config.configPath,
    configSource: config.configSource,
    usedExternalDslV2Fallback: config.usedExternalDslV2Fallback,
    apiKeyPresent: Boolean(config.apiKey)
  };
}

function defaultBaseURL(provider) {
  return provider === "doubao_ark" ? "https://ark.cn-beijing.volces.com/api/v3" : "";
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
