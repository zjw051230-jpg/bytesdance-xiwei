import { cleanJson, cleanNullableText, cleanText, normalizePrStatus, parseJson, read, requireParentId, safeId, timestamp } from "./utils.js";

export function createPrDraftRepository(database) {
  return {
    create(input = {}) {
      const now = timestamp();
      const id = safeId(read(input, "id", "id", null), "pr");
      database.prepare(`
        INSERT INTO pr_drafts (id, requirement_id, run_id, title, summary, body, checklist_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requireParentId(read(input, "requirement_id", "requirementId", null), "requirement_id"),
        cleanNullableText(read(input, "run_id", "runId", null)),
        cleanText(read(input, "title", "title", "PR draft")),
        cleanText(read(input, "summary", "summary", "")),
        cleanText(read(input, "body", "body", "")),
        cleanJson(read(input, "checklist_json", "checklistJson", []), []),
        normalizePrStatus(read(input, "status", "status", "draft")),
        now,
        now
      );
      return this.getById(id);
    },

    getById(id) {
      return mapPrDraft(database.prepare("SELECT * FROM pr_drafts WHERE id = ?").get(id));
    },

    getByRequirementId(requirementId) {
      return mapPrDraft(database.prepare("SELECT * FROM pr_drafts WHERE requirement_id = ?").get(requirementId));
    },

    listByParent(requirementId) {
      return database
        .prepare("SELECT * FROM pr_drafts WHERE requirement_id = ? ORDER BY updated_at DESC")
        .all(requirementId)
        .map(mapPrDraft);
    },

    list() {
      return database.prepare("SELECT * FROM pr_drafts ORDER BY updated_at DESC").all().map(mapPrDraft);
    },

    update(id, input = {}) {
      const existing = this.getById(id);
      if (!existing) return null;
      database.prepare(`
        UPDATE pr_drafts
        SET requirement_id = ?, run_id = ?, title = ?, summary = ?, body = ?, checklist_json = ?,
          status = ?, updated_at = ?
        WHERE id = ?
      `).run(
        requireParentId(read(input, "requirement_id", "requirementId", existing.requirement_id), "requirement_id"),
        cleanNullableText(read(input, "run_id", "runId", existing.run_id)),
        cleanText(read(input, "title", "title", existing.title)),
        cleanText(read(input, "summary", "summary", existing.summary)),
        cleanText(read(input, "body", "body", existing.body)),
        cleanJson(read(input, "checklist_json", "checklistJson", existing.checklist_json), []),
        normalizePrStatus(read(input, "status", "status", existing.status)),
        timestamp(),
        id
      );
      return this.getById(id);
    }
  };
}

function mapPrDraft(row) {
  if (!row) return null;
  return {
    id: row.id,
    requirement_id: row.requirement_id,
    run_id: row.run_id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    checklist_json: parseJson(row.checklist_json, []),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
