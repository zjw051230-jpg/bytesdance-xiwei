import { FolderKanban, Menu, PanelLeftClose, Plus, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import NewProjectModal from "./NewProjectModal.jsx";
import ProjectRailItem from "./ProjectRailItem.jsx";

export default function ProjectRail({
  expanded,
  projects,
  activeProject,
  activeProjectId,
  onToggle,
  onProjectSelect,
  onProjectCreate,
  onProjectDelete
}) {
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const canDeleteActiveProject = Boolean(activeProject?.id);

  const createProject = (projectDraft) => {
    onProjectCreate?.(projectDraft);
    setIsNewProjectOpen(false);
  };

  const deleteActiveProject = () => {
    if (!canDeleteActiveProject) return;
    const confirmed = window.confirm(`删除工程「${activeProject.name}」？`);
    if (confirmed) {
      onProjectDelete?.(activeProject);
    }
  };

  return (
    <>
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
                <span>XiWei</span>
              </div>
              <button className="rail-icon-button" type="button" aria-label="收起项目切换栏" onClick={onToggle}>
                <PanelLeftClose size={18} />
              </button>
            </div>

            <div className="rail-actions" aria-label="工程操作">
              <button className="rail-action-button" type="button" onClick={() => setIsNewProjectOpen(true)}>
                <Plus size={15} />
                <span>新增工程</span>
              </button>
              <button
                className="rail-action-button danger"
                type="button"
                onClick={deleteActiveProject}
                disabled={!canDeleteActiveProject}
              >
                <Trash2 size={15} />
                <span>删除工程</span>
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
      {isNewProjectOpen ? (
        <NewProjectModal
          onCancel={() => setIsNewProjectOpen(false)}
          onCreate={createProject}
        />
      ) : null}
    </>
  );
}
