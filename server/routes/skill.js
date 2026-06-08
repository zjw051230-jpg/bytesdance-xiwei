import { sendError, writeJson } from "../httpEnvelope.js";
import { runSkillTurn } from "../services/skillOrchestrator.js";

export async function handleSkillRoutes(request, response, config) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/skill")) return false;
  if (url.pathname !== "/api/skill/pm-dsl-turn" || request.method !== "POST") return false;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    sendError(response, 400, "bad_request", "Invalid JSON body", { reason: bodyResult.error });
    return true;
  }

  const payload = await runSkillTurn(bodyResult.data, skillRouteConfig(config));
  writeJson(response, payload.ok ? 200 : statusFromError(payload.error?.code), payload);
  return true;
}

function skillRouteConfig(config = {}) {
  const skillConfig = { ...config };
  if (!skillConfig.skillApiConfigPath && !process.env.SKILL_MODEL_API_CONFIG) {
    delete skillConfig.apiConfigPath;
  }
  return skillConfig;
}

function statusFromError(code) {
  if (code === "bad_request") return 400;
  if (code === "skill_prompt_missing" || code === "skill_wrapper_missing") return 503;
  if ([
    "skill_model_unavailable",
    "model_invalid_response",
    "sdk_auth_failed",
    "sdk_timeout",
    "sdk_connection_failed",
    "sdk_request_failed",
    "sdk_config_missing",
    "sdk_config_invalid",
    "doubao_config_missing",
    "doubao_key_missing",
    "doubao_endpoint_missing",
    "doubao_auth_failed",
    "doubao_timeout",
    "doubao_invalid_json",
    "doubao_http_error"
  ].includes(code)) return 503;
  return 500;
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    let raw = "";
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      raw += chunk.toString("utf8");
      if (raw.length > 2_000_000) {
        tooLarge = true;
        raw = "";
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        resolve({ ok: false, error: "request body too large" });
        return;
      }
      try {
        resolve({ ok: true, data: raw ? JSON.parse(raw) : {} });
      } catch (error) {
        resolve({ ok: false, error: String(error.message || error) });
      }
    });
    request.on("error", (error) => {
      resolve({ ok: false, error: String(error.message || error) });
    });
  });
}
