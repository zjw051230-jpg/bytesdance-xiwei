export function extractJsonObject(text) {
  const source = String(text || "").trim();
  if (!source) throw new Error("empty_model_response");
  try {
    return JSON.parse(source);
  } catch {
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
    throw new Error("json_object_not_found");
  }
}

export function requireFields(object, fields, label) {
  const missing = fields.filter((field) => object?.[field] === undefined);
  if (missing.length) {
    throw new Error(`${label}_missing_fields:${missing.join(",")}`);
  }
  return object;
}
