const secretPatterns = [
  { name: "openai_sk_like", pattern: /sk-[A-Za-z0-9_-]{12,}/g },
  { name: "bearer_plaintext", pattern: /Bearer\s+(?!\*\*\*REDACTED\*\*\*)[A-Za-z0-9._~+/=-]{12,}/gi },
  { name: "api_key_literal", pattern: /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/gi },
  { name: "authorization_literal", pattern: /authorization\s*[:=]\s*["'][^"']{8,}["']/gi }
];

export function scanText(text) {
  const findings = [];
  const source = String(text || "");
  for (const entry of secretPatterns) {
    if (entry.pattern.test(source)) findings.push(entry.name);
    entry.pattern.lastIndex = 0;
  }
  return findings;
}

export function assertNoSecretsInText(text, label) {
  const findings = scanText(text);
  if (findings.length) {
    const error = new Error(`secret_scan_failed:${label}`);
    error.findings = findings;
    throw error;
  }
}

export function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (/api[_-]?key|authorization|token|secret|password/i.test(key)) {
        return [key, "***REDACTED***"];
      }
      return [key, redactObject(item)];
    }));
  }
  if (typeof value !== "string") return value;
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***REDACTED***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***REDACTED***")
    .replace(/api[_-]?key\s*[:=]\s*["'][^"']+["']/gi, "api_key=\"***REDACTED***\"");
}
