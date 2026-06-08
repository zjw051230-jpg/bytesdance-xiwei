import { ChevronRight, Code2, Database, Folder, Plus } from "lucide-react";

const iconMap = {
  code: Code2,
  database: Database,
  folder: Folder
};

export default function ProjectSelectCard({
  project,
  variant = "project",
  selected = false,
  onClick,
  onDoubleClick
}) {
  const Icon = variant === "new" ? Plus : iconMap[project.icon] ?? Folder;
  const titleId = `project-card-${project.id}`;

  return (
    <button
      className={`project-select-card ${variant === "new" ? "new-project-card" : ""} ${selected ? "selected" : ""}`}
      type="button"
      aria-labelledby={titleId}
      aria-pressed={variant === "project" ? selected : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <span className="project-select-icon" aria-hidden="true">
        <Icon size={24} strokeWidth={2.1} />
      </span>
      <span className="project-select-copy">
        <strong id={titleId}>{project.name}</strong>
        <span>{project.description}</span>
      </span>
      {variant === "project" ? (
        <ChevronRight className="project-select-chevron" size={21} aria-hidden="true" />
      ) : null}
    </button>
  );
}
