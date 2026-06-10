import { useEffect, useState } from "react";
import ProjectOverview from "./ProjectOverview.jsx";
import Sidebar from "./Sidebar.jsx";
import TaskInspector from "./TaskInspector.jsx";
import TopBar from "./TopBar.jsx";
import WorkspaceShell from "./WorkspaceShell.jsx";
import { createProject as createPersistedProject, listProjects, updateProject } from "../api/persistenceClient.js";
import { fallbackProject, workspaceProjects } from "../data/workspaceProjects.js";

const initialProjects = workspaceProjects.length > 0 ? workspaceProjects : [fallbackProject];

export default function AppShell() {
  const [mode, setMode] = useState("monitor");
  const [projectList, setProjectList] = useState(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState(initialProjects[0]?.id);
  const [projectLoadState, setProjectLoadState] = useState({ loading: true, error: "" });
  const [workspacePage, setWorkspacePage] = useState("picker");
  const [workspaceToast, setWorkspaceToast] = useState("");

  useEffect(() => {
    let active = true;
    setProjectLoadState({ loading: true, error: "" });
    listProjects()
      .then((projects) => {
        if (!active || !Array.isArray(projects)) return;
        setProjectList(projects);
        setActiveProjectId((current) => projects.some((project) => project.id === current) ? current : projects[0]?.id);
        setProjectLoadState({ loading: false, error: "" });
      })
      .catch((error) => {
        if (!active) return;
        setProjectLoadState({ loading: false, error: error.message || "项目 API 加载失败" });
      });
    return () => {
      active = false;
    };
  }, []);

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
      id: `mock-${Date.now()}`
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

  return (
    <div className="app-shell">
      <TopBar
        mode={mode}
        onModeChange={handleModeChange}
        activeWorkspacePage={workspacePage === "picker" ? "dsl" : workspacePage}
        onWorkspacePageChange={handleWorkspacePageChange}
      />
      {mode === "monitor" ? (
        <div className="layout" data-testid="monitor-console-view">
          <Sidebar />
          <ProjectOverview />
          <TaskInspector />
        </div>
      ) : (
        <WorkspaceShell
          projects={projectList}
          activeProjectId={activeProjectId}
          onProjectSelect={selectProject}
          onProjectCreate={createProject}
          workspacePage={workspacePage}
          onWorkspacePageChange={setWorkspacePage}
          toast={workspaceToast}
          onToast={setWorkspaceToast}
          projectLoadState={projectLoadState}
        />
      )}
    </div>
  );
}
