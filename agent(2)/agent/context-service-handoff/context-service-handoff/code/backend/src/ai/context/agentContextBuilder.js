const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { EventStore } = require("./eventStore");
const { TraceProjector } = require("./traceProjector");
const { TraceGraphStore } = require("./traceGraphStore");
const { CompactSummarizer } = require("./compactSummarizer");
const { ContextBudgetManager } = require("./contextBudgetManager");
const { PrivacyFilter } = require("./privacyFilter");

class AgentContextBuilder {
  constructor({
    eventStore,
    traceProjector,
    traceGraphStore,
    compactSummarizer,
    contextBudgetManager,
    privacyFilter,
    storageRoot,
    now,
    idGenerator,
  } = {}) {
    this.eventStore = eventStore || new EventStore({ storageRoot, now });
    this.traceProjector = traceProjector || new TraceProjector({ eventStore: this.eventStore, storageRoot, now });
    this.traceGraphStore = traceGraphStore || new TraceGraphStore({
      eventStore: this.eventStore,
      traceProjector: this.traceProjector,
      storageRoot,
      now,
    });
    this.compactSummarizer = compactSummarizer || new CompactSummarizer();
    this.contextBudgetManager = contextBudgetManager || new ContextBudgetManager();
    this.privacyFilter = privacyFilter || new PrivacyFilter();
    this.storageRoot = storageRoot || this.eventStore.storageRoot;
    this.now = now || (() => new Date().toISOString());
    this.idGenerator = idGenerator || ((prefix) => `${prefix}_${crypto.randomUUID()}`);
  }

  buildContextForAgent({ taskId, agentName, currentNodeId }) {
    const createdAt = this.now();
    const contextId = this.idGenerator("ctx");
    const traceView = this.traceProjector.rebuildTraceView(taskId).trace_view;
    const dependencyChain = currentNodeId
      ? this.traceGraphStore.getDependencyChain(taskId, currentNodeId)
      : emptyDependencyChain(currentNodeId);
    const dependencySummary = currentNodeId
      ? this.compactSummarizer.buildDependencySummary({ taskId, targetNodeId: currentNodeId, traceView })
      : emptySummaryArtifact("summary_dependency_none");

    const sourceNodeIds = currentNodeId
      ? dependencyChain.chain_nodes.map((node) => node.id)
      : collectSourceNodeIds(traceView.nodes);
    const sourceEventIds = collectSourceEventIds(this.eventStore.readEvents(taskId), sourceNodeIds);
    const draftContext = buildAgentContext(agentName, traceView, dependencySummary, dependencyChain);
    const { context: budgetedContext, budget_report: budgetReport } = this.contextBudgetManager.applyContextBudget(agentName, draftContext);
    const { value: filteredContext, privacy_report: privacyReport } = this.privacyFilter.redactSensitiveObject(budgetedContext);
    const contextCacheRef = this.writeContextCache(taskId, contextId, filteredContext);

    this.eventStore.appendEvent(taskId, {
      type: "CONTEXT_BUILT",
      category: "system_event",
      producer: "AgentContextBuilder",
      payload: {
        context_id: contextId,
        agent_name: agentName,
        current_node_id: currentNodeId,
        source_node_ids: sourceNodeIds,
        source_event_ids: sourceEventIds,
        budget_report: budgetReport,
        privacy_report: privacyReport,
        context_cache_ref: contextCacheRef,
      },
      idempotency_key: `context-built:${taskId}:${contextId}`,
    });

    return {
      task_id: taskId,
      agent_name: agentName,
      current_node_id: currentNodeId,
      context: filteredContext,
      source_node_ids: sourceNodeIds,
      source_event_ids: sourceEventIds,
      budget_report: budgetReport,
      privacy_report: privacyReport,
      created_at: createdAt,
    };
  }

  writeContextCache(taskId, contextId, context) {
    const relativePath = path.join("tasks", safePathSegment(taskId), "context_cache", `${contextId}.json`);
    const absolutePath = path.join(this.storageRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, JSON.stringify(context, null, 2), "utf8");
    return toPosix(relativePath);
  }
}

function buildAgentContext(agentName, traceView, dependencySummary, dependencyChain) {
  const helpers = createTraceHelpers(traceView, dependencySummary, dependencyChain);
  if (agentName === "planAgent") {
    return {
      final_dsl: helpers.sourcedNodeValue(["final_dsl", "draft_dsl"]),
      requirement_summary: helpers.sourcedNodeValue(["pm_input", "final_dsl", "draft_dsl"]),
      context_package_summary: helpers.sourcedNodeValue(["context_package"]),
      active_constraints: helpers.constraints(),
      active_interrupts: helpers.activeInterrupts(),
      relevant_experiences: helpers.experiences(),
      trace_summary: helpers.traceSummary(),
    };
  }

  if (agentName === "codegenAgent") {
    return {
      final_dsl_core: helpers.sourcedNodeValue(["final_dsl", "draft_dsl"]),
      verified_plan: helpers.sourcedVerifiedPlan(),
      target_files_summary: helpers.metadataList("target_files"),
      target_snippets: helpers.metadataList("target_snippets"),
      patch_constraints: helpers.constraints(),
      active_interrupts: helpers.activeInterrupts(),
    };
  }

  if (agentName === "repairAgent") {
    return {
      final_dsl_core: helpers.sourcedNodeValue(["final_dsl", "draft_dsl"]),
      dependency_summary: {
        value: dependencySummary.value,
        source_node_ids: dependencySummary.value?.source_node_ids || [],
      },
      failed_patch_summary: helpers.sourcedNodeValue(["patch"], (node) => node.status === "failed" || dependencyHasNode(dependencyChain, node.id)),
      sandbox_error_summary: helpers.sourcedNodeValue(["sandbox_result", "error_event"]),
      verified_plan_summary: helpers.sourcedVerifiedPlan(),
      repair_attempt_count: traceView.nodes.filter((node) => node.type === "repair").length,
      active_interrupts: helpers.activeInterrupts(),
    };
  }

  if (agentName === "deliveryAgent") {
    return {
      final_dsl_summary: helpers.sourcedNodeValue(["final_dsl", "draft_dsl"]),
      plan_summary: helpers.sourcedNodeValue(["plan"]),
      patch_summary: helpers.sourcedNodeValue(["patch"]),
      test_summary: helpers.sourcedNodeValue(["sandbox_result", "tool_result"]),
      risk_summary: helpers.metadataList("risks"),
      evidence_list: helpers.evidenceList(),
    };
  }

  throw new Error(`Unsupported agentName "${agentName}".`);
}

function createTraceHelpers(traceView, dependencySummary, dependencyChain) {
  const nodes = traceView.nodes || [];
  return {
    sourcedNodeValue(types, predicate = () => true) {
      const matchedNodes = nodes.filter((node) => types.includes(node.type) && predicate(node));
      return {
        value: matchedNodes.map(toLightNode),
        source_node_ids: matchedNodes.map((node) => node.id),
      };
    },
    sourcedVerifiedPlan() {
      const matchedNodes = nodes.filter((node) => node.type === "plan" && ["verified", "created", "active"].includes(node.status));
      return {
        value: matchedNodes.map(toLightNode),
        source_node_ids: matchedNodes.map((node) => node.id),
      };
    },
    activeInterrupts() {
      const matchedNodes = nodes.filter((node) => node.type === "interrupt_instruction" && node.status !== "archived");
      return {
        value: matchedNodes.map(toLightNode),
        source_node_ids: matchedNodes.map((node) => node.id),
      };
    },
    experiences() {
      const matchedNodes = nodes.filter((node) => ["experience_candidate", "experience_memory"].includes(node.type));
      return {
        value: matchedNodes.map(toLightNode),
        source_node_ids: matchedNodes.map((node) => node.id),
      };
    },
    constraints() {
      const constraintNodes = nodes.filter((node) => node.metadata?.constraints || node.metadata?.hard_constraints || node.metadata?.executionPolicy);
      return {
        value: constraintNodes.map((node) => ({
          summary: node.summary,
          constraints: node.metadata?.constraints || node.metadata?.hard_constraints,
          executionPolicy: node.metadata?.executionPolicy,
        })),
        source_node_ids: constraintNodes.map((node) => node.id),
      };
    },
    traceSummary() {
      return {
        value: {
          node_count: nodes.length,
          edge_count: (traceView.edges || []).length,
          dependency_summary: dependencySummary.value,
        },
        source_node_ids: dependencySummary.value?.source_node_ids || [],
      };
    },
    metadataList(key) {
      const matchedNodes = nodes.filter((node) => node.metadata?.[key]);
      return {
        value: matchedNodes.flatMap((node) => Array.isArray(node.metadata[key]) ? node.metadata[key] : [node.metadata[key]]),
        source_node_ids: matchedNodes.map((node) => node.id),
      };
    },
    evidenceList() {
      const matchedNodes = nodes.filter((node) => ["plan", "patch", "sandbox_result", "tool_result", "delivery_report"].includes(node.type));
      return {
        value: matchedNodes.map((node) => ({ node_id: node.id, type: node.type, summary: node.summary, status: node.status })),
        source_node_ids: matchedNodes.map((node) => node.id),
      };
    },
  };
}

function toLightNode(node) {
  return {
    node_id: node.id,
    type: node.type,
    summary: node.summary,
    status: node.status,
    metadata: sanitizeMetadata(node.metadata),
  };
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !["payload", "full_payload", "full_chat_history", "full_sandbox_log", "full_patch_diff", "log", "diff"].includes(key)),
  );
}

function collectSourceNodeIds(nodes) {
  return nodes.map((node) => node.id);
}

function collectSourceEventIds(events, sourceNodeIds) {
  const sourceNodeSet = new Set(sourceNodeIds);
  return events
    .filter((event) => {
      const node = event.payload?.node;
      const edge = event.payload?.edge;
      const nodeId = event.payload?.node_id || event.payload?.nodeId;
      return sourceNodeSet.has(node?.id) || sourceNodeSet.has(nodeId) || sourceNodeSet.has(edge?.from_node_id) || sourceNodeSet.has(edge?.to_node_id);
    })
    .map((event) => event.event_id);
}

function dependencyHasNode(dependencyChain, nodeId) {
  return dependencyChain.chain_nodes.some((node) => node.id === nodeId);
}

function emptyDependencyChain(nodeId) {
  return { target_node_id: nodeId, chain_nodes: [], chain_edges: [], depth: 0 };
}

function emptySummaryArtifact(summaryId) {
  return { summary_id: summaryId, value: { source_node_ids: [] } };
}

function safePathSegment(value) {
  return encodeURIComponent(value).replace(/%/g, "_");
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function projectRoot() {
  return path.resolve(__dirname, "../../../..");
}

const defaultBuilder = new AgentContextBuilder({
  storageRoot: path.join(projectRoot(), ".ai-runs", "context"),
});

module.exports = {
  AgentContextBuilder,
  buildContextForAgent: defaultBuilder.buildContextForAgent.bind(defaultBuilder),
};
