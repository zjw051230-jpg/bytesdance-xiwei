export async function listProjects() {
  return requestJson("/api/projects");
}

export async function createProject(payload) {
  return requestJson("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function updateProject(projectId, payload) {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function listRequirements(projectId) {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}/requirements`);
}

export async function listClarifications(requirementId) {
  return requestJson(`/api/requirements/${encodeURIComponent(requirementId)}/clarifications`);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    const error = new Error(payload?.error?.message || "Persistence API request failed");
    error.payload = payload;
    throw error;
  }
  return payload.data;
}
