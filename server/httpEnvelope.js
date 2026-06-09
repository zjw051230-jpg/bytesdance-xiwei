import fs from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "./services/redactionService.js";
import { prepareRunDirectory, relativeOutputDir } from "./services/runStore.js";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
  "access-control-allow-headers": "content-type"
};

export function sendOk(response, data, statusCode = 200) {
  return writeJson(response, statusCode, { ok: true, data, error: null });
}

export function sendError(response, statusCode, code, message, details = {}) {
  return writeJson(response, statusCode, createErrorPayload(code, message, details));
}

export function createErrorPayload(code, message, details = {}) {
  return {
    ok: false,
    data: null,
    error: redactSecrets({
      code,
      message: String(message || "Request failed"),
      details: details || {}
    })
  };
}

export function writeJson(response, statusCode, payload) {
  if (response.destroyed || response.writableEnded) return false;
  const safePayload = redactSecrets(
    payload ?? createErrorPayload("empty_payload", "Empty JSON payload guarded")
  );
  const body = JSON.stringify(safePayload);

  try {
    if (!response.headersSent) {
      response.writeHead(statusCode, jsonHeaders);
    } else {
      response.statusCode = statusCode;
    }
    response.end(body);
    return true;
  } catch {
    return false;
  }
}

export async function sendBackendException(response, error, config = {}, details = {}) {
  let persisted = {};
  try {
    persisted = await writeServerError(config, error, details);
  } catch (persistError) {
    persisted = {
      serverErrorFileWritten: false,
      serverErrorWriteError: String(persistError?.message || persistError)
    };
  }
  return sendError(
    response,
    500,
    "backend_exception",
    safeErrorMessage(error, "Internal backend error"),
    { ...details, ...persisted }
  );
}

export async function writeServerError(config = {}, error, details = {}) {
  const runsRoot = config.runsRoot || path.resolve("runs");
  const existingRunId = details.runId ? String(details.runId) : "";
  const existingOutputDir = details.outputDir ? path.resolve(String(details.outputDir)) : "";
  const prepared = existingRunId && existingOutputDir
    ? { runId: existingRunId, outputDir: existingOutputDir }
    : await prepareRunDirectory(runsRoot);
  const persistedDetails = {
    ...details,
    runId: prepared.runId,
    outputDir: prepared.outputDir,
    relativeOutputDir: relativeOutputDir(prepared.outputDir),
    name: String(error?.name || "Error"),
    stack: error?.stack ? String(error.stack) : ""
  };

  const payload = createErrorPayload(
    "backend_exception",
    safeErrorMessage(error, "Internal backend error"),
    persistedDetails
  );
  await fs.mkdir(prepared.outputDir, { recursive: true });
  await fs.writeFile(
    path.join(prepared.outputDir, "server_error.json"),
    JSON.stringify(payload, null, 2),
    "utf8"
  );

  return {
    runId: prepared.runId,
    outputDir: prepared.outputDir,
    relativeOutputDir: relativeOutputDir(prepared.outputDir)
  };
}

function safeErrorMessage(error, fallback) {
  return String(error?.message || error || fallback);
}
