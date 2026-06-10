const categories = [
  "intent_gap",
  "boundary_control",
  "api_contract",
  "data_impact",
  "security_privacy",
  "ui_ux",
  "testing",
  "analytics",
  "rollout",
  "agent_execution"
];

const keywordRules = [
  { type: "login_error_state", category: "ui_ux", keywords: ["登录", "login", "失败", "错误", "锁定"] },
  { type: "ui_style", category: "ui_ux", keywords: ["样式", "主题", "按钮", "文案", "颜色", "ui", "copy", "style", "theme"] },
  { type: "favorite_interaction", category: "ui_ux", keywords: ["收藏", "取消收藏", "favorite", "like", "点赞"] },
  { type: "api_contract", category: "api_contract", keywords: ["api", "接口", "字段", "错误码", "状态码", "response"] },
  { type: "security_permission", category: "security_privacy", keywords: ["权限", "账号", "安全", "隐私", "auth", "role"] },
  { type: "testing_acceptance", category: "testing", keywords: ["测试", "验收", "标准", "用例", "test", "acceptance"] },
  { type: "data_change", category: "data_impact", keywords: ["数据", "表", "schema", "迁移", "导入", "db"] },
  { type: "agent_execution", category: "agent_execution", keywords: ["agent", "自动执行", "代码执行", "handoff"] }
];

const severityWeights = { critical: 0.35, high: 0.25, medium: 0.15, low: 0.08 };

export function routeRequirementType({ text = "", activatedRiskFactors = [] } = {}) {
  const normalized = normalize(text);
  const moduleActivation = Object.fromEntries(categories.map((category) => [category, 0]));
  const requirementTypes = [];
  const routerTrace = [];

  for (const factor of activatedRiskFactors) {
    if (!factor?.category || !(factor.category in moduleActivation)) continue;
    const delta = severityWeights[String(factor.severity || "").toLowerCase()] || 0.08;
    moduleActivation[factor.category] += delta;
    routerTrace.push({ source: "risk_factor", category: factor.category, factor_id: factor.factor_id, score_delta: delta });
  }

  for (const rule of keywordRules) {
    const matched = rule.keywords.filter((keyword) => normalized.includes(normalize(keyword)));
    if (matched.length === 0) continue;
    requirementTypes.push(rule.type);
    moduleActivation[rule.category] += Math.min(0.45, 0.16 + matched.length * 0.08);
    routerTrace.push({ source: "keyword", category: rule.category, requirement_type: rule.type, matched_keywords: matched });
  }

  if (requirementTypes.length === 0) {
    requirementTypes.push("general_requirement");
    moduleActivation.intent_gap += 0.18;
  }

  return {
    requirement_types: [...new Set(requirementTypes)],
    module_activation: Object.fromEntries(Object.entries(moduleActivation).map(([key, value]) => [key, clamp(value)])),
    router_trace: routerTrace
  };
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, "");
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
