import { validateRequirementDsl } from "./schemaValidator.js";

export function scoreRequirementDsl({ dsl = {}, gapVector = {}, activatedRiskFactors = [], schemaActivation = {} } = {}) {
  const validation = validateRequirementDsl(dsl);
  const acceptanceCount = Array.isArray(dsl.acceptance_criteria) ? dsl.acceptance_criteria.filter(Boolean).length : 0;
  const requirementsCount = Array.isArray(dsl.requirements) ? dsl.requirements.filter(Boolean).length : 0;
  const missingCount = gapVector.coverage?.missing?.length || 0;
  const partialCount = gapVector.coverage?.partial?.length || 0;
  const blockingCount = Array.isArray(schemaActivation.blocking_fields) ? schemaActivation.blocking_fields.length : 0;
  const highRiskCount = activatedRiskFactors.filter((factor) => ["critical", "high"].includes(String(factor.severity || "").toLowerCase())).length;

  const breakdown = {
    schema: validation.valid ? 22 : Math.max(0, 22 - validation.errors.length * 5),
    intent: requirementsCount > 0 ? 18 : 4,
    acceptance: acceptanceCount > 0 ? 22 : 0,
    riskCoverage: Math.max(0, 20 - missingCount * 4 - partialCount * 2),
    readiness: dsl.ready_for_agent === true && highRiskCount === 0 ? 18 : Math.max(0, 10 - blockingCount)
  };
  const rawScore = clamp(Math.round(Object.values(breakdown).reduce((sum, item) => sum + item, 0)), 0, 100);
  const blockingReasons = [];
  if (!validation.valid) blockingReasons.push("schema_invalid");
  if (acceptanceCount < 1) blockingReasons.push("acceptance_case_missing");
  if (missingCount > 0) blockingReasons.push("gap_fields_missing");
  if (highRiskCount > 0) blockingReasons.push("high_risk_requires_clarification");

  const ready = rawScore >= 90 && blockingReasons.length === 0 && dsl.ready_for_agent === true;
  return {
    module_status: "standalone_dsl_core",
    rawScore,
    dsl_completion_score: rawScore,
    breakdown,
    validation,
    ready_for_agent: ready,
    can_handoff_to_agent: ready,
    handoff_decision: ready ? "ready_for_agent" : "clarify_first",
    blocking_reasons: blockingReasons,
    clarification_reasons: blockingReasons.length ? blockingReasons : ["manual_pm_confirmation_required"],
    covered_items: gapVector.coverage?.covered || [],
    pending_items: [...(gapVector.coverage?.partial || []), ...(gapVector.coverage?.missing || [])],
    activated_risk_factors: activatedRiskFactors
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
