const crypto = require("node:crypto");
const path = require("node:path");
const { EventStore } = require("./eventStore");
const { TraceProjector } = require("./traceProjector");

const DEFAULT_MAX_DEPTH = 50;

class TraceGraphStore {
  constructor({ eventStore, traceProjector, storageRoot, now, idGenerator, maxDepth } = {}) {
    this.eventStore = eventStore || new EventStore({ storageRoot, now });
    this.traceProjector = traceProjector || new TraceProjector({ eventStore: this.eventStore, storageRoot, now });
    this.now = now || (() => new Date().toISOString());
    this.idGenerator = idGenerator || ((prefix) => `${prefix}_${crypto.randomUUID()}`);
    this.maxDepth = maxDepth || DEFAULT_MAX_DEPTH;
  }

  appendTraceNode(taskId, node) {
    if (!node || typeof node !== "object") {
      throw new Error("Trace node must be an object.");
    }
    if (Object.prototype.hasOwnProperty.call(node, "depends_on")) {
      throw new Error("TraceNode must not contain depends_on; use TraceEdge relation depends_on instead.");
    }
    if (!node.id || !node.type || !node.summary) {
      throw new Error("Trace node requires id, type, and summary.");
    }

    const normalizedNode = {
      status: "created",
      created_at: this.now(),
      ...node,
      task_id: node.task_id || taskId,
    };

    return this.eventStore.appendEvent(taskId, {
      type: "TRACE_NODE_APPENDED",
      category: "trace_mutation",
      producer: "TraceGraphStore",
      payload: { node: normalizedNode },
      idempotency_key: `trace-node:${taskId}:${normalizedNode.id}`,
    });
  }

  appendTraceEdge(taskId, edge) {
    if (!edge || typeof edge !== "object") {
      throw new Error("Trace edge must be an object.");
    }
    if (!edge.from_node_id || !edge.to_node_id || !edge.relation) {
      throw new Error("Trace edge requires from_node_id, to_node_id, and relation.");
    }

    const normalizedEdge = {
      id: edge.id || this.idGenerator("edge"),
      confidence: "deterministic",
      created_at: this.now(),
      ...edge,
      task_id: edge.task_id || taskId,
    };

    return this.eventStore.appendEvent(taskId, {
      type: "TRACE_EDGE_APPENDED",
      category: "trace_mutation",
      producer: "TraceGraphStore",
      payload: { edge: normalizedEdge },
      idempotency_key: `trace-edge:${taskId}:${normalizedEdge.id}`,
    });
  }

  markNodeStatus(taskId, nodeId, status) {
    if (!nodeId || !status) {
      throw new Error("markNodeStatus requires nodeId and status.");
    }

    return this.eventStore.appendEvent(taskId, {
      type: "TRACE_NODE_STATUS_CHANGED",
      category: "trace_mutation",
      producer: "TraceGraphStore",
      payload: { node_id: nodeId, status },
      idempotency_key: `trace-node-status:${taskId}:${nodeId}:${status}`,
    });
  }

  getNode(taskId, nodeId) {
    const traceView = this.traceProjector.rebuildTraceView(taskId).trace_view;
    return traceView.nodes.find((node) => node.id === nodeId) || null;
  }

  getEdges(taskId, filters = {}) {
    const traceView = this.traceProjector.rebuildTraceView(taskId).trace_view;
    return traceView.edges.filter((edge) => matchesEdgeFilters(edge, filters));
  }

  getDependencyChain(taskId, nodeId, options = {}) {
    const maxDepth = options.maxDepth || this.maxDepth;
    const traceView = this.traceProjector.rebuildTraceView(taskId).trace_view;
    const nodesById = new Map(traceView.nodes.map((node) => [node.id, node]));
    const dependencyEdgesByFrom = groupDependencyEdgesByFrom(traceView.edges);
    const chainNodeIds = [];
    const chainEdges = [];
    const visited = new Set();
    const queue = [{ nodeId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current.nodeId) || current.depth > maxDepth) continue;

      visited.add(current.nodeId);
      const node = nodesById.get(current.nodeId);
      if (node) chainNodeIds.push(current.nodeId);

      for (const edge of dependencyEdgesByFrom.get(current.nodeId) || []) {
        if (!chainEdges.some((candidate) => candidate.id === edge.id)) {
          chainEdges.push(edge);
        }
        if (!visited.has(edge.to_node_id) && current.depth + 1 <= maxDepth) {
          queue.push({ nodeId: edge.to_node_id, depth: current.depth + 1 });
        }
      }
    }

    const chainNodes = chainNodeIds
      .map((currentNodeId) => nodesById.get(currentNodeId))
      .filter(Boolean);

    return {
      target_node_id: nodeId,
      chain_nodes: chainNodes,
      chain_edges: chainEdges,
      depth: Math.max(0, chainNodes.length - 1),
    };
  }
}

function matchesEdgeFilters(edge, filters) {
  return Object.entries(filters).every(([key, value]) => {
    if (value === undefined || value === null) return true;
    return edge[key] === value;
  });
}

function groupDependencyEdgesByFrom(edges) {
  return edges
    .filter((edge) => edge.relation === "depends_on")
    .reduce((groups, edge) => {
      const current = groups.get(edge.from_node_id) || [];
      current.push(edge);
      groups.set(edge.from_node_id, current);
      return groups;
    }, new Map());
}

function projectRoot() {
  return path.resolve(__dirname, "../../../..");
}

const defaultStore = new TraceGraphStore({
  storageRoot: path.join(projectRoot(), ".ai-runs", "context"),
});

module.exports = {
  TraceGraphStore,
  DEFAULT_MAX_DEPTH,
  appendTraceNode: defaultStore.appendTraceNode.bind(defaultStore),
  appendTraceEdge: defaultStore.appendTraceEdge.bind(defaultStore),
  markNodeStatus: defaultStore.markNodeStatus.bind(defaultStore),
  getNode: defaultStore.getNode.bind(defaultStore),
  getEdges: defaultStore.getEdges.bind(defaultStore),
  getDependencyChain: defaultStore.getDependencyChain.bind(defaultStore),
};
