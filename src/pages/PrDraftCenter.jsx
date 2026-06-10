import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Copy,
  FileCode2,
  GitPullRequest,
  RefreshCw,
  Save,
  ShieldAlert
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadPrDraftCenterContext, normalizeContext, patchPrDraft, regeneratePrDraft, savePrDraft } from "../api/prDraftClient.js";

const evidenceSections = [
  ["requirement", "Requirement"],
  ["dsl", "DSL Readiness"],
  ["agent", "Agent Run"],
  ["files", "Changed Files"],
  ["review", "Review Items"],
  ["tests", "Tests"],
  ["risks", "Risks"],
  ["artifacts", "Artifacts"],
  ["activity", "Activity"]
];

const gateLabels = {
  dsl: "DSL Gate",
  agent: "Agent Run Gate",
  review: "Review Gate",
  tests: "Test Gate",
  risks: "Risk Gate",
  artifacts: "Artifact Gate",
  checklist: "Checklist Gate"
};

export default function PrDraftCenter({
  activeProject,
  activeRequirement,
  requirementId,
  projectId,
  agentWorkflow = {},
  onAgentWorkflowChange
}) {
  const resolvedRequirementId = requirementId || activeRequirement?.id || agentWorkflow.prDraft?.requirementId || "";
  const resolvedProjectId = projectId || activeProject?.id || activeRequirement?.projectId || "codex-workbench";
  const initialLocalContext = !resolvedRequirementId ? createLocalPrContext({ activeRequirement, resolvedProjectId, agentWorkflow }) : null;
  const [loadState, setLoadState] = useState({ loading: !initialLocalContext, error: null });
  const [context, setContext] = useState(initialLocalContext);
  const [draft, setDraft] = useState(initialLocalContext?.prDraft || null);
  const [mode, setMode] = useState("edit");
  const [toast, setToast] = useState("");
  const contentRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    setLoadState({ loading: true, error: null });
    if (!resolvedRequirementId) {
      const localContext = createLocalPrContext({ activeRequirement, resolvedProjectId, agentWorkflow });
      setContext(localContext);
      setDraft(localContext.prDraft);
      setLoadState({ loading: false, error: null });
      return () => {
        mounted = false;
      };
    }
    loadPrDraftCenterContext({
      projectId: resolvedProjectId,
      requirementId: resolvedRequirementId,
      runId: agentWorkflow.runId
    })
      .then((nextContext) => {
        if (!mounted) return;
        const requirement = activeRequirement?.id ? { ...nextContext.requirement, ...activeRequirement } : nextContext.requirement;
        const workflowDraft = agentWorkflow.prDraft ? normalizeWorkflowDraft(agentWorkflow.prDraft, agentWorkflow.runId) : null;
        const mergedDraft = workflowDraft ? { ...nextContext.prDraft, ...workflowDraft } : nextContext.prDraft;
        const mergedContext = { ...nextContext, requirement, prDraft: mergedDraft };
        setContext(mergedContext);
        setDraft(mergedContext.prDraft);
        setLoadState({ loading: false, error: null });
        onAgentWorkflowChange?.((current) => ({ ...current, runId: current.runId || mergedContext.prDraft.runId, prDraft: mergedContext.prDraft }));
      })
      .catch((error) => {
        if (!mounted) return;
        setLoadState({ loading: false, error: error.payload?.error || { code: "validation_failed", message: error.message || "PR draft load failed" } });
      });
    return () => {
      mounted = false;
    };
  }, [resolvedProjectId, resolvedRequirementId, agentWorkflow.runId, activeRequirement?.id, onAgentWorkflowChange]);

  const readiness = useMemo(() => context && draft ? evaluateReadiness({ ...context, prDraft: draft }) : null, [context, draft]);
  const markdown = useMemo(() => context && draft ? buildPrMarkdown({ ...context, prDraft: draft }, readiness) : "", [context, draft, readiness]);

  if (loadState.loading) {
    return <main className="pr-draft-center pr-draft-loading" data-testid="pr-draft-center"><GitPullRequest /><span>Loading PR Draft Center...</span></main>;
  }

  if (loadState.error) {
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
    if (!window.confirm("Regenerate PR draft from latest Agent Run and Review data? Manual edits may be overwritten.")) return;
    const nextDraft = await regeneratePrDraft(resolvedRequirementId, { runId: draft.runId || context.agentRun.runId });
    setDraft(nextDraft);
    setToast("Draft regenerated from latest evidence.");
  };

  const copyDescription = async () => {
    if (readiness.status === "blocked" && !window.confirm("Current PR Draft still has unresolved blockers. Copy anyway?")) return;
    try {
      await writeClipboard(markdown);
      setToast("PR description copied.");
      const copiedAt = new Date().toISOString();
      setDraft((current) => ({ ...current, status: "copied", copiedAt }));
      try {
        await patchPrDraft(draft.id || "mock-pr-draft", { status: "copied", copiedAt });
      } catch (error) {
        setToast(`PR description copied. Save failed: ${error.payload?.error?.message || error.message}`);
      }
    } catch (error) {
      setToast(`Copy failed: ${error.message || "Clipboard unavailable"}`);
    }
  };

  const scrollTo = (sectionId) => {
    contentRef.current?.querySelector(`[data-pr-section="${sectionId}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <main className="pr-draft-center" data-testid="pr-draft-center">
      <span data-testid="pr-workbench" hidden />
      <PrDraftHeader context={context} draft={draft} readiness={readiness} usedMockFallback={context.usedMockFallback} />
      <div className="pr-draft-grid">
        <PrEvidenceNavigator context={{ ...context, prDraft: draft }} readiness={readiness} onSelect={scrollTo} />
        <section className="pr-draft-workspace" ref={contentRef}>
          {toast ? <p className="pr-toast" role="status">{toast}</p> : null}
          <EditorToolbar mode={mode} onMode={setMode} onSave={save} onRegenerate={regenerate} onCopy={copyDescription} readiness={readiness} />
          {mode === "edit" ? (
            <PrDraftEditor context={{ ...context, prDraft: draft }} draft={draft} onDraftChange={updateDraft} />
          ) : (
            <PrMarkdownPreview markdown={markdown} />
          )}
          <PrActivityPanel context={context} />
        </section>
        <PrReadinessInspector readiness={readiness} draft={draft} onCopy={copyDescription} />
      </div>
    </main>
  );
}

function normalizeWorkflowDraft(input = {}, runId = "") {
  return {
    id: input.id || "",
    requirementId: input.requirementId || "",
    runId: input.runId || input.sourceRun || runId || "",
    title: input.title || "",
    summary: Array.isArray(input.summary) ? input.summary : String(input.summary || "").split(/\r?\n/).filter(Boolean),
    changedFiles: (input.changedFiles || []).map((file, index) => typeof file === "string"
      ? { id: `workflow-file-${index}`, path: file, changeSummary: "Changed file recorded by current Agent workflow.", why: "Mapped from current workflow.", requirementPoint: "Current workflow", risk: "Not documented", testStatus: "pending", reviewStatus: "pending" }
      : file),
    tests: input.tests || [],
    risks: (input.risks || []).map((risk, index) => typeof risk === "string" ? { id: `workflow-risk-${index}`, level: "medium", message: risk, mitigation: "Review before ready.", acknowledged: false } : risk),
    checklist: (input.checklist || input.checklistJson || []).map((item, index) => typeof item === "string" ? { id: `workflow-check-${index}`, label: item, checked: false, blocking: false, system: false } : item),
    notes: input.notes || input.body || "",
    status: input.status || "draft",
    copiedAt: input.copiedAt || null
  };
}

function PrDraftHeader({ context, draft, readiness, usedMockFallback }) {
  return (
    <header className="pr-draft-header">
      <div className="pr-draft-title-block">
        <span className="pr-route-label">PR Draft Center</span>
        <h1>PR Draft Center</h1>
        <p>{context.requirement.title}</p>
      </div>
      <div className="pr-header-actions">
        {usedMockFallback ? <span className="pr-fallback-badge">mock fallback</span> : null}
        <StatusBadge status={readiness.status} />
        <span className="pr-run-chip">{draft.runId || "no run"}</span>
      </div>
    </header>
  );
}

function PrEvidenceNavigator({ context, readiness, onSelect }) {
  const statuses = evidenceStatus(context, readiness);
  return (
    <aside className="pr-evidence-nav" aria-label="PR evidence navigator">
      <div>
        <span className="pr-panel-kicker">Evidence</span>
        <h2>Navigator</h2>
      </div>
      <nav>
        {evidenceSections.map(([id, label]) => (
          <button key={id} type="button" onClick={() => onSelect(id)}>
            <span>{label}</span>
            <ReadinessBadge status={statuses[id]} />
          </button>
        ))}
      </nav>
    </aside>
  );
}

function EditorToolbar({ mode, onMode, onSave, onRegenerate, onCopy, readiness }) {
  return (
    <div className="pr-editor-toolbar">
      <div className="pr-segmented" role="group" aria-label="PR draft view mode">
        <button type="button" className={mode === "edit" ? "selected" : ""} onClick={() => onMode("edit")}>Edit</button>
        <button type="button" className={mode === "preview" ? "selected" : ""} onClick={() => onMode("preview")}>Preview Markdown</button>
      </div>
      <div className="pr-toolbar-actions">
        <button type="button" aria-label="保存 PR 草稿" onClick={onSave}><Save size={15} />Save Draft</button>
        <button type="button" onClick={onRegenerate}><RefreshCw size={15} />Regenerate Draft</button>
        <button type="button" data-testid="copy-pr-description-toolbar" className={readiness.status === "blocked" ? "warn" : "primary"} onClick={onCopy}><Copy size={15} />Copy PR Description</button>
        <button type="button" disabled={readiness.status !== "ready"} title={readiness.status !== "ready" ? "Ready is disabled until every gate passes." : "All gates pass."}>Ready</button>
      </div>
    </div>
  );
}

function PrDraftEditor({ context, draft, onDraftChange }) {
  const updateSummary = (index, value) => {
    const next = draft.summary.map((item, itemIndex) => itemIndex === index ? value : item);
    onDraftChange({ summary: next });
  };
  const removeSummary = (index) => onDraftChange({ summary: draft.summary.filter((_, itemIndex) => itemIndex !== index) });
  const addSummary = () => onDraftChange({ summary: [...draft.summary, ""] });
  const toggleChecklist = (id) => onDraftChange({
    checklist: draft.checklist.map((item) => item.id === id && !item.system ? { ...item, checked: !item.checked } : item)
  });
  const acknowledgeRisk = (id) => onDraftChange({
    risks: draft.risks.map((item) => item.id === id ? { ...item, acknowledged: !item.acknowledged } : item)
  });

  return (
    <div className="pr-editor-stack">
      <section className="pr-editor-section" data-pr-section="requirement">
        <label className="pr-field-label" htmlFor="pr-title">Title</label>
        <strong className="pr-current-title">{draft.title || "Untitled PR Draft"}</strong>
        <input id="pr-title" aria-label="PR 标题" value={draft.title} onChange={(event) => onDraftChange({ title: event.target.value })} placeholder="PR title" />
      </section>
      <section className="pr-editor-section" data-pr-section="dsl">
        <h2>Requirement Mapping</h2>
        <div className="pr-mapping-grid">
          <InfoCell label="Requirement" value={context.requirement.title} />
          <InfoCell label="Goal" value={context.requirement.goal} />
          <InfoCell label="DSL readiness" value={context.requirement.dslReadiness} />
          <InfoCell label="Handoff decision" value={context.requirement.handoffDecision} />
        </div>
        <ul className="pr-compact-list">{context.requirement.points.map((point) => <li key={point}>{point}</li>)}</ul>
      </section>
      <section className="pr-editor-section" data-pr-section="agent">
        <h2>Agent Run</h2>
        <div className="pr-mapping-grid">
          <InfoCell label="Run" value={context.agentRun.runId || "missing"} />
          <InfoCell label="Status" value={context.agentRun.status} />
          <InfoCell label="Completed" value={context.agentRun.completedAt || "not recorded"} />
        </div>
        <p>{context.agentRun.summary || "No agent run summary was recorded."}</p>
      </section>
      <section className="pr-editor-section" data-pr-section="files">
        <h2>Changed Files</h2>
        <ChangedFilesSection files={draft.changedFiles} />
      </section>
      <section className="pr-editor-section">
        <h2>Summary</h2>
        <div className="pr-summary-editor">
          {draft.summary.map((item, index) => (
            <div key={`summary-${index}`}>
              <input aria-label={`Summary item ${index + 1}`} value={item} onChange={(event) => updateSummary(index, event.target.value)} />
              <button type="button" onClick={() => removeSummary(index)}>Remove</button>
            </div>
          ))}
          <button type="button" onClick={addSummary}>Add summary item</button>
        </div>
      </section>
      <section className="pr-editor-section" data-pr-section="review">
        <h2>Review Items</h2>
        <ReviewItemsSection items={context.reviewItems} />
      </section>
      <section className="pr-editor-section" data-pr-section="tests">
        <h2>Tests</h2>
        <TestsSection tests={draft.tests} />
      </section>
      <section className="pr-editor-section" data-pr-section="risks">
        <h2>Risks</h2>
        <RisksSection risks={draft.risks} onAcknowledge={acknowledgeRisk} />
      </section>
      <section className="pr-editor-section" data-pr-section="artifacts">
        <h2>Artifacts</h2>
        <ArtifactsSection artifacts={context.artifacts} />
      </section>
      <section className="pr-editor-section" data-pr-section="checklist">
        <h2>Checklist</h2>
        <ChecklistSection checklist={draft.checklist} onToggle={toggleChecklist} />
      </section>
      <section className="pr-editor-section">
        <h2>Notes</h2>
        <textarea value={draft.notes} onChange={(event) => onDraftChange({ notes: event.target.value })} rows={4} aria-label="PR notes" />
      </section>
    </div>
  );
}

function ChangedFilesSection({ files }) {
  if (!files.length) return <p className="pr-muted">No changed files are recorded. Readiness is blocked.</p>;
  return <div className="pr-file-grid">{files.map((file) => (
    <article key={file.id} className="pr-file-card">
      <code>{file.path}</code>
      <p>{file.changeSummary}</p>
      <dl>
        <InfoPair label="Why" value={file.why} />
        <InfoPair label="Requirement" value={file.requirementPoint} />
        <InfoPair label="Risk" value={file.risk} />
        <InfoPair label="Test" value={file.testStatus} />
        <InfoPair label="Review" value={file.reviewStatus} />
      </dl>
    </article>
  ))}</div>;
}

function ReviewItemsSection({ items }) {
  if (!items.length) return <p className="pr-muted">No review items are recorded.</p>;
  return <div className="pr-list-cards">{items.map((item) => (
    <article key={item.id}>
      <div><code>{item.filePath}</code><StatusBadge status={item.status} /></div>
      <p>{item.message}</p>
      <small>{item.required ? "required" : "optional"}</small>
    </article>
  ))}</div>;
}

function TestsSection({ tests }) {
  if (!tests.length) return <p className="pr-warning-line">Required test result is missing.</p>;
  return <div className="pr-list-cards">{tests.map((test) => (
    <article key={test.id}>
      <div><strong>{test.name}</strong><StatusBadge status={test.status} /></div>
      <p>{test.source}</p>
      {test.errorSummary ? <small>{test.errorSummary}</small> : null}
      {test.required ? <small>required</small> : null}
    </article>
  ))}</div>;
}

function RisksSection({ risks, onAcknowledge }) {
  if (!risks.length) return <p className="pr-muted">No risks recorded.</p>;
  return <div className="pr-list-cards">{risks.map((risk) => (
    <article key={risk.id}>
      <div><strong>{risk.level}</strong><StatusBadge status={risk.acknowledged ? "acknowledged" : "warning"} /></div>
      <p>{risk.message}</p>
      <small>{risk.mitigation}</small>
      <label className="pr-check-row">
        <input type="checkbox" checked={risk.acknowledged} onChange={() => onAcknowledge(risk.id)} />
        acknowledged
      </label>
    </article>
  ))}</div>;
}

function ArtifactsSection({ artifacts }) {
  if (!artifacts.length) return <p className="pr-warning-line">artifact_missing: No artifact references were found.</p>;
  return <div className="pr-list-cards">{artifacts.map((artifact) => (
    <article key={artifact.id}>
      <div><strong>{artifact.name}</strong><StatusBadge status={artifact.redactionState} /></div>
      <small>{artifact.type} · {artifact.createdAt || "no timestamp"}</small>
      <p>{isUnsafeArtifact(artifact) ? "secret_redacted: sensitive artifact preview is withheld." : artifact.contentPreview}</p>
    </article>
  ))}</div>;
}

function ChecklistSection({ checklist, onToggle }) {
  if (!checklist.length) return <p className="pr-warning-line">暂无 checklist</p>;
  return <div className="pr-checklist">{checklist.map((item) => (
    <label key={item.id} className={item.system ? "system" : ""}>
      <input type="checkbox" aria-label={item.label} checked={item.checked} disabled={item.system} onChange={() => onToggle(item.id)} />
      <span>{item.label}</span>
      {item.blocking ? <em>blocking</em> : <em>optional</em>}
    </label>
  ))}</div>;
}

function PrMarkdownPreview({ markdown }) {
  return (
    <section className="pr-markdown-preview" data-pr-section="preview">
      <div><Clipboard size={18} /><h2>Markdown Preview</h2></div>
      <pre>{markdown}</pre>
    </section>
  );
}

function PrReadinessInspector({ readiness, draft, onCopy }) {
  const collapsed = readiness.status !== "blocked";
  return (
    <aside className={`pr-readiness-inspector ${collapsed ? "compact" : ""}`}>
      <div className="pr-inspector-heading">
        <span className="pr-panel-kicker">Readiness</span>
        <h2>{readiness.status}</h2>
        {draft.copiedAt ? <small>copied at {draft.copiedAt}</small> : null}
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
      <button type="button" className={readiness.status === "blocked" ? "warn" : "primary"} onClick={onCopy}><Copy size={15} />Copy PR Description</button>
    </aside>
  );
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

function PrActivityPanel({ context }) {
  return (
    <details className="pr-activity-panel" data-pr-section="activity" open>
      <summary>Activity / artifact references</summary>
      <div>
        {context.activity.map((item) => <p key={item.id}><strong>{item.actor}</strong> {item.action} <time>{item.createdAt}</time></p>)}
        {context.artifacts.map((artifact) => <code key={artifact.id}>{artifact.name}</code>)}
      </div>
    </details>
  );
}

function ErrorState({ error }) {
  return (
    <main className="pr-draft-center pr-error-state" data-testid="pr-draft-error">
      <AlertTriangle />
      <h1>PR Draft Center error</h1>
      <p><code>{error.code}</code>: {error.message}</p>
      <p>Supported API error codes: dsl_not_ready, review_blocked, pr_not_ready, artifact_missing, secret_redacted, not_found, validation_failed.</p>
    </main>
  );
}

function toApiDraftPayload(draft) {
  return {
    ...draft,
    checklistJson: draft.checklist.map((item) => ({
      text: item.label,
      checked: item.checked
    }))
  };
}

function createLocalPrContext({ activeRequirement, resolvedProjectId, agentWorkflow }) {
  return normalizeContext({
    requirement: activeRequirement || {
      id: "",
      projectId: resolvedProjectId,
      title: "PR draft has not been generated",
      goal: "Run an agent workflow or select a requirement to create PR draft evidence.",
      dslReadiness: "missing",
      handoffDecision: "not_recorded",
      points: []
    },
    agentRun: { runId: agentWorkflow.runId || "", status: agentWorkflow.runId ? "completed" : "missing" },
    prDraft: agentWorkflow.prDraft || {
      id: "",
      requirementId: "",
      runId: agentWorkflow.runId || "",
      title: "PR 草稿未生成",
      summary: [],
      changedFiles: [],
      tests: [],
      risks: [],
      checklist: [],
      status: "draft"
    },
    reviewItems: [],
    artifacts: [],
    activity: [],
    usedMockFallback: false
  });
}

function InfoCell({ label, value }) {
  return <div className="pr-info-cell"><small>{label}</small><strong>{value}</strong></div>;
}

function InfoPair({ label, value }) {
  return <><dt>{label}</dt><dd>{value}</dd></>;
}

export function evaluateReadiness({ requirement, agentRun, prDraft, reviewItems, artifacts, changeRecords }) {
  const blockingReasons = [];
  const gates = {};
  const readiness = requirement.dslReadiness || requirement.readiness;
  const dslPass = ["ready_for_agent", "handoff_to_agent", "ready", "strong"].includes(readiness);
  gates.dsl = gate(dslPass, dslPass ? "DSL is ready for agent." : "DSL readiness is not ready_for_agent.");
  if (!dslPass) blockingReasons.push("DSL readiness is not ready_for_agent.");

  const agentPass = agentRun.status === "completed" || agentRun.status === "passed";
  gates.agent = gate(agentPass, agentPass ? "Agent run completed." : "Agent run is not completed.");
  if (!agentPass) blockingReasons.push("Agent run is not completed.");

  const verificationStale = agentRun.verificationStatus === "stale" || changeRecords?.verificationStatus === "stale";
  if (verificationStale) blockingReasons.push("verification_stale_after_rollback");

  const hasFiles = prDraft.changedFiles.length > 0;
  if (!hasFiles) blockingReasons.push("Changed files are missing.");
  if (Array.isArray(changeRecords?.changes) && changeRecords.changes.length > 0 && changeRecords.changes.every((change) => ["reverted", "reset"].includes(change.status))) {
    blockingReasons.push("all_changes_reverted");
  }

  const blockingReview = reviewItems.find((item) => ["blocked", "changes_requested"].includes(item.status) || (item.required && item.status === "pending"));
  gates.review = gate(!blockingReview, blockingReview ? `Review item for ${blockingReview.filePath} is ${blockingReview.status}.` : "Review gate is clear.");
  if (blockingReview) blockingReasons.push(`Review item for ${blockingReview.filePath} is ${blockingReview.status}.`);

  const requiredTests = prDraft.tests.filter((test) => test.required);
  const missingTest = requiredTests.length === 0 || requiredTests.find((test) => ["missing", "failed", "error"].includes(test.status));
  gates.tests = gate(!missingTest, missingTest ? "Required test result is missing." : "Required tests are present.");
  if (missingTest) blockingReasons.push("Required test result is missing.");

  const unacknowledgedHighRisk = prDraft.risks.find((risk) => ["high", "critical", "p0"].includes(String(risk.level).toLowerCase()) && !risk.acknowledged);
  gates.risks = gate(!unacknowledgedHighRisk, unacknowledgedHighRisk ? "High risk is not acknowledged." : "High risks are acknowledged or documented.");
  if (unacknowledgedHighRisk) blockingReasons.push("High risk is not acknowledged.");

  const unsafeArtifact = artifacts.find((artifact) => ["unsafe"].includes(artifact.redactionState));
  const artifactPass = artifacts.length > 0 && !unsafeArtifact;
  gates.artifacts = gate(artifactPass, artifactPass ? "Artifact redaction state is safe." : unsafeArtifact ? "Artifact redaction state is unsafe." : "artifact_missing: artifact reference is missing.");
  if (!artifactPass) blockingReasons.push(unsafeArtifact ? "Artifact redaction state is unsafe." : "artifact_missing: artifact reference is missing.");

  const unresolvedChecklist = prDraft.checklist.find((item) => item.blocking && !item.checked);
  gates.checklist = gate(!unresolvedChecklist, unresolvedChecklist ? "Checklist blocking item is unresolved." : "Checklist blocking items are resolved.");
  if (unresolvedChecklist) blockingReasons.push("Checklist blocking item is unresolved.");

  const canReady = blockingReasons.length === 0 && hasFiles;
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

function evidenceStatus(context, readiness) {
  return {
    requirement: context.requirement.id ? "passed" : "missing",
    dsl: readiness.gates.dsl.status,
    agent: readiness.gates.agent.status,
    files: context.prDraft.changedFiles.length ? "passed" : "missing",
    review: readiness.gates.review.status,
    tests: readiness.gates.tests.status === "passed" ? "passed" : "warning",
    risks: readiness.gates.risks.status,
    artifacts: readiness.gates.artifacts.status,
    activity: context.activity.length ? "passed" : "missing"
  };
}

export function buildPrMarkdown(context, readiness = evaluateReadiness(context)) {
  const { prDraft, requirement } = context;
  const lines = [];
  if (readiness.status === "blocked") {
    lines.push("> Warning: This PR draft still has unresolved blockers.", "");
  }
  lines.push(`# ${prDraft.title || "Untitled PR Draft"}`, "", "## Summary");
  lines.push(...(prDraft.summary.length ? prDraft.summary.map((item) => `* ${item}`) : ["* No summary recorded."]));
  lines.push("", "## Requirement Mapping", `* Requirement: ${requirement.title}`, `* DSL readiness: ${requirement.dslReadiness}`, `* Handoff decision: ${requirement.handoffDecision}`);
  lines.push("", "## Changed Files");
  if (prDraft.changedFiles.length) {
    prDraft.changedFiles.forEach((file) => {
      lines.push(`* \`${file.path}\``, "", `  * Summary: ${file.changeSummary}`, `  * Requirement: ${file.requirementPoint}`, `  * Risk: ${file.risk}`, `  * Review: ${file.reviewStatus}`);
    });
  } else {
    lines.push("* No changed files recorded.");
  }
  lines.push("", "## Tests");
  lines.push(...(prDraft.tests.length ? prDraft.tests.map((test) => `* ${test.name}: ${test.status} (${test.source})${test.errorSummary ? ` - ${test.errorSummary}` : ""}`) : ["* Required test result is missing."]));
  lines.push("", "## Risks");
  lines.push(...(prDraft.risks.length ? prDraft.risks.map((risk) => `* ${risk.level}: ${risk.message} Mitigation: ${risk.mitigation} Acknowledged: ${risk.acknowledged ? "yes" : "no"}`) : ["* No risks recorded."]));
  lines.push("", "## Checklist");
  lines.push(...(prDraft.checklist.length ? prDraft.checklist.map((item) => `* [${item.checked ? "x" : " "}] ${item.label}`) : ["* [ ] No checklist recorded."]));
  if (prDraft.notes) lines.push("", "## Notes", prDraft.notes);
  return lines.join("\n");
}

function StatusBadge({ status }) {
  return <span className={`pr-status-badge ${status}`}>{status}</span>;
}

function ReadinessBadge({ status }) {
  return <span className={`pr-readiness-badge ${status}`}>{status}</span>;
}

function isUnsafeArtifact(artifact) {
  return ["redacted", "unsafe", "secret_redacted"].includes(artifact.redactionState);
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
