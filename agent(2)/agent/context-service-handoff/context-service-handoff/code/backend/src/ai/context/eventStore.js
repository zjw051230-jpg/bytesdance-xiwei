const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { RedactionManifestStore, applyRedactionOverlay } = require("./redactionManifest");

const DEFAULT_SCHEMA_VERSION = "1";

class IdempotencyConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "IdempotencyConflictError";
    this.details = details;
  }
}

class OptimisticConcurrencyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "OptimisticConcurrencyError";
    this.details = details;
  }
}

class EventStore {
  constructor({ storageRoot, now, idGenerator, redactionManifestStore } = {}) {
    this.storageRoot = storageRoot || path.join(projectRoot(), ".ai-runs", "context");
    this.now = now || (() => new Date().toISOString());
    this.idGenerator = idGenerator || (() => `evt_${crypto.randomUUID()}`);
    this.redactionManifestStore = redactionManifestStore || new RedactionManifestStore({ storageRoot: this.storageRoot });
  }

  appendEvent(taskId, event, options = {}) {
    assertTaskId(taskId);
    const events = this.readEvents(taskId);
    const idempotencyKey = event?.idempotency_key || options.idempotency_key;

    if (idempotencyKey) {
      const existingEvent = events.find((candidate) => candidate.idempotency_key === idempotencyKey);
      if (existingEvent) {
        const candidate = this.buildEvent(taskId, event, {
          idempotencyKey,
          seq: existingEvent.seq,
          eventId: existingEvent.event_id,
          createdAt: existingEvent.created_at,
        });

        if (stableStringify(normalizeForIdempotency(existingEvent)) !== stableStringify(normalizeForIdempotency(candidate))) {
          throw new IdempotencyConflictError(
            `Event idempotency conflict for key "${idempotencyKey}".`,
            { taskId, idempotencyKey, existingEventId: existingEvent.event_id },
          );
        }

        return existingEvent;
      }
    }

    const latestSeq = getLatestSeq(events);
    if (Object.prototype.hasOwnProperty.call(options, "expectedSeq") && options.expectedSeq !== latestSeq) {
      throw new OptimisticConcurrencyError(
        `Expected latest event seq ${options.expectedSeq}, but found ${latestSeq}.`,
        { taskId, expectedSeq: options.expectedSeq, latestSeq },
      );
    }

    const nextEvent = this.buildEvent(taskId, event, {
      idempotencyKey,
      seq: latestSeq + 1,
      eventId: event?.event_id || this.idGenerator(),
      createdAt: event?.created_at || this.now(),
    });
    this.appendLine(taskId, JSON.stringify(nextEvent));
    return nextEvent;
  }

  readEvents(taskId) {
    assertTaskId(taskId);
    const filePath = this.eventsFilePath(taskId);
    if (!fs.existsSync(filePath)) return [];

    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .sort((left, right) => left.seq - right.seq);
  }

  readEventsByType(taskId, type) {
    return this.readEvents(taskId).filter((event) => event.type === type);
  }

  readSafeEvents(taskId) {
    const rawEvents = this.readEvents(taskId);
    const manifests = this.redactionManifestStore.readRedactionManifests(taskId);
    return applyRedactionOverlay(rawEvents, manifests);
  }

  getLatestEventSeq(taskId) {
    return getLatestSeq(this.readEvents(taskId));
  }

  buildEvent(taskId, event, { idempotencyKey, seq, eventId, createdAt }) {
    if (!event || typeof event !== "object") {
      throw new Error("Event must be an object.");
    }
    if (!event.type) {
      throw new Error("Event type is required.");
    }

    return {
      ...event,
      event_id: eventId,
      task_id: taskId,
      seq,
      type: event.type,
      payload: event.payload || {},
      created_at: createdAt,
      schema_version: event.schema_version || DEFAULT_SCHEMA_VERSION,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    };
  }

  appendLine(taskId, line) {
    const filePath = this.eventsFilePath(taskId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${line}\n`, "utf8");
  }

  eventsFilePath(taskId) {
    return path.join(this.taskDirectory(taskId), "events.jsonl");
  }

  taskDirectory(taskId) {
    return path.join(this.storageRoot, "tasks", safePathSegment(taskId));
  }
}

function getLatestSeq(events) {
  return events.reduce((latest, event) => Math.max(latest, Number(event.seq || 0)), 0);
}

function normalizeForIdempotency(event) {
  const {
    event_id,
    seq,
    created_at,
    ...stableEvent
  } = event;
  return stableEvent;
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

function assertTaskId(taskId) {
  if (!taskId || typeof taskId !== "string") {
    throw new Error("taskId is required.");
  }
}

function safePathSegment(value) {
  return encodeURIComponent(value).replace(/%/g, "_");
}

function projectRoot() {
  return path.resolve(__dirname, "../../../..");
}

const defaultEventStore = new EventStore();

module.exports = {
  EventStore,
  IdempotencyConflictError,
  OptimisticConcurrencyError,
  appendEvent: defaultEventStore.appendEvent.bind(defaultEventStore),
  readEvents: defaultEventStore.readEvents.bind(defaultEventStore),
  readSafeEvents: defaultEventStore.readSafeEvents.bind(defaultEventStore),
  readEventsByType: defaultEventStore.readEventsByType.bind(defaultEventStore),
  getLatestEventSeq: defaultEventStore.getLatestEventSeq.bind(defaultEventStore),
  stableStringify,
};
