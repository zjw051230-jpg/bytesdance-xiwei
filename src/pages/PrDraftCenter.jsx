import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Copy,
  Eye,
  FileCode2,
  GitPullRequest,
  RefreshCw,
  Save,
  ShieldAlert,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildPrDraftTaskSkillView } from "../adapters/prDraftTaskSkills.js";
import { loadPrDraftCenterContext, patchPrDraft, regeneratePrDraft, savePrDraft } from "../api/prDraftClient.js";

const gateLabels = {
  dsl: "Requirement / DSL",
  agent: "Agent Run",
  review: "Review",
  tests: "Tests",
  risks: "Risks",
  artifacts: "Artifacts",
  checklist: "Checklist"
};

export default function PrDraftCenter({
  activeProject,
  activeRequirement,
  requirementId,
  projectId,
  agentWorkflow = {},
  onAgentWorkflowChange
}) {
  const resolvedRequirementId = requirementId || activeRequirement?.id || "";
  const resolvedProjectId = projectId || activeProject?.id || activeRequirement?.projectId || "";
  const [loadState, setLoadState] = useState({ state: "loading", error: null, reason: null });
  const [context, setContext] = useState(null);
  const [draft, setDraft] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [toast, setToast] = useState("");
  const dialogRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    setLoadState({ state: "loading", error: null, reason: null });
    setContext(null);
    setDraft(null);

    loadPrDraftCenterContext({
      projectId: resolvedProjectId,
      requirementId: resolvedRequirementId,
      runId: agentWorkflow.runId
    }).then((result) => {
      if (!mounted) return;
      if (result.state !== "success") {
        setLoadState({ state: result.state, error: result.error || null, reason: result.reason || null });
        return;
      }
      setContext(result.context);
      setDraft(result.context.prDraft);
      setLoadState({ state: "success", error: null, reason: null });
      onAgentWorkflowChange?.((current) => ({ ...current, runId: current.runId || result.context.prDraft.runId, prDraft: result.context.prDraft }));
    });

    return () => {
      mounted = false;
    };
  }, [resolvedProjectId, resolvedRequirementId, agentWorkflow.runId, onAgentWorkflowChange]);

  const readiness = useMemo(() => context && draft ? evaluateReadiness({ ...context, prDraft: draft }) : null, [context, draft]);
  const markdown = useMemo(() => context && draft ? buildPrMarkdown({ ...context, prDraft: draft }, readiness) : "", [context, draft, readiness]);
  const taskView = useMemo(() => context && readiness ? buildPrDraftTaskSkillView({ ...context, prDraft: draft }, readiness) : null, [context, draft, readiness]);

  const openDetail = (id) => {
    setDetailId(id);
    if (typeof dialogRef.current?.showModal !== "function") {
      dialogRef.current?.setAttribute("open", "");
    }
    const schedule = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame : (callback) => setTimeout(callback, 0);
    schedule(() => {
      if (typeof dialogRef.current?.showModal === "function") dialogRef.current.showModal();
      else dialogRef.current?.setAttribute("open", "");
    });
  };

  const closeDetail = () => {
    if (typeof dialogRef.current?.close === "function") dialogRef.current.close();
    else {
      dialogRef.current?.removeAttribute("open");
      setDetailId(null);
    }
  };

  if (loadState.state === "loading") {
    return <main className="pr-draft-center pr-state-page" data-testid="pr-draft-center"><span data-testid="pr-workbench" hidden /><GitPullRequest /><span>Loading PR Draft Center...</span></main>;
  }

  if (loadState.state === "empty") {
    return <EmptyState reason={loadState.reason} requirementId={resolvedRequirementId} />;
  }

  if (loadState.state === "unavailable") {
    return <UnavailableState error={loadState.error || loadState.reason} />;
  }

  if (loadState.state === "error") {
    return <ErrorState error={loadState.error} />;
  }

  const updateDraft = (patch) => {
    setDraft((current) => ({ ...current, ...patch, status: current.status === "copied" ? "draft" : current.status }));
    setToast("");
  };

  const save = async () => {
    try {
      const saved = await savePrDraft(resolvedRequirementId, toApiDraftPayload(draft));
      setDraft((current) => ({ ...current, ...saved }));
      setToast("Draft saved.");
    } catch (error) {
      setToast(`Save failed: ${error.payload?.error?.message || error.message}`);
    }
  };

  const regenerate = async () => {
    try {
      const nextDraft = await regeneratePrDraft(resolvedRequirementId, { runId: draft.runId || context.agentRun.runId });
      setDraft(nextDraft);
      setToast("Draft regenerated from live API.");
    } catch (error) {
      setToast(`Regenerate unavailable: ${error.payload?.error?.message || error.message}`);
    }
  };

  const copyDescription = async () => {
    if (readiness.status === "blocked" && !window.confirm("Current PR Draft still has unresolved blockers. Copy anyway?")) return;
    try {
      await writeClipboard(markdown);
      const copiedAt = new Date().toISOString();
      if (!draft.id) {
        setToast("PR description copied. Save failed: prDraft id is unavailable.");
        return;
      }
      const patched = await patchPrDraft(draft.id, { status: "copied", copiedAt });
      setDraft((current) => ({ ...current, ...patched, status: "copied", copiedAt }));
      setToast(readiness.status === "blocked" ? "Blocked PR description copied with warning." : "PR description copied.");
    } catch (error) {
      setToast(`Copy failed: ${error.payload?.error?.message || error.message || "Clipboard unavailable"}`);
    }
  };

  return (
    <main className="pr-draft-center" data-testid="pr-draft-center">
      <span data-testid="pr-workbench" hidden />
      <PRHeader context={context} draft={draft} readiness={readiness} />
      {toast ? <p className="pr-toast" role="status">{toast}</p> : null}
      <section className="pr-main-overview" aria-label="PR readiness overview">
        <PRDraftEditor draft={draft} onDraftChange={updateDraft} />
        <PRReadinessOverview readiness={readiness} taskView={taskView} onDetail={openDetail} />
        <PRActionBar readiness={readiness} onSave={save} onRegenerate={regenerate} onCopy={copyDescription} onPreview={() => openDetail("markdown")} />
      </section>
      <section className="pr-lower-grid">
        <ReadinessInspector readiness={readiness} copiedAt={draft.copiedAt} />
        <DetailLaunchPanel taskView={taskView} onDetail={openDetail} />
        <ActivitySummary context={context} copiedAt={draft.copiedAt} onDetail={openDetail} />
      </section>
      <PRDetailDialog
        dialogRef={dialogRef}
        detailId={detailId}
        context={{ ...context, prDraft: draft }}
        markdown={markdown}
        taskView={taskView}
        onDraftChange={updateDraft}
        onRequestClose={closeDetail}
        onClosed={() => setDetailId(null)}
      />
    </main>
  );
}

function PRHeader({ context, draft, readiness }) {
  return (
    <header className="pr-draft-header">
      <div className="pr-draft-title-block">
        <span className="pr-route-label">PR Draft Center</span>
        <h1>{draft.title || "Untitled PR draft"}</h1>
        <p>{context.requirement.title || "Field unavailable"} · {draft.runId || "run unavailable"}</p>
      </div>
      <div className="pr-header-actions">
        <StatusBadge status="live">Live API</StatusBadge>
        <StatusBadge status={readiness.status}>{readiness.status}</StatusBadge>
      </div>
    </header>
  );
}

function PRDraftEditor({ draft, onDraftChange }) {
  const updateSummary = (index, value) => {
    onDraftChange({ summary: draft.summary.map((item, itemIndex) => itemIndex === index ? value : item) });
  };
  return (
    <article className="pr-editor-card">
      <div className="panel-title">
        <h2>Draft editor</h2>
        <span>editable delivery note</span>
      </div>
      <label className="pr-field-label" htmlFor="pr-title">PR title</label>
      <input id="pr-title" value={draft.title} onChange={(event) => onDraftChange({ title: event.target.value })} placeholder="Field unavailable" />
      <label className="pr-field-label" htmlFor="pr-summary-0">Summary</label>
      <div className="pr-summary-editor compact">
        {draft.summary.length ? draft.summary.map((item, index) => (
          <input key={`summary-${index}`} id={index === 0 ? "pr-summary-0" : undefined} aria-label={`Summary item ${index + 1}`} value={item} onChange={(event) => updateSummary(index, event.target.value)} />
        )) : <FieldUnavailable label="Summary" />}
        <button type="button" onClick={() => onDraftChange({ summary: [...draft.summary, ""] })}>Add summary item</button>
      </div>
      <label className="pr-field-label" htmlFor="pr-notes">Notes</label>
      <textarea id="pr-notes" value={draft.notes} onChange={(event) => onDraftChange({ notes: event.target.value })} rows={3} placeholder="Field unavailable" />
    </article>
  );
}

function PRReadinessOverview({ readiness, taskView, onDetail }) {
  return (
    <section className="pr-overview-card">
      <div className="panel-title">
        <h2>Gate overview</h2>
        <span>overview first</span>
      </div>
      <div className="pr-gate-card-grid">
        {taskView.overviewCards.map((card) => (
          <button key={card.id} type="button" className={`pr-gate-card ${card.status}`} onClick={() => onDetail(card.detailId)}>
            <span>{card.title}</span>
            <StatusBadge status={card.status}>{card.status}</StatusBadge>
            <strong>{card.value}</strong>
            <small>{card.message}</small>
          </button>
        ))}
      </div>
      <meter min="0" max={Object.keys(readiness.gates).length} value={Object.values(readiness.gates).filter((gate) => gate.status === "passed").length}>
        readiness
      </meter>
    </section>
  );
}

function PRActionBar({ readiness, onSave, onRegenerate, onCopy, onPreview }) {
  return (
    <div className="pr-action-bar">
      <button type="button" onClick={onSave}><Save size={15} />Save Draft</button>
      <button type="button" onClick={onRegenerate}><RefreshCw size={15} />Regenerate Draft</button>
      <button type="button" onClick={onPreview}><Eye size={15} />View Markdown Preview</button>
      <button type="button" data-testid="copy-pr-description-toolbar" className={readiness.status === "blocked" ? "warn" : "primary"} onClick={onCopy}><Copy size={15} />Copy PR Description</button>
      <button type="button" disabled={!readiness.canReady}>Ready</button>
    </div>
  );
}

function ReadinessInspector({ readiness, copiedAt }) {
  return (
    <aside className="pr-readiness-inspector">
      <div className="pr-inspector-heading">
        <span className="pr-panel-kicker">Readiness Inspector</span>
        <h2>{readiness.status}</h2>
        {copiedAt ? <small>copied at <time dateTime={copiedAt}>{copiedAt}</time></small> : null}
      </div>
      <p>{readiness.summary}</p>
      <BlockingReasonsPanel reasons={readiness.blockingReasons} />
      <div className="pr-gate-list">
        {Object.entries(readiness.gates).map(([key, gate]) => (
          <div key={key}>
            <span>{gateLabels[key]}</span>
            <ReadinessBadge status={gate.status} />
          </div>
        ))}
      </div>
    </aside>
  );
}

function DetailLaunchPanel({ taskView, onDetail }) {
  return (
    <section className="pr-detail-launcher">
      <div className="panel-title">
        <h2>Details on demand</h2>
        <span>native dialog / details</span>
      </div>
      <div className="pr-detail-buttons">
        {taskView.details.map((detail) => (
          <button key={detail.id} type="button" onClick={() => onDetail(detail.id)}>
            <span>{detail.title}</span>
            <small>{detail.surface}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function ActivitySummary({ context, copiedAt, onDetail }) {
  return (
    <details className="pr-activity-panel">
      <summary>Activity / copy history</summary>
      <div>
        <p><strong>copiedAt</strong> {copiedAt || "Field unavailable"}</p>
        <p><strong>activity</strong> {context.activity.length ? `${context.activity.length} events` : "EmptyState"}</p>
        <button type="button" onClick={() => onDetail("activity")}>Open activity detail</button>
      </div>
    </details>
  );
}

function PRDetailDialog({ dialogRef, detailId, context, markdown, taskView, onDraftChange, onRequestClose, onClosed }) {
  const detail = taskView?.details.find((item) => item.id === detailId);
  return (
    <dialog className="pr-detail-dialog" ref={dialogRef} aria-modal="true" onClose={onClosed}>
      {detail ? (
        <>
          <header>
            <div>
              <span className="pr-panel-kicker">{detail.surface}</span>
              <h2>{detail.title}</h2>
            </div>
            <button type="button" onClick={onRequestClose} aria-label="Close detail"><X size={16} /></button>
          </header>
          <p className="pr-detail-contract">TaskSkills: {detail.contract}</p>
          {renderDetail(detailId, context, markdown, onDraftChange)}
        </>
      ) : null}
    </dialog>
  );
}

function renderDetail(detailId, context, markdown, onDraftChange) {
  switch (detailId) {
    case "requirement":
      return <RequirementDetail context={context} />;
    case "files":
      return <ChangedFilesDetail files={context.prDraft.changedFiles} />;
    case "review":
      return <ReviewDetail items={context.reviewItems} />;
    case "tests":
      return <TestsDetail tests={context.prDraft.tests} />;
    case "risks":
      return <RisksDetail risks={context.prDraft.risks} onDraftChange={onDraftChange} />;
    case "artifacts":
      return <ArtifactsDetail artifacts={context.artifacts} />;
    case "checklist":
      return <ChecklistDetail checklist={context.prDraft.checklist} onDraftChange={onDraftChange} />;
    case "markdown":
      return <MarkdownDetail markdown={markdown} />;
    case "activity":
      return <ActivityDetail activity={context.activity} copiedAt={context.prDraft.copiedAt} />;
    default:
      return <EmptyInline message="Detail unavailable." />;
  }
}

function RequirementDetail({ context }) {
  return (
    <details open>
      <summary>Requirement and DSL readiness</summary>
      <table>
        <tbody>
          <InfoRow label="Requirement" value={context.requirement.title} />
          <InfoRow label="Goal" value={context.requirement.goal} />
          <InfoRow label="DSL readiness" value={context.requirement.dslReadiness} />
          <InfoRow label="Handoff decision" value={context.requirement.handoffDecision} />
          <InfoRow label="Agent run" value={context.agentRun.runId} />
          <InfoRow label="Agent status" value={context.agentRun.status} />
        </tbody>
      </table>
      {context.requirement.points.length ? <ul>{context.requirement.points.map((point) => <li key={point}>{point}</li>)}</ul> : <EmptyInline message="No requirement points returned." />}
    </details>
  );
}

function ChangedFilesDetail({ files }) {
  if (!files.length) return <EmptyInline message="No changed files returned by the PR draft API." />;
  return <DataTable rows={files} columns={["path", "changeSummary", "why", "requirementPoint", "risk", "testStatus", "reviewStatus"]} />;
}

function ReviewDetail({ items }) {
  if (!items.length) return <EmptyInline message="No review items returned." />;
  return <DataTable rows={items} columns={["filePath", "status", "required", "message"]} />;
}

function TestsDetail({ tests }) {
  if (!tests.length) return <EmptyInline message="No test records returned." />;
  return <DataTable rows={tests} columns={["name", "status", "source", "required", "errorSummary"]} />;
}

function RisksDetail({ risks, onDraftChange }) {
  if (!risks.length) return <EmptyInline message="No risks returned." />;
  return (
    <div className="pr-list-cards">
      {risks.map((risk) => (
        <article key={risk.id}>
          <div><strong>{risk.level || "Field unavailable"}</strong><StatusBadge status={risk.acknowledged ? "acknowledged" : "warning"} /></div>
          <p>{risk.message || "Field unavailable"}</p>
          <small>{risk.mitigation || "Field unavailable"}</small>
          <label className="pr-check-row">
            <input type="checkbox" checked={risk.acknowledged} onChange={() => onDraftChange({ risks: risks.map((item) => item.id === risk.id ? { ...item, acknowledged: !item.acknowledged } : item) })} />
            acknowledged
          </label>
        </article>
      ))}
    </div>
  );
}

function ArtifactsDetail({ artifacts }) {
  if (!artifacts.length) return <EmptyInline message="No artifacts returned." />;
  return <DataTable rows={artifacts} columns={["name", "type", "redactionState", "createdAt", "contentPreview"]} />;
}

function ChecklistDetail({ checklist, onDraftChange }) {
  if (!checklist.length) return <EmptyInline message="No checklist returned." />;
  return (
    <div className="pr-checklist">
      {checklist.map((item) => (
        <label key={item.id} className={item.system ? "system" : ""}>
          <input type="checkbox" checked={item.checked} disabled={item.system} onChange={() => onDraftChange({ checklist: checklist.map((row) => row.id === item.id ? { ...row, checked: !row.checked } : row) })} />
          <span>{item.label || "Field unavailable"}</span>
          <em>{item.blocking ? "blocking" : "optional"}</em>
        </label>
      ))}
    </div>
  );
}

function MarkdownDetail({ markdown }) {
  return (
    <section className="pr-markdown-preview">
      <div><Clipboard size={18} /><h2>Markdown Preview</h2></div>
      <pre>{markdown}</pre>
    </section>
  );
}

function ActivityDetail({ activity, copiedAt }) {
  return (
    <details open>
      <summary>Recent activity</summary>
      <p>copiedAt: {copiedAt || "Field unavailable"}</p>
      {activity.length ? <DataTable rows={activity} columns={["actor", "action", "createdAt"]} /> : <EmptyInline message="No project activity returned." />}
    </details>
  );
}

function DataTable({ rows, columns }) {
  return (
    <table>
      <thead>
        <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.id || index}>
            {columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InfoRow({ label, value }) {
  return <tr><th>{label}</th><td>{formatCell(value)}</td></tr>;
}

function FieldUnavailable({ label }) {
  return <p className="pr-field-unavailable">{label}: Field unavailable</p>;
}

function EmptyInline({ message }) {
  return <p className="pr-empty-inline">{message}</p>;
}

function BlockingReasonsPanel({ reasons }) {
  if (!reasons.length) return <div className="pr-ready-panel"><CheckCircle2 size={16} />All readiness gates pass.</div>;
  return (
    <div className="pr-blocking-panel">
      <div><ShieldAlert size={16} />Blocking reasons</div>
      <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </div>
  );
}

function EmptyState({ reason, requirementId }) {
  return (
    <main className="pr-draft-center pr-state-page" data-testid="pr-draft-empty">
      <span data-testid="pr-workbench" hidden />
      <FileCode2 />
      <h1>PR Draft Center</h1>
      <p><strong>EmptyState</strong>: {reason?.message || `No PR draft exists for ${requirementId || "this requirement"}.`}</p>
    </main>
  );
}

function UnavailableState({ error }) {
  return (
    <main className="pr-draft-center pr-state-page" data-testid="pr-draft-unavailable">
      <span data-testid="pr-workbench" hidden />
      <AlertTriangle />
      <h1>PR Draft Center unavailable</h1>
      <p><code>{error?.code || "unavailable"}</code>: {error?.message || "A required live API is unavailable."}</p>
    </main>
  );
}

function ErrorState({ error }) {
  return (
    <main className="pr-draft-center pr-state-page pr-error-state" data-testid="pr-draft-error">
      <span data-testid="pr-workbench" hidden />
      <AlertTriangle />
      <h1>PR Draft Center error</h1>
      <p><code>{error?.code || "error"}</code>: {error?.message || "PR draft API request failed."}</p>
    </main>
  );
}

function toApiDraftPayload(draft) {
  return {
    ...draft,
    checklistJson: draft.checklist.map((item) => ({
      text: item.label,
      checked: item.checked,
      blocking: item.blocking
    }))
  };
}

export function evaluateReadiness({ requirement = {}, agentRun = {}, prDraft = {}, reviewItems = [], artifacts = [], changeRecords = {} }) {
  const blockingReasons = [];
  const gates = {};
  const readiness = requirement.dslReadiness || requirement.readiness;
  const dslPass = ["ready_for_agent", "handoff_to_agent", "ready", "strong"].includes(readiness);
  gates.dsl = gate(dslPass, dslPass ? "DSL is ready for agent." : "DSL readiness is not ready_for_agent.");
  if (!dslPass) blockingReasons.push("DSL readiness is not ready_for_agent.");

  const agentPass = agentRun.status === "completed" || agentRun.status === "passed";
  gates.agent = gate(agentPass, agentPass ? "Agent run completed." : "Agent run is not completed.");
  if (!agentPass) blockingReasons.push("Agent run is not completed.");

  if (agentRun.verificationStatus === "stale" || changeRecords?.verificationStatus === "stale") {
    blockingReasons.push("verification_stale_after_rollback");
  }

  const changedFiles = Array.isArray(prDraft.changedFiles) ? prDraft.changedFiles : [];
  if (!changedFiles.length) blockingReasons.push("Changed files are missing.");
  if (Array.isArray(changeRecords?.changes) && changeRecords.changes.length > 0 && changeRecords.changes.every((change) => ["reverted", "reset"].includes(change.status))) {
    blockingReasons.push("all_changes_reverted");
  }

  const blockingReview = reviewItems.find((item) => ["blocked", "changes_requested"].includes(item.status) || (item.required && item.status === "pending"));
  gates.review = gate(!blockingReview, blockingReview ? `Review item for ${blockingReview.filePath || "general"} is ${blockingReview.status}.` : "Review gate is clear.");
  if (blockingReview) blockingReasons.push(`Review item for ${blockingReview.filePath || "general"} is ${blockingReview.status}.`);

  const tests = Array.isArray(prDraft.tests) ? prDraft.tests : [];
  const requiredTests = tests.filter((test) => test.required);
  const missingTest = requiredTests.length === 0 || requiredTests.find((test) => ["", "missing", "failed", "error"].includes(test.status));
  gates.tests = gate(!missingTest, missingTest ? "Required test result is missing." : "Required tests are present.");
  if (missingTest) blockingReasons.push("Required test result is missing.");

  const risks = Array.isArray(prDraft.risks) ? prDraft.risks : [];
  const unacknowledgedHighRisk = risks.find((risk) => ["high", "critical", "p0"].includes(String(risk.level).toLowerCase()) && !risk.acknowledged);
  gates.risks = gate(!unacknowledgedHighRisk, unacknowledgedHighRisk ? "High risk is not acknowledged." : "High risks are acknowledged or documented.");
  if (unacknowledgedHighRisk) blockingReasons.push("High risk is not acknowledged.");

  const unsafeArtifact = artifacts.find((artifact) => ["unsafe", "secret_redacted"].includes(artifact.redactionState));
  const artifactPass = artifacts.length > 0 && !unsafeArtifact;
  gates.artifacts = gate(artifactPass, artifactPass ? "Artifact redaction state is safe." : unsafeArtifact ? "Artifact redaction state is unsafe." : "artifact_missing: artifact reference is missing.");
  if (!artifactPass) blockingReasons.push(unsafeArtifact ? "Artifact redaction state is unsafe." : "artifact_missing: artifact reference is missing.");

  const checklist = Array.isArray(prDraft.checklist) ? prDraft.checklist : [];
  const unresolvedChecklist = checklist.find((item) => item.blocking && !item.checked);
  gates.checklist = gate(!unresolvedChecklist, unresolvedChecklist ? "Checklist blocking item is unresolved." : "Checklist blocking items are resolved.");
  if (unresolvedChecklist) blockingReasons.push("Checklist blocking item is unresolved.");

  const canReady = blockingReasons.length === 0 && changedFiles.length > 0;
  const status = prDraft.status === "copied" ? "copied" : canReady ? "ready" : "blocked";
  return {
    status,
    canReady,
    blockingReasons,
    gates,
    summary: canReady ? "This PR draft can be marked ready and copied." : "This PR draft is blocked until the listed gates pass."
  };
}

function gate(pass, message) {
  return { status: pass ? "passed" : "blocked", message };
}

export function buildPrMarkdown(context, readiness = evaluateReadiness(context)) {
  const { prDraft, requirement } = context;
  const lines = [];
  if (readiness.status === "blocked") {
    lines.push("> Warning: This PR draft still has unresolved blockers.", "");
  }
  lines.push(`# ${prDraft.title || "Untitled PR Draft"}`, "", "## Summary");
  lines.push(...(prDraft.summary?.length ? prDraft.summary.map((item) => `* ${item}`) : ["* Field unavailable."]));
  lines.push("", "## Requirement Mapping", `* Requirement: ${requirement.title || "Field unavailable"}`, `* DSL readiness: ${requirement.dslReadiness || "Field unavailable"}`, `* Handoff decision: ${requirement.handoffDecision || "Field unavailable"}`);
  lines.push("", "## Changed Files");
  if (prDraft.changedFiles?.length) {
    prDraft.changedFiles.forEach((file) => {
      lines.push(`* \`${file.path || "Field unavailable"}\``, `  * Summary: ${file.changeSummary || "Field unavailable"}`, `  * Requirement: ${file.requirementPoint || "Field unavailable"}`, `  * Risk: ${file.risk || "Field unavailable"}`, `  * Review: ${file.reviewStatus || "Field unavailable"}`);
    });
  } else {
    lines.push("* No changed files recorded.");
  }
  lines.push("", "## Tests");
  lines.push(...(prDraft.tests?.length ? prDraft.tests.map((test) => `* ${test.name}: ${test.status || "Field unavailable"} (${test.source || "Field unavailable"})${test.errorSummary ? ` - ${test.errorSummary}` : ""}`) : ["* Required test result is missing."]));
  lines.push("", "## Risks");
  lines.push(...(prDraft.risks?.length ? prDraft.risks.map((risk) => `* ${risk.level || "Field unavailable"}: ${risk.message || "Field unavailable"} Mitigation: ${risk.mitigation || "Field unavailable"} Acknowledged: ${risk.acknowledged ? "yes" : "no"}`) : ["* No risks recorded."]));
  lines.push("", "## Checklist");
  lines.push(...(prDraft.checklist?.length ? prDraft.checklist.map((item) => `* [${item.checked ? "x" : " "}] ${item.label || "Field unavailable"}`) : ["* [ ] No checklist recorded."]));
  if (prDraft.notes) lines.push("", "## Notes", prDraft.notes);
  return lines.join("\n");
}

function StatusBadge({ status, children }) {
  return <span className={`pr-status-badge ${status}`}>{children || status}</span>;
}

function ReadinessBadge({ status }) {
  return <span className={`pr-readiness-badge ${status}`}>{status}</span>;
}

function formatCell(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (value === null || value === undefined || value === "") return "Field unavailable";
  return String(value);
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("Clipboard API unavailable");
}
