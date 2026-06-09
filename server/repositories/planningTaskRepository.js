import { cleanText, normalizePlanningStatus, read, requireParentId, safeId, timestamp } from "./utils.js";

export function createPlanningTaskRepository(database) {
  return {
    create(input = {}) {
      const now = timestamp();
      const id = safeId(read(input, "id", "id", null), "workitem");
      database.prepare(`
        INSERT INTO planning_tasks (
          id, plan_id, title, description, owner, status, priority, progress, due_date,
          blocked_reason, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requireParentId(read(input, "plan_id", "planId", null), "plan_id"),
        cleanText(read(input, "title", "title", "Planning task")),
        cleanText(read(input, "description", "description", "")),
        cleanText(read(input, "owner", "owner", "")),
        normalizePlanningStatus(read(input, "status", "status", "todo")),
        cleanText(read(input, "priority", "priority", "")),
        Number(read(input, "progress", "progress", 0)),
        cleanText(read(input, "due_date", "dueDate", "")),
        cleanText(read(input, "blocked_reason", "blockedReason", "")),
        now,
        now
      );
      return this.getById(id);
    },

    getById(id) {
      return mapPlanningTask(database.prepare("SELECT * FROM planning_tasks WHERE id = ?").get(id));
    },

    listByParent(planId) {
      return database
        .prepare("SELECT * FROM planning_tasks WHERE plan_id = ? ORDER BY created_at ASC")
        .all(planId)
        .map(mapPlanningTask);
    },

    list() {
      return database.prepare("SELECT * FROM planning_tasks ORDER BY created_at ASC").all().map(mapPlanningTask);
    },

    update(id, input = {}) {
      const existing = this.getById(id);
      if (!existing) return null;
      database.prepare(`
        UPDATE planning_tasks
        SET plan_id = ?, title = ?, description = ?, owner = ?, status = ?, priority = ?,
          progress = ?, due_date = ?, blocked_reason = ?, updated_at = ?
        WHERE id = ?
      `).run(
        requireParentId(read(input, "plan_id", "planId", existing.plan_id), "plan_id"),
        cleanText(read(input, "title", "title", existing.title)),
        cleanText(read(input, "description", "description", existing.description)),
        cleanText(read(input, "owner", "owner", existing.owner)),
        normalizePlanningStatus(read(input, "status", "status", existing.status)),
        cleanText(read(input, "priority", "priority", existing.priority)),
        Number(read(input, "progress", "progress", existing.progress)),
        cleanText(read(input, "due_date", "dueDate", existing.due_date)),
        cleanText(read(input, "blocked_reason", "blockedReason", existing.blocked_reason)),
        timestamp(),
        id
      );
      return this.getById(id);
    }
  };
}

function mapPlanningTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    plan_id: row.plan_id,
    title: row.title,
    description: row.description,
    owner: row.owner,
    status: row.status,
    priority: row.priority,
    progress: row.progress,
    due_date: row.due_date,
    blocked_reason: row.blocked_reason,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
