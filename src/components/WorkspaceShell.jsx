import { useState } from "react";
import DesignPlanningWorkbench from "./DesignPlanningWorkbench.jsx";
import DSLWorkbench from "./DSLWorkbench.jsx";
import PRWorkbench from "./PRWorkbench.jsx";
import ProjectRail from "./ProjectRail.jsx";
import ReviewCheckWorkbench from "./ReviewCheckWorkbench.jsx";
import WorkspaceProjectPicker from "./WorkspaceProjectPicker.jsx";
import { initialAgentWorkflowState } from "../data/agentWorkflowData.js";

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
  const [agentWorkflow, setAgentWorkflow] = useState(initialAgentWorkflowState);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];

  const enterWorkbench = (project = activeProject) => {
    if (project) {
      onProjectSelect(project, "enter");
      onWorkspacePageChange("dsl");
    }
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
        onProjectSelect={(project) => onProjectSelect(project, "rail")}
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
          <DSLWorkbench activeProject={activeProject} toast={toast} onToast={onToast} />
        ) : null}
        {workspacePage === "design" ? (
          <DesignPlanningWorkbench
            activeProject={activeProject}
            toast={toast}
            onToast={onToast}
            agentWorkflow={agentWorkflow}
            onAgentWorkflowChange={setAgentWorkflow}
            onOpenReview={() => onWorkspacePageChange("review")}
            onOpenPr={() => onWorkspacePageChange("pr")}
          />
        ) : null}
        {workspacePage === "review" ? (
          <ReviewCheckWorkbench agentWorkflow={agentWorkflow} onOpenPr={() => onWorkspacePageChange("pr")} />
        ) : null}
        {workspacePage === "pr" ? (
          <PRWorkbench agentWorkflow={agentWorkflow} />
        ) : null}
      </div>
    </div>
  );
}
