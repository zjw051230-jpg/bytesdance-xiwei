import { boolToInt, cleanJson, cleanText, intToBool, parseJson, read, requireParentId, safeId, timestamp } from "./utils.js";

export function createRequirementRepository(database) {
  return {
    create(input = {}) {
      const now = timestamp();
      const id = safeId(read(input, "id", "id", null), "req");
      database.prepare(`
        INSERT INTO requirements (
          id, project_id, title, raw_pm_input, dsl_json, readiness_status, ready_for_agent,
          handoff_decision, source_provider, source_model, completion_percent, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requireParentId(read(input, "project_id", "projectId", null), "project_id"),
        cleanText(read(input, "title", "title", "Untitled Requirement")),
        cleanText(read(input, "raw_pm_input", "rawPmInput", "")),
        cleanJson(read(input, "dsl_json", "dslJson", {}), {}),
        cleanText(read(input, "readiness_status", "readinessStatus", "clarify_first")),
        boolToInt(read(input, "ready_for_agent", "readyForAgent", false)),
        cleanText(read(input, "handoff_decision", "handoffDecision", "clarify_first")),
        cleanText(read(input, "source_provider", "sourceProvider", "")),
        cleanText(read(input, "source_model", "sourceModel", "")),
        Number(read(input, "completion_percent", "completionPercent", 0)),
        now,
        now
      );
      return this.getById(id);
    },

    getById(id) {
      return mapRequirement(database.prepare("SELECT * FROM requirements WHERE id = ?").get(id));
    },

    listByParent(projectId) {
      return database
        .prepare("SELECT * FROM requirements WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC")
        .all(projectId)
        .map(mapRequirement);
    },

    list() {
      return database.prepare("SELECT * FROM requirements ORDER BY updated_at DESC, created_at DESC").all().map(mapRequirement);
    },

    update(id, input = {}) {
      const existing = this.getById(id);
      if (!existing) return null;
      database.prepare(`
        UPDATE requirements
        SET project_id = ?, title = ?, raw_pm_input = ?, dsl_json = ?, readiness_status = ?,
          ready_for_agent = ?, handoff_decision = ?, source_provider = ?, source_model = ?,
          completion_percent = ?, updated_at = ?
        WHERE id = ?
      `).run(
        requireParentId(read(input, "project_id", "projectId", existing.project_id), "project_id"),
        cleanText(read(input, "title", "title", existing.title)),
        cleanText(read(input, "raw_pm_input", "rawPmInput", existing.raw_pm_input)),
        cleanJson(read(input, "dsl_json", "dslJson", existing.dsl_json), {}),
        cleanText(read(input, "readiness_status", "readinessStatus", existing.readiness_status)),
        boolToInt(read(input, "ready_for_agent", "readyForAgent", existing.ready_for_agent)),
        cleanText(read(input, "handoff_decision", "handoffDecision", existing.handoff_decision)),
        cleanText(read(input, "source_provider", "sourceProvider", existing.source_provider)),
        cleanText(read(input, "source_model", "sourceModel", existing.source_model)),
        Number(read(input, "completion_percent", "completionPercent", existing.completion_percent)),
        timestamp(),
        id
      );
      return this.getById(id);
    }
  };
}

function mapRequirement(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    raw_pm_input: row.raw_pm_input,
    dsl_json: parseJson(row.dsl_json, {}),
    readiness_status: row.readiness_status,
    ready_for_agent: intToBool(row.ready_for_agent),
    handoff_decision: row.handoff_decision,
    source_provider: row.source_provider,
    source_model: row.source_model,
    completion_percent: row.completion_percent,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
