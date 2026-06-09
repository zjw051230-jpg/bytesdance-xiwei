import { cleanText, read, requireParentId, safeId, timestamp } from "./utils.js";

export function createDesignPlanRepository(database) {
  return {
    create(input = {}) {
      const now = timestamp();
      const id = safeId(read(input, "id", "id", null), "plan");
      database.prepare(`
        INSERT INTO design_plans (id, requirement_id, title, summary, current_stage, overall_progress, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requireParentId(read(input, "requirement_id", "requirementId", null), "requirement_id"),
        cleanText(read(input, "title", "title", "Design Plan")),
        cleanText(read(input, "summary", "summary", "")),
        cleanText(read(input, "current_stage", "currentStage", "design")),
        Number(read(input, "overall_progress", "overallProgress", 0)),
        now,
        now
      );
      return this.getById(id);
    },

    getById(id) {
      return mapDesignPlan(database.prepare("SELECT * FROM design_plans WHERE id = ?").get(id));
    },

    getByRequirementId(requirementId) {
      return mapDesignPlan(database.prepare("SELECT * FROM design_plans WHERE requirement_id = ?").get(requirementId));
    },

    listByParent(requirementId) {
      return database
        .prepare("SELECT * FROM design_plans WHERE requirement_id = ? ORDER BY updated_at DESC")
        .all(requirementId)
        .map(mapDesignPlan);
    },

    list() {
      return database.prepare("SELECT * FROM design_plans ORDER BY updated_at DESC").all().map(mapDesignPlan);
    },

    update(id, input = {}) {
      const existing = this.getById(id);
      if (!existing) return null;
      database.prepare(`
        UPDATE design_plans
        SET requirement_id = ?, title = ?, summary = ?, current_stage = ?, overall_progress = ?, updated_at = ?
        WHERE id = ?
      `).run(
        requireParentId(read(input, "requirement_id", "requirementId", existing.requirement_id), "requirement_id"),
        cleanText(read(input, "title", "title", existing.title)),
        cleanText(read(input, "summary", "summary", existing.summary)),
        cleanText(read(input, "current_stage", "currentStage", existing.current_stage)),
        Number(read(input, "overall_progress", "overallProgress", existing.overall_progress)),
        timestamp(),
        id
      );
      return this.getById(id);
    }
  };
}

function mapDesignPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    requirement_id: row.requirement_id,
    title: row.title,
    summary: row.summary,
    current_stage: row.current_stage,
    overall_progress: row.overall_progress,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
