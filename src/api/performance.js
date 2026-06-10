const slowRequestKeys = new Set();

export function markRequestStart() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function logSlowRequest(url, startedAt, options = {}) {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test") return;
  const elapsedMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);
  if (elapsedMs <= 800) return;
  const method = options.method || "GET";
  const key = `${method} ${safeApiPath(url)}`;
  if (slowRequestKeys.has(key)) return;
  slowRequestKeys.add(key);
  console.info("[workbench:api-slow]", key, `${elapsedMs}ms`);
}

function safeApiPath(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.pathname;
  } catch {
    return String(url || "").split("?")[0].slice(0, 120);
  }
}
