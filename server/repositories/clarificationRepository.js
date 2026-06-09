import { cleanText, normalizeRole, read, requireParentId, safeId, timestamp } from "./utils.js";

export function createClarificationRepository(database) {
  return {
    create(input = {}) {
      const id = safeId(read(input, "id", "id", null), "turn");
      database.prepare(`
        INSERT INTO clarification_turns (id, requirement_id, role, content, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requireParentId(read(input, "requirement_id", "requirementId", null), "requirement_id"),
        normalizeRole(read(input, "role", "role", "pm")),
        cleanText(read(input, "content", "content", "")),
        cleanText(read(input, "source", "source", "manual")),
        timestamp()
      );
      return this.getById(id);
    },

    getById(id) {
      return mapClarification(database.prepare("SELECT * FROM clarification_turns WHERE id = ?").get(id));
    },

    listByParent(requirementId) {
      return database
        .prepare("SELECT * FROM clarification_turns WHERE requirement_id = ? ORDER BY created_at ASC")
        .all(requirementId)
        .map(mapClarification);
    },

    list() {
      return database.prepare("SELECT * FROM clarification_turns ORDER BY created_at ASC").all().map(mapClarification);
    },

    update(id, input = {}) {
      const existing = this.getById(id);
      if (!existing) return null;
      database.prepare(`
        UPDATE clarification_turns
        SET requirement_id = ?, role = ?, content = ?, source = ?
        WHERE id = ?
      `).run(
        requireParentId(read(input, "requirement_id", "requirementId", existing.requirement_id), "requirement_id"),
        normalizeRole(read(input, "role", "role", existing.role)),
        cleanText(read(input, "content", "content", existing.content)),
        cleanText(read(input, "source", "source", existing.source)),
        id
      );
      return this.getById(id);
    }
  };
}

function mapClarification(row) {
  if (!row) return null;
  return {
    id: row.id,
    requirement_id: row.requirement_id,
    role: row.role,
    content: row.content,
    source: row.source,
    created_at: row.created_at
  };
}
