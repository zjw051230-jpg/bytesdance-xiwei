const SENSITIVE_KEY = /(api[_-]?key|authorization|token|secret|password|bearer)/i;

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item], index) => [
        SENSITIVE_KEY.test(key) ? `redacted_${index}` : key,
        SENSITIVE_KEY.test(key) ? "***REDACTED***" : redactSecrets(item)
      ])
    );
  }
  if (typeof value === "string") return redactString(value);
  return value;
}

export function redactString(text) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***REDACTED***")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "***REDACTED***")
    .replace(/ark-[A-Za-z0-9_*.-]{8,}/g, "***REDACTED***")
    .replace(/(api[_-]?key|authorization|token|secret|password)\s*[:=]\s*["']?[^"',\s}]+/gi, "***REDACTED***");
}
