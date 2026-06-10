import { useEffect, useState } from "react";
import MonitorConsole from "./MonitorConsole.jsx";
import TopBar from "./TopBar.jsx";
import WorkspaceShell from "./WorkspaceShell.jsx";
import { loadMonitorConsoleData } from "../api/monitorClient.js";
import { createProject as createPersistedProject, deleteProject as deletePersistedProject, listProjects, updateProject } from "../api/persistenceClient.js";
import { buildMonitorConsoleModel } from "../adapters/monitorConsoleAdapter.js";

const initialProjects = import.meta.env.MODE === "test" ? [
  {
    id: "persistence-project",
    name: "Persistence Project",
    description: "Project returned by persistence API in tests",
    railSubtitle: "F:\\Projects\\Persistence",
    localPath: "F:\\Projects\\Persistence",
    status: "current",
    icon: "code"
  },
  {
    id: "codex-workbench",
    name: "Codex Workbench",
    description: "Workbench project",
    railSubtitle: "F:\\Projects\\Codex Workbench",
    localPath: "F:\\Projects\\Codex Workbench",
    status: "pass",
    icon: "code"
  },
  {
    id: "ai-agent-framework",
    name: "AI Agent Framework",
    description: "Agent project",
    railSubtitle: "F:\\Agents\\Framework",
    localPath: "F:\\Agents\\Framework",
    status: "current",
    icon: "folder"
  },
  {
    id: "data-pipeline",
    name: "Data Pipeline",
    description: "Pipeline project",
    railSubtitle: "F:\\Projects\\Data Pipeline",
    localPath: "F:\\Projects\\Data Pipeline",
    status: "warn",
    icon: "database"
  }
] : [];

export default function AppShell() {
  const directPrRoute = parsePrDraftRoute();
  const [mode, setMode] = useState(directPrRoute ? "workbench" : "monitor");
  const [projectList, setProjectList] = useState(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState(directPrRoute?.projectId || initialProjects[0]?.id);
  const [projectLoadState, setProjectLoadState] = useState({ loading: true, error: "" });
  const [monitorLoadState, setMonitorLoadState] = useState({ loading: true, error: "" });
  const [monitorData, setMonitorData] = useState({});
  const [workspacePage, setWorkspacePage] = useState(directPrRoute ? "pr" : "picker");
  const [workspaceToast, setWorkspaceToast] = useState("");

  useEffect(() => {
    if (
      !import.meta.env.DEV ||
      import.meta.env.MODE === "test" ||
      !window.__workbenchFirstRenderTimingStarted ||
      window.__workbenchFirstRenderTimingEnded
    ) return;
    window.__workbenchFirstRenderTimingEnded = true;
    console.timeEnd("workbench:first-render");
  }, []);

  useEffect(() => {
    let active = true;
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    setProjectLoadState({ loading: true, error: "" });
    listProjects()
      .then((projects) => {
        if (!active || !Array.isArray(projects)) return;
        setProjectList(projects);
        setActiveProjectId((current) => {
          const currentProject = projects.find((project) => project.id === current);
          if (currentProject?.localPath) return currentProject.id;
          return projects[0]?.id || currentProject?.id;
        });
        setProjectLoadState({ loading: false, error: "" });
        logDevDuration("workbench:project-load", startedAt);
      })
      .catch((error) => {
        if (!active) return;
        setProjectLoadState({ loading: false, error: error.message || "项目 API 加载失败" });
        logDevDuration("workbench:project-load", startedAt);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setMonitorLoadState({ loading: true, error: "" });
    loadMonitorConsoleData({ projects: projectList, activeProjectId })
      .then((data) => {
        if (!active) return;
        setMonitorData(data);
        setMonitorLoadState({ loading: false, error: "" });
      })
      .catch((error) => {
        if (!active) return;
        setMonitorData({});
        setMonitorLoadState({ loading: false, error: error.message || "Monitor data load failed" });
      });
    return () => {
      active = false;
    };
  }, [activeProjectId, projectList]);

  const selectProject = (project, source = "picker") => {
    setActiveProjectId(project.id);
    updateProject(project.id, { lastOpenedAt: new Date().toISOString() }).catch(() => {});
    if (source === "rail") {
      setWorkspaceToast(`已切换到 ${project.name}`);
    } else if (source !== "enter") {
      setWorkspaceToast(`已选择 ${project.name}`);
    }
  };

  const createProject = async ({ name, localPath }) => {
    const draft = {
      name,
      localPath,
      description: localPath ? `本地路径：${localPath}` : "刚刚创建的项目",
      railSubtitle: localPath || "刚刚创建",
      status: "current",
      icon: "folder"
    };
    const optimisticProject = {
      ...draft,
      id: `pending-${Date.now()}`
    };
    setProjectList((currentProjects) => [optimisticProject, ...currentProjects]);
    setActiveProjectId(optimisticProject.id);
    setWorkspaceToast(`已创建 ${name}`);
    try {
      const createdProject = await createPersistedProject(draft);
      if (!createdProject?.id || !createdProject?.name) return;
      setProjectList((currentProjects) => [
        createdProject,
        ...currentProjects.filter((project) => project.id !== optimisticProject.id && project.id !== createdProject.id)
      ]);
      setActiveProjectId((current) => current === optimisticProject.id ? createdProject.id : current);
      setWorkspaceToast(`已创建 ${createdProject.name}`);
    } catch (error) {
      setWorkspaceToast(`项目创建失败：${error.message || "Persistence API request failed"}`);
    }
  };

  const removeProjectFromState = (projectId) => {
    setProjectList((currentProjects) => {
      const nextProjects = currentProjects.filter((project) => project.id !== projectId);
      setActiveProjectId((current) => current === projectId ? nextProjects[0]?.id : current);
      return nextProjects;
    });
  };

  const deleteProject = async (project) => {
    if (!project?.id) return;
    const isLocalOnlyProject = /^pending-/.test(String(project.id));
    if (isLocalOnlyProject) {
      removeProjectFromState(project.id);
      setWorkspaceToast(`已删除 ${project.name}`);
      return;
    }

    try {
      await deletePersistedProject(project.id);
      removeProjectFromState(project.id);
      setWorkspaceToast(`已删除 ${project.name}`);
    } catch (error) {
      setWorkspaceToast(`工程删除失败：${error.message || "Persistence API request failed"}`);
    }
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    if (nextMode === "workbench" && workspacePage !== "picker") {
      return;
    }
    if (nextMode === "workbench") {
      setWorkspaceToast("");
    }
  };

  const handleWorkspacePageChange = (page) => {
    setMode("workbench");
    setWorkspacePage(page);
  };

  const monitorModel = buildMonitorConsoleModel({
    projects: projectList,
    activeProjectId,
    ...monitorData,
    loadState: monitorLoadState
  });

  return (
    <div className="app-shell">
      <TopBar
        mode={mode}
        onModeChange={handleModeChange}
        activeWorkspacePage={workspacePage === "picker" ? "dsl" : workspacePage}
        onWorkspacePageChange={handleWorkspacePageChange}
      />
      {mode === "monitor" ? (
        <div className="layout monitor-layout" data-testid="monitor-console-view">
          <MonitorConsole monitor={monitorModel} onProjectSelect={(project) => selectProject(project, "monitor")} />
        </div>
      ) : (
        <WorkspaceShell
          projects={projectList}
          activeProjectId={activeProjectId}
          onProjectSelect={selectProject}
          onProjectCreate={createProject}
          onProjectDelete={deleteProject}
          workspacePage={workspacePage}
          onWorkspacePageChange={setWorkspacePage}
          toast={workspaceToast}
          onToast={setWorkspaceToast}
          projectLoadState={projectLoadState}
          routeRequirementId={directPrRoute?.requirementId}
          routeProjectId={directPrRoute?.projectId}
        />
      )}
    </div>
  );
}

function parsePrDraftRoute() {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/projects\/([^/]+)\/requirements\/([^/]+)\/pr-draft\/?$/);
  if (!match) return null;
  return {
    projectId: decodeURIComponent(match[1]),
    requirementId: decodeURIComponent(match[2])
  };
}

function logDevDuration(label, startedAt) {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test") return;
  const elapsedMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
  console.info(`[${label}]`, `${elapsedMs}ms`);
}
