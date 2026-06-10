import ProjectList from "./ProjectList.jsx";
import RunList from "./RunList.jsx";
import PendingReportsQueue from "./PendingReportsQueue.jsx";

export default function Sidebar({ monitor }) {
  return (
    <aside className="sidebar">
      <ProjectList projects={monitor?.projects || []} />
      <RunList runs={monitor?.runs || []} />
      <PendingReportsQueue reports={monitor?.pendingReports || []} />
    </aside>
  );
}
