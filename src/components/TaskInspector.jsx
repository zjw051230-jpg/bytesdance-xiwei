import { CheckCircle2, Copy, Download, Eye, FileText, RotateCcw } from "lucide-react";
import { selectedTask } from "../data/mockData.js";
import StatusBadge from "./StatusBadge.jsx";

function fileType(name) {
  return name.split(".").pop()?.toUpperCase() ?? "FILE";
}

export default function TaskInspector() {
  return (
    <aside className="inspector">
      <section className="inspector-section current-task-section">
        <div className="section-header">
          <h2>当前任务</h2>
          <StatusBadge status="pass">{selectedTask.liveStatus}</StatusBadge>
        </div>
        <div className="task-summary-card">
          <div>
            <span className="task-run-id"><code>{selectedTask.runId}</code><Copy size={12} /></span>
            <strong>{selectedTask.type}</strong>
            <small>{selectedTask.checkpoint}</small>
          </div>
          <div className="inspector-score compact-score">
            <span className="score-ring big" style={{ "--score": `${selectedTask.score * 3.6}deg` }}>
              <strong>{selectedTask.score}</strong>
            </span>
            <em>/ 100</em>
          </div>
        </div>
        <div className="task-meta-grid">
          <span><small>负责人</small><strong><span className="mini-avatar">H</span>{selectedTask.owner}</strong></span>
          <span><small>状态</small><strong><StatusBadge status="pass">{selectedTask.status}</StatusBadge></strong></span>
          <span><small>耗时</small><strong>{selectedTask.duration}</strong></span>
        </div>
      </section>

      <section className="inspector-section">
        <div className="section-header">
          <h2>报告审批</h2>
        </div>
        <div className="report-approval">
          <span className="approval-title">
            <strong>{selectedTask.report.title}</strong>
            <StatusBadge status="warn">{selectedTask.report.status}</StatusBadge>
          </span>
          <span>{selectedTask.report.generatedAt}</span>
          <span>生成者 · {selectedTask.report.author}</span>
        </div>
        <div className="approval-actions">
          <button className="approve"><CheckCircle2 size={14} />通过</button>
          <button className="reject"><RotateCcw size={14} />要求返工</button>
          <button><Eye size={14} />查看详情</button>
        </div>
      </section>

      <section className="inspector-section artifact-section">
        <div className="section-header">
          <h2>Artifacts (4)</h2>
        </div>
        <div className="artifact-list">
          {selectedTask.artifacts.map((artifact) => (
            <button className="artifact-row" key={artifact.name}>
              <FileText size={15} />
              <span>{artifact.name}</span>
              <em>{fileType(artifact.name)}</em>
              <small>{artifact.size}</small>
              <Download size={14} />
            </button>
          ))}
        </div>
      </section>

      <section className="inspector-section risk-section">
        <div className="section-header">
          <h2>风险与异常</h2>
        </div>
        <div className="risk-box">
          <ul>
            {selectedTask.risks.map((risk) => <li key={risk}>{risk}</li>)}
          </ul>
          <button className="link-button">查看详情</button>
        </div>
      </section>
    </aside>
  );
}
