import fs from "node:fs/promises";
import path from "node:path";
import { writeContextArtifact, readCodeContext } from "../context/context-adapter.mjs";
import { applyAgentOutputToRepo, getTargetRepoPath, writeCandidatePatch } from "../agent/agent-runner.mjs";
import { loadStandaloneConfig, safeConfig } from "./config-loader.mjs";
import { extractJsonObject, requireFields } from "./json-utils.mjs";
import { chatCompletion } from "./llm-client.mjs";
import { assertNoSecretsInText, redactObject } from "./secret-scan.mjs";

const requiredDslFields = ["title", "summary", "requirements", "acceptance_criteria", "risks", "ready_for_agent", "handoff_decision"];
const requiredReadinessFields = ["ready", "reasons", "safe_to_write", "recommended_files", "test_commands"];
const requiredAgentFields = ["summary", "files", "test_commands", "notes"];

export async function runStandaloneE2E(options = {}) {
  const dryRun = options.dryRun !== false;
  const pmText = options.pmText || "Improve login failure guidance: cover failure scenarios, user-facing next steps, acceptance criteria, and keep the change safe for dry-run review.";
  const runId = `standalone-e2e-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  const outputDir = path.resolve("runs", runId);
  await fs.mkdir(outputDir, { recursive: true });

  const config = await loadStandaloneConfig({ allowExternalFallback: options.allowExternalFallback !== false });
  if (options.requireStandaloneConfig !== false && config.usedExternalDslV2Fallback) {
    throw new Error("standalone_smoke_must_not_use_external_dsl_v2_config_fallback");
  }

  const prompts = await loadPrompts();
  const codeContext = await readCodeContext(options.contextPath);

  const dslResult = await chatCompletion({
    config,
    label: "pm_to_requirement_dsl",
    messages: [
      { role: "system", content: prompts.pmToDsl },
      { role: "user", content: JSON.stringify({ pm_request: pmText }, null, 2) }
    ]
  });
  const requirementDsl = requireFields(extractJsonObject(dslResult.content), requiredDslFields, "requirement_dsl");
  await fs.writeFile(path.join(outputDir, "requirement_dsl.json"), JSON.stringify(requirementDsl, null, 2), "utf8");

  const readinessResult = await chatCompletion({
    config,
    label: "context_readiness",
    messages: [
      { role: "system", content: prompts.contextReadiness },
      { role: "user", content: JSON.stringify({ requirementDsl, codeContext }, null, 2) }
    ]
  });
  const readiness = requireFields(extractJsonObject(readinessResult.content), requiredReadinessFields, "context_readiness");
  const contextArtifact = await writeContextArtifact({ outputDir, requirementDsl, codeContext, readiness });

  const agentResult = await chatCompletion({
    config,
    label: "agent_codegen",
    messages: [
      { role: "system", content: prompts.agentCodegen },
      { role: "user", content: JSON.stringify({ requirementDsl, readiness, codeContext, dryRun }, null, 2) }
    ]
  });
  const agentOutput = requireFields(extractJsonObject(agentResult.content), requiredAgentFields, "agent_output");
  assertNoSecretsInText(JSON.stringify(agentOutput), "agent_output");
  const candidatePatchPath = await writeCandidatePatch({ outputDir, agentOutput });

  let writtenFiles = [];
  let realWritePerformed = false;
  if (!dryRun) {
    writtenFiles = await applyAgentOutputToRepo({
      targetRepoPath: getTargetRepoPath(),
      agentOutput
    });
    realWritePerformed = writtenFiles.length > 0;
  }

  const report = redactObject({
    runId,
    status: "passed",
    dryRun,
    realLlmCalls: 3,
    mockLlmUsed: false,
    mockRepoUsed: false,
    mockTestUsed: false,
    targetRepoPath: getTargetRepoPath(),
    realWritePerformed,
    writtenFiles,
    outputDir,
    config: safeConfig(config),
    artifacts: {
      requirementDsl: path.join(outputDir, "requirement_dsl.json"),
      contextReadiness: contextArtifact.filePath,
      candidatePatch: candidatePatchPath
    },
    source: {
      provider: config.provider,
      model: config.model
    },
    latencyMs: {
      pmToDsl: dslResult.latencyMs,
      readiness: readinessResult.latencyMs,
      agent: agentResult.latencyMs
    },
    readiness: {
      ready: readiness.ready,
      safeToWrite: readiness.safe_to_write,
      reasons: readiness.reasons
    }
  });

  await fs.writeFile(path.join(outputDir, "standalone_e2e_report.json"), JSON.stringify(report, null, 2), "utf8");
  await fs.mkdir(path.resolve("reporting"), { recursive: true });
  await fs.writeFile(path.resolve("reporting", "standalone-e2e-dry-run-result.json"), JSON.stringify(report, null, 2), "utf8");
  return report;
}

async function loadPrompts() {
  const [pmToDsl, contextReadiness, agentCodegen] = await Promise.all([
    fs.readFile(path.resolve("e2e", "prompts", "pm_to_requirement_dsl.md"), "utf8"),
    fs.readFile(path.resolve("e2e", "prompts", "context_readiness.md"), "utf8"),
    fs.readFile(path.resolve("e2e", "prompts", "agent_codegen.md"), "utf8")
  ]);
  return { pmToDsl, contextReadiness, agentCodegen };
}
