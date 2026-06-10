const statusLabels = {
  idle: "idle",
  running: "running",
  completed: "completed",
  skipped: "skipped",
  blocked: "blocked",
  failed: "failed"
};

export default function AgentActivityTimeline({ stageEvents = [], compact = false }) {
  const events = Array.isArray(stageEvents) ? stageEvents : [];

  return (
    <section className={`agent-activity-timeline ${compact ? "compact" : ""}`} aria-label="Agent activity timeline">
      <div className="planning-card-header">
        <h2>Agent Activity Timeline</h2>
        <span>{events.length ? `${events.length} stages` : "idle"}</span>
      </div>
      {events.length ? (
        <ol className="agent-activity-list">
          {events.map((event, index) => (
            <li className={`agent-activity-item ${normalizeStatus(event.status)}`} key={event.id || event.key || `${event.agent}-${index}`}>
              <span className="agent-activity-index">{index + 1}</span>
              <div>
                <div className="agent-activity-title">
                  <strong>{event.agent || event.name || "AgentStage"}</strong>
                  <em>{statusLabels[normalizeStatus(event.status)]}</em>
                </div>
                <p>{event.summary || event.title || "-"}</p>
                {event.errorSummary ? <small>{event.errorSummary}</small> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="monitor-empty-state">
          尚未启动 Agent dry-run。点击生成执行计划后，将在这里展示各阶段活动状态。
        </p>
      )}
    </section>
  );
}

function normalizeStatus(status) {
  return statusLabels[status] ? status : "idle";
}
