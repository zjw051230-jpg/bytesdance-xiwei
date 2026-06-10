import StatusBadge from "./StatusBadge.jsx";

export default function AgentRunStatusPanel({ agentWorkflow = {}, isStarting = false }) {
  const stageEvents = Array.isArray(agentWorkflow.stageEvents) ? agentWorkflow.stageEvents : [];
  const completed = stageEvents.filter((event) => event.status === "completed").length;
  const skipped = stageEvents.filter((event) => event.status === "skipped").length;
  const failed = stageEvents.find((event) => event.status === "failed");
  const running = stageEvents.find((event) => event.status === "running");
  const status = isStarting ? "running" : agentWorkflow.status || "idle";

  return (
    <section className="agent-run-status-panel" aria-label="Agent run status">
      <div>
        <span>Agent dry-run</span>
        <strong>{agentWorkflow.runId || (isStarting ? "starting" : "not started")}</strong>
      </div>
      <StatusBadge status={status === "completed" ? "pass" : status === "failed" ? "fail" : status === "running" ? "warn" : "pending"}>
        {status}
      </StatusBadge>
      <dl>
        <div><dt>dryRun</dt><dd>{String(agentWorkflow.dryRun ?? true)}</dd></div>
        <div><dt>realWritePerformed</dt><dd>{String(agentWorkflow.realWritePerformed ?? false)}</dd></div>
        <div><dt>completed</dt><dd>{completed}</dd></div>
        <div><dt>skipped</dt><dd>{skipped}</dd></div>
      </dl>
      <p>{failed?.errorSummary || running?.summary || agentWorkflow.latestReturn || "No Agent dry-run has been started."}</p>
    </section>
  );
}
