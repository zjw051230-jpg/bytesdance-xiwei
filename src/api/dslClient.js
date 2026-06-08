export async function createDslRun(payload) {
  return postJson("/api/dsl/runs", payload);
}

export async function startDslRun(payload) {
  return postJson("/api/dsl/runs/start", payload);
}

export async function createSkillPmDslTurn(payload) {
  return postJson("/api/skill/pm-dsl-turn", payload);
}

export async function getDslRun(runId) {
  return requestJson(`/api/dsl/runs/${encodeURIComponent(runId)}`);
}

export async function cancelDslRun(runId) {
  return postJson(`/api/dsl/runs/${encodeURIComponent(runId)}/cancel`, {});
}

export async function retryDslRun(runId) {
  return postJson(`/api/dsl/runs/${encodeURIComponent(runId)}/retry`, {});
}

export async function getDslRunArtifacts(runId) {
  return requestJson(`/api/dsl/runs/${encodeURIComponent(runId)}/artifacts`);
}

async function postJson(url, payload) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw apiError("network_error", `Failed to reach DSL API: ${String(error.message || error)}`, {});
  }

  const data = await readJsonEnvelope(response);
  if (!response.ok || data?.ok !== true) {
    throw payloadError(normalizeErrorEnvelope(data, response));
  }
  return data.data;
}

async function requestJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw apiError("network_error", `Failed to reach DSL API: ${String(error.message || error)}`, {});
  }

  const data = await readJsonEnvelope(response);
  if (!response.ok || data?.ok !== true) {
    throw payloadError(normalizeErrorEnvelope(data, response));
  }
  return data.data;
}

async function readJsonEnvelope(response) {
  let text = "";
  try {
    text = await response.text();
  } catch (error) {
    throw apiError("response_read_failed", `Failed to read DSL API response: ${String(error.message || error)}`, {
      status: response.status,
      statusText: response.statusText || ""
    });
  }

  if (!text.trim()) {
    throw apiError("empty_response", `Empty response from DSL API (${statusLabel(response)})`, {
      status: response.status,
      statusText: response.statusText || ""
    });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw apiError("invalid_json_response", `Invalid JSON response from DSL API (${statusLabel(response)})`, {
      status: response.status,
      statusText: response.statusText || "",
      bodyPreview: text.slice(0, 300)
    });
  }
}

function normalizeErrorEnvelope(data, response) {
  if (data?.error?.code || data?.error?.message) {
    return {
      ok: false,
      data: data.data ?? null,
      error: {
        code: data.error.code || "request_failed",
        message: data.error.message || "DSL runner request failed",
        details: data.error.details || {}
      }
    };
  }

  return {
    ok: false,
    data: null,
    error: {
      code: "request_failed",
      message: `DSL runner request failed (${statusLabel(response)})`,
      details: {
        status: response.status,
        statusText: response.statusText || ""
      }
    }
  };
}

function apiError(code, message, details) {
  return payloadError({
    ok: false,
    data: null,
    error: { code, message, details }
  });
}

function payloadError(payload) {
  const error = new Error(payload.error.message);
  error.payload = payload;
  return error;
}

function statusLabel(response) {
  const status = response.status || 0;
  const statusText = response.statusText || "Unknown";
  return `${status} ${statusText}`.trim();
}
