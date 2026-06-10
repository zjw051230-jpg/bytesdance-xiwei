import { CheckCircle2, Copy, Download, Eye, FileText, RotateCcw } from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";

function fileType(name) {
  return name.split(".").pop()?.toUpperCase() ?? "FILE";
}

export default function TaskInspector({ monitor }) {
  const selectedTask = monitor?.selectedTask;
  if (!selectedTask) {
    return (
      <aside className="inspector">
        <section className="inspector-section current-task-section">
          <div className="section-header">
            <h2>当前任务</h2>
            <StatusBadge status="pending">EMPTY</StatusBadge>
          </div>
          <div className="monitor-empty-state">
            <strong>暂无真实运行或需求</strong>
            <span>创建需求、生成设计计划或启动 Agent run 后，这里会展示数据库中的真实状态。</span>
          </div>
        </section>
      </aside>
    );
  }

  const hasReport = Boolean(selectedTask.report);
  const artifacts = selectedTask.artifacts || [];
  const risks = selectedTask.risks || [];

  return (
    <aside className="inspector">
      <section className="inspector-section current-task-section">
        <div className="section-header">
          <h2>当前任务</h2>
          <StatusBadge status={selectedTask.status}>{selectedTask.liveStatus}</StatusBadge>
        </div>
        <div className="task-summary-card">
          <div>
            <span className="task-run-id"><code>{selectedTask.runId}</code><Copy size={12} /></span>
            <strong>{selectedTask.type}</strong>
            <small>{selectedTask.checkpoint}</small>
          </div>
          <div className="inspector-score compact-score">
            <span className="score-ring big" style={{ "--score": `${(selectedTask.score ?? 0) * 3.6}deg` }}>
              <strong>{selectedTask.score ?? "-"}</strong>
            </span>
            <em>/ 100</em>
          </div>
        </div>
        <div className="task-meta-grid">
          <span><small>来源</small><strong><span className="mini-avatar">DB</span>Persistence</strong></span>
          <span><small>状态</small><strong><StatusBadge status={selectedTask.status}>{selectedTask.status}</StatusBadge></strong></span>
          <span><small>耗时</small><strong>{selectedTask.duration}</strong></span>
        </div>
      </section>

      <section className="inspector-section">
        <div className="section-header">
          <h2>报告审批</h2>
        </div>
        {hasReport ? (
          <>
            <div className="report-approval">
              <span className="approval-title">
                <strong>{selectedTask.report.title}</strong>
                <StatusBadge status="warn">{selectedTask.report.status}</StatusBadge>
              </span>
              <span>{selectedTask.report.generatedAt || "-"}</span>
              <span>生成者 · {selectedTask.report.author || "-"}</span>
            </div>
            <div className="approval-actions">
              <button className="approve"><CheckCircle2 size={14} />通过</button>
              <button className="reject"><RotateCcw size={14} />要求返工</button>
              <button><Eye size={14} />查看详情</button>
            </div>
          </>
        ) : <p className="monitor-empty-state">暂无真实 PR 草稿或报告。</p>}
      </section>

      <section className="inspector-section artifact-section">
        <div className="section-header">
          <h2>Artifacts ({artifacts.length})</h2>
        </div>
        <div className="artifact-list">
          {artifacts.length ? artifacts.map((artifact) => (
            <button className="artifact-row" key={artifact.id || artifact.name}>
              <FileText size={15} />
              <span>{artifact.name}</span>
              <em>{fileType(artifact.name || artifact.type || "artifact")}</em>
              <small>{artifact.summary || artifact.type || "-"}</small>
              <Download size={14} />
            </button>
          )) : <p className="monitor-empty-state">暂无真实 artifact。</p>}
        </div>
      </section>

      <section className="inspector-section risk-section">
        <div className="section-header">
          <h2>风险与异常</h2>
        </div>
        <div className="risk-box">
          <ul>
            {risks.length ? risks.map((risk) => <li key={risk}>{risk}</li>) : <li>暂无真实风险记录。</li>}
          </ul>
          <button className="link-button">查看详情</button>
        </div>
      </section>
    </aside>
  );
}
