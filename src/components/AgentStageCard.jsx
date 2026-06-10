import { AlertTriangle, Ban, CheckCircle2, Circle, Clock, Loader2, XCircle } from "lucide-react";

const statusLabels = {
  idle: "等待中",
  running: "工作中",
  completed: "已完成",
  skipped: "已跳过",
  blocked: "已阻断",
  failed: "失败"
};

const statusIcons = {
  idle: Clock,
  running: Loader2,
  completed: CheckCircle2,
  skipped: Ban,
  blocked: AlertTriangle,
  failed: XCircle
};

export default function AgentStageCard({ stage }) {
  const status = normalizeStatus(stage?.status);
  const StatusIcon = statusIcons[status] || Circle;
  const output = stage?.output || stage?.artifact || stage?.artifactName || stage?.result || stage?.product ||
    (status === "skipped" ? "未产生该阶段产物" : stage?.summary || "等待上游阶段完成");
  const reason = stage?.errorSummary || stage?.blockedReason || stage?.reason || "";

  return (
    <article className={`agent-stage-card ${status}`} data-agent={stage?.agent || "Agent"}>
      <div className="agent-stage-card-top">
        <span className="agent-stage-icon" aria-hidden="true"><StatusIcon size={17} /></span>
        <div>
          <h3>{stage?.agent || "Agent"}</h3>
          <p>{stage?.title || stage?.summary || "等待分配工作"}</p>
        </div>
        <span className={`agent-stage-badge ${status}`}>{statusLabels[status]}</span>
      </div>
      <dl className="agent-stage-meta">
        <div>
          <dt>当前动作</dt>
          <dd>{stage?.summary || stage?.title || "等待 Agent 编排"}</dd>
        </div>
        <div>
          <dt>产物/输出</dt>
          <dd>{output}</dd>
        </div>
        {reason ? (
          <div className="agent-stage-reason">
            <dt>{status === "failed" ? "错误摘要" : "阻断原因"}</dt>
            <dd>{reason}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

export function normalizeStatus(status) {
  const value = String(status || "idle").toLowerCase();
  if (["queued", "pending", "waiting", "todo"].includes(value)) return "idle";
  if (["active", "in_progress", "working"].includes(value)) return "running";
  if (["done", "success", "passed", "complete"].includes(value)) return "completed";
  if (["error"].includes(value)) return "failed";
  return ["idle", "running", "completed", "skipped", "blocked", "failed"].includes(value) ? value : "idle";
}
