import { useCallback, useEffect, useState } from "react";
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
  onProjectDelete,
  workspacePage,
  onWorkspacePageChange,
  toast,
  onToast,
  projectLoadState,
  routeRequirementId,
  routeProjectId
}) {
  const [railExpanded, setRailExpanded] = useState(false);
  const [agentWorkflowByScope, setAgentWorkflowByScope] = useState({});
  const [activeRequirement, setActiveRequirement] = useState(null);
  const [requirementError, setRequirementError] = useState("");
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  const activeRequirementForProject = requirementBelongsToProject(activeRequirement, activeProject) ? activeRequirement : null;
  const workflowScopeKey = buildWorkflowScopeKey(activeProject?.id, activeRequirementForProject?.id);
  const agentWorkflow = agentWorkflowByScope[workflowScopeKey] || initialAgentWorkflowState;
  const setScopedAgentWorkflow = useCallback((updater) => {
    setAgentWorkflowByScope((current) => {
      const previous = current[workflowScopeKey] || initialAgentWorkflowState;
      const next = typeof updater === "function" ? updater(previous) : updater;
      if (Object.is(next, previous)) return current;
      return { ...current, [workflowScopeKey]: next || initialAgentWorkflowState };
    });
  }, [workflowScopeKey]);

  useEffect(() => {
    let active = true;
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    setActiveRequirement(null);
    setRequirementError("");
    if (!activeProject?.id && !routeRequirementId) return () => {
      active = false;
    };
    if (!routeRequirementId && /^(pending|mock)-/.test(String(activeProject.id))) return () => {
      active = false;
    };

    const requirementPromise = routeRequirementId ? getRequirement(routeRequirementId) : listRequirements(activeProject.id);
    requirementPromise
      .then(async (requirements) => {
        if (!active) return;
        if (routeRequirementId && requirements?.id) {
          setActiveRequirement(requirements);
          logDevDuration("workbench:active-tab-data-load", startedAt);
          return;
        }
        const latest = Array.isArray(requirements) ? requirements[0] : null;
        if (!latest?.id) {
          setActiveRequirement(null);
          return;
        }
        const requirement = await getRequirement(latest.id);
        if (active) {
          setActiveRequirement(requirement);
          logDevDuration("workbench:active-tab-data-load", startedAt);
        }
      })
      .catch((error) => {
        if (!active) return;
        setRequirementError(error.message || "需求 API 加载失败");
      });

    return () => {
      active = false;
    };
  }, [activeProject?.id, routeRequirementId]);

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
        onProjectCreate={onProjectCreate}
        onProjectDelete={onProjectDelete}
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
            activeRequirement={activeRequirementForProject}
            onRequirementChange={setActiveRequirement}
            requirementError={requirementError}
            toast={toast}
            onToast={onToast}
            onStartConstruction={() => onWorkspacePageChange("design")}
          />
        ) : null}
        {workspacePage === "design" ? (
          <DesignPlanningWorkbench
            activeProject={activeProject}
            activeRequirement={activeRequirementForProject}
            requirementError={requirementError}
            toast={toast}
            onToast={onToast}
            agentWorkflow={agentWorkflow}
            onAgentWorkflowChange={setScopedAgentWorkflow}
            onOpenReview={() => onWorkspacePageChange("review")}
            onOpenPr={() => onWorkspacePageChange("pr")}
          />
        ) : null}
        {workspacePage === "review" ? (
          <ReviewCheckWorkbench
            activeProject={activeProject}
            activeRequirement={activeRequirementForProject}
            agentWorkflow={agentWorkflow}
            onAgentWorkflowChange={setScopedAgentWorkflow}
            onOpenPr={() => onWorkspacePageChange("pr")}
          />
        ) : null}
        {workspacePage === "pr" ? (
          <PRWorkbench
            activeProject={activeProject}
            activeRequirement={activeRequirementForProject}
            requirementId={routeRequirementId}
            projectId={routeProjectId || activeProject?.id}
            agentWorkflow={agentWorkflow}
            onAgentWorkflowChange={setScopedAgentWorkflow}
          />
        ) : null}
      </div>
    </div>
  );
}

function buildWorkflowScopeKey(projectId, requirementId) {
  return `${projectId || "no-project"}:${requirementId || "no-requirement"}`;
}

function requirementBelongsToProject(requirement, project) {
  if (!requirement) return true;
  if (!project?.id || !requirement.projectId) return true;
  return String(requirement.projectId) === String(project.id);
}

function logDevDuration(label, startedAt) {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test") return;
  const elapsedMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
  console.info(`[${label}]`, `${elapsedMs}ms`);
}
