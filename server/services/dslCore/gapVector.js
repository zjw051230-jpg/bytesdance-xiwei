export function computeGapVector({ dsl = {}, schemaActivation = {}, activatedRiskFactors = [] } = {}) {
  const requiredFields = unique([
    ...arrayOfStrings(schemaActivation.required_fields),
    ...activatedRiskFactors.flatMap((factor) => arrayOfStrings(factor.default_coverage_fields))
  ]);
  const covered = [];
  const partial = [];
  const missing = [];
  const fieldDetails = [];

  for (const field of requiredFields) {
    const score = coverageScore(field, dsl);
    const status = score >= 0.8 ? "covered" : score > 0 ? "partial" : "missing";
    if (status === "covered") covered.push(field);
    if (status === "partial") partial.push(field);
    if (status === "missing") missing.push(field);
    fieldDetails.push({ field, status, coverage_ratio: score });
  }

  const topGapFactors = activatedRiskFactors
    .map((factor) => {
      const fields = unique([...arrayOfStrings(factor.related_dsl_fields), ...arrayOfStrings(factor.default_coverage_fields)]);
      const factorDetails = fieldDetails.filter((item) => fields.includes(item.field));
      const missingFields = factorDetails.filter((item) => item.status === "missing").map((item) => item.field);
      const partialFields = factorDetails.filter((item) => item.status === "partial").map((item) => item.field);
      const coverageRatio = factorDetails.length
        ? factorDetails.reduce((sum, item) => sum + item.coverage_ratio, 0) / factorDetails.length
        : 0;
      return {
        factor_id: factor.factor_id,
        category: factor.category,
        severity: factor.severity,
        coverage_ratio: round(coverageRatio),
        coverage_status: coverageRatio >= 0.8 ? "covered" : coverageRatio > 0 ? "partial" : "missing",
        missing_fields: missingFields,
        partial_fields: partialFields,
        gap_score: round((1 - coverageRatio) * severityWeight(factor.severity))
      };
    })
    .filter((factor) => factor.coverage_status !== "covered")
    .sort((a, b) => b.gap_score - a.gap_score)
    .slice(0, 6);

  const total = fieldDetails.length || 1;
  const coverageRatio = (covered.length + partial.length * 0.5) / total;
  return {
    coverage: { covered, partial, missing, field_details: fieldDetails },
    coverage_source_type: "actual_dsl_coverage",
    residual_ratio: round(1 - coverageRatio),
    top_gap_factors: topGapFactors,
    summary: {
      total_fields: fieldDetails.length,
      covered_count: covered.length,
      partial_count: partial.length,
      missing_count: missing.length
    }
  };
}

function coverageScore(field, dsl) {
  const acceptance = arrayOfStrings(dsl.acceptance_criteria).join(" ");
  const requirements = arrayOfStrings(dsl.requirements).join(" ");
  const risks = arrayOfStrings(dsl.risks).join(" ");
  const scope = JSON.stringify(dsl.scope || {});
  const text = `${dsl.title || ""} ${dsl.summary || ""} ${requirements} ${acceptance} ${risks} ${scope}`.toLowerCase();

  if (/test_oracle_detail\.expected_result/.test(field)) {
    if (/预期结果|expected result|可见结果|visible result/i.test(acceptance)) return 1;
    return 0;
  }
  if (/acceptance_case|test_oracle|expected_result/.test(field)) {
    if (acceptance.length > 12 && /失败|错误|password|login|用户|提示|完成|clear|next action/i.test(acceptance)) return 1;
    if (acceptance.length > 0) return 0.5;
    return 0;
  }
  if (/negative_case|error_state/.test(field)) {
    if (/失败|错误|异常|锁定|不存在|network|error|negative|password/i.test(text)) return 0.5;
    return 0;
  }
  if (/ui_copy/.test(field)) {
    if (/提示|文案|copy|message|toast|prompt|clear|action/i.test(text)) return 0.5;
    return 0;
  }
  if (/scope|out_of_scope|in_scope/.test(field)) {
    return Array.isArray(dsl.scope?.out_of_scope) || /不做|范围|only|scope/i.test(text) ? 0.8 : 0;
  }
  if (/permission|security|privacy/.test(field)) {
    return /权限|账号|安全|隐私|permission|auth|security/i.test(text) ? 0.5 : 0;
  }
  if (/completion_criteria|ready_for_agent/.test(field)) {
    return dsl.ready_for_agent === true ? 0.8 : 0;
  }
  return text.includes(lastSegment(field).toLowerCase()) ? 0.5 : 0;
}

function severityWeight(severity) {
  return { critical: 1, high: 0.8, medium: 0.5, low: 0.2 }[String(severity || "").toLowerCase()] || 0.4;
}

function lastSegment(field) {
  return String(field || "").split(".").pop() || "";
}

function unique(items) {
  return [...new Set(arrayOfStrings(items))];
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}
