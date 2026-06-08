import fs from "node:fs/promises";
import path from "node:path";
import {
  createChatCompletionWithLocalConfig,
  readOpenAiCompatibleConfig
} from "../server/services/openAiCompatibleClient.js";

const outDir = path.resolve("reporting");
const outPath = path.join(outDir, "skill-model-sdk-check-result.json");
await fs.mkdir(outDir, { recursive: true });

const started = Date.now();
const result = {
  attempted: true,
  status: "unknown",
  endpoint: "",
  baseURL: "",
  model: "",
  latencyMs: 0,
  errorCode: "",
  error: null
};

try {
  const config = await readOpenAiCompatibleConfig();
  result.baseURL = config.baseURL;
  result.endpoint = `${config.baseURL}${config.chatCompletionsPath}`;
  result.model = config.model;

  const completion = await createChatCompletionWithLocalConfig({
    messages: [
      { role: "system", content: "Return JSON only." },
      { role: "user", content: "Return exactly {\"ok\":true} and nothing else." }
    ],
    timeoutMs: 30_000,
    temperature: 0
  });
  const parsed = parseJsonObject(completion.content);
  result.latencyMs = Date.now() - started;
  result.status = parsed?.ok === true ? "passed" : "model_invalid_json";
  if (result.status !== "passed") result.errorCode = "model_invalid_json";
} catch (error) {
  result.latencyMs = Date.now() - started;
  result.status = "external_blocked";
  result.errorCode = error.code || "sdk_request_failed";
  result.error = error.message || String(error);
  if (error.details?.baseURL) result.baseURL = error.details.baseURL;
  if (error.details?.model) result.model = error.details.model;
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
