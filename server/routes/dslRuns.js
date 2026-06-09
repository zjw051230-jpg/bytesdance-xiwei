import { sendBackendException, sendError, writeJson } from "../httpEnvelope.js";
import {
  cancelDslRunJob,
  createDslRun,
  getDslRunArtifacts,
  getDslRunJob,
  retryDslRunJob,
  startDslRunJob
} from "../services/runnerService.js";

export async function handleDslRuns(request, response, config) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/dsl/runs")) return false;
  try {
    if (url.pathname === "/api/dsl/runs/start" && request.method === "POST") {
      const bodyResult = await readJsonBody(request);
      if (!bodyResult.ok) {
        sendError(response, 400, "bad_request", "Invalid JSON body", { reason: bodyResult.error });
        return true;
      }
      if (config.forceDslRouteException || process.env.FORCE_DSL_ROUTE_EXCEPTION === "1") {
        throw new Error("Forced DSL route exception for empty response regression");
      }
      const payload = await startDslRunJob(bodyResult.data, config);
      writeJson(response, payload.ok ? 202 : statusFromError(payload.error?.code), payload);
      return true;
    }

    const runRoute = matchRunRoute(url.pathname);
    if (runRoute && request.method === "GET" && runRoute.action === "status") {
      const payload = getDslRunJob(runRoute.runId);
      writeJson(response, payload.ok ? 200 : statusFromError(payload.error?.code), payload);
      return true;
    }
    if (runRoute && request.method === "GET" && runRoute.action === "artifacts") {
      const payload = await getDslRunArtifacts(runRoute.runId);
      writeJson(response, payload.ok ? 200 : statusFromError(payload.error?.code), payload);
      return true;
    }
    if (runRoute && request.method === "POST" && runRoute.action === "cancel") {
      const payload = await cancelDslRunJob(runRoute.runId);
      writeJson(response, payload.ok ? 200 : statusFromError(payload.error?.code), payload);
      return true;
    }
    if (runRoute && request.method === "POST" && runRoute.action === "retry") {
      const payload = await retryDslRunJob(runRoute.runId, config);
      writeJson(response, payload.ok ? 202 : statusFromError(payload.error?.code), payload);
      return true;
    }

    if (url.pathname !== "/api/dsl/runs" || request.method !== "POST") return false;
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) {
      sendError(response, 400, "bad_request", "Invalid JSON body", { reason: bodyResult.error });
      return true;
    }
    if (config.forceDslRouteException || process.env.FORCE_DSL_ROUTE_EXCEPTION === "1") {
      throw new Error("Forced DSL route exception for empty response regression");
    }
    const body = bodyResult.data;
    const payload = await createDslRun(body, config);
    writeJson(response, payload.ok ? 200 : statusFromError(payload.error?.code), payload);
    return true;
  } catch (error) {
    await sendBackendException(response, error, config);
    return true;
  }
}

function statusFromError(code) {
  if (code === "bad_request") return 400;
  if (code === "not_found") return 404;
  if (["config_missing", "runner_missing", "standalone_runner_missing", "standalone_config_missing"].includes(code)) return 503;
  return 500;
}

function matchRunRoute(pathname) {
  const match = pathname.match(/^\/api\/dsl\/runs\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  const [, runId, action = "status"] = match;
  if (!/^RUN-[A-Z0-9-]+$/i.test(runId)) return null;
  if (!["status", "artifacts", "cancel", "retry"].includes(action)) return null;
  return { runId, action };
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

export { writeJson };
