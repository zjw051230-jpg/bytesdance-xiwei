import { useState } from "react";
import DesignPlanningWorkbench from "./DesignPlanningWorkbench.jsx";
import DSLWorkbench from "./DSLWorkbench.jsx";
import ProjectRail from "./ProjectRail.jsx";
import WorkspaceProjectPicker from "./WorkspaceProjectPicker.jsx";

export default function WorkspaceShell({
  projects,
  activeProjectId,
  onProjectSelect,
  onProjectCreate,
  workspacePage,
  onWorkspacePageChange,
  toast,
  onToast
}) {
  const [railExpanded, setRailExpanded] = useState(false);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];

  const enterWorkbench = (project = activeProject) => {
    if (project) {
      onProjectSelect(project, "enter");
      onWorkspacePageChange("dsl");
    }
  };

  const handleRailSelect = (project) => {
    onProjectSelect(project, "rail");
  };

  return (
    <div
      className={`workspace-shell ${railExpanded ? "rail-expanded" : "rail-collapsed"}`}
      data-testid="workspace-shell"
      data-rail-state={railExpanded ? "expanded" : "collapsed"}
      data-workspace-view={workspacePage}
    >
      <ProjectRail
        expanded={railExpanded}
        projects={projects}
        activeProject={activeProject}
        activeProjectId={activeProjectId}
        onToggle={() => setRailExpanded((current) => !current)}
        onProjectSelect={handleRailSelect}
      />
      <div className="workspace-content">
        {workspacePage === "picker" ? (
          <WorkspaceProjectPicker
            projects={projects}
            activeProjectId={activeProjectId}
            onProjectSelect={(project) => onProjectSelect(project, "picker")}
            onProjectCreate={onProjectCreate}
            onEnterWorkbench={enterWorkbench}
            toast={toast}
          />
        ) : null}
        {workspacePage === "dsl" ? (
          <DSLWorkbench
            activeProject={activeProject}
            toast={toast}
            onToast={onToast}
          />
        ) : null}
        {workspacePage === "design" ? (
          <DesignPlanningWorkbench activeProject={activeProject} toast={toast} />
        ) : null}
        {workspacePage === "review" || workspacePage === "pr" ? (
          <PlaceholderWorkbench page={workspacePage} />
        ) : null}
      </div>
    </div>
  );
}

function PlaceholderWorkbench({ page }) {
  const title = page === "review" ? "审阅检查" : "PR 页面";
  return (
    <main className="workspace-placeholder" data-testid={`${page}-placeholder`}>
      <section>
        <h1>{title}</h1>
        <p>即将开放</p>
      </section>
    </main>
  );
}
