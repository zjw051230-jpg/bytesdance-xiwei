const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REDACTED_VALUE = "[REDACTED]";
const ALLOWED_REDACTION_REASONS = new Set(["secret_leak", "pii_leak", "user_request", "policy"]);

class RedactionManifestStore {
  constructor({ storageRoot, now, idGenerator } = {}) {
    this.storageRoot = storageRoot || path.join(projectRoot(), ".ai-runs", "context");
    this.now = now || (() => new Date().toISOString());
    this.idGenerator = idGenerator || (() => `redact_${crypto.randomUUID()}`);
  }

  createRedactionManifest(taskId, input) {
    if (!taskId) throw new Error("taskId is required.");
    if (!input || typeof input !== "object") throw new Error("redaction manifest input is required.");
    if (!ALLOWED_REDACTION_REASONS.has(input.reason)) {
      throw new Error(`Unsupported redaction reason "${input.reason}".`);
    }

    const manifest = {
      manifest_id: input.manifest_id || this.idGenerator(),
      task_id: taskId,
      affected_event_ids: [...(input.affected_event_ids || [])],
      redacted_paths: [...(input.redacted_paths || [])],
      reason: input.reason,
      created_at: input.created_at || this.now(),
    };
    const manifests = [...this.readRedactionManifests(taskId), manifest].sort(compareManifests);
    fs.mkdirSync(path.dirname(this.manifestFilePath(taskId)), { recursive: true });
    fs.writeFileSync(this.manifestFilePath(taskId), JSON.stringify(manifests, null, 2), "utf8");
    return manifest;
  }

  readRedactionManifests(taskId) {
    if (!taskId) throw new Error("taskId is required.");
    const filePath = this.manifestFilePath(taskId);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf8")).sort(compareManifests);
  }

  manifestFilePath(taskId) {
    return path.join(this.storageRoot, "tasks", safePathSegment(taskId), "redaction_manifests.json");
  }
}

function applyRedactionOverlay(events, manifests) {
  const safeEvents = clone(events || []);
  const manifestsByEventId = new Map();
  for (const manifest of manifests || []) {
    for (const eventId of manifest.affected_event_ids || []) {
      const current = manifestsByEventId.get(eventId) || [];
      current.push(manifest);
      manifestsByEventId.set(eventId, current);
    }
  }

  for (const event of safeEvents) {
    for (const manifest of manifestsByEventId.get(event.event_id) || []) {
      for (const redactedPath of manifest.redacted_paths || []) {
        redactValueAtPath(event, redactedPath);
      }
    }
  }
  return safeEvents;
}

function redactValueAtPath(object, pathExpression) {
  if (!object || typeof object !== "object" || !pathExpression) return object;
  const pathParts = String(pathExpression).split(".").filter(Boolean);
  if (pathParts.length === 0) return object;

  let cursor = object;
  for (const part of pathParts.slice(0, -1)) {
    if (!cursor || typeof cursor !== "object" || !Object.prototype.hasOwnProperty.call(cursor, part)) {
      return object;
    }
    cursor = cursor[part];
  }

  const finalKey = pathParts[pathParts.length - 1];
  if (cursor && typeof cursor === "object" && Object.prototype.hasOwnProperty.call(cursor, finalKey)) {
    cursor[finalKey] = REDACTED_VALUE;
  }
  return object;
}

function compareManifests(left, right) {
  return left.created_at.localeCompare(right.created_at) || left.manifest_id.localeCompare(right.manifest_id);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safePathSegment(value) {
  return encodeURIComponent(value).replace(/%/g, "_");
}

function projectRoot() {
  return path.resolve(__dirname, "../../../..");
}

const defaultStore = new RedactionManifestStore();

module.exports = {
  RedactionManifestStore,
  REDACTED_VALUE,
  ALLOWED_REDACTION_REASONS,
  createRedactionManifest: defaultStore.createRedactionManifest.bind(defaultStore),
  readRedactionManifests: defaultStore.readRedactionManifests.bind(defaultStore),
  applyRedactionOverlay,
  redactValueAtPath,
};
