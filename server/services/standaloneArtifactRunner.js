import fs from "node:fs/promises";
import path from "node:path";
import { artifactsToUiState } from "../../src/adapters/dslArtifactAdapter.js";
import { readCodeContext, writeContextArtifact } from "../../e2e/context/context-adapter.mjs";
import { loadStandaloneConfig, safeConfig } from "../../e2e/runner/config-loader.mjs";
import { extractJsonObject, requireFields } from "../../e2e/runner/json-utils.mjs";
import { chatCompletion as defaultChatCompletion } from "../../e2e/runner/llm-client.mjs";
import { assertNoSecretsInText, redactObject } from "../../e2e/runner/secret-scan.mjs";
import { readRunArtifacts } from "./artifactService.js";
import { redactSecrets, redactString } from "./redactionService.js";
import { relativeOutputDir } from "./runStore.js";

const requiredDslFields = ["title", "summary", "requirements", "acceptance_criteria", "risks", "ready_for_agent", "handoff_decision"];
const requiredReadinessFields = ["ready", "reasons", "safe_to_write", "recommended_files", "test_commands"];

export async function checkStandaloneArtifactRunner(config = {}) {
  const root = path.resolve("e2e");
  const requiredFiles = [
    path.join(root, "runner", "standalone-e2e.mjs"),
    path.join(root, "runner", "config-loader.mjs"),
    path.join(root, "runner", "llm-client.mjs"),
    path.join(root, "prompts", "pm_to_requirement_dsl.md"),
    path.join(root, "prompts", "context_readiness.md"),
    path.join(root, "context", "default_code_context_packet.json")
  ];
  const missingFiles = [];
  for (const file of requiredFiles) {
    if (!await exists(file)) missingFiles.push(file);
  }
  return {
    available: missingFiles.length === 0,
    root,
    missingFiles,
    apiConfigPath: path.resolve(process.env.API_CONFIG_PATH || config.apiConfigPath || path.resolve("configs", "api_config.local.json")),
    apiConfigExists: await exists(process.env.API_CONFIG_PATH || config.apiConfigPath || path.resolve("configs", "api_config.local.json"))
  };
}

export async function runStandaloneArtifactRunner(request = {}, config = {}) {
  const runId = request.runId;
  const outputDir = path.resolve(request.outputDir);
  const caseDir = path.join(outputDir, "single_case");
  const pmText = request.pmText || mergePmMessages(request.pmMessages);
  const codeContextPath = request.codeContextPath || config.codeContextPath || path.resolve("e2e", "context", "default_code_context_packet.json");
  const chatCompletion = config.artifactModelClient || defaultChatCompletion;

  if (!runId) throw standaloneError("standalone_artifact_failed", "runId is required");
  if (!pmText.trim()) throw standaloneError("bad_request", "pmMessages must include at least one PM message");

  await fs.mkdir(caseDir, { recursive: true });

  try {
    const standaloneStatus = await checkStandaloneArtifactRunner(config);
    if (!standaloneStatus.available) {
      throw standaloneError("standalone_runner_missing", "Standalone artifact runner files are missing", standaloneStatus);
    }

    const standaloneConfig = await loadStandaloneConfig({
      allowExternalFallback: false,
      configPath: config.apiConfigPath
    });
    const prompts = await loadArtifactPrompts();
    const codeContext = await readCodeContext(codeContextPath);

    const dslResult = await chatCompletion({
      config: standaloneConfig,
      label: "pm_to_requirement_dsl",
      messages: [
        { role: "system", content: prompts.pmToDsl },
        { role: "user", content: JSON.stringify({ pm_request: pmText }, null, 2) }
      ]
    });
    const requirementDsl = requireFields(extractJsonObject(dslResult.content), requiredDslFields, "requirement_dsl");
    assertNoSecretsInText(JSON.stringify(requirementDsl), "requirement_dsl");

    const readinessResult = await chatCompletion({
      config: standaloneConfig,
      label: "context_readiness",
      messages: [
        { role: "system", content: prompts.contextReadiness },
        { role: "user", content: JSON.stringify({ requirementDsl, codeContext }, null, 2) }
      ]
    });
    const readiness = requireFields(extractJsonObject(readinessResult.content), requiredReadinessFields, "context_readiness");
    assertNoSecretsInText(JSON.stringify(readiness), "context_readiness");

    const contextArtifact = await writeContextArtifact({ outputDir, requirementDsl, codeContext, readiness });
    const artifactPaths = await writeDslArtifacts({
      runId,
      outputDir,
      caseDir,
      pmText,
      codeContextPath,
      requirementDsl,
      readiness,
      contextPath: contextArtifact.filePath,
      standaloneConfig,
      latencies: {
        pmToDsl: dslResult.latencyMs,
        readiness: readinessResult.latencyMs
      }
    });
    const { artifacts, caseDir: resolvedCaseDir } = await readRunArtifacts(outputDir);
    const uiState = artifactsToUiState(artifacts);

    return redactSecrets({
      runId,
      status: "passed",
      artifactStatus: "done",
      outputDir,
      relativeOutputDir: relativeOutputDir(outputDir),
      caseDir: resolvedCaseDir,
      dslPath: artifactPaths.finalDsl,
      contextPath: contextArtifact.filePath,
      reportPath: artifactPaths.caseSummary,
      artifactPaths,
      artifacts,
      uiState,
      realLlmCalls: 2,
      mockLlmUsed: false,
      realWritePerformed: false,
      source: {
        provider: standaloneConfig.provider,
        model: standaloneConfig.model,
        configSource: standaloneConfig.configSource
      },
      error: null
    });
  } catch (error) {
    const code = normalizeStandaloneErrorCode(error);
    const safeError = redactSecrets({
      code,
      message: redactString(String(error.message || error)),
      details: error.details || {}
    });
    await writeStandaloneError(outputDir, safeError);
    return {
      runId,
      status: "failed",
      artifactStatus: "failed",
      outputDir,
      relativeOutputDir: relativeOutputDir(outputDir),
      realLlmCalls: 0,
      mockLlmUsed: false,
      realWritePerformed: false,
      artifactPaths: {},
      artifacts: {},
      uiState: null,
      error: safeError
    };
  }
}

async function writeDslArtifacts({
  runId,
  outputDir,
  caseDir,
  pmText,
  codeContextPath,
  requirementDsl,
  readiness,
  contextPath,
  standaloneConfig,
  latencies
}) {
  const finalDsl = {
    title: requirementDsl.title,
    summary: requirementDsl.summary,
    requirements: requirementDsl.requirements,
    acceptance_criteria: requirementDsl.acceptance_criteria,
    risks: requirementDsl.risks,
    ready_for_agent: Boolean(requirementDsl.ready_for_agent),
    handoff_decision: String(requirementDsl.handoff_decision || "clarify_first"),
    scope: {
      in_scope: normalizeStringList(requirementDsl.requirements),
      out_of_scope: ["Agent real write", "Agent Handoff", "Remote PR creation"]
    },
    execution_atoms: {
      agent_plan_generated: false,
      agent_handoff_entered: false,
      code_execution_entered: false,
      post_eval_entered: false,
      completion_state: "standalone_artifacts_only"
    },
    source: {
      provider: standaloneConfig.provider,
      model: standaloneConfig.model,
      mode: "standalone_artifact_runner"
    }
  };
  const risks = normalizeRisks(requirementDsl.risks);
  const scoring = {
    module_status: "standalone",
    dsl_completion_score: estimateCompletion(requirementDsl, readiness),
    ready_for_agent: Boolean(requirementDsl.ready_for_agent && readiness.ready && readiness.safe_to_write),
    can_handoff_to_agent: false,
    handoff_decision: finalDsl.handoff_decision,
    covered_items: normalizeStringList(requirementDsl.acceptance_criteria).slice(0, 6),
    pending_items: risks.slice(0, 6).map((risk) => risk.reason),
    source: "standalone_artifact_runner"
  };
  const evpi = {
    module_status: "standalone",
    clarification_gate: {
      should_ask: !scoring.ready_for_agent,
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: finalDsl.handoff_decision,
      coverage_source_type: "standalone_artifact_runner"
    },
    ranked_questions: buildClarificationQuestions(requirementDsl, readiness)
  };
  const artifactJson = {
    "00_input.json": {
      case: {
        case_id: "single_case",
        pm_text: pmText,
        code_context_packet_path: codeContextPath
      },
      runtime_scope: "standalone_pm_to_dsl_context_report_only"
    },
    "01_code_context_ref.json": {
      path: codeContextPath,
      contextArtifactPath: contextPath
    },
    "05_dsl_draft.json": finalDsl,
    "06_risk_activation.json": {
      module_status: "standalone",
      activated_risk_factors: risks
    },
    "09_scoring.json": scoring,
    "10_evpi_clarification.json": evpi,
    "11_pm_turns.json": [{ speaker: "pm", text: pmText, round: 0 }],
    "12_final_dsl.json": finalDsl
  };

  await Promise.all(Object.entries(artifactJson).map(([filename, json]) =>
    fs.writeFile(path.join(caseDir, filename), JSON.stringify(redactObject(json), null, 2), "utf8")
  ));

  const caseSummary = [
    `# Standalone DSL Artifact Summary: ${runId}`,
    "",
    `- status: passed`,
    `- title: ${finalDsl.title}`,
    `- handoff_decision: ${finalDsl.handoff_decision}`,
    `- ready_for_agent: ${scoring.ready_for_agent}`,
    `- realLlmCalls: 2`,
    `- mockLlmUsed: false`,
    `- realWritePerformed: false`,
    `- scope: DSL / Context / Report artifacts only; no Agent real write.`
  ].join("\n");
  await fs.writeFile(path.join(caseDir, "13_case_summary.md"), caseSummary, "utf8");

  await fs.writeFile(path.join(outputDir, "requirement_dsl.json"), JSON.stringify(redactObject(requirementDsl), null, 2), "utf8");
  const standaloneReport = redactObject({
    runId,
    status: "passed",
    artifactStatus: "done",
    dryRun: true,
    realLlmCalls: 2,
    mockLlmUsed: false,
    realWritePerformed: false,
    outputDir,
    config: safeConfig(standaloneConfig),
    artifacts: {
      requirementDsl: path.join(outputDir, "requirement_dsl.json"),
      contextReadiness: contextPath,
      finalDsl: path.join(caseDir, "12_final_dsl.json"),
      caseSummary: path.join(caseDir, "13_case_summary.md")
    },
    latencyMs: latencies,
    readiness: {
      ready: Boolean(readiness.ready),
      safeToWrite: Boolean(readiness.safe_to_write),
      reasons: readiness.reasons
    }
  });
  await fs.writeFile(path.join(outputDir, "standalone_artifact_report.json"), JSON.stringify(standaloneReport, null, 2), "utf8");

  const summary = {
    run_id: runId,
    status: "passed",
    artifact_status: "done",
    requested_output_dir: outputDir,
    actual_output_dir: outputDir,
    total_cases: 1,
    passed_cases: 1,
    failed_cases: 0,
    timeout_cases: 0,
    real_llm_calls: 2,
    mock_llm_used: false,
    real_write_performed: false,
    case_results: [{
      case_id: "single_case",
      status: "passed",
      output_dir: caseDir,
      rounds: 1,
      should_ask: evpi.clarification_gate.should_ask,
      handoff_decision: finalDsl.handoff_decision
    }]
  };
  await fs.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(path.join(outputDir, "summary.md"), `# Standalone Artifact Runner Summary: ${runId}\n`, "utf8");

  return {
    input: path.join(caseDir, "00_input.json"),
    dslDraft: path.join(caseDir, "05_dsl_draft.json"),
    scoring: path.join(caseDir, "09_scoring.json"),
    clarification: path.join(caseDir, "10_evpi_clarification.json"),
    finalDsl: path.join(caseDir, "12_final_dsl.json"),
    caseSummary: path.join(caseDir, "13_case_summary.md"),
    contextReadiness: contextPath,
    standaloneReport: path.join(outputDir, "standalone_artifact_report.json"),
    summary: path.join(outputDir, "summary.json")
  };
}

async function loadArtifactPrompts() {
  const [pmToDsl, contextReadiness] = await Promise.all([
    fs.readFile(path.resolve("e2e", "prompts", "pm_to_requirement_dsl.md"), "utf8"),
    fs.readFile(path.resolve("e2e", "prompts", "context_readiness.md"), "utf8")
  ]);
  return { pmToDsl, contextReadiness };
}

function mergePmMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => String(message?.content || "").trim())
    .map((message, index) => {
      if (["system", "system_clarification"].includes(message.role)) {
        const suffix = message.questionKey ? `\n[question_key] ${message.questionKey}` : "";
        return `[System clarification asked]\n${message.content}${suffix}`;
      }
      return `${index > 0 ? "[PM answer]" : "[PM request]"}\n${message.content}`;
    })
    .join("\n\n");
}

function normalizeRisks(risks) {
  const items = Array.isArray(risks) && risks.length ? risks : ["Acceptance criteria need human confirmation."];
  return items.slice(0, 8).map((risk, index) => {
    if (risk && typeof risk === "object") {
      return {
        factor_id: String(risk.factor_id || risk.key || risk.id || `standalone_risk_${index + 1}`),
        severity: String(risk.severity || risk.priority || (index === 0 ? "P0" : "P1")),
        reason: String(risk.reason || risk.description || risk.title || "Risk requires human review."),
        category: String(risk.category || risk.type || "standalone")
      };
    }
    return {
      factor_id: `standalone_risk_${index + 1}`,
      severity: index === 0 ? "P0" : "P1",
      reason: String(risk),
      category: "standalone"
    };
  });
}

function buildClarificationQuestions(requirementDsl, readiness) {
  const reasons = normalizeStringList(readiness.reasons);
  const firstReason = reasons[0] || "Acceptance criteria still require human confirmation.";
  return [
    {
      question: "Which visible acceptance result should confirm this requirement is complete?",
      reason: firstReason,
      factor_ids: ["standalone_acceptance_confirmation"]
    },
    {
      question: "What should stay out of scope for this round so the DSL does not expand too far?",
      reason: "clarify_first requires PM-owned scope boundaries before any Agent handoff.",
      factor_ids: ["standalone_scope_boundary"]
    }
  ];
}

function estimateCompletion(requirementDsl, readiness) {
  const requirementsCount = normalizeStringList(requirementDsl.requirements).length;
  const acceptanceCount = normalizeStringList(requirementDsl.acceptance_criteria).length;
  const riskCount = normalizeRisks(requirementDsl.risks).length;
  const base = 0.68 + Math.min(0.18, requirementsCount * 0.03) + Math.min(0.1, acceptanceCount * 0.025);
  const readinessBonus = readiness.ready ? 0.04 : 0;
  const riskPenalty = Math.min(0.08, riskCount * 0.01);
  return Math.max(0.5, Math.min(0.92, Number((base + readinessBonus - riskPenalty).toFixed(2))));
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

async function writeStandaloneError(outputDir, error) {
  await fs.mkdir(outputDir, { recursive: true });
  const payload = JSON.stringify(redactSecrets({ error }), null, 2);
  await fs.writeFile(path.join(outputDir, "error.json"), payload, "utf8");
  const caseDir = path.join(outputDir, "single_case");
  await fs.mkdir(caseDir, { recursive: true });
  await fs.writeFile(path.join(caseDir, "error.json"), payload, "utf8");
}

function normalizeStandaloneErrorCode(error) {
  if (error?.code) return error.code;
  const message = String(error?.message || error || "");
  if (message.includes("standalone_config_missing")) return "standalone_config_missing";
  if (message.includes("standalone_config_model_missing")) return "standalone_config_model_missing";
  if (message.includes("standalone_config_api_key_missing")) return "standalone_config_api_key_missing";
  if (message.includes("timeout")) return "standalone_artifact_timeout";
  return "standalone_artifact_failed";
}

function standaloneError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
