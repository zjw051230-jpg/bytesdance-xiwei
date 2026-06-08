import { BookOpen, ShieldCheck, Sparkles, Target } from "lucide-react";

const icons = [BookOpen, Target, ShieldCheck, Sparkles];

export default function ReportQualityPanel({ reportQuality = [], note }) {
  return (
    <aside className="report-quality-panel" aria-label="报告质量">
      <h3>报告质量</h3>
      <div className="quality-list">
        {reportQuality.map((metric, index) => {
          const Icon = icons[index] ?? Sparkles;
          return (
            <div className="quality-row" key={metric.label}>
              <Icon size={18} />
              <span>{metric.label}</span>
              <i><b style={{ width: `${metric.value}%` }} /></i>
              <strong className={metric.tone ?? ""}>{metric.value}</strong>
            </div>
          );
        })}
      </div>
      <div className="report-conclusion">
        <strong>需要继续澄清</strong>
      </div>
      <div className="report-hint">
        <strong>提示</strong>
        <p>{note || "关键决策项仍未确认，建议补充缺失内容后再进入后续流程。"}</p>
      </div>
    </aside>
  );
}
