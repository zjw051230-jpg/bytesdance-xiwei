export function buildMonitorConsoleModel({
  projects = [],
  activeProjectId = "",
  requirements = [],
  activity = [],
  designPlan = null,
  planningTasks = [],
  agentRun = null,
  agentArtifacts = [],
  reviewItems = [],
  prDraft = null,
  loadState = {}
} = {}) {
  const activeProject = projects.find((project) => project.id === activeProjectId) || projects[0] || null;
  const latestRequirement = requirements[0] || null;
  const run = agentRun || null;
  const artifacts = normalizeArtifactList(agentArtifacts);
  const reviews = Array.isArray(reviewItems) ? reviewItems : [];

  return {
    loading: Boolean(loadState.loading),
    error: loadState.error || "",
    project: buildProjectSummary(activeProject),
    projects: buildProjectRows(projects, activeProject?.id, latestRequirement),
    runs: buildRunRows(run, activity),
    pendingReports: buildReportRows({ activeProject, artifacts, prDraft }),
    stages: buildStages(latestRequirement, designPlan, run),
    metrics: buildMetrics({ latestRequirement, designPlan, planningTasks, run, artifacts, reviews }),
    checkpoints: buildCheckpoints(activity),
    timeline: buildTimeline(activity),
    selectedTask: buildSelectedTask({ run, latestRequirement, artifacts, reviews, prDraft }),
    hasRealData: Boolean(activeProject || latestRequirement || activity.length || run)
  };
}

function buildProjectSummary(project) {
  if (!project) return null;
  return {
    name: project.name || project.id || "Untitled project",
    description: project.description || project.localPath || "No project description saved.",
    branch: project.localPath || "No local path saved",
    owner: project.id || "project",
    updatedAt: project.updatedAt || project.lastOpenedAt || project.createdAt || "",
    status: normalizeUiStatus(project.status || "current")
  };
}

function buildProjectRows(projects, activeProjectId, latestRequirement) {
  return projects.map((project) => ({
    id: project.id,
    name: project.name || project.id,
    phase: project.id === activeProjectId
      ? latestRequirement?.readinessStatus || latestRequirement?.handoffDecision || "No active requirement"
      : project.updatedAt || project.lastOpenedAt || "",
    status: normalizeUiStatus(project.status || "current"),
    selected: project.id === activeProjectId
  }));
}

function buildRunRows(run, activity) {
  const rows = [];
  if (run?.runId || run?.id) {
    rows.push({
      id: run.runId || run.id,
      status: normalizeRunStatus(run.status),
      time: formatRelative(run.updatedAt || run.finishedAt || run.startedAt || run.createdAt)
    });
  }
  for (const item of activity) {
    if (!item.runId || rows.some((row) => row.id === item.runId)) continue;
    rows.push({
      id: item.runId,
      status: normalizeLevel(item.level),
      time: formatRelative(item.createdAt)
    });
  }
  return rows.slice(0, 6);
}

function buildReportRows({ activeProject, artifacts, prDraft }) {
  const rows = [];
  if (prDraft?.id) {
    rows.push({
      title: prDraft.title || "Persisted PR draft",
      project: activeProject?.name || prDraft.requirementId || "Project",
      time: formatRelative(prDraft.updatedAt || prDraft.createdAt),
      status: prDraft.status || "draft",
      tone: prDraft.status === "ready" ? "pass" : "warn"
    });
  }
  for (const artifact of artifacts.filter((item) => ["report", "pr_summary"].includes(item.type))) {
    rows.push({
      title: artifact.name || artifact.summary || "Persisted artifact",
      project: activeProject?.name || artifact.runId || "Project",
      time: formatRelative(artifact.createdAt),
      status: artifact.type,
      tone: "pending"
    });
  }
  return rows.slice(0, 6);
}

function buildStages(requirement, plan, run) {
  return [
    { label: "Requirement", active: Boolean(requirement), detail: requirement?.title || "No requirement" },
    { label: "Design", active: Boolean(plan), detail: plan?.currentStage || "No design plan" },
    { label: "Agent run", active: Boolean(run), detail: run?.status || "No run" }
  ];
}

function buildMetrics({ latestRequirement, designPlan, planningTasks, run, artifacts, reviews }) {
  const completedTasks = planningTasks.filter((task) => task.status === "done").length;
  const taskScore = planningTasks.length ? Math.round((completedTasks / planningTasks.length) * 100) : null;
  return [
    {
      label: "Requirement",
      summary: latestRequirement?.title || "No requirement saved",
      score: numberOrNull(latestRequirement?.completionPercent),
      status: latestRequirement?.readyForAgent ? "PASS" : latestRequirement ? "WARN" : "PENDING",
      runId: latestRequirement?.id || "none",
      points: [
        ["Readiness", latestRequirement?.readinessStatus || "not_started"],
        ["Handoff", latestRequirement?.handoffDecision || "not_started"]
      ]
    },
    {
      label: "Design plan",
      summary: designPlan?.title || "No design plan saved",
      score: numberOrNull(designPlan?.overallProgress ?? taskScore),
      status: designPlan ? "PASS" : "PENDING",
      runId: designPlan?.id || "none",
      points: [
        ["Tasks", String(planningTasks.length)],
        ["Done", String(completedTasks)]
      ]
    },
    {
      label: "Agent",
      summary: run?.resultSummary || run?.status || "No agent run saved",
      score: run ? (run.realWritePerformed ? 0 : 100) : null,
      status: run ? normalizeRunStatus(run.status).toUpperCase() : "PENDING",
      runId: run?.runId || run?.id || "none",
      points: [
        ["Dry-run", run ? String(Boolean(run.dryRun)) : "none"],
        ["Real write", run ? String(Boolean(run.realWritePerformed)) : "none"]
      ]
    },
    {
      label: "Review",
      summary: reviews.length ? `${reviews.length} review item(s)` : "No review items saved",
      score: reviews.length ? Math.round((reviews.filter((item) => item.humanStatus === "approved").length / reviews.length) * 100) : null,
      status: reviews.length ? "WARN" : "PENDING",
      runId: run?.runId || run?.id || "none",
      points: [
        ["Artifacts", String(artifacts.length)],
        ["Review", String(reviews.length)]
      ]
    }
  ];
}

function buildCheckpoints(activity) {
  return activity.slice(0, 7).map((item) => ({
    label: item.message || item.type || "Activity",
    time: formatShortTime(item.createdAt)
  }));
}

function buildTimeline(activity) {
  return activity.slice(0, 8).map((item) => ({
    id: item.runId || item.id,
    task: item.message || item.type || "Activity",
    score: "-",
    status: normalizeLevel(item.level).toUpperCase(),
    time: formatShortTime(item.createdAt),
    duration: "-",
    meta: [item.type, item.requirementId].filter(Boolean).join(" / ") || "activity_logs"
  }));
}

function buildSelectedTask({ run, latestRequirement, artifacts, reviews, prDraft }) {
  if (!run && !latestRequirement) return null;
  const riskRows = reviews
    .map((item) => item.riskLevel || item.reason || item.changeSummary)
    .filter(Boolean);
  return {
    runId: run?.runId || run?.id || latestRequirement?.id || "No run",
    type: run?.resultSummary || latestRequirement?.title || "Requirement",
    liveStatus: run?.status || latestRequirement?.readinessStatus || "not_started",
    status: normalizeRunStatus(run?.status || latestRequirement?.readinessStatus),
    score: numberOrNull(latestRequirement?.completionPercent),
    duration: formatDuration(run?.startedAt, run?.finishedAt),
    checkpoint: latestRequirement?.handoffDecision || latestRequirement?.readinessStatus || "not_started",
    report: prDraft?.id ? {
      title: prDraft.title || "PR draft",
      status: prDraft.status || "draft",
      generatedAt: prDraft.updatedAt || prDraft.createdAt || "",
      author: prDraft.runId || run?.runId || ""
    } : null,
    artifacts,
    risks: riskRows
  };
}

function normalizeArtifactList(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.artifactList)) return input.artifactList;
  if (input && typeof input === "object") return Object.entries(input).map(([name, value]) => ({ name, ...value }));
  return [];
}

function normalizeUiStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["pass", "passed", "done", "completed", "current"].includes(value)) return "pass";
  if (["warn", "warning", "running", "needs_review", "pending"].includes(value)) return "warn";
  if (["fail", "failed", "blocked", "error"].includes(value)) return "fail";
  return "current";
}

function normalizeRunStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["completed", "passed", "pass", "done"].includes(value)) return "pass";
  if (["failed", "fail", "error", "blocked"].includes(value)) return "fail";
  return value ? "warn" : "pending";
}

function normalizeLevel(level) {
  const value = String(level || "").toLowerCase();
  if (["error", "failed", "fail"].includes(value)) return "fail";
  if (["warn", "warning"].includes(value)) return "warn";
  return "pass";
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : null;
}

function formatRelative(value) {
  if (!value) return "-";
  return formatShortTime(value);
}

function formatShortTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}

function formatDuration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return "-";
  const start = new Date(startedAt).getTime();
  const finish = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return "-";
  const seconds = Math.round((finish - start) / 1000);
  return `${seconds}s`;
}
