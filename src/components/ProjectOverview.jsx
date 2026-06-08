import { Copy, Github, GitBranch } from "lucide-react";
import { checkpoints, currentProject, metrics, timeline } from "../data/mockData.js";
import CheckpointStrip from "./CheckpointStrip.jsx";
import MetricCard from "./MetricCard.jsx";
import StatusBadge from "./StatusBadge.jsx";
import TaskTimeline from "./TaskTimeline.jsx";

const stages = ["PM→DSL", "Code Grounding", "Verification Ready"];

export default function ProjectOverview() {
  return (
    <main className="main">
      <div className="main-heading">
        <div>
          <h1>监控台首页</h1>
          <p>全局概览与项目健康状态</p>
        </div>
      </div>

      <section className="panel project-card">
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
            <span>Owner <strong>{currentProject.owner}</strong></span>
            <span><time>{currentProject.updatedAt}</time></span>
            <span><StatusBadge status="pass">{currentProject.status}</StatusBadge></span>
          </div>
        </div>
        <div className="embedded-stage">
          <h2>当前阶段</h2>
          <div className="stage-track">
            {stages.map((stage, index) => (
              <div className={`stage-step ${index === 0 ? "active" : ""}`} key={stage}>
                <span>{index + 1}</span>
                <strong>{stage}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </section>

      <CheckpointStrip checkpoints={checkpoints} />
      <TaskTimeline items={timeline} />
    </main>
  );
}
