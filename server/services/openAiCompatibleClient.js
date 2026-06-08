import fs from "node:fs/promises";
import OpenAI from "openai";
import { redactSecrets, redactString } from "./redactionService.js";

export const DEFAULT_OPENAI_COMPATIBLE_CONFIG_PATH = "F:\\dsl-v2\\configs\\api_config.local.json";

export async function readOpenAiCompatibleConfig(options = {}) {
  const apiConfigPath = options.apiConfigPath || process.env.SKILL_MODEL_API_CONFIG || DEFAULT_OPENAI_COMPATIBLE_CONFIG_PATH;
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(apiConfigPath, "utf8"));
  } catch (error) {
    throw sdkError("sdk_config_missing", "OpenAI-compatible API config could not be read", {
      status: "external_blocked",
      configPath: apiConfigPath,
      reason: String(error.message || error)
    });
  }

  const baseURL = String(raw.base_url || raw.baseURL || "").trim().replace(/\/+$/, "");
  const apiKey = String(raw.api_key || raw.apiKey || "").trim();
  const model = String(options.model || raw.model || "").trim();
  const chatCompletionsPath = String(raw.chat_completions_path || raw.chatCompletionsPath || "/chat/completions").trim();

  if (!baseURL || !model || !apiKey) {
    throw sdkError("sdk_config_invalid", "OpenAI-compatible API config is missing base_url, model, or api_key", {
      status: "external_blocked",
      configPath: apiConfigPath,
      hasBaseURL: Boolean(baseURL),
      hasModel: Boolean(model),
      hasApiKey: Boolean(apiKey)
    });
  }

  return {
    apiConfigPath,
    baseURL,
    apiKey,
    model,
    chatCompletionsPath,
    client: "openai_sdk",
    hasApiKey: true
  };
}

export async function createChatCompletionWithLocalConfig(options = {}) {
  const config = await readOpenAiCompatibleConfig(options);
  const OpenAIClass = options.OpenAIClass || OpenAI;
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const messages = Array.isArray(options.messages) ? options.messages : [];
  const temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.2;
  const body = {
    model: config.model,
    messages,
    temperature
  };
  const client = new OpenAIClass({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });
  const controller = new AbortController();
  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(new Error(`OpenAI SDK request exceeded ${timeoutMs}ms`)), timeoutMs)
    : null;

  const startedAt = Date.now();
  let completion;
  try {
    completion = await client.chat.completions.create(body, {
      timeout: timeoutMs,
      signal: controller.signal
    });
  } catch (error) {
    throw mapSdkError(error, {
      baseURL: config.baseURL,
      model: config.model,
      timeoutMs,
      latencyMs: Date.now() - startedAt
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  const content = completion?.choices?.[0]?.message?.content;
  if (!content) {
    throw sdkError("model_invalid_response", "OpenAI SDK response did not include choices[0].message.content", {
      status: "external_blocked",
      baseURL: config.baseURL,
      model: config.model,
      client: "openai_sdk",
      latencyMs: Date.now() - startedAt
    });
  }

  const safeRequest = redactSecrets({
    transport: "openai_sdk",
    baseURL: config.baseURL,
    model: config.model,
    client: "openai_sdk",
    timeoutMs,
    body
  });
  const safeResponse = redactSecrets({
    transport: "openai_sdk",
    baseURL: config.baseURL,
    model: config.model,
    client: "openai_sdk",
    latencyMs: Date.now() - startedAt,
    completion
  });

  return {
    content,
    completion,
    safeRequest,
    safeResponse,
    config: safeConfig(config),
    source: {
      mode: "model_generated_real",
      provider: "openai_compatible",
      client: "openai_sdk",
      model: config.model
    },
    latencyMs: Date.now() - startedAt
  };
}

export function safeConfig(config) {
  return {
    apiConfigPath: config.apiConfigPath,
    baseURL: config.baseURL,
    model: config.model,
    chatCompletionsPath: config.chatCompletionsPath,
    client: "openai_sdk",
    hasApiKey: Boolean(config.apiKey || config.hasApiKey)
  };
}

function normalizeTimeoutMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 30_000;
}

function mapSdkError(error, details) {
  const status = Number(error?.status || error?.response?.status || 0);
  const text = `${error?.name || ""} ${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  if (status === 401 || status === 403) {
    return sdkError("sdk_auth_failed", "OpenAI SDK authentication failed", {
      status: "external_blocked",
      ...details,
      httpStatus: status,
      reason: redactString(error?.message || "")
    });
  }
  if (text.includes("abort") || text.includes("timeout") || text.includes("timed out")) {
    return sdkError("sdk_timeout", "OpenAI SDK request timed out", {
      status: "external_blocked",
      ...details,
      httpStatus: status || undefined,
      reason: redactString(error?.message || "")
    });
  }
  if (text.includes("fetch failed") || text.includes("econnrefused") || text.includes("enotfound") || text.includes("network")) {
    return sdkError("sdk_connection_failed", "OpenAI SDK connection failed", {
      status: "external_blocked",
      ...details,
      httpStatus: status || undefined,
      reason: redactString(error?.message || "")
    });
  }
  return sdkError("sdk_request_failed", "OpenAI SDK request failed", {
    status: "external_blocked",
    ...details,
    httpStatus: status || undefined,
    reason: redactString(error?.message || "")
  });
}

function sdkError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = redactSecrets({
    ...details,
    client: "openai_sdk"
  });
  return error;
}
