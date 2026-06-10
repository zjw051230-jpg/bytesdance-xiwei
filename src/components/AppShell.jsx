import { useState } from "react";
import ProjectOverview from "./ProjectOverview.jsx";
import Sidebar from "./Sidebar.jsx";
import TaskInspector from "./TaskInspector.jsx";
import TopBar from "./TopBar.jsx";
import WorkspaceShell from "./WorkspaceShell.jsx";
import { fallbackProject, workspaceProjects } from "../data/workspaceProjects.js";

const initialProjects = workspaceProjects.length > 0 ? workspaceProjects : [fallbackProject];

export default function AppShell() {
  const [mode, setMode] = useState("monitor");
  const [projectList, setProjectList] = useState(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState(initialProjects[0]?.id);
  const [workspacePage, setWorkspacePage] = useState("picker");
  const [workspaceToast, setWorkspaceToast] = useState("");

  const selectProject = (project, source = "picker") => {
    setActiveProjectId(project.id);
    if (source === "rail") {
      setWorkspaceToast(`已切换到 ${project.name}`);
    } else if (source !== "enter") {
      setWorkspaceToast(`已选择 ${project.name}`);
    }
  };

  const createProject = ({ name, localPath }) => {
    const createdProject = {
      id: `mock-${Date.now()}`,
      name,
      localPath,
      description: localPath ? `本地路径：${localPath}` : "刚刚创建的 mock 项目",
      railSubtitle: localPath || "刚刚创建",
      status: "current",
      icon: "folder"
    };
    setProjectList((currentProjects) => [createdProject, ...currentProjects]);
    setActiveProjectId(createdProject.id);
    setWorkspaceToast(`已创建 ${name}`);
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
        />
      )}
    </div>
  );
}
