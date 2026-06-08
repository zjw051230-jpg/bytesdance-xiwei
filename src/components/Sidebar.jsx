import ProjectList from "./ProjectList.jsx";
import RunList from "./RunList.jsx";
import PendingReportsQueue from "./PendingReportsQueue.jsx";
import { pendingReports, projects, runs } from "../data/mockData.js";

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <ProjectList projects={projects} />
      <RunList runs={runs} />
      <PendingReportsQueue reports={pendingReports} />
    </aside>
  );
}
