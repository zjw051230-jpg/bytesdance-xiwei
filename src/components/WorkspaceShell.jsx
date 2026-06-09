import { useEffect, useState } from "react";
import DesignPlanningWorkbench from "./DesignPlanningWorkbench.jsx";
import DSLWorkbench from "./DSLWorkbench.jsx";
import PRWorkbench from "./PRWorkbench.jsx";
import ProjectRail from "./ProjectRail.jsx";
import ReviewCheckWorkbench from "./ReviewCheckWorkbench.jsx";
import WorkspaceProjectPicker from "./WorkspaceProjectPicker.jsx";
import { getRequirement, listRequirements } from "../api/persistenceClient.js";
import { initialAgentWorkflowState } from "../data/agentWorkflowData.js";

export default function WorkspaceShell({
  projects,
  activeProjectId,
  onProjectSelect,
  onProjectCreate,
  workspacePage,
  onWorkspacePageChange,
  toast,
  onToast,
  projectLoadState
}) {
  const [railExpanded, setRailExpanded] = useState(false);
  const [agentWorkflow, setAgentWorkflow] = useState(initialAgentWorkflowState);
  const [activeRequirement, setActiveRequirement] = useState(null);
  const [requirementError, setRequirementError] = useState("");
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];

  useEffect(() => {
    let active = true;
    setActiveRequirement(null);
    setRequirementError("");
    if (!activeProject?.id) return () => {
      active = false;
    };
    if (String(activeProject.id).startsWith("pending-")) return () => {
      active = false;
    };

    listRequirements(activeProject.id)
      .then(async (requirements) => {
        if (!active) return;
        const latest = Array.isArray(requirements) ? requirements[0] : null;
        if (!latest?.id) {
          setActiveRequirement(null);
          return;
        }
        const requirement = await getRequirement(latest.id);
        if (active) setActiveRequirement(requirement);
      })
      .catch((error) => {
        if (!active) return;
        setRequirementError(error.message || "需求 API 加载失败");
      });

    return () => {
      active = false;
    };
  }, [activeProject?.id]);

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
            projectLoadState={projectLoadState}
          />
        ) : null}
        {workspacePage === "dsl" ? (
          <DSLWorkbench
            activeProject={activeProject}
            activeRequirement={activeRequirement}
            onRequirementChange={setActiveRequirement}
            requirementError={requirementError}
            toast={toast}
            onToast={onToast}
          />
        ) : null}
        {workspacePage === "design" ? (
          <DesignPlanningWorkbench
            activeProject={activeProject}
            activeRequirement={activeRequirement}
            requirementError={requirementError}
            toast={toast}
            onToast={onToast}
            agentWorkflow={agentWorkflow}
            onAgentWorkflowChange={setAgentWorkflow}
            onOpenReview={() => onWorkspacePageChange("review")}
            onOpenPr={() => onWorkspacePageChange("pr")}
          />
        ) : null}
        {workspacePage === "review" ? (
          <ReviewCheckWorkbench
            activeRequirement={activeRequirement}
            agentWorkflow={agentWorkflow}
            onAgentWorkflowChange={setAgentWorkflow}
            onOpenPr={() => onWorkspacePageChange("pr")}
          />
        ) : null}
        {workspacePage === "pr" ? (
          <PRWorkbench
            activeRequirement={activeRequirement}
            agentWorkflow={agentWorkflow}
            onAgentWorkflowChange={setAgentWorkflow}
          />
        ) : null}
      </div>
    </div>
  );
}
