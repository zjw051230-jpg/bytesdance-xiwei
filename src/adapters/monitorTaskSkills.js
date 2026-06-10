const unavailable = "Field unavailable";

export const monitorTaskSkills = [
  { id: "requirement", label: "Requirement / DSL", detailUi: "dialog+details+meter" },
  { id: "run", label: "Agent Run", detailUi: "dialog+details+progress" },
  { id: "review", label: "Review", detailUi: "dialog+table" },
  { id: "pr", label: "PR Draft", detailUi: "dialog+table" },
  { id: "artifacts", label: "Artifacts", detailUi: "dialog+table" },
  { id: "activity", label: "Recent Activity", detailUi: "dialog+table" }
];

export function buildMonitorTaskSkillView(monitor = {}) {
  const metrics = Array.isArray(monitor.metrics) ? monitor.metrics : [];
  const timeline = Array.isArray(monitor.timeline) ? monitor.timeline : [];
  const selectedTask = monitor.selectedTask || null;
  const project = monitor.project || null;

  const cards = [
    fromMetric("requirement", "Requirement / DSL", metrics[0]),
    fromMetric("run", "Agent Run", metrics[2]),
    fromMetric("review", "Review", metrics[3]),
    fromMetric("pr", "PR Draft", {
      summary: selectedTask?.report?.title || "No PR draft returned",
      status: selectedTask?.report?.status || "empty",
      score: null,
      runId: selectedTask?.report?.author || unavailable,
      points: [
        ["Status", selectedTask?.report?.status],
        ["Generated", selectedTask?.report?.generatedAt]
      ]
    }),
    fromMetric("artifacts", "Artifacts", {
      summary: selectedTask?.artifacts?.length ? `${selectedTask.artifacts.length} artifact(s)` : "No artifacts returned",
      status: selectedTask?.artifacts?.length ? "live" : "empty",
      score: null,
      runId: selectedTask?.runId,
      points: (selectedTask?.artifacts || []).slice(0, 5).map((item) => [item.name || item.id, item.summary || item.type])
    }),
    fromMetric("activity", "Recent Activity", {
      summary: timeline[0]?.task || "No recent activity",
      status: timeline.length ? "live" : "empty",
      score: null,
      runId: timeline[0]?.id,
      points: timeline.slice(0, 5).map((item) => [item.task, [item.status, item.time].filter(Boolean).join(" / ")])
    })
  ];

  return {
    definitions: monitorTaskSkills,
    cards,
    workflow: buildWorkflow(metrics),
    activity: timeline.slice(0, 6).map((item) => ({
      id: safeText(item.id || item.task || item.time),
      title: safeText(item.task || "Activity"),
      meta: safeText([item.status, item.duration, item.meta].filter(Boolean).join(" / ")),
      status: statusFromValue(item.status),
      createdAt: item.time && item.time !== "-" ? item.time : "",
      detailRows: rows([
        ["Task", item.task],
        ["Status", item.status],
        ["Time", item.time],
        ["Duration", item.duration],
        ["Metadata", item.meta]
      ])
    })),
    projectRows: rows([
      ["Project", project?.name],
      ["Description", project?.description],
      ["Local path", project?.branch],
      ["Updated", project?.updatedAt],
      ["Status", project?.status]
    ])
  };
}

function fromMetric(id, title, metric = {}) {
  return {
    id,
    title,
    value: safeText(metric.status || "empty", 42),
    status: statusFromValue(metric.status),
    summary: safeText(metric.summary || "No live data returned", 150),
    source: metric.runId && metric.runId !== "none" ? "live" : "empty",
    metric: Number.isFinite(Number(metric.score)) ? Number(metric.score) : null,
    detailRows: rows([
      ["Summary", metric.summary],
      ["Status", metric.status],
      ["Score", Number.isFinite(Number(metric.score)) ? `${metric.score}%` : ""],
      ["Reference", metric.runId],
      ...(Array.isArray(metric.points) ? metric.points : [])
    ])
  };
}

function buildWorkflow(metrics) {
  return [
    { id: "dsl", label: "DSL", value: numberOrNull(metrics[0]?.score), detail: metrics[0]?.status || "empty" },
    { id: "plan", label: "Plan", value: numberOrNull(metrics[1]?.score), detail: metrics[1]?.status || "empty" },
    { id: "run", label: "Run", value: numberOrNull(metrics[2]?.score), detail: metrics[2]?.status || "empty" }
  ];
}

function rows(items) {
  return items.map(([label, value]) => ({
    label,
    value: value === false || value === 0 ? String(value) : safeText(value || unavailable, 220)
  }));
}

function statusFromValue(value) {
  const text = String(value || "").toLowerCase();
  if (["pass", "passed", "ready", "completed", "done", "live"].some((item) => text.includes(item))) return "pass";
  if (["fail", "failed", "blocked", "error", "unavailable"].some((item) => text.includes(item))) return "fail";
  if (["warn", "running", "pending"].some((item) => text.includes(item))) return "warn";
  return "pending";
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function safeText(value, maxLength = 220) {
  const redacted = String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s,;]+/gi, "$1=[redacted]")
    .replace(/\bark-[A-Za-z0-9-]+/gi, "ark-[redacted]");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 3)}...` : redacted;
}
