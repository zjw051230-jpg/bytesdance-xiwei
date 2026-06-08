import fs from "node:fs/promises";
import path from "node:path";
import {
  createDoubaoChatCompletionWithLocalConfig,
  readDoubaoArkConfig
} from "../server/services/doubaoArkClient.js";

const outDir = path.resolve("reporting");
const outPath = path.join(outDir, "doubao-ark-check-result.json");
await fs.mkdir(outDir, { recursive: true });

const started = Date.now();
const result = {
  attempted: true,
  status: "unknown",
  provider: "doubao_ark",
  baseURL: "",
  model: "",
  apiKeyPresent: false,
  latencyMs: 0,
  errorCode: "",
  error: null
};

try {
  const config = await readDoubaoArkConfig();
  result.provider = config.provider;
  result.baseURL = config.baseURL;
  result.model = config.model;
  result.apiKeyPresent = config.hasApiKey === true;

  const completion = await createDoubaoChatCompletionWithLocalConfig({
    messages: [
      { role: "system", content: "Return JSON only." },
      { role: "user", content: "Return JSON only: {\"ok\": true}" }
    ],
    timeoutMs: 30_000,
    temperature: 0
  });
  const parsed = parseJsonObject(completion.content);
  result.latencyMs = Date.now() - started;
  result.status = parsed?.ok === true ? "passed" : "external_blocked";
  if (result.status !== "passed") result.errorCode = "doubao_invalid_json";
} catch (error) {
  result.latencyMs = Date.now() - started;
  result.status = ["doubao_config_missing", "doubao_key_missing", "doubao_endpoint_missing"].includes(error.code)
    ? error.code.replace("doubao_", "")
    : "external_blocked";
  result.errorCode = error.code || "doubao_http_error";
  result.error = error.message || String(error);
  if (error.details?.model) result.model = error.details.model;
  if (error.details?.provider) result.provider = error.details.provider;
  if (error.details?.baseURL) result.baseURL = error.details.baseURL;
} finally {
  await fs.writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") process.exitCode = 1;
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim());
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    return null;
  }
}
