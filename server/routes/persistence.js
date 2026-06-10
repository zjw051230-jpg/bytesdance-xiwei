import { sendError, sendOk } from "../httpEnvelope.js";
import { openWorkbenchDatabase } from "../db/connection.js";
import { migrateDatabase } from "../db/migrate.js";
import { seedWorkbenchDatabase } from "../db/seed.js";
import { createPersistenceService } from "../services/persistence/persistenceService.js";
import {
  createRunCheckpoint,
  getRunChangeDiff,
  listRunChanges,
  resetRunWorkspace,
  revertRunFile
} from "../services/rollbackService.js";

export async function handlePersistenceRoutes(request, response, config = {}) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (!isPersistencePath(url.pathname)) return false;

  const database = openWorkbenchDatabase({ dbPath: config.workbenchDbPath });
  try {
    migrateDatabase(database);
    seedWorkbenchDatabase(database);
    const service = createPersistenceService(database);
    const bodyResult = ["POST", "PATCH"].includes(request.method) ? await readJsonBody(request) : { ok: true, data: {} };
    if (!bodyResult.ok) {
      sendError(response, 400, "bad_request", "Invalid JSON body", { reason: bodyResult.error });
      return true;
    }
    const body = bodyResult.data;
    const result = await routeSafely({ method: request.method, url, body, service, config });
    if (!result) {
      sendError(response, 404, "not_found", "Persistence route not found");
    } else if (result.error) {
      sendError(response, result.status || 400, result.error.code, result.error.message, result.error.details || {});
    } else {
      sendOk(response, result.data, result.status || 200);
    }
    return true;
  } finally {
    database.close();
  }
}

function isPersistencePath(pathname) {
  return pathname === "/api/projects" ||
    pathname.startsWith("/api/projects/") ||
    pathname.startsWith("/api/requirements/") ||
    pathname.startsWith("/api/design-plans/") ||
    pathname.startsWith("/api/planning-tasks/") ||
    pathname.startsWith("/api/agent/runs/") ||
    pathname.startsWith("/api/review-items/") ||
    pathname.startsWith("/api/pr-drafts/");
}

async function routeRequest({ method, url, body, service, config }) {
  const path = decodeURIComponent(url.pathname);

  if (method === "GET" && path === "/api/projects") return { data: service.projects.list() };
  if (method === "POST" && path === "/api/projects") {
    if (!String(body?.name || "").trim()) {
      return {
        error: {
          code: "validation_failed",
          message: "Project name is required",
          details: { field: "name" }
        },
        status: 422
      };
    }
    return { data: service.projects.create(body), status: 201 };
  }

  let match = path.match(/^\/api\/projects\/([^/]+)$/);
  if (match && method === "GET") return getOr404(service.projects.get(match[1]), "project_not_found");
  if (match && method === "PATCH") return getOr404(service.projects.update(match[1], body), "project_not_found");
  if (match && method === "DELETE") return getOr404(service.projects.delete(match[1]), "project_not_found");

  match = path.match(/^\/api\/projects\/([^/]+)\/requirements$/);
  if (match && method === "GET") {
    const missing = requireProject(service, match[1]);
    if (missing) return missing;
    return { data: service.requirements.list(match[1]) };
  }
  if (match && method === "POST") {
    const missing = requireProject(service, match[1]);
    if (missing) return missing;
    const invalid = requireOneText(body, ["title", "rawPmInput", "raw_pm_input"], "title or rawPmInput");
    if (invalid) return invalid;
    return { data: service.requirements.create(match[1], body), status: 201 };
  }

  match = path.match(/^\/api\/requirements\/([^/]+)$/);
  if (match && method === "GET") return getOr404(service.requirements.get(match[1]), "requirement_not_found");
  if (match && method === "PATCH") return getOr404(service.requirements.update(match[1], body), "requirement_not_found");

  match = path.match(/^\/api\/requirements\/([^/]+)\/clarifications$/);
  if (match && method === "GET") {
    const missing = requireRequirement(service, match[1]);
    if (missing) return missing;
    return { data: service.clarifications.list(match[1]) };
  }
  if (match && method === "POST") {
    const missing = requireRequirement(service, match[1]);
    if (missing) return missing;
    const invalid = requireText(body.content || body.text, "content");
    if (invalid) return invalid;
    return { data: service.clarifications.create(match[1], body), status: 201 };
  }

  match = path.match(/^\/api\/requirements\/([^/]+)\/design-plan$/);
  if (match && method === "GET") {
    const missing = requireRequirement(service, match[1]);
    if (missing) return missing;
    return getOr404(service.designPlans.getByRequirement(match[1]), "design_plan_not_found");
  }
  if (match && method === "POST") {
    const missing = requireRequirement(service, match[1]);
    if (missing) return missing;
    return { data: service.designPlans.upsert(match[1], body), status: 201 };
  }

  match = path.match(/^\/api\/design-plans\/([^/]+)$/);
  if (match && method === "PATCH") return getOr404(service.designPlans.update(match[1], body), "design_plan_not_found");

  match = path.match(/^\/api\/design-plans\/([^/]+)\/tasks$/);
  if (match && method === "GET") {
    const missing = requireDesignPlan(service, match[1]);
    if (missing) return missing;
    return { data: service.planningTasks.list(match[1]) };
  }
  if (match && method === "POST") {
    const missing = requireDesignPlan(service, match[1]);
    if (missing) return missing;
    const invalid = requireText(body.title || body.task, "title");
    if (invalid) return invalid;
    return { data: service.planningTasks.create(match[1], body), status: 201 };
  }

  match = path.match(/^\/api\/planning-tasks\/([^/]+)$/);
  if (match && method === "PATCH") return getOr404(service.planningTasks.update(match[1], body), "task_not_found");

  match = path.match(/^\/api\/agent\/runs\/([^/]+)$/);
  if (match && method === "GET") return getOr404(service.agentRuns.get(match[1]), "agent_run_not_found");

  match = path.match(/^\/api\/agent\/runs\/([^/]+)\/artifacts$/);
  if (match && method === "GET") {
    const missing = requireAgentRun(service, match[1]);
    if (missing) return missing;
    return { data: { runId: match[1], artifactList: service.agentArtifacts.list(match[1]) } };
  }

  match = path.match(/^\/api\/agent\/runs\/([^/]+)\/events$/);
  if (match && method === "GET") {
    const missing = requireAgentRun(service, match[1]);
    if (missing) return missing;
    return { data: service.activity.listByRun(match[1]) };
  }

  match = path.match(/^\/api\/agent\/runs\/([^/]+)\/review$/);
  if (match && method === "GET") {
    const missing = requireAgentRun(service, match[1]);
    if (missing) return missing;
    return { data: service.reviewItems.listByRun(match[1]) };
  }

  match = path.match(/^\/api\/agent\/runs\/([^/]+)\/changes$/);
  if (match && method === "GET") {
    const result = await listRunChanges(service, match[1]);
    return unwrapServiceResult(result);
  }

  match = path.match(/^\/api\/agent\/runs\/([^/]+)\/changes\/([^/]+)\/diff$/);
  if (match && method === "GET") {
    const result = await getRunChangeDiff(service, match[1], match[2], config);
    return unwrapServiceResult(result);
  }

  match = path.match(/^\/api\/agent\/runs\/([^/]+)\/rollback\/file$/);
  if (match && method === "POST") {
    const result = await revertRunFile(service, match[1], body, config);
    return unwrapServiceResult(result);
  }

  match = path.match(/^\/api\/agent\/runs\/([^/]+)\/rollback$/);
  if (match && method === "POST") {
    const result = await resetRunWorkspace(service, match[1], body, config);
    return unwrapServiceResult(result);
  }

  match = path.match(/^\/api\/agent\/runs\/([^/]+)\/checkpoints$/);
  if (match && method === "POST") {
    const result = await createRunCheckpoint(service, match[1], body, config);
    return unwrapServiceResult(result);
  }

  match = path.match(/^\/api\/review-items\/([^/]+)$/);
  if (match && method === "PATCH") return getOr404(service.reviewItems.update(match[1], body), "review_item_not_found");

  match = path.match(/^\/api\/requirements\/([^/]+)\/pr-draft$/);
  if (match && method === "GET") {
    const missing = requireRequirement(service, match[1]);
    if (missing) return missing;
    return getOr404(service.prDrafts.getByRequirement(match[1]), "pr_draft_not_found");
  }
  if (match && method === "POST") {
    const missing = requireRequirement(service, match[1]);
    if (missing) return missing;
    return { data: service.prDrafts.upsert(match[1], body), status: 201 };
  }

  match = path.match(/^\/api\/pr-drafts\/([^/]+)$/);
  if (match && method === "PATCH") return getOr404(service.prDrafts.update(match[1], body), "pr_draft_not_found");

  match = path.match(/^\/api\/projects\/([^/]+)\/activity$/);
  if (match && method === "GET") {
    const missing = requireProject(service, match[1]);
    if (missing) return missing;
    return { data: service.activity.listByProject(match[1]) };
  }

  return null;
}

async function routeSafely(args) {
  try {
    return await routeRequest(args);
  } catch (error) {
    return {
      error: {
        code: "db_error",
        message: "Database request failed",
        details: {
          name: String(error?.name || "Error"),
          code: String(error?.code || "")
        }
      },
      status: 500
    };
  }
}

function unwrapServiceResult(result) {
  if (result?.ok) return { data: result.data, status: result.status || 200 };
  return {
    error: result?.error || { code: "request_failed", message: "Request failed", details: {} },
    status: result?.status || 400
  };
}

function getOr404(data, code) {
  if (data) return { data };
  return { error: { code, message: code.replaceAll("_", " ") }, status: 404 };
}

function requireProject(service, projectId) {
  return service.projects.get(projectId) ? null : getOr404(null, "project_not_found");
}

function requireRequirement(service, requirementId) {
  return service.requirements.get(requirementId) ? null : getOr404(null, "requirement_not_found");
}

function requireDesignPlan(service, planId) {
  return service.designPlans.get(planId) ? null : getOr404(null, "design_plan_not_found");
}

function requireAgentRun(service, runId) {
  return service.agentRuns.get(runId) ? null : getOr404(null, "agent_run_not_found");
}

function requireText(value, field) {
  if (String(value ?? "").trim()) return null;
  return validationError(`${field} is required`, { field });
}

function requireOneText(body, fields, label) {
  if (fields.some((field) => String(body?.[field] ?? "").trim())) return null;
  return validationError(`${label} is required`, { fields });
}

function validationError(message, details = {}) {
  return {
    error: { code: "validation_failed", message, details },
    status: 422
  };
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (!raw.trim()) return resolve({ ok: true, data: {} });
      try {
        resolve({ ok: true, data: JSON.parse(raw) });
      } catch (error) {
        resolve({ ok: false, error: String(error.message || error) });
      }
    });
    request.on("error", (error) => resolve({ ok: false, error: String(error.message || error) }));
  });
}
