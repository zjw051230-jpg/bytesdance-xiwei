export async function getAgentInventory() {
  return requestJson("/api/agent/inventory");
}

export async function checkAgentReadiness(payload = {}) {
  return postJson("/api/agent/readiness", payload);
}

export async function startAgentRun(payload = {}) {
  return postJson("/api/agent/run", payload);
}

export async function getAgentRun(runId) {
  return requestJson(`/api/agent/runs/${encodeURIComponent(runId)}`);
}

export async function cancelAgentRun(runId) {
  return postJson(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, {});
}

export async function getAgentArtifacts(runId) {
  return requestJson(`/api/agent/runs/${encodeURIComponent(runId)}/artifacts`);
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return unwrap(response);
}

async function requestJson(url) {
  const response = await fetch(url);
  return unwrap(response);
}

async function unwrap(response) {
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    const error = new Error(payload?.error?.message || "Agent API request failed");
    error.payload = payload;
    throw error;
  }
  return payload.data;
}
