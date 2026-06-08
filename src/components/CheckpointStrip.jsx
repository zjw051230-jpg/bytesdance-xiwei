import { ArrowRight, Check } from "lucide-react";

export default function CheckpointStrip({ checkpoints }) {
  return (
    <section className="panel checkpoint-panel">
      <div className="panel-title">
        <h2>最近检查点</h2>
        <button className="link-button">查看全部 <ArrowRight size={14} /></button>
      </div>
      <div className="checkpoint-strip">
        {checkpoints.map((checkpoint) => (
          <div className="checkpoint-item" key={checkpoint.label}>
            <span className="check-icon"><Check size={13} /></span>
            <strong>{checkpoint.label}</strong>
            <time>{checkpoint.time}</time>
          </div>
        ))}
      </div>
    </section>
  );
}
