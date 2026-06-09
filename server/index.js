import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendBackendException, sendError, sendOk } from "./httpEnvelope.js";
import { handleArtifacts } from "./routes/artifacts.js";
import { handleAgentExecutionRoutes } from "./routes/agentExecution.js";
import { defaultConfig, getHealth } from "./services/runnerService.js";
import { handleDslRuns } from "./routes/dslRuns.js";
import { handleSkillRoutes } from "./routes/skill.js";

export function createAppServer(config = {}) {
  const merged = { ...defaultConfig, ...config };
  return http.createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        sendOk(response, { method: "OPTIONS" });
        return;
      }
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendOk(response, await getHealth(merged));
        return;
      }
      if (url.pathname.startsWith("/api/dsl/runs") && await handleDslRuns(request, response, merged)) return;
      if (await handleSkillRoutes(request, response, merged)) return;
      if (await handleAgentExecutionRoutes(request, response, merged)) return;
      if (await handleArtifacts(request, response, merged)) return;
      sendError(response, 404, "not_found", "Route not found");
    } catch (error) {
      await sendBackendException(response, error, merged);
    }
  });
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (path.resolve(currentFile) === invokedFile) {
  const port = Number(process.env.PORT || 8787);
  const server = createAppServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`codex-workbench-web backend listening on http://127.0.0.1:${port}`);
  });
}
