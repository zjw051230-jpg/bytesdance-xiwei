export const requiredDslFields = ["title", "summary", "requirements", "acceptance_criteria", "risks", "ready_for_agent", "handoff_decision"];

export function validateRequirementDsl(dsl = {}) {
  const errors = [];
  for (const field of requiredDslFields) {
    if (!(field in Object(dsl))) {
      errors.push({ field, code: "required", message: `${field} is required` });
    }
  }
  requireType(errors, dsl, "title", "string");
  requireType(errors, dsl, "summary", "string");
  requireArray(errors, dsl, "requirements");
  requireArray(errors, dsl, "acceptance_criteria");
  requireArray(errors, dsl, "risks");
  requireType(errors, dsl, "ready_for_agent", "boolean");
  if ("handoff_decision" in Object(dsl) && !["clarify_first", "ready_for_agent", "ready"].includes(String(dsl.handoff_decision))) {
    errors.push({ field: "handoff_decision", code: "enum", message: "handoff_decision must be clarify_first or ready_for_agent" });
  }
  return {
    valid: errors.length === 0,
    errors,
    schemaVersion: "requirement_dsl_v0"
  };
}

function requireType(errors, dsl, field, type) {
  if (!(field in Object(dsl))) return;
  if (typeof dsl[field] !== type || (type === "string" && !dsl[field].trim())) {
    errors.push({ field, code: "type", message: `${field} must be a non-empty ${type}` });
  }
}

function requireArray(errors, dsl, field) {
  if (!(field in Object(dsl))) return;
  if (!Array.isArray(dsl[field])) {
    errors.push({ field, code: "type", message: `${field} must be an array` });
  }
}
