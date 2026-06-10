import { ArrowRight, FileText } from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";

export default function PendingReportsQueue({ reports }) {
  return (
    <section className="sidebar-section report-section">
      <div className="section-header">
        <div>
          <h2>待审批报告</h2>
          <small className="section-kicker">全局审批队列</small>
        </div>
        <button className="link-button">查看全部 <ArrowRight size={14} /></button>
      </div>
      <div className="report-list">
        {reports.length ? reports.map((report) => (
          <button key={`${report.title}-${report.time}`} className="report-row">
            <FileText size={16} />
            <span>
              <span className="report-row-top">
                <strong>{report.title}</strong>
                <StatusBadge status={report.tone}>{report.status}</StatusBadge>
              </span>
              <small>{report.project} / {report.time}</small>
            </span>
          </button>
        )) : <p className="monitor-empty-state">暂无待审报告。</p>}
      </div>
    </section>
  );
}
