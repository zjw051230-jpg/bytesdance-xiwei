import { Copy, Github, GitBranch } from "lucide-react";
import CheckpointStrip from "./CheckpointStrip.jsx";
import MetricCard from "./MetricCard.jsx";
import StatusBadge from "./StatusBadge.jsx";
import TaskTimeline from "./TaskTimeline.jsx";

export default function ProjectOverview({ monitor }) {
  const currentProject = monitor?.project;
  const metrics = monitor?.metrics || [];
  const checkpoints = monitor?.checkpoints || [];
  const timeline = monitor?.timeline || [];
  const stages = monitor?.stages || [];

  return (
    <main className="main">
      <div className="main-heading">
        <div>
          <h1>监控台首页</h1>
          <p>全局概览与项目健康状态</p>
        </div>
      </div>

      <section className="panel project-card">
        {currentProject ? (
          <>
            <div className="project-card-top">
              <div>
                <div className="project-title">
                  <Github size={28} />
                  <h2>{currentProject.name}</h2>
                  <Copy size={16} />
                </div>
                <p className="project-description">{currentProject.description}</p>
              </div>
              <div className="project-facts">
                <span><GitBranch size={13} /><code>{currentProject.branch}</code></span>
                <span>Project <strong>{currentProject.owner}</strong></span>
                <span><time>{currentProject.updatedAt || "-"}</time></span>
                <span><StatusBadge status={currentProject.status}>{currentProject.status.toUpperCase()}</StatusBadge></span>
              </div>
            </div>
            <div className="embedded-stage">
              <h2>当前阶段</h2>
              <div className="stage-track">
                {stages.map((stage, index) => (
                  <div className={`stage-step ${stage.active ? "active" : ""}`} key={stage.label}>
                    <span>{index + 1}</span>
                    <strong>{stage.label}</strong>
                    <small>{stage.detail}</small>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="monitor-empty-state">
            <strong>暂无真实项目数据</strong>
            <span>{monitor?.loading ? "正在读取后端项目列表..." : "请先在工作台创建或选择项目。"}</span>
            {monitor?.error ? <small>{monitor.error}</small> : null}
          </div>
        )}
      </section>

      <section className="metrics-grid">
        {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </section>

      <CheckpointStrip checkpoints={checkpoints} />
      <TaskTimeline items={timeline} />
    </main>
  );
}
