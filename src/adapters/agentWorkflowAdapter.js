export function normalizeAgentWorkflow(run = {}, fallback = {}) {
  const stageEvents = normalizeAgentStageEvents(
    run.stageEvents ||
    run.activityTimeline ||
    run.plan?.stageEvents ||
    run.planJson?.stageEvents ||
    fallback.stageEvents ||
    []
  );

  return {
    ...fallback,
    ...run,
    runId: run.runId || run.id || fallback.runId || "",
    status: run.status || fallback.status || "idle",
    latestReturn: run.latestReturn || run.resultSummary || fallback.latestReturn || "",
    context: run.context || run.contextSnapshot || fallback.context || null,
    plan: run.plan || run.planJson || fallback.plan || null,
    dryRun: run.dryRun ?? fallback.dryRun ?? true,
    realWritePerformed: run.realWritePerformed ?? fallback.realWritePerformed ?? false,
    stageEvents,
    activityTimeline: stageEvents
  };
}

export function normalizeAgentStageEvents(stageEvents = []) {
  if (!Array.isArray(stageEvents)) return [];
  return stageEvents.map((event, index) => ({
    id: event.id || `${event.agent || "AgentStage"}-${index + 1}`,
    key: event.key || `stage-${index + 1}`,
    agent: event.agent || event.name || "AgentStage",
    title: event.title || event.summary || "",
    summary: event.summary || event.title || "",
    status: normalizeStageStatus(event.status),
    startedAt: event.startedAt || event.createdAt || "",
    finishedAt: event.finishedAt || event.updatedAt || "",
    errorSummary: event.errorSummary || event.error || ""
  }));
}

function normalizeStageStatus(status) {
  const value = String(status || "idle").toLowerCase();
  return ["idle", "running", "completed", "skipped", "blocked", "failed"].includes(value) ? value : "idle";
}
