import { FolderKanban, Menu, PanelLeftClose, UserRound } from "lucide-react";
import ProjectRailItem from "./ProjectRailItem.jsx";

export default function ProjectRail({
  expanded,
  projects,
  activeProject,
  activeProjectId,
  onToggle,
  onProjectSelect
}) {
  return (
    <aside
      className={`project-rail ${expanded ? "expanded" : "collapsed"}`}
      data-testid="project-rail"
      data-state={expanded ? "expanded" : "collapsed"}
      aria-label="项目切换栏"
    >
      {expanded ? (
        <>
          <div className="rail-header">
            <div className="rail-brand">
              <span className="rail-codex-mark" aria-hidden="true"><span /><span /></span>
              <span>Codex Workbench</span>
            </div>
            <button className="rail-icon-button" type="button" aria-label="收起项目切换栏" onClick={onToggle}>
              <PanelLeftClose size={18} />
            </button>
          </div>

          <div className="rail-projects" aria-label="项目">
            {projects.map((project) => (
              <ProjectRailItem
                key={project.id}
                project={project}
                active={activeProjectId === project.id}
                onSelect={onProjectSelect}
              />
            ))}
          </div>

          <div className="rail-current">
            <small>当前项目</small>
            <strong>{activeProject?.name ?? "未选择项目"}</strong>
            <span>{activeProject?.railSubtitle ?? activeProject?.description ?? "等待选择"}</span>
          </div>
        </>
      ) : (
        <>
          <button className="rail-icon-button rail-top-toggle" type="button" aria-label="展开项目切换栏" onClick={onToggle}>
            <Menu size={18} />
          </button>
          <button
            className="rail-project-trigger active"
            type="button"
            aria-label="切换项目"
            title="切换项目"
            onClick={onToggle}
          >
            <FolderKanban size={21} />
          </button>
          <div className="rail-collapsed-bottom" aria-label="当前用户">
            <UserRound size={18} />
          </div>
        </>
      )}
    </aside>
  );
}
