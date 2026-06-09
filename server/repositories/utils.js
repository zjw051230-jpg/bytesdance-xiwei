import { randomUUID } from "node:crypto";

export const validRoles = new Set(["pm", "system", "assistant"]);
export const validPlanningStatuses = new Set(["todo", "running", "blocked", "done", "needs_review", "cancelled"]);
export const validHumanStatuses = new Set(["pending", "approved", "needs_change", "blocked"]);
export const validPrStatuses = new Set(["draft", "ready", "blocked", "merged", "cancelled"]);
export const validArtifactTypes = new Set(["dsl", "context", "report", "patch", "test_log", "screenshot", "pr_summary"]);

export function timestamp() {
  return new Date().toISOString();
}

export function safeId(value, prefix) {
  const candidate = String(value || "").trim();
  if (/^[A-Za-z0-9_.:-]{2,120}$/.test(candidate)) return candidate;
  return `${prefix}-${randomUUID()}`;
}

export function read(input, snakeName, camelName, fallback) {
  if (hasOwn(input, snakeName)) return input[snakeName];
  if (camelName && hasOwn(input, camelName)) return input[camelName];
  return fallback;
}

export function cleanText(value) {
  return String(value ?? "")
    .replace(/api[_-]?key\s*[:=]\s*["']?[^"',;\s]+["']?/gi, "credential redacted")
    .replace(/authorization\s*[:=]\s*["']?[^"',;\n]+["']?/gi, "credential redacted")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "credential redacted")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "credential redacted")
    .replace(/[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@/g, "credential redacted@");
}

export function cleanNullableText(value) {
  if (value === undefined || value === null || value === "") return null;
  return cleanText(value);
}

export function boolToInt(value) {
  return value ? 1 : 0;
}

export function intToBool(value) {
  return Boolean(value);
}

export function cleanJson(value, fallback) {
  return JSON.stringify(cleanValue(value ?? fallback));
}

export function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function normalizeRole(value) {
  return validRoles.has(value) ? value : "pm";
}

export function normalizePlanningStatus(value) {
  return validPlanningStatuses.has(value) ? value : "todo";
}

export function normalizeHumanStatus(value) {
  return validHumanStatuses.has(value) ? value : "pending";
}

export function normalizePrStatus(value) {
  return validPrStatuses.has(value) ? value : "draft";
}

export function normalizeArtifactType(value) {
  return validArtifactTypes.has(value) ? value : "report";
}

export function requireParentId(value, fieldName) {
  const id = cleanText(value);
  if (!id) throw new Error(`${fieldName} is required`);
  return id;
}

function hasOwn(input, key) {
  return Boolean(input) && Object.prototype.hasOwnProperty.call(input, key);
}

function cleanValue(value) {
  if (Array.isArray(value)) return value.map(cleanValue);
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/api[_-]?key|authorization|bearer|token|password|secret/i.test(key)) {
        output[key] = "credential redacted";
      } else {
        output[key] = cleanValue(entry);
      }
    }
    return output;
  }
  if (typeof value === "string") return cleanText(value);
  return value;
}
