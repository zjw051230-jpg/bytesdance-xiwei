import { sendBackendException, sendError, writeJson } from "../httpEnvelope.js";
import { getPreviewStatus, startPreview, stopPreview } from "../services/previewLauncherService.js";

export async function handlePreviewRoutes(request, response, config = {}) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/preview")) return false;

  try {
    if (request.method !== "POST") {
      sendError(response, 404, "not_found", "Preview route not found");
      return true;
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      sendError(response, 400, "bad_request", "Invalid JSON body", { reason: body.error });
      return true;
    }

    const payload = url.pathname === "/api/preview/status"
      ? await getPreviewStatus(body.data, config)
      : url.pathname === "/api/preview/start"
        ? await startPreview(body.data, config)
        : url.pathname === "/api/preview/stop"
          ? await stopPreview(body.data, config)
          : null;

    if (!payload) {
      sendError(response, 404, "not_found", "Preview route not found");
      return true;
    }

    writeJson(response, 200, payload);
    return true;
  } catch (error) {
    await sendBackendException(response, error, config);
    return true;
  }
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    let raw = "";
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      raw += chunk.toString("utf8");
      if (raw.length > 200_000) {
        tooLarge = true;
        raw = "";
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        resolve({ ok: false, error: "request body too large" });
        return;
      }
      try {
        resolve({ ok: true, data: raw ? JSON.parse(raw) : {} });
      } catch (error) {
        resolve({ ok: false, error: String(error.message || error) });
      }
    });
    request.on("error", (error) => {
      resolve({ ok: false, error: String(error.message || error) });
    });
  });
}
