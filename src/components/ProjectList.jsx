import { ChevronRight, MoreVertical, Plus } from "lucide-react";

export default function ProjectList({ projects }) {
  return (
    <section className="sidebar-section project-section">
      <div className="section-header">
        <h2>项目</h2>
        <button className="small-button"><Plus size={14} />新建项目</button>
      </div>
      <div className="project-list">
        {projects.map((project) => (
          <button key={project.name} className={`project-row ${project.selected ? "selected" : ""}`}>
            <span className={`status-dot dot-${project.status}`} />
            <span className="project-copy">
              <strong>{project.name}</strong>
              {project.selected && <span>当前阶段: {project.phase}</span>}
            </span>
            {project.selected ? <ChevronRight className="row-icon" size={15} /> : <MoreVertical className="row-icon" size={15} />}
          </button>
        ))}
      </div>
      <button className="link-button project-all">查看全部项目 (12)</button>
    </section>
  );
}
