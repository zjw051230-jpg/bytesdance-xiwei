import { redactObject } from "./secret-scan.mjs";

export async function chatCompletion({ config, messages, temperature = 0.2, label = "llm" }) {
  const endpoint = `${config.baseURL}${config.chatCompletionsPath}`;
  const timeoutMs = Math.max(1000, Number(config.timeoutSeconds || 120) * 1000);
  const body = {
    model: config.model,
    messages,
    temperature
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label}_timeout`)), timeoutMs);
  const startedAt = Date.now();

  let response;
  let payload;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const rawText = await response.text();
    payload = rawText ? JSON.parse(rawText) : {};
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const error = new Error(`${label}_http_error:${response.status}`);
    error.details = redactObject({
      status: response.status,
      statusText: response.statusText,
      payload,
      endpoint,
      model: config.model
    });
    throw error;
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${label}_empty_content`);
  }

  return {
    content,
    latencyMs: Date.now() - startedAt,
    safeRequest: redactObject({ endpoint, body, headers: { authorization: `Bearer ${config.apiKey}` } }),
    safeResponse: redactObject({ endpoint, model: config.model, payload })
  };
}
