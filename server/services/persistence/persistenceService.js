import { randomUUID } from "node:crypto";

const validPlanningStatuses = new Set(["todo", "running", "blocked", "done", "needs_review", "cancelled"]);
const validHumanStatuses = new Set(["pending", "approved", "needs_change", "blocked"]);
const validPrStatuses = new Set(["draft", "ready", "blocked", "merged", "cancelled"]);
const validArtifactTypes = new Set(["dsl", "context", "report", "patch", "test_log", "screenshot", "pr_summary"]);

export function createPersistenceService(database) {
  return {
    projects: projectRepository(database),
    requirements: requirementRepository(database),
    clarifications: clarificationRepository(database),
    designPlans: designPlanRepository(database),
    planningTasks: planningTaskRepository(database),
    agentRuns: agentRunRepository(database),
    agentArtifacts: agentArtifactRepository(database),
    reviewItems: reviewItemRepository(database),
    prDrafts: prDraftRepository(database),
    activity: activityRepository(database)
  };
}

function projectRepository(database) {
  return {
    list() {
      return database.prepare("SELECT * FROM projects ORDER BY COALESCE(last_opened_at, updated_at) DESC, created_at DESC").all().map(mapProject);
    },
    get(id) {
      return mapProject(database.prepare("SELECT * FROM projects WHERE id = ?").get(id));
    },
    create(input = {}) {
      const now = timestamp();
      const id = safeId(input.id, "project");
      database.prepare(`
        INSERT INTO projects (id, name, description, status, icon, rail_subtitle, local_path, created_at, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        cleanText(input.name || "Untitled Project"),
        cleanText(input.description || ""),
        cleanText(input.status || "current"),
        cleanText(input.icon || "folder"),
        cleanText(input.railSubtitle || input.rail_subtitle || input.localPath || ""),
        cleanText(input.localPath || input.local_path || ""),
        now,
        now,
        input.lastOpenedAt || input.last_opened_at || now
      );
      return this.get(id);
    },
    update(id, input = {}) {
      const existing = this.get(id);
      if (!existing) return null;
      const next = { ...existing, ...input };
      const now = timestamp();
      database.prepare(`
        UPDATE projects SET name = ?, description = ?, status = ?, icon = ?, rail_subtitle = ?, local_path = ?, updated_at = ?, last_opened_at = ?
        WHERE id = ?
      `).run(
        cleanText(next.name),
        cleanText(next.description),
        cleanText(next.status || "current"),
        cleanText(next.icon || "folder"),
        cleanText(next.railSubtitle || next.rail_subtitle || ""),
        cleanText(next.localPath || next.local_path || ""),
        now,
        next.lastOpenedAt || next.last_opened_at || existing.lastOpenedAt || now,
        id
      );
      return this.get(id);
    },
    delete(id) {
      const existing = this.get(id);
      if (!existing) return null;
      database.prepare("DELETE FROM projects WHERE id = ?").run(id);
      return existing;
    },
    touchLastOpened(id) {
      database.prepare("UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?").run(timestamp(), timestamp(), id);
      return this.get(id);
    }
  };
}

function requirementRepository(database) {
  return {
    list(projectId) {
      return database.prepare("SELECT * FROM requirements WHERE project_id = ? ORDER BY updated_at DESC").all(projectId).map(mapRequirement);
    },
    get(id) {
      return mapRequirement(database.prepare("SELECT * FROM requirements WHERE id = ?").get(id));
    },
    latestForProject(projectId) {
      return mapRequirement(database.prepare("SELECT * FROM requirements WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1").get(projectId));
    },
    create(projectId, input = {}) {
      const now = timestamp();
      const id = safeId(input.id, "req");
      database.prepare(`
        INSERT INTO requirements (
          id, project_id, title, raw_pm_input, dsl_json, readiness_status, ready_for_agent,
          handoff_decision, source_provider, source_model, completion_percent, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        projectId,
        cleanText(input.title || "Untitled Requirement"),
        cleanText(input.rawPmInput || input.raw_pm_input || ""),
        cleanJson(input.dslJson ?? input.dsl_json ?? {}),
        cleanText(input.readinessStatus || input.readiness_status || "clarify_first"),
        boolToInt(input.readyForAgent ?? input.ready_for_agent ?? false),
        cleanText(input.handoffDecision || input.handoff_decision || "clarify_first"),
        cleanText(input.sourceProvider || input.source_provider || ""),
        cleanText(input.sourceModel || input.source_model || ""),
        Number(input.completionPercent ?? input.completion_percent ?? 0),
        now,
        now
      );
      return this.get(id);
    },
    update(id, input = {}) {
      const existing = this.get(id);
      if (!existing) return null;
      const next = { ...existing, ...input };
      database.prepare(`
        UPDATE requirements SET title = ?, raw_pm_input = ?, dsl_json = ?, readiness_status = ?,
          ready_for_agent = ?, handoff_decision = ?, source_provider = ?, source_model = ?,
          completion_percent = ?, updated_at = ?
        WHERE id = ?
      `).run(
        cleanText(next.title),
        cleanText(next.rawPmInput ?? next.raw_pm_input ?? ""),
        cleanJson(next.dslJson ?? next.dsl_json ?? {}),
        cleanText(next.readinessStatus ?? next.readiness_status ?? "clarify_first"),
        boolToInt(next.readyForAgent ?? next.ready_for_agent ?? false),
        cleanText(next.handoffDecision ?? next.handoff_decision ?? "clarify_first"),
        cleanText(next.sourceProvider ?? next.source_provider ?? ""),
        cleanText(next.sourceModel ?? next.source_model ?? ""),
        Number(next.completionPercent ?? next.completion_percent ?? 0),
        timestamp(),
        id
      );
      return this.get(id);
    }
  };
}

function clarificationRepository(database) {
  return {
    list(requirementId) {
      return database.prepare("SELECT * FROM clarification_turns WHERE requirement_id = ? ORDER BY created_at ASC").all(requirementId).map(mapClarification);
    },
    create(requirementId, input = {}) {
      const id = safeId(input.id, "turn");
      database.prepare(`
        INSERT INTO clarification_turns (id, requirement_id, role, content, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requirementId,
        normalizeRole(input.role || "pm"),
        cleanText(input.content || input.text || ""),
        cleanText(input.source || "manual"),
        timestamp()
      );
      return mapClarification(database.prepare("SELECT * FROM clarification_turns WHERE id = ?").get(id));
    }
  };
}

function designPlanRepository(database) {
  return {
    get(id) {
      return mapDesignPlan(database.prepare("SELECT * FROM design_plans WHERE id = ?").get(id));
    },
    getByRequirement(requirementId) {
      return mapDesignPlan(database.prepare("SELECT * FROM design_plans WHERE requirement_id = ?").get(requirementId));
    },
    upsert(requirementId, input = {}) {
      const existing = this.getByRequirement(requirementId);
      if (existing) return this.update(existing.id, input);
      const now = timestamp();
      const id = safeId(input.id, "plan");
      database.prepare(`
        INSERT INTO design_plans (id, requirement_id, title, summary, current_stage, overall_progress, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requirementId,
        cleanText(input.title || "Design Plan"),
        cleanText(input.summary || ""),
        cleanText(input.currentStage || input.current_stage || "design"),
        Number(input.overallProgress ?? input.overall_progress ?? 0),
        now,
        now
      );
      return this.get(id);
    },
    update(id, input = {}) {
      const existing = this.get(id);
      if (!existing) return null;
      const next = { ...existing, ...input };
      database.prepare(`
        UPDATE design_plans SET title = ?, summary = ?, current_stage = ?, overall_progress = ?, updated_at = ? WHERE id = ?
      `).run(
        cleanText(next.title),
        cleanText(next.summary || ""),
        cleanText(next.currentStage || next.current_stage || "design"),
        Number(next.overallProgress ?? next.overall_progress ?? 0),
        timestamp(),
        id
      );
      return this.get(id);
    }
  };
}

function planningTaskRepository(database) {
  return {
    list(planId) {
      return database.prepare("SELECT * FROM planning_tasks WHERE plan_id = ? ORDER BY created_at ASC").all(planId).map(mapPlanningTask);
    },
    get(id) {
      return mapPlanningTask(database.prepare("SELECT * FROM planning_tasks WHERE id = ?").get(id));
    },
    create(planId, input = {}) {
      const now = timestamp();
      const id = safeId(input.id, "workitem");
      database.prepare(`
        INSERT INTO planning_tasks (
          id, plan_id, title, description, owner, status, priority, progress, due_date,
          blocked_reason, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        planId,
        cleanText(input.title || input.task || "Planning task"),
        cleanText(input.description || ""),
        cleanText(input.owner || ""),
        normalizePlanningStatus(input.status || "todo"),
        cleanText(input.priority || ""),
        Number(input.progress ?? 0),
        cleanText(input.dueDate || input.due_date || input.due || ""),
        cleanText(input.blockedReason || input.blocked_reason || ""),
        now,
        now
      );
      return this.get(id);
    },
    update(id, input = {}) {
      const existing = this.get(id);
      if (!existing) return null;
      const next = { ...existing, ...input };
      database.prepare(`
        UPDATE planning_tasks SET title = ?, description = ?, owner = ?, status = ?, priority = ?,
          progress = ?, due_date = ?, blocked_reason = ?, updated_at = ? WHERE id = ?
      `).run(
        cleanText(next.title || next.task || ""),
        cleanText(next.description || ""),
        cleanText(next.owner || ""),
        normalizePlanningStatus(next.status || "todo"),
        cleanText(next.priority || ""),
        Number(next.progress ?? 0),
        cleanText(next.dueDate || next.due_date || next.due || ""),
        cleanText(next.blockedReason || next.blocked_reason || ""),
        timestamp(),
        id
      );
      return this.get(id);
    }
  };
}

function agentRunRepository(database) {
  return {
    get(id) {
      return mapAgentRun(database.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id));
    },
    create(input = {}) {
      const now = timestamp();
      const id = safeId(input.id || input.runId, "RUN");
      database.prepare(`
        INSERT INTO agent_runs (
          id, requirement_id, plan_id, task_id, status, dry_run, real_write_performed,
          target_repo_path, context_snapshot, plan_json, result_summary, error_code,
          error_message, started_at, finished_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.requirementId || input.requirement_id || null,
        input.planId || input.plan_id || null,
        input.taskId || input.task_id || null,
        cleanText(input.status || "created"),
        boolToInt(input.dryRun ?? input.dry_run ?? true),
        boolToInt(input.realWritePerformed ?? input.real_write_performed ?? false),
        cleanText(input.targetRepoPath || input.target_repo_path || ""),
        cleanJson(input.contextSnapshot ?? input.context_snapshot ?? {}),
        cleanJson(input.planJson ?? input.plan_json ?? {}),
        cleanText(input.resultSummary || input.result_summary || ""),
        cleanText(input.errorCode || input.error_code || ""),
        cleanText(input.errorMessage || input.error_message || ""),
        input.startedAt || input.started_at || now,
        input.finishedAt || input.finished_at || null,
        now,
        now
      );
      return this.get(id);
    },
    update(id, input = {}) {
      const existing = this.get(id);
      if (!existing) return null;
      const next = { ...existing, ...input };
      database.prepare(`
        UPDATE agent_runs SET status = ?, dry_run = ?, real_write_performed = ?, target_repo_path = ?,
          context_snapshot = ?, plan_json = ?, result_summary = ?, error_code = ?, error_message = ?,
          started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?
      `).run(
        cleanText(next.status || "created"),
        boolToInt(next.dryRun ?? next.dry_run ?? true),
        boolToInt(next.realWritePerformed ?? next.real_write_performed ?? false),
        cleanText(next.targetRepoPath || next.target_repo_path || ""),
        cleanJson(next.contextSnapshot ?? next.context_snapshot ?? {}),
        cleanJson(next.planJson ?? next.plan_json ?? {}),
        cleanText(next.resultSummary || next.result_summary || ""),
        cleanText(next.errorCode || next.error_code || ""),
        cleanText(next.errorMessage || next.error_message || ""),
        next.startedAt || next.started_at || existing.startedAt,
        next.finishedAt || next.finished_at || existing.finishedAt,
        timestamp(),
        id
      );
      return this.get(id);
    }
  };
}

function agentArtifactRepository(database) {
  return {
    list(runId) {
      return database.prepare("SELECT * FROM agent_artifacts WHERE run_id = ? ORDER BY created_at ASC").all(runId).map(mapAgentArtifact);
    },
    create(runId, input = {}) {
      const id = safeId(input.id, "artifact");
      database.prepare(`
        INSERT INTO agent_artifacts (id, run_id, type, name, path, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        runId,
        normalizeArtifactType(input.type || "report"),
        cleanText(input.name || ""),
        cleanText(input.path || ""),
        cleanText(input.summary || ""),
        timestamp()
      );
      return this.list(runId).find((artifact) => artifact.id === id);
    }
  };
}

function reviewItemRepository(database) {
  return {
    listByRun(runId) {
      return database.prepare("SELECT * FROM review_items WHERE run_id = ? ORDER BY created_at ASC").all(runId).map(mapReviewItem);
    },
    get(id) {
      return mapReviewItem(database.prepare("SELECT * FROM review_items WHERE id = ?").get(id));
    },
    create(runId, input = {}) {
      const now = timestamp();
      const id = safeId(input.id, "review");
      database.prepare(`
        INSERT INTO review_items (
          id, run_id, file_path, change_summary, reason, requirement_mapping, risk_level,
          test_status, human_status, human_comment, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        runId,
        cleanText(input.filePath || input.file_path || ""),
        cleanText(input.changeSummary || input.change_summary || ""),
        cleanText(input.reason || ""),
        cleanText(input.requirementMapping || input.requirement_mapping || ""),
        cleanText(input.riskLevel || input.risk_level || ""),
        cleanText(input.testStatus || input.test_status || ""),
        normalizeHumanStatus(input.humanStatus || input.human_status || "pending"),
        cleanText(input.humanComment || input.human_comment || ""),
        now,
        now
      );
      return this.get(id);
    },
    update(id, input = {}) {
      const existing = this.get(id);
      if (!existing) return null;
      const next = { ...existing, ...input };
      database.prepare(`
        UPDATE review_items SET human_status = ?, human_comment = ?, test_status = ?, updated_at = ? WHERE id = ?
      `).run(
        normalizeHumanStatus(next.humanStatus || next.human_status || "pending"),
        cleanText(next.humanComment || next.human_comment || ""),
        cleanText(next.testStatus || next.test_status || ""),
        timestamp(),
        id
      );
      return this.get(id);
    }
  };
}

function prDraftRepository(database) {
  return {
    get(id) {
      return mapPrDraft(database.prepare("SELECT * FROM pr_drafts WHERE id = ?").get(id));
    },
    getByRequirement(requirementId) {
      return mapPrDraft(database.prepare("SELECT * FROM pr_drafts WHERE requirement_id = ?").get(requirementId));
    },
    upsert(requirementId, input = {}) {
      const existing = this.getByRequirement(requirementId);
      if (existing) return this.update(existing.id, input);
      const now = timestamp();
      const id = safeId(input.id, "pr");
      database.prepare(`
        INSERT INTO pr_drafts (id, requirement_id, run_id, title, summary, body, checklist_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        requirementId,
        input.runId || input.run_id || null,
        cleanText(input.title || "PR draft"),
        cleanText(Array.isArray(input.summary) ? input.summary.join("\n") : input.summary || ""),
        cleanText(input.body || ""),
        cleanJson(input.checklistJson ?? input.checklist_json ?? input.checklist ?? []),
        normalizePrStatus(input.status || "draft"),
        now,
        now
      );
      return this.get(id);
    },
    update(id, input = {}) {
      const existing = this.get(id);
      if (!existing) return null;
      const next = { ...existing, ...input };
      database.prepare(`
        UPDATE pr_drafts SET run_id = ?, title = ?, summary = ?, body = ?, checklist_json = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(
        next.runId || next.run_id || existing.runId || null,
        cleanText(next.title || ""),
        cleanText(Array.isArray(next.summary) ? next.summary.join("\n") : next.summary || ""),
        cleanText(next.body || ""),
        cleanJson(next.checklistJson ?? next.checklist_json ?? next.checklist ?? []),
        normalizePrStatus(next.status || "draft"),
        timestamp(),
        id
      );
      return this.get(id);
    }
  };
}

function activityRepository(database) {
  return {
    listByProject(projectId) {
      return database.prepare("SELECT * FROM activity_logs WHERE project_id = ? ORDER BY created_at DESC").all(projectId).map(mapActivity);
    },
    listByRun(runId) {
      return database.prepare("SELECT * FROM activity_logs WHERE run_id = ? ORDER BY created_at DESC").all(runId).map(mapActivity);
    },
    create(input = {}) {
      const id = safeId(input.id, "activity");
      database.prepare(`
        INSERT INTO activity_logs (id, project_id, requirement_id, run_id, type, level, message, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.projectId || input.project_id || null,
        input.requirementId || input.requirement_id || null,
        input.runId || input.run_id || null,
        cleanText(input.type || "event"),
        cleanText(input.level || "info"),
        cleanText(input.message || ""),
        cleanJson(input.payloadJson ?? input.payload_json ?? {}),
        timestamp()
      );
      return mapActivity(database.prepare("SELECT * FROM activity_logs WHERE id = ?").get(id));
    }
  };
}

function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    icon: row.icon,
    railSubtitle: row.rail_subtitle,
    localPath: row.local_path || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at
  };
}

function mapRequirement(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    rawPmInput: row.raw_pm_input,
    dslJson: parseJson(row.dsl_json, {}),
    readinessStatus: row.readiness_status,
    readyForAgent: Boolean(row.ready_for_agent),
    handoffDecision: row.handoff_decision,
    sourceProvider: row.source_provider,
    sourceModel: row.source_model,
    completionPercent: row.completion_percent,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapClarification(row) {
  if (!row) return null;
  return {
    id: row.id,
    requirementId: row.requirement_id,
    role: row.role,
    content: row.content,
    source: row.source,
    createdAt: row.created_at
  };
}

function mapDesignPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    requirementId: row.requirement_id,
    title: row.title,
    summary: row.summary,
    currentStage: row.current_stage,
    overallProgress: row.overall_progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPlanningTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    planId: row.plan_id,
    title: row.title,
    description: row.description,
    owner: row.owner,
    status: row.status,
    priority: row.priority,
    progress: row.progress,
    dueDate: row.due_date,
    blockedReason: row.blocked_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAgentRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.id,
    requirementId: row.requirement_id,
    planId: row.plan_id,
    taskId: row.task_id,
    status: row.status,
    dryRun: Boolean(row.dry_run),
    realWritePerformed: Boolean(row.real_write_performed),
    targetRepoPath: row.target_repo_path,
    contextSnapshot: parseJson(row.context_snapshot, {}),
    planJson: parseJson(row.plan_json, {}),
    resultSummary: row.result_summary,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAgentArtifact(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    type: row.type,
    name: row.name,
    path: row.path,
    summary: row.summary,
    createdAt: row.created_at
  };
}

function mapReviewItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    filePath: row.file_path,
    changeSummary: row.change_summary,
    reason: row.reason,
    requirementMapping: row.requirement_mapping,
    riskLevel: row.risk_level,
    testStatus: row.test_status,
    humanStatus: row.human_status,
    humanComment: row.human_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPrDraft(row) {
  if (!row) return null;
  return {
    id: row.id,
    requirementId: row.requirement_id,
    runId: row.run_id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    checklistJson: parseJson(row.checklist_json, []),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapActivity(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    runId: row.run_id,
    type: row.type,
    level: row.level,
    message: row.message,
    payloadJson: parseJson(row.payload_json, {}),
    createdAt: row.created_at
  };
}

function safeId(value, prefix) {
  const candidate = String(value || "").trim();
  if (/^[A-Za-z0-9_.:-]{2,80}$/.test(candidate)) return candidate;
  return `${prefix}-${randomUUID()}`;
}

function timestamp() {
  return new Date().toISOString();
}

function boolToInt(value) {
  return value ? 1 : 0;
}

function cleanJson(value) {
  return JSON.stringify(cleanValue(value ?? {}));
}

function cleanValue(value) {
  if (Array.isArray(value)) return value.map(cleanValue);
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/api[_-]?key|authorization|bearer|token|password|secret/i.test(key)) {
        output[key] = "[redacted credential]";
      } else {
        output[key] = cleanValue(entry);
      }
    }
    return output;
  }
  if (typeof value === "string") return cleanText(value);
  return value;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/api[_-]?key\s*[:=]\s*["']?[^"',;\s]+["']?/gi, "credential redacted")
    .replace(/authorization\s*[:=]\s*["']?[^"',;\n]+["']?/gi, "credential redacted")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "credential redacted")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "credential redacted")
    .replace(/[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@/g, "credential redacted@");
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeRole(value) {
  return ["pm", "system", "assistant"].includes(value) ? value : "pm";
}

function normalizePlanningStatus(value) {
  return validPlanningStatuses.has(value) ? value : "todo";
}

function normalizeHumanStatus(value) {
  return validHumanStatuses.has(value) ? value : "pending";
}

function normalizePrStatus(value) {
  return validPrStatuses.has(value) ? value : "draft";
}

function normalizeArtifactType(value) {
  return validArtifactTypes.has(value) ? value : "report";
}
