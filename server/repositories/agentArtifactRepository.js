import { cleanText, normalizeArtifactType, read, requireParentId, safeId, timestamp } from "./utils.js";

export function createAgentArtifactRepository(database) {
  return {
    create(input = {}) {
      const id = safeId(read(input, "id", "id", null), "artifact");
      database.prepare(`
        INSERT INTO agent_artifacts (id, run_id, type, name, path, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requireParentId(read(input, "run_id", "runId", null), "run_id"),
        normalizeArtifactType(read(input, "type", "type", "report")),
        cleanText(read(input, "name", "name", "")),
        cleanText(read(input, "path", "path", "")),
        cleanText(read(input, "summary", "summary", "")),
        timestamp()
      );
      return this.getById(id);
    },

    getById(id) {
      return mapAgentArtifact(database.prepare("SELECT * FROM agent_artifacts WHERE id = ?").get(id));
    },

    listByParent(runId) {
      return database
        .prepare("SELECT * FROM agent_artifacts WHERE run_id = ? ORDER BY created_at ASC")
        .all(runId)
        .map(mapAgentArtifact);
    },

    list() {
      return database.prepare("SELECT * FROM agent_artifacts ORDER BY created_at ASC").all().map(mapAgentArtifact);
    },

    update(id, input = {}) {
      const existing = this.getById(id);
      if (!existing) return null;
      database.prepare(`
        UPDATE agent_artifacts
        SET run_id = ?, type = ?, name = ?, path = ?, summary = ?
        WHERE id = ?
      `).run(
        requireParentId(read(input, "run_id", "runId", existing.run_id), "run_id"),
        normalizeArtifactType(read(input, "type", "type", existing.type)),
        cleanText(read(input, "name", "name", existing.name)),
        cleanText(read(input, "path", "path", existing.path)),
        cleanText(read(input, "summary", "summary", existing.summary)),
        id
      );
      return this.getById(id);
    }
  };
}

function mapAgentArtifact(row) {
  if (!row) return null;
  return {
    id: row.id,
    run_id: row.run_id,
    type: row.type,
    name: row.name,
    path: row.path,
    summary: row.summary,
    created_at: row.created_at
  };
}
