import { cleanJson, cleanNullableText, cleanText, parseJson, read, safeId, timestamp } from "./utils.js";

export function createActivityLogRepository(database) {
  return {
    create(input = {}) {
      const id = safeId(read(input, "id", "id", null), "activity");
      database.prepare(`
        INSERT INTO activity_logs (id, project_id, requirement_id, run_id, type, level, message, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        cleanNullableText(read(input, "project_id", "projectId", null)),
        cleanNullableText(read(input, "requirement_id", "requirementId", null)),
        cleanNullableText(read(input, "run_id", "runId", null)),
        cleanText(read(input, "type", "type", "event")),
        cleanText(read(input, "level", "level", "info")),
        cleanText(read(input, "message", "message", "")),
        cleanJson(read(input, "payload_json", "payloadJson", {}), {}),
        timestamp()
      );
      return this.getById(id);
    },

    getById(id) {
      return mapActivityLog(database.prepare("SELECT * FROM activity_logs WHERE id = ?").get(id));
    },

    listByParent(projectId) {
      return database
        .prepare("SELECT * FROM activity_logs WHERE project_id = ? ORDER BY created_at DESC")
        .all(projectId)
        .map(mapActivityLog);
    },

    listByRun(runId) {
      return database
        .prepare("SELECT * FROM activity_logs WHERE run_id = ? ORDER BY created_at DESC")
        .all(runId)
        .map(mapActivityLog);
    },

    list() {
      return database.prepare("SELECT * FROM activity_logs ORDER BY created_at DESC").all().map(mapActivityLog);
    },

    update(id, input = {}) {
      const existing = this.getById(id);
      if (!existing) return null;
      database.prepare(`
        UPDATE activity_logs
        SET project_id = ?, requirement_id = ?, run_id = ?, type = ?, level = ?, message = ?, payload_json = ?
        WHERE id = ?
      `).run(
        cleanNullableText(read(input, "project_id", "projectId", existing.project_id)),
        cleanNullableText(read(input, "requirement_id", "requirementId", existing.requirement_id)),
        cleanNullableText(read(input, "run_id", "runId", existing.run_id)),
        cleanText(read(input, "type", "type", existing.type)),
        cleanText(read(input, "level", "level", existing.level)),
        cleanText(read(input, "message", "message", existing.message)),
        cleanJson(read(input, "payload_json", "payloadJson", existing.payload_json), {}),
        id
      );
      return this.getById(id);
    }
  };
}

function mapActivityLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    requirement_id: row.requirement_id,
    run_id: row.run_id,
    type: row.type,
    level: row.level,
    message: row.message,
    payload_json: parseJson(row.payload_json, {}),
    created_at: row.created_at
  };
}
