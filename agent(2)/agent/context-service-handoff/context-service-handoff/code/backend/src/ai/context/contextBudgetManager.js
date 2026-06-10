const DEFAULT_MAX_CHARS = {
  planAgent: 12000,
  codegenAgent: 18000,
  repairAgent: 12000,
  deliveryAgent: 8000,
};

const REMOVED_FIELD_NAMES = new Set([
  "full_chat_history",
  "fullChatHistory",
  "full_sandbox_log",
  "fullSandboxLog",
  "full_patch_diff",
  "fullPatchDiff",
  "sandbox_log",
  "sandboxLog",
  "patch_diff",
  "patchDiff",
]);

const PROTECTED_FIELD_NAMES = new Set([
  "finalDsl",
  "final_dsl",
  "final_dsl_core",
  "active_interrupts",
  "hard_constraints",
  "hardConstraints",
  "executionPolicy",
  "execution_policy",
]);

class ContextBudgetManager {
  constructor({ maxCharsByAgent } = {}) {
    this.maxCharsByAgent = { ...DEFAULT_MAX_CHARS, ...(maxCharsByAgent || {}) };
  }

  applyContextBudget(agentName, context) {
    const beforeChars = charSize(context);
    const removedFields = [];
    const truncatedFields = [];
    let nextContext = removeForbiddenFields(context, "$", removedFields);
    const maxChars = this.maxCharsByAgent[agentName] || 12000;

    nextContext = truncateLargeFields(nextContext, "$", truncatedFields);

    while (charSize(nextContext) > maxChars) {
      const candidate = findLargestTruncatableString(nextContext);
      if (!candidate) break;
      if (candidate.value.includes("[TRUNCATED]") && candidate.value.length <= 220) break;
      nextContext = setPathValue(
        nextContext,
        candidate.path,
        `${candidate.value.slice(0, Math.min(200, Math.max(80, Math.floor(candidate.value.length / 2))))}\n[TRUNCATED]`,
      );
      truncatedFields.push(candidate.path);
    }

    return {
      context: nextContext,
      budget_report: {
        before_chars: beforeChars,
        after_chars: charSize(nextContext),
        truncated_fields: [...new Set(truncatedFields)],
        removed_fields: [...new Set(removedFields)],
      },
    };
  }

  rankContextItemsByImportance(items) {
    return [...items].sort((left, right) => importanceScore(right) - importanceScore(left));
  }

  summarizeBudgetUsage(beforeContext, afterContext) {
    return {
      before_chars: charSize(beforeContext),
      after_chars: charSize(afterContext),
      truncated_fields: [],
      removed_fields: [],
    };
  }
}

function removeForbiddenFields(value, currentPath, removedFields) {
  if (Array.isArray(value)) {
    return value.map((item, index) => removeForbiddenFields(item, `${currentPath}[${index}]`, removedFields));
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => {
        if (!REMOVED_FIELD_NAMES.has(key)) return true;
        removedFields.push(`${currentPath}.${key}`);
        return false;
      })
      .map(([key, entryValue]) => [key, removeForbiddenFields(entryValue, `${currentPath}.${key}`, removedFields)]),
  );
}

function truncateLargeFields(value, currentPath, truncatedFields) {
  if (typeof value === "string") {
    if (isProtectedPath(currentPath) || value.length <= 2000) return value;
    truncatedFields.push(currentPath);
    return `${value.slice(0, 2000)}\n[TRUNCATED]`;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => truncateLargeFields(item, `${currentPath}[${index}]`, truncatedFields));
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      truncateLargeFields(entryValue, `${currentPath}.${key}`, truncatedFields),
    ]),
  );
}

function findLargestTruncatableString(value, currentPath = "$", largest = null) {
  if (typeof value === "string") {
    if (isProtectedPath(currentPath)) return largest;
    if (!largest || value.length > largest.value.length) return { path: currentPath, value };
    return largest;
  }
  if (Array.isArray(value)) {
    return value.reduce(
      (candidate, item, index) => findLargestTruncatableString(item, `${currentPath}[${index}]`, candidate),
      largest,
    );
  }
  if (!value || typeof value !== "object") return largest;

  return Object.entries(value).reduce(
    (candidate, [key, entryValue]) => findLargestTruncatableString(entryValue, `${currentPath}.${key}`, candidate),
    largest,
  );
}

function setPathValue(value, path, nextValue) {
  const clone = JSON.parse(JSON.stringify(value));
  const parts = path.replace(/^\$\./, "").split(".");
  let cursor = clone;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor[parts[index]];
  }
  cursor[parts[parts.length - 1]] = nextValue;
  return clone;
}

function isProtectedPath(path) {
  return [...PROTECTED_FIELD_NAMES].some((fieldName) => path.includes(`.${fieldName}`));
}

function importanceScore(item) {
  const key = String(item?.key || item?.type || "");
  if (key.includes("final_dsl") || key.includes("constraint") || key.includes("interrupt")) return 100;
  if (key.includes("dependency") || key.includes("verified_plan")) return 80;
  if (key.includes("summary")) return 60;
  return 10;
}

function charSize(value) {
  return JSON.stringify(value || {}).length;
}

const defaultBudgetManager = new ContextBudgetManager();

module.exports = {
  ContextBudgetManager,
  DEFAULT_MAX_CHARS,
  applyContextBudget: defaultBudgetManager.applyContextBudget.bind(defaultBudgetManager),
  rankContextItemsByImportance: defaultBudgetManager.rankContextItemsByImportance.bind(defaultBudgetManager),
  summarizeBudgetUsage: defaultBudgetManager.summarizeBudgetUsage.bind(defaultBudgetManager),
};
