export function computeEvpiLiteGate({ scoring = {}, gapVector = {}, activatedRiskFactors = [], schemaActivation = {} } = {}) {
  const ready = Boolean(scoring.ready_for_agent && scoring.can_handoff_to_agent && scoring.handoff_decision === "ready_for_agent");
  const ranked = buildQuestionCandidates({ scoring, gapVector, activatedRiskFactors, schemaActivation });
  return {
    module_status: "standalone_dsl_core",
    clarification_gate: {
      should_ask: !ready,
      ready_for_agent: ready,
      can_handoff_to_agent: ready,
      handoff_decision: ready ? "ready_for_agent" : "clarify_first",
      coverage_source_type: gapVector.coverage_source_type || "actual_dsl_coverage"
    },
    ranked_questions: ranked.slice(0, 6)
  };
}

function buildQuestionCandidates({ scoring, gapVector, activatedRiskFactors, schemaActivation }) {
  const candidates = [];
  for (const factor of activatedRiskFactors) {
    candidates.push({
      question: ensureQuestionMark(factor.default_clarification_question || questionForFactor(factor.factor_id)),
      reason: "active_risk_factor",
      factor_ids: [factor.factor_id],
      target_fields: factor.default_coverage_fields || factor.related_dsl_fields || [],
      priority: ["critical", "high"].includes(String(factor.severity || "").toLowerCase()) ? "p0" : "p1",
      evpi_score: severityScore(factor.severity)
    });
  }
  for (const field of [...(gapVector.coverage?.missing || []), ...(schemaActivation.blocking_fields || [])]) {
    candidates.push({
      question: ensureQuestionMark(questionForField(field)),
      reason: "missing_or_blocking_field",
      factor_ids: [],
      target_fields: [field],
      priority: "p0",
      evpi_score: 8
    });
  }
  if (Array.isArray(scoring.blocking_reasons) && scoring.blocking_reasons.includes("acceptance_case_missing")) {
    candidates.unshift({
      question: "验收时你希望用哪些用户可见结果判断这个需求完成？",
      reason: "acceptance_case_missing",
      factor_ids: ["test_oracle_unclear"],
      target_fields: ["evaluation_atoms.acceptance_case"],
      priority: "p0",
      evpi_score: 10
    });
  }
  return dedupeQuestions(candidates).sort((a, b) => b.evpi_score - a.evpi_score);
}

function questionForFactor(factorId) {
  if (factorId === "error_state_missing") return "失败或异常场景要覆盖哪些情况？";
  if (factorId === "copy_policy_missing") return "你希望用户看到的提示文案大致表达什么？";
  return "当前还有哪个关键信息需要 PM 先确认？";
}

function questionForField(field) {
  if (/acceptance|oracle|expected/.test(field)) return "验收时你希望用哪些用户可见结果判断这个需求完成？";
  if (/negative|error/.test(field)) return "失败或异常场景要覆盖哪些情况？";
  if (/ui_copy/.test(field)) return "用户看到提示后，下一步动作应该是什么？";
  if (/scope/.test(field)) return "这次明确不做哪些范围，避免需求被放大？";
  if (/permission|security/.test(field)) return "这个需求是否涉及账号、权限或安全边界？";
  return "这个字段对应的 PM 决策应该如何确认？";
}

function severityScore(severity) {
  return { critical: 10, high: 8, medium: 5, low: 2 }[String(severity || "").toLowerCase()] || 3;
}

function dedupeQuestions(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item.question || "").replace(/\s+/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ensureQuestionMark(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "当前还有哪个关键信息需要 PM 先确认？";
  return /[?？]$/.test(trimmed) ? trimmed : `${trimmed}？`;
}
