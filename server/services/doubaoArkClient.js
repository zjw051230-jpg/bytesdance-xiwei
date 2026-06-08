import fs from "node:fs/promises";
import { redactSecrets, redactString } from "./redactionService.js";

export const DEFAULT_DOUBAO_ARK_CONFIG_PATH = "F:\\dsl-v2\\configs\\api_config.local.json";
export const DEFAULT_DOUBAO_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
export const DEFAULT_DOUBAO_ARK_PATH = "/chat/completions";

export async function readDoubaoArkConfig(options = {}) {
  const configPath = options.configPath || options.doubaoApiConfigPath || process.env.DOUBAO_API_CONFIG || DEFAULT_DOUBAO_ARK_CONFIG_PATH;
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    throw doubaoError("doubao_config_missing", "Doubao Ark API config could not be read", {
      status: "external_blocked",
      configPath,
      reason: String(error.message || error)
    });
  }

  const provider = String(raw.provider || "").trim();
  const endpointId = String(raw.endpoint_id || raw.endpointId || "").trim();
  const model = String(options.endpointId || options.model || raw.model || endpointId || "").trim();
  const apiKey = String(raw.api_key || raw.apiKey || "").trim();
  const baseURL = String(options.baseURL || raw.base_url || raw.baseURL || DEFAULT_DOUBAO_ARK_BASE_URL).trim().replace(/\/+$/, "");
  const chatCompletionsPath = String(raw.chat_completions_path || raw.chatCompletionsPath || DEFAULT_DOUBAO_ARK_PATH).trim();
  const timeoutSeconds = normalizeOptionalSeconds(raw.timeout_seconds ?? raw.timeoutSeconds);
  const maxRetries = normalizeOptionalInteger(raw.max_retries ?? raw.maxRetries);

  if (provider !== "doubao_ark") {
    throw doubaoError("doubao_config_missing", "Doubao Ark config provider is not doubao_ark", {
      status: "external_blocked",
      configPath,
      provider: provider || "missing"
    });
  }
  if (!model) {
    throw doubaoError("doubao_endpoint_missing", "Doubao Ark model or endpoint_id is missing", {
      status: "external_blocked",
      configPath,
      provider
    });
  }
  if (!apiKey) {
    throw doubaoError("doubao_key_missing", "Doubao Ark api_key is missing", {
      status: "external_blocked",
      configPath,
      provider,
      model
    });
  }

  return {
    configPath,
    provider,
    baseURL,
    chatCompletionsPath,
    endpointId,
    model,
    apiKey,
    client: "doubao_ark",
    hasApiKey: true,
    timeoutSeconds,
    maxRetries
  };
}

export async function createDoubaoChatCompletionWithLocalConfig(options = {}) {
  const config = await readDoubaoArkConfig(options);
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const messages = Array.isArray(options.messages) ? options.messages : [];
  const body = {
    model: config.model,
    messages
  };
  if (Number.isFinite(Number(options.temperature))) body.temperature = Number(options.temperature);

  const controller = new AbortController();
  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(new Error(`Doubao Ark request exceeded ${timeoutMs}ms`)), timeoutMs)
    : null;
  const fetchImpl = options.fetchImpl || fetch;
  const endpoint = `${config.baseURL}${config.chatCompletionsPath}`;
  const startedAt = Date.now();

  let response;
  let payload;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const rawText = await response.text();
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch (error) {
      throw doubaoError("doubao_invalid_json", "Doubao Ark HTTP response was not valid JSON", {
        status: "external_blocked",
        provider: "doubao_ark",
        client: "doubao_ark",
        model: config.model,
        baseURL: config.baseURL,
        latencyMs: Date.now() - startedAt,
        reason: redactForKey(String(error.message || error), config.apiKey)
      });
    }
    if (!response.ok) {
      throw mapDoubaoHttpError(response, payload, config, Date.now() - startedAt);
    }
  } catch (error) {
    if (error?.code?.startsWith("doubao_")) throw error;
    throw mapDoubaoTransportError(error, config, Date.now() - startedAt);
  } finally {
    if (timer) clearTimeout(timer);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw doubaoError("model_invalid_response", "Doubao Ark response did not include choices[0].message.content", {
      status: "external_blocked",
      provider: "doubao_ark",
      client: "doubao_ark",
      model: config.model,
      baseURL: config.baseURL,
      latencyMs: Date.now() - startedAt
    });
  }

  const safeRequest = redactForKeyInPayload({
    transport: "doubao_ark",
    provider: "doubao_ark",
    baseURL: config.baseURL,
    path: config.chatCompletionsPath,
    model: config.model,
    client: "doubao_ark",
    timeoutMs,
    headers: {
      authorization: `Bearer ${config.apiKey}`
    },
    body
  }, config.apiKey);
  const safeResponse = redactForKeyInPayload({
    transport: "doubao_ark",
    provider: "doubao_ark",
    baseURL: config.baseURL,
    path: config.chatCompletionsPath,
    model: config.model,
    client: "doubao_ark",
    latencyMs: Date.now() - startedAt,
    response: payload
  }, config.apiKey);

  return {
    content,
    completion: payload,
    safeRequest,
    safeResponse,
    config: safeConfig(config),
    source: {
      mode: "model_generated_real",
      provider: "doubao_ark",
      client: "doubao_ark",
      model: config.model
    },
    latencyMs: Date.now() - startedAt
  };
}

export function safeConfig(config) {
  return {
    configPath: config.configPath,
    provider: "doubao_ark",
    baseURL: config.baseURL,
    chatCompletionsPath: config.chatCompletionsPath,
    model: config.model,
    endpointId: config.endpointId,
    client: "doubao_ark",
    hasApiKey: Boolean(config.apiKey || config.hasApiKey),
    timeoutSeconds: config.timeoutSeconds,
    maxRetries: config.maxRetries
  };
}

function mapDoubaoHttpError(response, payload, config, latencyMs) {
  const reason = redactForKey(payload?.error?.message || payload?.message || response.statusText || "", config.apiKey);
  const details = {
    status: "external_blocked",
    provider: "doubao_ark",
    client: "doubao_ark",
    model: config.model,
    baseURL: config.baseURL,
    httpStatus: response.status,
    latencyMs,
    reason
  };
  if (response.status === 401 || response.status === 403) {
    return doubaoError("doubao_auth_failed", "Doubao Ark authentication failed", details);
  }
  return doubaoError("doubao_http_error", "Doubao Ark HTTP request failed", details);
}

function mapDoubaoTransportError(error, config, latencyMs) {
  const text = `${error?.name || ""} ${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  if (text.includes("abort") || text.includes("timeout") || text.includes("timed out")) {
    return doubaoError("doubao_timeout", "Doubao Ark request timed out", {
      status: "external_blocked",
      provider: "doubao_ark",
      client: "doubao_ark",
      model: config.model,
      baseURL: config.baseURL,
      latencyMs,
      reason: redactForKey(error?.message || "", config.apiKey)
    });
  }
  return doubaoError("doubao_http_error", "Doubao Ark request failed", {
    status: "external_blocked",
    provider: "doubao_ark",
    client: "doubao_ark",
    model: config.model,
    baseURL: config.baseURL,
    latencyMs,
    reason: redactForKey(error?.message || "", config.apiKey)
  });
}

function doubaoError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = redactSecrets({
    provider: "doubao_ark",
    client: "doubao_ark",
    ...details
  });
  return error;
}

function redactForKey(text, apiKey) {
  const redacted = redactString(text);
  return apiKey ? redacted.split(apiKey).join("***REDACTED***") : redacted;
}

function redactForKeyInPayload(value, apiKey) {
  return redactSecrets(replaceExactSecret(value, apiKey));
}

function replaceExactSecret(value, secret) {
  if (!secret) return value;
  if (Array.isArray(value)) return value.map((item) => replaceExactSecret(item, secret));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceExactSecret(item, secret)])
    );
  }
  if (typeof value === "string") return value.split(secret).join("***REDACTED***");
  return value;
}

function normalizeTimeoutMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 30_000;
}

function normalizeOptionalSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeOptionalInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}
