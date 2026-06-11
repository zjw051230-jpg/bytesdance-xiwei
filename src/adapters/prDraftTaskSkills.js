export function buildPrDraftTaskSkillView(context, readiness) {
  const draft = context?.prDraft || {};
  const sources = context?.sources || {};
  return {
    overviewCards: [
      card("requirement", "Requirement / DSL", context?.requirement?.dslReadiness, readiness?.gates?.dsl, "requirement", sources.requirement),
      card("agent", "Agent Run", context?.agentRun?.status, readiness?.gates?.agent, "agent", sources.agentRun),
      card("review", "Review Gate", `${context?.reviewItems?.length || 0} items`, readiness?.gates?.review, "review", sources.review),
      card("tests", "Test Gate", `${draft.tests?.length || 0} records`, readiness?.gates?.tests, "tests", sources.prDraft),
      card("risks", "Risk Gate", `${draft.risks?.length || 0} risks`, readiness?.gates?.risks, "risks", sources.prDraft),
      card("artifacts", "Artifacts / Redaction", `${context?.artifacts?.length || 0} artifacts`, readiness?.gates?.artifacts, "artifacts", sources.artifacts),
      card("checklist", "Checklist", `${draft.checklist?.filter((item) => item.checked).length || 0}/${draft.checklist?.length || 0}`, readiness?.gates?.checklist, "checklist", sources.prDraft)
    ],
    details: [
      detail("requirement", "Requirement detail", "dialog", "Requirement title, goal, DSL readiness, handoff decision, acceptance points."),
      detail("files", "View Changed Files", "dialog", "Changed file table with summary, rationale, test, review and risk fields."),
      detail("review", "View Review Items", "dialog", "Review rows, required flags and blocked or changes_requested states."),
      detail("tests", "View Tests", "dialog", "Recorded test commands, status and error summary."),
      detail("risks", "View Risks", "dialog", "Risk levels, mitigation and acknowledgement state."),
      detail("artifacts", "View Artifacts", "dialog", "Artifact names, types and redaction state without unsafe raw content."),
      detail("checklist", "View Checklist", "details", "Blocking checklist progress."),
      detail("markdown", "View Markdown Preview", "dialog", "Rendered markdown generated from the live draft and current editor state."),
      detail("activity", "View Activity / Copy History", "details", "Project activity and copiedAt metadata.")
    ],
    gateOrder: ["dsl", "agent", "review", "tests", "risks", "artifacts", "checklist"]
  };
}

function card(id, title, value, gate, detailId, source) {
  return {
    id,
    title,
    value: value || "Field unavailable",
    status: gate?.status || sourceState(source),
    message: gate?.message || sourceMessage(source),
    detailId,
    source: source?.state || "live"
  };
}

function detail(id, title, surface, contract) {
  return { id, title, surface, contract };
}

function sourceState(source) {
  if (!source) return "unavailable";
  if (source.state === "success") return "passed";
  return source.state || "unavailable";
}

function sourceMessage(source) {
  if (!source) return "The backend did not return this source.";
  return source.error?.message || "Live API source.";
}
