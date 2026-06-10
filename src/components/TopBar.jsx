import { Bell, ChevronDown, CircleHelp } from "lucide-react";
import WorkspaceTopTabs from "./WorkspaceTopTabs.jsx";

export default function TopBar({ mode, onModeChange, activeWorkspacePage, onWorkspacePageChange }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="codex-mark" aria-hidden="true"><span /><span /></span>
        <span>Codex Workbench</span>
      </div>
      {mode === "workbench" ? (
        <div className="workspace-nav-cluster">
          <button
            className="workspace-monitor-return"
            type="button"
            aria-label="返回监控台"
            onClick={() => onModeChange("monitor")}
          >
            监控台
          </button>
          <WorkspaceTopTabs activePage={activeWorkspacePage} onPageChange={onWorkspacePageChange} />
        </div>
      ) : (
        <nav className="mode-tabs" aria-label="全局模式">
          <button
            className={`mode-tab ${mode === "monitor" ? "selected" : ""}`}
            aria-pressed={mode === "monitor"}
            onClick={() => onModeChange("monitor")}
          >
            监控台
          </button>
          <button
            className={`mode-tab ${mode === "workbench" ? "selected" : ""}`}
            aria-pressed={mode === "workbench"}
            onClick={() => onModeChange("workbench")}
          >
            工作台
          </button>
        </nav>
      )}
      <div className="top-actions" aria-label="快捷操作">
        <button className="icon-button notification" aria-label="通知"><Bell size={17} /></button>
        <button className="icon-button" aria-label="帮助"><CircleHelp size={17} /></button>
        <div className="user-chip">
          <span className="avatar">H</span>
          <span>Horizon</span>
          <ChevronDown size={14} />
        </div>
      </div>
    </header>
  );
}
