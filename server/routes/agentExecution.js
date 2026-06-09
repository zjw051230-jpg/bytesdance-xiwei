import { sendError, writeJson } from "../httpEnvelope.js";
import {
  cancelAgentRun,
  getAgentArtifacts,
  getAgentReadiness,
  getAgentRun,
  inspectAgent1,
  startAgentRun
} from "../services/agentExecutionService.js";

export async function handleAgentExecutionRoutes(request, response, config = {}) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/agent")) return false;
  if (/^\/api\/agent\/runs\/[^/]+\/(events|review)$/.test(url.pathname)) return false;

  if (request.method === "GET" && url.pathname === "/api/agent/inventory") {
    writeJson(response, 200, { ok: true, data: await inspectAgent1(), error: null });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/agent/readiness") {
    const body = await readJsonBody(request);
    if (!body.ok) {
      sendError(response, 400, "bad_request", "Invalid JSON body", { reason: body.error });
      return true;
    }
    writeJson(response, 200, { ok: true, data: await getAgentReadiness(body.data), error: null });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/agent/run") {
    const body = await readJsonBody(request);
    if (!body.ok) {
      sendError(response, 400, "bad_request", "Invalid JSON body", { reason: body.error });
      return true;
    }
    const result = await startAgentRun(body.data, config);
    writeJson(response, result.ok ? 200 : 403, result);
    return true;
  }

  const match = url.pathname.match(/^\/api\/agent\/runs\/([^/]+)(?:\/(cancel|artifacts))?$/);
  if (match) {
    const runId = decodeURIComponent(match[1]);
    const action = match[2] || "";
    const result = action === "cancel" && request.method === "POST"
      ? cancelAgentRun(runId)
      : action === "artifacts" && request.method === "GET"
        ? getAgentArtifacts(runId)
        : !action && request.method === "GET"
          ? getAgentRun(runId)
          : null;
    if (!result) {
      sendError(response, 404, "not_found", "Agent route not found", { runId, action });
      return true;
    }
    writeJson(response, result.ok ? 200 : 404, result);
    return true;
  }

  sendError(response, 404, "not_found", "Agent route not found");
  return true;
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    request.on("end", () => {
      try {
        resolve({ ok: true, data: raw ? JSON.parse(raw) : {} });
      } catch (error) {
        resolve({ ok: false, error: String(error.message || error) });
      }
    });
    request.on("error", (error) => resolve({ ok: false, error: String(error.message || error) }));
  });
}
