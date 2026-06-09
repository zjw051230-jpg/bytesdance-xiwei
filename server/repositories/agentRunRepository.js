import { boolToInt, cleanJson, cleanNullableText, cleanText, intToBool, parseJson, read, safeId, timestamp } from "./utils.js";

export function createAgentRunRepository(database) {
  return {
    create(input = {}) {
      const now = timestamp();
      const id = safeId(read(input, "id", "id", read(input, "run_id", "runId", null)), "RUN");
      database.prepare(`
        INSERT INTO agent_runs (
          id, requirement_id, plan_id, task_id, status, dry_run, real_write_performed,
          target_repo_path, context_snapshot, plan_json, result_summary, error_code,
          error_message, started_at, finished_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        cleanNullableText(read(input, "requirement_id", "requirementId", null)),
        cleanNullableText(read(input, "plan_id", "planId", null)),
        cleanNullableText(read(input, "task_id", "taskId", null)),
        cleanText(read(input, "status", "status", "created")),
        boolToInt(read(input, "dry_run", "dryRun", true)),
        boolToInt(read(input, "real_write_performed", "realWritePerformed", false)),
        cleanText(read(input, "target_repo_path", "targetRepoPath", "")),
        cleanJson(read(input, "context_snapshot", "contextSnapshot", {}), {}),
        cleanJson(read(input, "plan_json", "planJson", {}), {}),
        cleanText(read(input, "result_summary", "resultSummary", "")),
        cleanText(read(input, "error_code", "errorCode", "")),
        cleanText(read(input, "error_message", "errorMessage", "")),
        read(input, "started_at", "startedAt", now),
        read(input, "finished_at", "finishedAt", null),
        now,
        now
      );
      return this.getById(id);
    },

    getById(id) {
      return mapAgentRun(database.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id));
    },

    listByParent(requirementId) {
      return database
        .prepare("SELECT * FROM agent_runs WHERE requirement_id = ? ORDER BY created_at DESC")
        .all(requirementId)
        .map(mapAgentRun);
    },

    list() {
      return database.prepare("SELECT * FROM agent_runs ORDER BY created_at DESC").all().map(mapAgentRun);
    },

    update(id, input = {}) {
      const existing = this.getById(id);
      if (!existing) return null;
      database.prepare(`
        UPDATE agent_runs
        SET requirement_id = ?, plan_id = ?, task_id = ?, status = ?, dry_run = ?,
          real_write_performed = ?, target_repo_path = ?, context_snapshot = ?, plan_json = ?,
          result_summary = ?, error_code = ?, error_message = ?, started_at = ?, finished_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        cleanNullableText(read(input, "requirement_id", "requirementId", existing.requirement_id)),
        cleanNullableText(read(input, "plan_id", "planId", existing.plan_id)),
        cleanNullableText(read(input, "task_id", "taskId", existing.task_id)),
        cleanText(read(input, "status", "status", existing.status)),
        boolToInt(read(input, "dry_run", "dryRun", existing.dry_run)),
        boolToInt(read(input, "real_write_performed", "realWritePerformed", existing.real_write_performed)),
        cleanText(read(input, "target_repo_path", "targetRepoPath", existing.target_repo_path)),
        cleanJson(read(input, "context_snapshot", "contextSnapshot", existing.context_snapshot), {}),
        cleanJson(read(input, "plan_json", "planJson", existing.plan_json), {}),
        cleanText(read(input, "result_summary", "resultSummary", existing.result_summary)),
        cleanText(read(input, "error_code", "errorCode", existing.error_code)),
        cleanText(read(input, "error_message", "errorMessage", existing.error_message)),
        read(input, "started_at", "startedAt", existing.started_at),
        read(input, "finished_at", "finishedAt", existing.finished_at),
        timestamp(),
        id
      );
      return this.getById(id);
    }
  };
}

function mapAgentRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    requirement_id: row.requirement_id,
    plan_id: row.plan_id,
    task_id: row.task_id,
    status: row.status,
    dry_run: intToBool(row.dry_run),
    real_write_performed: intToBool(row.real_write_performed),
    target_repo_path: row.target_repo_path,
    context_snapshot: parseJson(row.context_snapshot, {}),
    plan_json: parseJson(row.plan_json, {}),
    result_summary: row.result_summary,
    error_code: row.error_code,
    error_message: row.error_message,
    started_at: row.started_at,
    finished_at: row.finished_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
