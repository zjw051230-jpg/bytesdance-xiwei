export default function ProjectRailItem({ project, active, onSelect }) {
  return (
    <button
      className={`project-rail-item ${active ? "active" : ""}`}
      type="button"
      aria-label={`切换到 ${project.name}`}
      aria-pressed={active}
      onClick={() => onSelect(project)}
    >
      <span className={`rail-status-dot rail-status-${project.status ?? "muted"}`} aria-hidden="true" />
      <span className="rail-item-copy">
        <strong>{project.name}</strong>
        <span>{project.railSubtitle ?? project.description}</span>
      </span>
    </button>
  );
}
