import { useState } from "react";
import DSLWorkbench from "./DSLWorkbench.jsx";
import ProjectRail from "./ProjectRail.jsx";
import WorkspaceProjectPicker from "./WorkspaceProjectPicker.jsx";

export default function WorkspaceShell({
  projects,
  activeProjectId,
  onProjectSelect,
  onProjectCreate,
  toast,
  onToast
}) {
  const [railExpanded, setRailExpanded] = useState(false);
  const [workspaceView, setWorkspaceView] = useState("picker");
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];

  const enterWorkbench = (project = activeProject) => {
    if (project) {
      onProjectSelect(project, "enter");
      setWorkspaceView("dsl");
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
      data-workspace-view={workspaceView}
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
        {workspaceView === "picker" ? (
          <WorkspaceProjectPicker
            projects={projects}
            activeProjectId={activeProjectId}
            onProjectSelect={(project) => onProjectSelect(project, "picker")}
            onProjectCreate={onProjectCreate}
            onEnterWorkbench={enterWorkbench}
            toast={toast}
          />
        ) : (
          <DSLWorkbench
            activeProject={activeProject}
            toast={toast}
            onToast={onToast}
          />
        )}
      </div>
    </div>
  );
}
