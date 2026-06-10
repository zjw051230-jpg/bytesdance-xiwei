const dslModules = [
  "meta",
  "readiness_gates",
  "task_profile",
  "intent_atoms",
  "business_semantics",
  "baseline_behavior",
  "scope_atoms",
  "change_atoms",
  "boundary_atoms",
  "decision_policy",
  "risk_atoms",
  "execution_atoms",
  "evaluation_atoms",
  "test_oracle_detail",
  "clarification_queue",
  "scoring_atoms"
];

const categoryModules = {
  intent_gap: ["intent_atoms", "business_semantics", "clarification_queue"],
  boundary_control: ["scope_atoms", "boundary_atoms", "decision_policy"],
  api_contract: ["change_atoms", "test_oracle_detail", "evaluation_atoms"],
  data_impact: ["change_atoms", "baseline_behavior", "test_oracle_detail"],
  security_privacy: ["boundary_atoms", "decision_policy", "readiness_gates"],
  ui_ux: ["scope_atoms", "change_atoms", "evaluation_atoms"],
  testing: ["evaluation_atoms", "test_oracle_detail", "scoring_atoms"],
  analytics: ["business_semantics", "evaluation_atoms"],
  rollout: ["decision_policy", "execution_atoms"],
  agent_execution: ["execution_atoms", "decision_policy", "readiness_gates"]
};

const alwaysLight = ["meta", "readiness_gates", "task_profile", "intent_atoms", "risk_atoms", "scoring_atoms"];

export function activateSchema({ routerResult = {}, activatedRiskFactors = [] } = {}) {
  const deep = [];
  const light = [...alwaysLight];
  const trace = [];
  const activation = routerResult.module_activation || {};

  for (const [category, modules] of Object.entries(categoryModules)) {
    const score = Number(activation[category] || 0);
    if (score >= 0.3) {
      pushUnique(score >= 0.65 ? deep : light, modules);
      trace.push({ category, score, scan_depth: score >= 0.65 ? "deep" : "light", modules });
    } else {
      trace.push({ category, score, scan_depth: "disabled", modules });
    }
  }

  const required = [];
  const recommended = [];
  const blocking = [];
  for (const factor of activatedRiskFactors) {
    const fields = fieldsForFactor(factor);
    pushUnique(required, fields);
    if (["critical", "high"].includes(String(factor.severity || "").toLowerCase())) {
      pushUnique(blocking, fields);
      pushUnique(deep, categoryModules[factor.category] || []);
      trace.push({ source: "high_risk_force_deep", factor_id: factor.factor_id, category: factor.category });
    } else {
      pushUnique(recommended, fields);
    }
  }

  const deepSet = new Set(deep);
  const lightScan = sortModules(light.filter((module) => !deepSet.has(module)));
  const deepModules = sortModules(deep);
  const disabled = dslModules.filter((module) => !deepModules.includes(module) && !lightScan.includes(module));

  return {
    deep_modules: deepModules,
    light_scan_modules: lightScan,
    disabled_modules: disabled,
    required_fields: required,
    recommended_fields: recommended,
    blocking_fields: blocking,
    activation_trace: trace
  };
}

function fieldsForFactor(factor = {}) {
  return unique([
    ...arrayOfStrings(factor.related_dsl_fields),
    ...arrayOfStrings(factor.default_coverage_fields)
  ]);
}

function sortModules(modules) {
  const set = new Set(modules);
  return dslModules.filter((module) => set.has(module));
}

function pushUnique(target, items) {
  for (const item of arrayOfStrings(items)) {
    if (!target.includes(item)) target.push(item);
  }
}

function unique(items) {
  return [...new Set(arrayOfStrings(items))];
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
