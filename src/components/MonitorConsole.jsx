import { RefreshCw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { buildMonitorTaskSkillView } from "../adapters/monitorTaskSkills.js";
import StatusBadge from "./StatusBadge.jsx";

export default function MonitorConsole({ monitor, onProjectSelect }) {
  const [detail, setDetail] = useState(null);
  const dialogRef = useRef(null);
  const taskView = useMemo(() => buildMonitorTaskSkillView(monitor || {}), [monitor]);
  const projectName = monitor?.project?.name || "Select a project";
  const runStatus = String(monitor?.selectedTask?.liveStatus || "").toLowerCase();
  const isPolling = ["queued", "running", "in_progress"].includes(runStatus);

  const openDetail = (item) => {
    setDetail(item);
    window.requestAnimationFrame(() => {
      if (typeof dialogRef.current?.showModal === "function") dialogRef.current.showModal();
      else dialogRef.current?.setAttribute?.("open", "");
    });
  };

  const closeDetail = () => {
    if (typeof dialogRef.current?.close === "function") dialogRef.current.close();
    else {
      dialogRef.current?.removeAttribute?.("open");
      setDetail(null);
    }
  };

  return (
    <main className="monitor-console" data-testid="monitor-console-overview">
      <header className="monitor-hero panel">
        <div>
          <span className="monitor-kicker">Monitor Console</span>
          <h1>{projectName}</h1>
          <p>Overview first. Live workflow details open on demand.</p>
        </div>
        <div className="monitor-hero-actions">
          <ProjectSwitcher monitor={monitor} onProjectSelect={onProjectSelect} />
          <SourceBadge monitor={monitor} />
          <StatusBadge status={isPolling ? "warn" : "pass"}>{isPolling ? "polling" : "stable"}</StatusBadge>
          <button className="small-button" type="button" disabled={monitor?.loading}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </header>

      {monitor?.error ? <p className="monitor-error-state">{monitor.error}</p> : null}

      <section className="panel monitor-status-strip" aria-label="Monitor status summary">
        {taskView.projectRows.map((row) => (
          <span key={row.label}><small>{row.label}</small><strong>{row.value}</strong></span>
        ))}
      </section>

      <section className="monitor-overview-grid" aria-label="Monitor overview cards">
        {taskView.cards.map((card) => (
          <article className={`monitor-overview-card monitor-card-${card.status}`} key={card.id}>
            <div className="monitor-card-top">
              <span>{card.title}</span>
              <StatusBadge status={card.status}>{card.value}</StatusBadge>
            </div>
            <p>{card.summary}</p>
            <div className="monitor-card-foot">
              <small>source: {card.source}</small>
              <button type="button" onClick={() => openDetail({ type: "card", ...card })}>Details</button>
            </div>
            {Number.isFinite(Number(card.metric)) ? (
              <meter min="0" max="100" value={Number(card.metric)}>{card.metric}</meter>
            ) : null}
          </article>
        ))}
      </section>

      <section className="panel monitor-workflow-panel">
        <div className="panel-title">
          <h2>Workflow progress</h2>
          <span>native progress</span>
        </div>
        <div className="monitor-workflow-list">
          {taskView.workflow.map((step) => (
            <label key={step.id}>
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
              {Number.isFinite(Number(step.value)) ? (
                <progress max="100" value={Number(step.value)}>{step.value}%</progress>
              ) : (
                <em>empty</em>
              )}
            </label>
          ))}
        </div>
      </section>

      <section className="panel monitor-activity-panel">
        <div className="panel-title">
          <h2>Recent activity</h2>
          <span>latest live events</span>
        </div>
        {taskView.activity.length ? (
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Status</th>
                <th>Created</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {taskView.activity.map((item, index) => (
                <tr key={`${item.id || "activity"}-${index}`}>
                  <td><strong>{item.title}</strong><small>{item.meta}</small></td>
                  <td><StatusBadge status={item.status}>{item.status}</StatusBadge></td>
                  <td>{item.createdAt ? <time dateTime={item.createdAt}>{item.createdAt}</time> : "Field unavailable"}</td>
                  <td><button type="button" onClick={() => openDetail({ type: "activity", title: item.title, detailRows: item.detailRows, source: "activity" })}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="monitor-empty-state">No live activity returned.</p>
        )}
      </section>

      <MonitorDetailDialog dialogRef={dialogRef} detail={detail} onRequestClose={closeDetail} onClosed={() => setDetail(null)} />
    </main>
  );
}

function ProjectSwitcher({ monitor, onProjectSelect }) {
  const projects = Array.isArray(monitor?.projects) ? monitor.projects : [];
  const activeProjectId = monitor?.activeProjectId || monitor?.project?.owner || "";
  const handleChange = (event) => {
    const nextProject = projects.find((project) => project.id === event.target.value);
    if (nextProject) onProjectSelect?.(nextProject);
  };

  return (
    <label className="monitor-project-switcher">
      <span>Project</span>
      <select value={activeProjectId} onChange={handleChange} disabled={!projects.length}>
        {!projects.length ? <option value="">No projects</option> : null}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>{project.name || project.id}</option>
        ))}
      </select>
    </label>
  );
}

function SourceBadge({ monitor }) {
  if (monitor?.loading) return <StatusBadge status="warn">Loading</StatusBadge>;
  if (monitor?.error) return <StatusBadge status="fail">Unavailable</StatusBadge>;
  return <StatusBadge status={monitor?.hasRealData ? "pass" : "pending"}>{monitor?.hasRealData ? "Live" : "Empty"}</StatusBadge>;
}

function MonitorDetailDialog({ dialogRef, detail, onRequestClose, onClosed }) {
  return (
    <dialog className="monitor-detail-dialog" ref={dialogRef} role="dialog" aria-modal="true" onClose={onClosed}>
      {detail ? (
        <>
          <header>
            <div>
              <span className="monitor-kicker">{detail.source || detail.type || "detail"}</span>
              <h2>{detail.title}</h2>
            </div>
            <button type="button" onClick={onRequestClose}>Close</button>
          </header>
          <details open>
            <summary>Structured detail</summary>
            <table>
              <tbody>
                {(detail.detailRows || []).map((row) => (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <details>
            <summary>TaskSkill contract</summary>
            <p>This panel is rendered from declarative MonitorTaskSkills. API loading stays in monitorClient.</p>
          </details>
        </>
      ) : null}
    </dialog>
  );
}
