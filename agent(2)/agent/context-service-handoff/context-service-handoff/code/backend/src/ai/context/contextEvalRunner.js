const { AgentContextBuilder } = require("./agentContextBuilder");
const { PrivacyFilter } = require("./privacyFilter");

const DEFAULT_CONTEXT_EVAL_THRESHOLDS = {
  dependency_recall_min: 0.95,
  noise_rate_max: 0.05,
  constraint_recall_min: 1.0,
  source_attribution_accuracy_min: 0.95,
  privacy_leakage_allowed: false,
  replay_accuracy_required: true,
};

const DEFAULT_CONTEXT_QUALITY_WEIGHTS = {
  relevance: 0.2,
  sufficiency: 0.3,
  isolation: 0.15,
  economy: 0.15,
  provenance: 0.2,
};

const FORBIDDEN_RAW_FIELDS = new Set([
  "full_context",
  "full_chat_history",
  "full_sandbox_log",
  "full_patch_diff",
]);

class ContextEvalRunner {
  constructor({ agentContextBuilder, privacyFilter } = {}) {
    this.agentContextBuilder = agentContextBuilder || new AgentContextBuilder();
    this.privacyFilter = privacyFilter || new PrivacyFilter();
  }

  runContextEvalCase(evalCase, thresholds = {}) {
    const mergedThresholds = { ...DEFAULT_CONTEXT_EVAL_THRESHOLDS, ...thresholds };
    const agentContext = evalCase.context || this.buildAgentContext(evalCase);
    const metrics = {
      dependency_recall: this.calculateDependencyRecall(agentContext, evalCase.expected_source_nodes || []),
      noise_rate: this.calculateNoiseRate(agentContext, evalCase.forbidden_source_nodes || []),
      constraint_recall: this.calculateConstraintRecall(agentContext, evalCase.expected_constraints || []),
      source_attribution_accuracy: this.calculateSourceAttributionAccuracy(agentContext, evalCase.expected_attributions || []),
      privacy_leakage: this.detectPrivacyLeakage(agentContext),
      replay_accuracy: this.calculateReplayAccuracy(evalCase, agentContext),
    };
    const failedReasons = buildFailedReasons(metrics, mergedThresholds);

    return {
      passed: failedReasons.length === 0,
      failed_reasons: failedReasons,
      metrics,
    };
  }

  runContextEvalSuite(cases, thresholds = {}) {
    const caseResults = cases.map((evalCase) => this.runContextEvalCase(evalCase, thresholds));
    const summary = {
      total: caseResults.length,
      passed: caseResults.filter((result) => result.passed).length,
      failed: caseResults.filter((result) => !result.passed).length,
      average_dependency_recall: average(caseResults, "dependency_recall"),
      average_noise_rate: average(caseResults, "noise_rate"),
      average_constraint_recall: average(caseResults, "constraint_recall"),
      average_source_attribution_accuracy: average(caseResults, "source_attribution_accuracy"),
      privacy_leakage_count: caseResults.filter((result) => result.metrics.privacy_leakage).length,
    };

    return {
      passed: summary.failed === 0,
      case_results: caseResults,
      summary,
    };
  }

  calculateDependencyRecall(context, expectedNodes) {
    if (!expectedNodes || expectedNodes.length === 0) return 1;
    const sourceNodeIds = collectSourceNodeIds(context);
    const recalled = expectedNodes.filter((nodeId) => sourceNodeIds.has(nodeId)).length;
    return recalled / expectedNodes.length;
  }

  calculateNoiseRate(context, forbiddenNodes) {
    if (!forbiddenNodes || forbiddenNodes.length === 0) return 0;
    const sourceNodeIds = collectSourceNodeIds(context);
    const forbiddenFound = forbiddenNodes.filter((nodeId) => sourceNodeIds.has(nodeId)).length;
    return forbiddenFound / Math.max(1, sourceNodeIds.size);
  }

  calculateConstraintRecall(context, expectedConstraints) {
    if (!expectedConstraints || expectedConstraints.length === 0) return 1;
    const haystack = collectSearchableText(context).toLowerCase();
    const recalled = expectedConstraints.filter((constraint) => haystack.includes(String(constraint).toLowerCase())).length;
    return recalled / expectedConstraints.length;
  }

  calculateSourceAttributionAccuracy(context, expectedAttributions) {
    if (!expectedAttributions || expectedAttributions.length === 0) return 1;
    const passed = expectedAttributions.filter((attribution) => {
      const target = getByPath(context, attribution.context_path);
      const sourceNodeIds = new Set(collectLocalSourceNodeIds(target));
      return (attribution.expected_source_nodes || []).every((nodeId) => sourceNodeIds.has(nodeId));
    }).length;
    return passed / expectedAttributions.length;
  }

  calculateContextQualityReport(metricsOrEvalResult, options = {}) {
    const metrics = metricsOrEvalResult?.metrics || metricsOrEvalResult || {};
    const relevance = clamp01(1 - safeNumber(metrics.noise_rate, 0));
    const sufficiency = clamp01(safeNumber(metrics.dependency_recall, 1));
    const provenance = clamp01(safeNumber(metrics.source_attribution_accuracy, 1));
    const isolation = calculateIsolation(metricsOrEvalResult, options);
    const economy = calculateEconomy(metricsOrEvalResult, options);
    const overallScore = clamp01(
      relevance * DEFAULT_CONTEXT_QUALITY_WEIGHTS.relevance
      + sufficiency * DEFAULT_CONTEXT_QUALITY_WEIGHTS.sufficiency
      + isolation * DEFAULT_CONTEXT_QUALITY_WEIGHTS.isolation
      + economy * DEFAULT_CONTEXT_QUALITY_WEIGHTS.economy
      + provenance * DEFAULT_CONTEXT_QUALITY_WEIGHTS.provenance,
    );

    return {
      relevance: roundScore(relevance),
      sufficiency: roundScore(sufficiency),
      isolation: roundScore(isolation),
      economy: roundScore(economy),
      provenance: roundScore(provenance),
      overall_score: roundScore(overallScore),
    };
  }

  detectPrivacyLeakage(context) {
    return this.privacyFilter.redactSensitiveObject(context).privacy_report.redacted;
  }

  calculateReplayAccuracy(evalCase, agentContext) {
    if (evalCase.context) {
      return stableReplayShape(evalCase.context) === stableReplayShape(agentContext);
    }

    try {
      const replayedContext = this.buildAgentContext(evalCase);
      return stableReplayShape(agentContext) === stableReplayShape(replayedContext);
    } catch (error) {
      return false;
    }
  }

  buildAgentContext(evalCase) {
    return this.agentContextBuilder.buildContextForAgent({
      taskId: evalCase.task_id,
      agentName: evalCase.target_agent,
      currentNodeId: evalCase.current_node_id,
    });
  }
}

function buildFailedReasons(metrics, thresholds) {
  const failedReasons = [];
  if (metrics.dependency_recall < thresholds.dependency_recall_min) {
    failedReasons.push(`dependency_recall ${metrics.dependency_recall} is below minimum ${thresholds.dependency_recall_min}.`);
  }
  if (metrics.noise_rate > thresholds.noise_rate_max) {
    failedReasons.push(`noise_rate ${metrics.noise_rate} is above maximum ${thresholds.noise_rate_max}.`);
  }
  if (metrics.constraint_recall < thresholds.constraint_recall_min) {
    failedReasons.push(`constraint_recall ${metrics.constraint_recall} is below minimum ${thresholds.constraint_recall_min}.`);
  }
  if (metrics.source_attribution_accuracy < thresholds.source_attribution_accuracy_min) {
    failedReasons.push(
      `source_attribution_accuracy ${metrics.source_attribution_accuracy} is below minimum ${thresholds.source_attribution_accuracy_min}.`,
    );
  }
  if (!thresholds.privacy_leakage_allowed && metrics.privacy_leakage) {
    failedReasons.push("privacy_leakage is true but privacy leakage is not allowed.");
  }
  if (thresholds.replay_accuracy_required && !metrics.replay_accuracy) {
    failedReasons.push("replay_accuracy is false but replay accuracy is required.");
  }
  return failedReasons;
}

function collectSourceNodeIds(value) {
  return new Set(collectSourceNodeIdList(value));
}

function collectSourceNodeIdList(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectSourceNodeIdList(item));
  }

  const ownSourceNodeIds = Array.isArray(value.source_node_ids) ? value.source_node_ids : [];
  return [
    ...ownSourceNodeIds,
    ...Object.entries(value)
      .filter(([key]) => key !== "source_node_ids")
      .flatMap(([, entryValue]) => collectSourceNodeIdList(entryValue)),
  ];
}

function collectLocalSourceNodeIds(value) {
  if (!value || typeof value !== "object") return [];
  return Array.isArray(value.source_node_ids) ? value.source_node_ids : [];
}

function collectSearchableText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(collectSearchableText).join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([key]) => !isUnsafeSearchField(key))
      .map(([key, entryValue]) => `${key}\n${collectSearchableText(entryValue)}`)
      .join("\n");
  }
  return "";
}

function isUnsafeSearchField(key) {
  return [
    "full_context",
    "full_chat_history",
    "full_sandbox_log",
    "full_patch_diff",
    "full_payload",
    "payload",
  ].includes(key);
}

function getByPath(value, path) {
  if (!path) return undefined;
  const normalizedPath = path.startsWith("context.") ? path.slice("context.".length) : path;
  return normalizedPath.split(".").reduce((cursor, part) => {
    if (!cursor || typeof cursor !== "object") return undefined;
    return cursor[part];
  }, value.context ? value.context : value);
}

function stableReplayShape(agentContext) {
  return stableStringify({
    source_node_ids: agentContext.source_node_ids || [],
    context_keys: Object.keys(agentContext.context || {}).sort(),
    budget_report: agentContext.budget_report || {},
  });
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function calculateIsolation(metricsOrEvalResult, options) {
  if (typeof options.isolation_score === "number") return clamp01(options.isolation_score);
  if (typeof options.agent_context_overlap === "number") return clamp01(1 - options.agent_context_overlap);

  const context = options.context || metricsOrEvalResult?.context || {};
  return hasForbiddenRawFields(context) ? 0.5 : 1;
}

function calculateEconomy(metricsOrEvalResult, options) {
  const maxChars = Math.max(1, safeNumber(options.max_chars, safeNumber(options.maxChars, 0)));
  const budgetReport = options.budget_report || metricsOrEvalResult?.budget_report || {};
  const afterChars = safeNumber(budgetReport.after_chars, safeNumber(options.context_size_chars, 0));

  if (!maxChars || (!afterChars && afterChars !== 0)) return 1;
  if (afterChars <= maxChars) return 1;
  return clamp01(maxChars / afterChars);
}

function hasForbiddenRawFields(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenRawFields(item));
  return Object.entries(value).some(([key, entryValue]) => (
    FORBIDDEN_RAW_FIELDS.has(key) || hasForbiddenRawFields(entryValue)
  ));
}

function safeNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundScore(value) {
  return Math.round(value * 1000000) / 1000000;
}

function average(results, metricName) {
  if (results.length === 0) return 0;
  return results.reduce((total, result) => total + result.metrics[metricName], 0) / results.length;
}

const defaultRunner = new ContextEvalRunner();

module.exports = {
  ContextEvalRunner,
  DEFAULT_CONTEXT_EVAL_THRESHOLDS,
  runContextEvalCase: defaultRunner.runContextEvalCase.bind(defaultRunner),
  runContextEvalSuite: defaultRunner.runContextEvalSuite.bind(defaultRunner),
  calculateDependencyRecall: defaultRunner.calculateDependencyRecall.bind(defaultRunner),
  calculateNoiseRate: defaultRunner.calculateNoiseRate.bind(defaultRunner),
  calculateConstraintRecall: defaultRunner.calculateConstraintRecall.bind(defaultRunner),
  calculateSourceAttributionAccuracy: defaultRunner.calculateSourceAttributionAccuracy.bind(defaultRunner),
  calculateContextQualityReport: defaultRunner.calculateContextQualityReport.bind(defaultRunner),
};
