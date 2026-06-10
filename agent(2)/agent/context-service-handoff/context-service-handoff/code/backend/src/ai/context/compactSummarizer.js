const crypto = require("node:crypto");
const { stableStringify } = require("./eventStore");

const RULE_BASED_SUMMARIZER = "rule_based";
const RULE_VERSION = "rule_v1.0.0";
const DEPENDENCY_RULE_VERSION = "dependency_summary_rule_v1.0.0";

class CompactSummarizer {
  constructor({ idGenerator } = {}) {
    this.idGenerator = idGenerator || ((prefix) => `${prefix}_${crypto.randomUUID()}`);
  }

  compressPlan(plan) {
    const value = pickDefined({
      steps: plan?.steps,
      target_files: plan?.target_files || plan?.targetFiles,
      risks: plan?.risks || plan?.risk_points || plan?.riskPoints,
      verification_plan: plan?.verification_plan || plan?.verificationPlan,
    });

    return this.createSummaryArtifact({
      summaryId: plan?.summary_id || this.idGenerator("summary_plan"),
      sourceArtifactRef: inferSourceArtifactRef(plan, "artifact:plan"),
      source: plan,
      value,
    });
  }

  compressPatch(patch) {
    const value = pickDefined({
      changed_files: patch?.changed_files || patch?.changedFiles,
      added_symbols: patch?.added_symbols || patch?.addedSymbols,
      removed_symbols: patch?.removed_symbols || patch?.removedSymbols,
      modified_functions: patch?.modified_functions || patch?.modifiedFunctions,
      patch_intent: patch?.patch_intent || patch?.patchIntent,
      risk_flags: patch?.risk_flags || patch?.riskFlags,
    });

    return this.createSummaryArtifact({
      summaryId: patch?.summary_id || this.idGenerator("summary_patch"),
      sourceArtifactRef: inferSourceArtifactRef(patch, "artifact:patch"),
      source: removeRawPatchFields(patch),
      value,
    });
  }

  compressSandboxResult(result) {
    const value = pickDefined({
      failed_command: result?.failed_command || result?.failedCommand || result?.command,
      exit_code: result?.exit_code ?? result?.exitCode,
      error_type: result?.error_type || result?.errorType,
      top_stack_lines: result?.top_stack_lines || result?.topStackLines,
      likely_cause: result?.likely_cause || result?.likelyCause,
      affected_files: result?.affected_files || result?.affectedFiles,
    });

    return this.createSummaryArtifact({
      summaryId: result?.summary_id || this.idGenerator("summary_sandbox"),
      sourceArtifactRef: inferSourceArtifactRef(result, "artifact:sandbox_result"),
      source: removeRawSandboxFields(result),
      value,
    });
  }

  compressRepair(repair) {
    const value = pickDefined({
      repair_intent: repair?.repair_intent || repair?.repairIntent,
      changed_files: repair?.changed_files || repair?.changedFiles,
      fixed_error_type: repair?.fixed_error_type || repair?.fixedErrorType,
      remaining_risks: repair?.remaining_risks || repair?.remainingRisks,
    });

    return this.createSummaryArtifact({
      summaryId: repair?.summary_id || this.idGenerator("summary_repair"),
      sourceArtifactRef: inferSourceArtifactRef(repair, "artifact:repair"),
      source: repair,
      value,
    });
  }

  buildDependencySummary({ taskId, targetNodeId, traceView }) {
    const dependencyChain = buildDependencyChainFromTraceView(traceView, targetNodeId);
    const value = buildDependencyValue(dependencyChain.chain_nodes);

    value.source_node_ids = dependencyChain.chain_nodes.map((node) => node.id);

    return this.createSummaryArtifact({
      summaryId: `summary_dependency_${targetNodeId}`,
      sourceArtifactRef: `trace_view:${taskId}:${targetNodeId}`,
      source: dependencyChain.chain_nodes.map((node) => ({
        id: node.id,
        type: node.type,
        summary: node.summary,
        metadata: sanitizeDependencyMetadata(node.metadata),
      })),
      value,
      summarizerVersion: DEPENDENCY_RULE_VERSION,
    });
  }

  createSummaryArtifact({
    summaryId,
    sourceArtifactRef,
    source,
    value,
    summarizerVersion = RULE_VERSION,
  }) {
    const normalizedValue = value || {};
    return {
      summary_id: summaryId,
      source_artifact_ref: sourceArtifactRef,
      source_artifact_hash: sha256(source || {}),
      summarizer_type: RULE_BASED_SUMMARIZER,
      summarizer_version: summarizerVersion,
      output_hash: sha256(normalizedValue),
      value: normalizedValue,
    };
  }
}

function buildDependencyChainFromTraceView(traceView, targetNodeId, maxDepth = 50) {
  const nodesById = new Map((traceView?.nodes || []).map((node) => [node.id, node]));
  const edgesByFrom = (traceView?.edges || [])
    .filter((edge) => edge.relation === "depends_on")
    .reduce((groups, edge) => {
      const current = groups.get(edge.from_node_id) || [];
      current.push(edge);
      groups.set(edge.from_node_id, current);
      return groups;
    }, new Map());
  const visited = new Set();
  const nodeIds = [];
  const queue = [{ nodeId: targetNodeId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current.nodeId) || current.depth > maxDepth) continue;
    visited.add(current.nodeId);
    if (nodesById.has(current.nodeId)) nodeIds.push(current.nodeId);

    for (const edge of edgesByFrom.get(current.nodeId) || []) {
      if (!visited.has(edge.to_node_id) && current.depth + 1 <= maxDepth) {
        queue.push({ nodeId: edge.to_node_id, depth: current.depth + 1 });
      }
    }
  }

  return {
    chain_nodes: nodeIds.map((nodeId) => nodesById.get(nodeId)).filter(Boolean),
  };
}

function buildDependencyValue(nodes) {
  const value = {};
  for (const node of nodes) {
    const summary = node.summary || node.metadata?.summary;
    if (!summary) continue;

    if (node.type === "final_dsl" || node.type === "draft_dsl" || node.type === "pm_input") {
      value.requirement ||= summary;
      continue;
    }
    if (node.type === "plan") {
      value.plan ||= summary;
      continue;
    }
    if (node.type === "patch") {
      value.patch ||= summary;
      continue;
    }
    if (node.type === "sandbox_result" || node.type === "error_event") {
      value.failure ||= summary;
      value.next_action_hint ||= node.metadata?.next_action_hint || node.metadata?.likely_cause;
      continue;
    }
    if (node.type === "repair") {
      value.repair ||= summary;
    }
  }
  return value;
}

function sanitizeDependencyMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return undefined;
  return pickDefined({
    likely_cause: metadata.likely_cause || metadata.likelyCause,
    next_action_hint: metadata.next_action_hint || metadata.nextActionHint,
    affected_files: metadata.affected_files || metadata.affectedFiles,
    changed_files: metadata.changed_files || metadata.changedFiles,
    failed_command: metadata.failed_command || metadata.failedCommand,
    error_type: metadata.error_type || metadata.errorType,
    risk_flags: metadata.risk_flags || metadata.riskFlags,
  });
}

function inferSourceArtifactRef(source, fallback) {
  return source?.source_artifact_ref || source?.artifact_ref || source?.artifactRef || source?.id || fallback;
}

function removeRawPatchFields(patch) {
  if (!patch || typeof patch !== "object") return patch;
  const { diff, patch_diff, patchDiff, full_patch_diff, fullPatchDiff, ...safePatch } = patch;
  return safePatch;
}

function removeRawSandboxFields(result) {
  if (!result || typeof result !== "object") return result;
  const { log, logs, full_log, fullLog, sandbox_log, sandboxLog, stdout, stderr, ...safeResult } = result;
  return safeResult;
}

function pickDefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null),
  );
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

const defaultSummarizer = new CompactSummarizer();

module.exports = {
  CompactSummarizer,
  RULE_BASED_SUMMARIZER,
  RULE_VERSION,
  DEPENDENCY_RULE_VERSION,
  compressPlan: defaultSummarizer.compressPlan.bind(defaultSummarizer),
  compressPatch: defaultSummarizer.compressPatch.bind(defaultSummarizer),
  compressSandboxResult: defaultSummarizer.compressSandboxResult.bind(defaultSummarizer),
  compressRepair: defaultSummarizer.compressRepair.bind(defaultSummarizer),
  buildDependencySummary: defaultSummarizer.buildDependencySummary.bind(defaultSummarizer),
  sha256,
};
