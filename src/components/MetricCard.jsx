import StatusBadge from "./StatusBadge.jsx";

export default function MetricCard({ metric }) {
  const tone = metric.status.toLowerCase();

  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-top">
        <span><i />{metric.label}</span>
        <StatusBadge status={tone}>{metric.status}</StatusBadge>
      </div>
      <div className="metric-hero">
        <div className="score-ring" style={{ "--score": `${metric.score * 3.6}deg` }}>
          <span>{metric.score}</span>
          <small>/100</small>
        </div>
        <div className="metric-summary">
          <strong>{metric.summary}</strong>
          <span>最近 <code>{metric.runId}</code></span>
        </div>
      </div>
      <div className="metric-points">
        {metric.points.map(([label, value]) => (
          <span key={label}><em>{label}</em><strong>{value}</strong></span>
        ))}
      </div>
    </article>
  );
}
