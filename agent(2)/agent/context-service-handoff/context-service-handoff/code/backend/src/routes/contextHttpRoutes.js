const express = require("express");
const path = require("node:path");
const { EventStore, IdempotencyConflictError, OptimisticConcurrencyError } = require("../ai/context/eventStore");
const { TraceProjector } = require("../ai/context/traceProjector");
const { TraceGraphStore } = require("../ai/context/traceGraphStore");
const { AgentContextBuilder } = require("../ai/context/agentContextBuilder");
const { RedactionManifestStore } = require("../ai/context/redactionManifest");
const { mapContextEventForAppend } = require("../ai/context/contextEventMapper");

class TaskWriteQueue {
  constructor() {
    this.tailsByTaskId = new Map();
  }

  run(taskId, work) {
    const previousTail = this.tailsByTaskId.get(taskId) || Promise.resolve();
    const runPromise = previousTail.catch(() => undefined).then(work);
    const nextTail = runPromise.finally(() => {
      if (this.tailsByTaskId.get(taskId) === nextTail) {
        this.tailsByTaskId.delete(taskId);
      }
    });
    this.tailsByTaskId.set(taskId, nextTail);
    return runPromise;
  }
}

function createContextHttpRouter(options = {}) {
  const router = express.Router();
  const dependencies = createDependencies(options);
  const writeQueue = options.writeQueue || new TaskWriteQueue();

  register(router, "get", ["/context/health", "/api/context/health"], (req, res) => {
    res.json({
      ok: true,
      service: "context-http-wrapper",
      storage_root: dependencies.eventStore.storageRoot,
    });
  });

  register(router, "post", ["/context/build", "/api/context/build"], async (req, res, next) => {
    try {
      const { taskId, agentName, currentNodeId } = req.body || {};
      assertTaskId(taskId);
      if (!agentName || typeof agentName !== "string") {
        return sendError(res, 400, "INVALID_REQUEST", "agentName is required.");
      }

      const data = await writeQueue.run(taskId, () => dependencies.agentContextBuilder.buildContextForAgent({
        taskId,
        agentName,
        currentNodeId,
      }));

      return res.json({
        ok: true,
        data,
        latest_seq: dependencies.eventStore.getLatestEventSeq(taskId),
      });
    } catch (error) {
      return next(error);
    }
  });

  register(router, "post", ["/events/append", "/api/context/events/append"], async (req, res, next) => {
    try {
      const { taskId, event } = req.body || {};
      assertTaskId(taskId);
      if (!event || typeof event !== "object") {
        return sendError(res, 400, "INVALID_REQUEST", "event is required.");
      }

      const appendedEvents = await writeQueue.run(taskId, () => {
        const existingEvents = dependencies.eventStore.readEvents(taskId);
        const mappedEvents = mapContextEventForAppend({ taskId, event, existingEvents });
        return mappedEvents.map((mappedEvent) => dependencies.eventStore.appendEvent(
          taskId,
          mappedEvent,
          { expectedSeq: dependencies.eventStore.getLatestEventSeq(taskId) },
        ));
      });
      const committedEvent = appendedEvents[appendedEvents.length - 1];
      const latestSeq = dependencies.eventStore.getLatestEventSeq(taskId);

      return res.status(201).json({
        ok: true,
        event_id: committedEvent?.event_id,
        seq: committedEvent?.seq,
        latest_seq: latestSeq,
        event: committedEvent,
        appended_events: appendedEvents,
      });
    } catch (error) {
      return next(error);
    }
  });

  register(router, "get", ["/events/latest-seq/:taskId", "/api/context/events/latest-seq/:taskId"], (req, res, next) => {
    try {
      const { taskId } = req.params;
      assertTaskId(taskId);
      return res.json({
        ok: true,
        task_id: taskId,
        latest_seq: dependencies.eventStore.getLatestEventSeq(taskId),
      });
    } catch (error) {
      return next(error);
    }
  });

  register(router, "get", ["/events/safe/:taskId", "/api/context/events/safe/:taskId"], (req, res, next) => {
    try {
      const { taskId } = req.params;
      assertTaskId(taskId);
      return res.json({
        ok: true,
        task_id: taskId,
        events: dependencies.eventStore.readSafeEvents(taskId),
        latest_seq: dependencies.eventStore.getLatestEventSeq(taskId),
      });
    } catch (error) {
      return next(error);
    }
  });

  register(router, "post", ["/trace/rebuild", "/api/context/trace/rebuild"], (req, res, next) => {
    try {
      const { taskId } = req.body || {};
      assertTaskId(taskId);
      const result = dependencies.traceProjector.rebuildTraceView(taskId);
      return res.json({
        ok: true,
        data: result,
        latest_seq: dependencies.eventStore.getLatestEventSeq(taskId),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.use((error, req, res, next) => {
    return sendMappedError(res, error);
  });

  return router;
}

function createDependencies(options) {
  const storageRoot = options.storageRoot || path.join(projectRoot(), ".ai-runs", "context");
  const redactionManifestStore = options.redactionManifestStore || new RedactionManifestStore({ storageRoot });
  const eventStore = options.eventStore || new EventStore({ storageRoot, redactionManifestStore });
  const traceProjector = options.traceProjector || new TraceProjector({
    eventStore,
    redactionManifestStore,
    storageRoot,
  });
  const traceGraphStore = options.traceGraphStore || new TraceGraphStore({
    eventStore,
    traceProjector,
    storageRoot,
  });
  const agentContextBuilder = options.agentContextBuilder || new AgentContextBuilder({
    eventStore,
    traceProjector,
    traceGraphStore,
    storageRoot,
  });

  return {
    redactionManifestStore,
    eventStore,
    traceProjector,
    traceGraphStore,
    agentContextBuilder,
  };
}

function register(router, method, routePaths, handler) {
  for (const routePath of routePaths) {
    router[method](routePath, handler);
  }
}

function assertTaskId(taskId) {
  if (!taskId || typeof taskId !== "string") {
    const error = new Error("taskId is required.");
    error.statusCode = 400;
    error.code = "INVALID_REQUEST";
    throw error;
  }
}

function sendMappedError(res, error) {
  if (error instanceof OptimisticConcurrencyError) {
    return sendError(res, 409, "EXPECTED_SEQ_CONFLICT", error.message, error.details);
  }
  if (error instanceof IdempotencyConflictError) {
    return sendError(res, 409, "IDEMPOTENCY_CONFLICT", error.message, error.details);
  }
  return sendError(
    res,
    error.statusCode || 500,
    error.code || "INTERNAL_ERROR",
    error.message || "Internal error.",
    error.details || {},
  );
}

function sendError(res, statusCode, code, message, details = {}) {
  return res.status(statusCode).json({
    ok: false,
    error: {
      code,
      message,
      details,
    },
  });
}

function projectRoot() {
  return path.resolve(__dirname, "../..");
}

module.exports = {
  TaskWriteQueue,
  createContextHttpRouter,
};
