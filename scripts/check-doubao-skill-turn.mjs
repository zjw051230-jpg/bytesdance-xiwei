import fs from "node:fs/promises";
import path from "node:path";
import { runSkillTurn } from "../server/services/skillOrchestrator.js";

const mode = String(process.argv[2] || "minimal").trim().toLowerCase();
const outDir = path.resolve("reporting");
const outPath = path.join(outDir, `doubao-skill-${mode}-check-result.json`);
await fs.mkdir(outDir, { recursive: true });

const prompts = {
  minimal: "请把文章详情页增加阅读信息提示这个 PM 需求整理成候选 DSL，并只问一个关键澄清问题。",
  l1: "文章详情页现在只有正文内容，我希望在正文下面加一个简单的阅读信息提示，比如“本文共 XXX 字，预计阅读 X 分钟”。先只在前端根据文章正文计算，不需要改后端，也不需要保存数据。希望空正文时不要报错，展示上也别太突兀。"
};

const startedAt = Date.now();
const result = {
  attempted: true,
  mode,
  status: "unknown",
  runId: "",
  provider: "doubao_ark",
  model: "",
  latencyMs: 0,
  promptChars: 0,
  messageCount: 0,
  mockUsed: false,
  readyForAgent: null,
  errorCode: "",
  error: null
};

try {
  const response = await runSkillTurn({
    mode: "fast",
    maxLatencyMs: mode === "l1" ? 90_000 : 60_000,
    projectId: "conduit-realworld-example-app",
    pmMessages: [{ role: "pm", content: prompts[mode] || prompts.minimal }]
  }, {
    nodeEnv: "development"
  });

  const payload = response.data || {};
  const error = response.error || {};
  const runId = payload.runId || error.details?.runId || "";
  const diagnostics = runId ? await readDiagnostics(runId) : {};
  result.status = response.ok ? "passed" : error.code || "failed";
  result.runId = runId;
  result.provider = payload.source?.provider || error.details?.provider || diagnostics.provider || result.provider;
  result.model = payload.source?.model || error.details?.model || diagnostics.model || "";
  result.latencyMs = diagnostics.latencyMs || payload.source?.latencyMs || Date.now() - startedAt;
  result.promptChars = diagnostics.promptChars || 0;
  result.messageCount = diagnostics.messageCount || 0;
  result.mockUsed = payload.source?.mode === "mock";
  result.readyForAgent = payload.risk_boundary?.ready_for_agent ?? payload.readiness?.ready_for_agent ?? false;
  result.errorCode = error.code || "";
  if (!response.ok) result.error = error.message || "Doubao skill check failed";
} catch (error) {
  result.status = "failed";
  result.latencyMs = Date.now() - startedAt;
  result.errorCode = error.code || "check_failed";
  result.error = String(error.message || error);
} finally {
  await fs.writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") process.exitCode = 1;
}

async function readDiagnostics(runId) {
  try {
    return JSON.parse(await fs.readFile(path.join("runs", runId, "skill_turn_diagnostics.json"), "utf8"));
  } catch {
    return {};
  }
}
