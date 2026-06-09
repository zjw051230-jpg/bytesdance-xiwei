import { sendError, sendOk } from "../httpEnvelope.js";
import { openWorkbenchDatabase } from "../db/connection.js";
import { migrateDatabase } from "../db/migrate.js";
import { seedWorkbenchDatabase } from "../db/seed.js";
import { createPersistenceService } from "../services/persistence/persistenceService.js";

export async function handlePersistenceRoutes(request, response, config = {}) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (!isPersistencePath(url.pathname)) return false;

  const database = openWorkbenchDatabase({ dbPath: config.workbenchDbPath });
  try {
    migrateDatabase(database);
    seedWorkbenchDatabase(database);
    const service = createPersistenceService(database);
    const body = ["POST", "PATCH"].includes(request.method) ? await readJsonBody(request) : {};
    const result = routeRequest({ method: request.method, url, body, service });
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

function routeRequest({ method, url, body, service }) {
  const path = decodeURIComponent(url.pathname);

  if (method === "GET" && path === "/api/projects") return { data: service.projects.list() };
  if (method === "POST" && path === "/api/projects") return { data: service.projects.create(body), status: 201 };

  let match = path.match(/^\/api\/projects\/([^/]+)$/);
  if (match && method === "GET") return getOr404(service.projects.get(match[1]), "project_not_found");
  if (match && method === "PATCH") return getOr404(service.projects.update(match[1], body), "project_not_found");

  match = path.match(/^\/api\/projects\/([^/]+)\/requirements$/);
  if (match && method === "GET") return { data: service.requirements.list(match[1]) };
  if (match && method === "POST") return { data: service.requirements.create(match[1], body), status: 201 };

  match = path.match(/^\/api\/requirements\/([^/]+)$/);
  if (match && method === "GET") return getOr404(service.requirements.get(match[1]), "requirement_not_found");
  if (match && method === "PATCH") return getOr404(service.requirements.update(match[1], body), "requirement_not_found");

  match = path.match(/^\/api\/requirements\/([^/]+)\/clarifications$/);
  if (match && method === "GET") return { data: service.clarifications.list(match[1]) };
  if (match && method === "POST") return { data: service.clarifications.create(match[1], body), status: 201 };

  match = path.match(/^\/api\/requirements\/([^/]+)\/design-plan$/);
  if (match && method === "GET") return getOr404(service.designPlans.getByRequirement(match[1]), "design_plan_not_found");
  if (match && method === "POST") return { data: service.designPlans.upsert(match[1], body), status: 201 };

  match = path.match(/^\/api\/design-plans\/([^/]+)$/);
  if (match && method === "PATCH") return getOr404(service.designPlans.update(match[1], body), "design_plan_not_found");

  match = path.match(/^\/api\/design-plans\/([^/]+)\/tasks$/);
  if (match && method === "GET") return { data: service.planningTasks.list(match[1]) };
  if (match && method === "POST") return { data: service.planningTasks.create(match[1], body), status: 201 };

  match = path.match(/^\/api\/planning-tasks\/([^/]+)$/);
  if (match && method === "PATCH") return getOr404(service.planningTasks.update(match[1], body), "planning_task_not_found");

  match = path.match(/^\/api\/agent\/runs\/([^/]+)$/);
  if (match && method === "GET") return getOr404(service.agentRuns.get(match[1]), "agent_run_not_found");

  match = path.match(/^\/api\/agent\/runs\/([^/]+)\/artifacts$/);
  if (match && method === "GET") return { data: service.agentArtifacts.list(match[1]) };

  match = path.match(/^\/api\/agent\/runs\/([^/]+)\/events$/);
  if (match && method === "GET") return { data: service.activity.listByRun(match[1]) };

  match = path.match(/^\/api\/agent\/runs\/([^/]+)\/review$/);
  if (match && method === "GET") return { data: service.reviewItems.listByRun(match[1]) };

  match = path.match(/^\/api\/review-items\/([^/]+)$/);
  if (match && method === "PATCH") return getOr404(service.reviewItems.update(match[1], body), "review_item_not_found");

  match = path.match(/^\/api\/requirements\/([^/]+)\/pr-draft$/);
  if (match && method === "GET") return getOr404(service.prDrafts.getByRequirement(match[1]), "pr_draft_not_found");
  if (match && method === "POST") return { data: service.prDrafts.upsert(match[1], body), status: 201 };

  match = path.match(/^\/api\/pr-drafts\/([^/]+)$/);
  if (match && method === "PATCH") return getOr404(service.prDrafts.update(match[1], body), "pr_draft_not_found");

  match = path.match(/^\/api\/projects\/([^/]+)\/activity$/);
  if (match && method === "GET") return { data: service.activity.listByProject(match[1]) };

  return null;
}

function getOr404(data, code) {
  if (data) return { data };
  return { error: { code, message: code.replaceAll("_", " ") }, status: 404 };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}
