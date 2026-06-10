import { AlertTriangle, CheckCircle2, SlidersHorizontal, XCircle } from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";

const icons = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  pending: AlertTriangle
};

export default function RunList({ runs }) {
  return (
    <section className="sidebar-section run-section">
      <div className="section-header">
        <h2>运行记录</h2>
        <button className="filter-button">全部状态 <SlidersHorizontal size={13} /></button>
      </div>
      <div className="run-list">
        {runs.length ? runs.map((run) => {
          const Icon = icons[run.status] || AlertTriangle;
          return (
            <button key={run.id} className="run-row">
              <Icon className={`run-icon ${run.status}`} size={16} />
              <span>
                <code>{run.id}</code>
                <small>{run.time}</small>
              </span>
              <StatusBadge status={run.status} />
            </button>
          );
        }) : <p className="monitor-empty-state">暂无真实运行记录。</p>}
      </div>
    </section>
  );
}
