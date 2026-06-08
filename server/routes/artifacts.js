import path from "node:path";
import { readRunArtifacts } from "../services/artifactService.js";
import { writeJson } from "../httpEnvelope.js";

export async function handleArtifacts(request, response, config) {
  if (request.method !== "GET") return false;
  const match = new URL(request.url, "http://127.0.0.1").pathname.match(/^\/api\/(?:dsl\/runs|artifacts)\/([^/]+)\/artifacts?$/);
  if (!match) return false;
  const runId = match[1];
  if (!/^RUN-[A-Z0-9-]+$/i.test(runId)) {
    writeJson(response, 400, { ok: false, data: null, error: { code: "bad_request", message: "invalid runId" } });
    return true;
  }
  const outputDir = path.resolve(config.runsRoot, runId);
  const { artifacts, caseDir } = await readRunArtifacts(outputDir);
  writeJson(response, 200, { ok: true, data: { runId, outputDir, caseDir, artifacts }, error: null });
  return true;
}
