import { useMemo, useState } from "react";
import NewProjectModal from "./NewProjectModal.jsx";
import ProjectSelectCard from "./ProjectSelectCard.jsx";
import { fallbackProject, workspaceProjects } from "../data/workspaceProjects.js";

const newProjectCard = {
  id: "new-project",
  name: "新建项目",
  description: "从空白开始创建一个新项目"
};

export default function WorkspaceProjectPicker({
  projects = workspaceProjects,
  activeProjectId,
  onProjectSelect,
  onProjectCreate,
  onEnterWorkbench,
  toast
}) {
  const displayProjects = useMemo(() => {
    return projects.length > 0 ? projects : [fallbackProject];
  }, [projects]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const visibleProjects = displayProjects.slice(0, 5);

  const createProject = (projectDraft) => {
    onProjectCreate?.(projectDraft);
    setIsModalOpen(false);
  };

  return (
    <main className="workspace-picker" data-testid="workspace-project-picker">
      <section className="workspace-picker-column" aria-labelledby="workspace-picker-title">
        <h1 id="workspace-picker-title" className="workspace-title">选择你的项目</h1>
        <div className="project-select-list" aria-label="项目列表">
          <ProjectSelectCard
            project={newProjectCard}
            variant="new"
            onClick={() => setIsModalOpen(true)}
          />
          {visibleProjects.map((project) => (
            <ProjectSelectCard
              key={project.id}
              project={project}
              selected={activeProjectId === project.id}
              onClick={() => onProjectSelect?.(project)}
              onDoubleClick={() => onEnterWorkbench?.(project)}
            />
          ))}
        </div>
        {activeProjectId ? (
          <button className="enter-workbench-button" type="button" onClick={() => onEnterWorkbench?.()}>
            进入工作台
          </button>
        ) : null}
      </section>

      {toast ? <div className="selection-toast" role="status">{toast}</div> : null}
      {isModalOpen ? (
        <NewProjectModal
          onCancel={() => setIsModalOpen(false)}
          onCreate={createProject}
        />
      ) : null}
    </main>
  );
}
