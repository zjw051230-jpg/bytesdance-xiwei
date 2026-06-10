import { ArrowRight, Check } from "lucide-react";

export default function CheckpointStrip({ checkpoints }) {
  return (
    <section className="panel checkpoint-panel">
      <div className="panel-title">
        <h2>最近检查点</h2>
        <button className="link-button">查看全部 <ArrowRight size={14} /></button>
      </div>
      <div className="checkpoint-strip">
        {checkpoints.length ? checkpoints.map((checkpoint) => (
          <div className="checkpoint-item" key={`${checkpoint.label}-${checkpoint.time}`}>
            <span className="check-icon"><Check size={13} /></span>
            <strong>{checkpoint.label}</strong>
            <time>{checkpoint.time}</time>
          </div>
        )) : <p className="monitor-empty-state">暂无真实检查点。</p>}
      </div>
    </section>
  );
}
