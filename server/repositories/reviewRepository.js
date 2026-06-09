import { cleanText, normalizeHumanStatus, read, requireParentId, safeId, timestamp } from "./utils.js";

export function createReviewItemRepository(database) {
  return {
    create(input = {}) {
      const now = timestamp();
      const id = safeId(read(input, "id", "id", null), "review");
      database.prepare(`
        INSERT INTO review_items (
          id, run_id, file_path, change_summary, reason, requirement_mapping, risk_level,
          test_status, human_status, human_comment, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requireParentId(read(input, "run_id", "runId", null), "run_id"),
        cleanText(read(input, "file_path", "filePath", "")),
        cleanText(read(input, "change_summary", "changeSummary", "")),
        cleanText(read(input, "reason", "reason", "")),
        cleanText(read(input, "requirement_mapping", "requirementMapping", "")),
        cleanText(read(input, "risk_level", "riskLevel", "")),
        cleanText(read(input, "test_status", "testStatus", "")),
        normalizeHumanStatus(read(input, "human_status", "humanStatus", "pending")),
        cleanText(read(input, "human_comment", "humanComment", "")),
        now,
        now
      );
      return this.getById(id);
    },

    getById(id) {
      return mapReviewItem(database.prepare("SELECT * FROM review_items WHERE id = ?").get(id));
    },

    listByParent(runId) {
      return database
        .prepare("SELECT * FROM review_items WHERE run_id = ? ORDER BY created_at ASC")
        .all(runId)
        .map(mapReviewItem);
    },

    list() {
      return database.prepare("SELECT * FROM review_items ORDER BY created_at ASC").all().map(mapReviewItem);
    },

    update(id, input = {}) {
      const existing = this.getById(id);
      if (!existing) return null;
      database.prepare(`
        UPDATE review_items
        SET run_id = ?, file_path = ?, change_summary = ?, reason = ?, requirement_mapping = ?,
          risk_level = ?, test_status = ?, human_status = ?, human_comment = ?, updated_at = ?
        WHERE id = ?
      `).run(
        requireParentId(read(input, "run_id", "runId", existing.run_id), "run_id"),
        cleanText(read(input, "file_path", "filePath", existing.file_path)),
        cleanText(read(input, "change_summary", "changeSummary", existing.change_summary)),
        cleanText(read(input, "reason", "reason", existing.reason)),
        cleanText(read(input, "requirement_mapping", "requirementMapping", existing.requirement_mapping)),
        cleanText(read(input, "risk_level", "riskLevel", existing.risk_level)),
        cleanText(read(input, "test_status", "testStatus", existing.test_status)),
        normalizeHumanStatus(read(input, "human_status", "humanStatus", existing.human_status)),
        cleanText(read(input, "human_comment", "humanComment", existing.human_comment)),
        timestamp(),
        id
      );
      return this.getById(id);
    }
  };
}

function mapReviewItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    run_id: row.run_id,
    file_path: row.file_path,
    change_summary: row.change_summary,
    reason: row.reason,
    requirement_mapping: row.requirement_mapping,
    risk_level: row.risk_level,
    test_status: row.test_status,
    human_status: row.human_status,
    human_comment: row.human_comment,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
