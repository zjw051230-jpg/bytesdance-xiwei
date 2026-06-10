import { logSlowRequest, markRequestStart } from "./performance.js";

export async function getPreviewStatus(payload = {}) {
  return postJson("/api/preview/status", payload);
}

export async function startProjectPreview(payload = {}) {
  return postJson("/api/preview/start", payload);
}

export async function stopProjectPreview(payload = {}) {
  return postJson("/api/preview/stop", payload);
}

async function postJson(url, payload) {
  const startedAt = markRequestStart();
  const options = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  };
  const response = await fetch(url, options);
  logSlowRequest(url, startedAt, options);
  return unwrap(response);
}

async function unwrap(response) {
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    const error = new Error(payload?.error?.message || "Preview API request failed");
    error.payload = payload;
    throw error;
  }
  return payload.data;
}
