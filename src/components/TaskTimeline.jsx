import { ArrowRight, Check, TriangleAlert, X } from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";

const markerIcons = {
  PASS: Check,
  WARN: TriangleAlert,
  FAIL: X
};

export default function TaskTimeline({ items }) {
  return (
    <section className="panel timeline-panel">
      <div className="panel-title">
        <div className="timeline-heading-left">
          <h2>最近任务时间线</h2>
          <button className="filter-button">全部任务</button>
        </div>
        <button className="link-button">查看全部任务 <ArrowRight size={14} /></button>
      </div>
      <div className="timeline-table">
        {items.map((item) => {
          const Icon = markerIcons[item.status];
          return (
            <button className="timeline-row" key={item.id}>
              <span className={`timeline-marker ${item.status.toLowerCase()}`}><Icon size={13} /></span>
              <span className="timeline-main">
                <strong>{item.task}</strong>
                <span><code>{item.id}</code><small>{item.meta}</small></span>
              </span>
              <strong>{item.score}</strong>
              <StatusBadge status={item.status.toLowerCase()}>{item.status}</StatusBadge>
              <time><span>{item.time}</span><small>{item.duration}</small></time>
            </button>
          );
        })}
      </div>
    </section>
  );
}
