import fs from "node:fs/promises";
import path from "node:path";
import { loadSkillPrompts, defaultSkillNames } from "./skillPromptLoader.js";
import { redactSecrets, redactString } from "./redactionService.js";
import { prepareRunDirectory, relativeOutputDir } from "./runStore.js";
import { createChatCompletionWithLocalConfig, readOpenAiCompatibleConfig } from "./openAiCompatibleClient.js";
import { createDoubaoChatCompletionWithLocalConfig, readDoubaoArkConfig } from "./doubaoArkClient.js";
import { evaluateDslCore } from "./dslCore/index.js";
import {
  buildInputGateReply,
  detectInputIntent,
  shouldGateInputIntent
} from "../../src/utils/inputIntentGate.js";

const RAW_EVPI_ACCEPTANCE_QUESTION = "你希望用什么用户可见现象或测试结果判断这个需求已经完成？";
const DEFAULT_FAST_SKILL_TIMEOUT_MS = 60_000;
const MAX_PM_HISTORY = 12;
const FAST_PROMPT_MAX_CHARS = 6000;
const SKILL_SUMMARY_MAX_CHARS = 560;
const SKILL_MODEL_RESULT_MARKER = "__skillModelResult";
const INITIAL_MIN_QUESTIONS = 5;
const INITIAL_MAX_QUESTIONS = 6;
const INITIAL_REQUIRED_ANSWERS = 5;
const INITIAL_REQUIRED_DIMENSIONS = 4;
const REFINEMENT_QUESTIONS = 1;

export async function runSkillTurn(requestBody = {}, config = {}) {
  const rawLatestInput = latestRawPmText(requestBody.pmMessages);
  const intent = detectInputIntent(rawLatestInput);
  if (!String(rawLatestInput || "").trim() || (shouldGateInputIntent(intent) && !hasClarificationQuestionContext(requestBody.pmMessages))) {
    return inputGatedSkillPayload(intent, rawLatestInput);
  }
  const pmMessages = normalizePmMessages(requestBody.pmMessages).slice(-MAX_PM_HISTORY);
  if (!pmMessages.length) {
    return errorPayload("bad_request", "pmMessages must include at least one PM message", {});
  }

  const { runId, outputDir } = await prepareRunDirectory(config.runsRoot || path.resolve("runs"));
  const skillNames = config.skillNames || defaultSkillNames;
  const promptResult = await loadSkillPrompts({
    dslRuntimeRoot: config.dslRuntimeRoot || path.resolve("e2e"),
    skillNames,
    wrapperPath: config.wrapperPath
  });
  if (!promptResult.ok) return promptResult;

  const maxLatencyMs = await resolveSkillMaxLatencyMs(requestBody, config);
  const input = redactSecrets({
    runId,
    projectId: requestBody.projectId || "conduit-realworld-example-app",
    pmMessages,
    latestPmInput: latestPmText(pmMessages),
    codeContextHint: requestBody.codeContextPath || config.codeContextPath ? "code_context_available_as_candidate_hint_only" : "",
    evpiSignals: compactEvpiSignals(requestBody.evpiSignals),
    riskSignals: compactRiskSignals(requestBody.riskSignals),
    lightweightSignals: compactLightweightSignals(requestBody.lightweightSignals),
    mode: requestBody.mode || "fast",
    clarificationMode: String(requestBody.clarificationMode || "").trim(),
    refinementRequested: Boolean(requestBody.refinementRequested),
    maxLatencyMs,
    currentDslDraft: compactDslDraft(requestBody.currentDslDraft),
    previousUiState: compactPreviousUiState(requestBody.previousUiState),
    localRulesRole: "validation_redaction_dedup_safety_artifact_only"
  });
  const prompt = buildSkillPrompt(promptResult.data, input);
  const diagnosticsBase = createSkillDiagnostics({ prompt, input, timeoutMs: input.maxLatencyMs });

  await fs.writeFile(path.join(outputDir, "skill_turn_input.json"), JSON.stringify(input, null, 2), "utf8");
  await fs.writeFile(path.join(outputDir, "skill_turn_prompt.md"), redactString(prompt), "utf8");
  await writeSkillDiagnostics(outputDir, diagnosticsBase);

  let rawResponse;
  let parsed;
  let sourceDefaults = {};
  const startedAt = Date.now();
  try {
    const invocation = await withSkillTimeout(
      invokeSkillModel(prompt, input, config, promptResult.data, { outputDir, timeoutMs: input.maxLatencyMs }),
      input.maxLatencyMs
    );
    const modelResult = unwrapSkillModelResult(invocation);
    rawResponse = modelResult.content;
    sourceDefaults = modelResult.sourceDefaults;
    await fs.writeFile(
      path.join(outputDir, "skill_turn_response_raw.json"),
      JSON.stringify(redactSecrets({ response: rawResponse }), null, 2),
      "utf8"
    );
    try {
      parsed = normalizeModelPayload(parseModelJson(rawResponse), skillNames, sourceDefaults);
    } catch (error) {
      parsed = invalidJsonSkillPayload(input, skillNames, error);
      await writeSkillDiagnostics(outputDir, finalizeSkillDiagnostics(diagnosticsBase, {
        status: "model_invalid_json",
        latencyMs: Date.now() - startedAt,
        source: sourceDefaults
      }));
    }
  } catch (error) {
    rawResponse = { fallbackReason: String(error.message || error), code: error.code || "skill_turn_failed" };
    await fs.writeFile(
      path.join(outputDir, "skill_turn_response_raw.json"),
      JSON.stringify(redactSecrets({ response: rawResponse }), null, 2),
      "utf8"
    );
    if (error?.code === "skill_turn_timeout" && isRealModeRequested(requestBody, config)) {
      let timeoutModelDetails = {};
      try {
        timeoutModelDetails = await readRealModelDetails(config);
      } catch {
        timeoutModelDetails = {};
      }
      await writeRealResponseArtifact(outputDir, timeoutModelDetails, {
        ok: false,
        status: "timeout",
        statusText: `${timeoutModelDetails.provider === "doubao_ark" ? "Doubao Ark" : "OpenAI SDK"} request timed out before a response was available`,
        ...timeoutModelDetails
      });
      const timeoutError = codedError(timeoutModelDetails.provider === "doubao_ark" ? "doubao_timeout" : "sdk_timeout", `${timeoutModelDetails.provider === "doubao_ark" ? "Doubao Ark" : "OpenAI SDK"} request timed out`, {
        status: "external_blocked",
        timeoutMs: input.maxLatencyMs,
        ...timeoutModelDetails
      });
      await writeSkillDiagnostics(outputDir, finalizeSkillDiagnostics(diagnosticsBase, {
        status: timeoutError.code,
        latencyMs: Date.now() - startedAt,
        source: timeoutModelDetails
      }));
      return writeExternalBlockedResult({ error: timeoutError, runId, outputDir });
    }
    if (isExternalBlockedError(error)) {
      await writeSkillDiagnostics(outputDir, finalizeSkillDiagnostics(diagnosticsBase, {
        status: error.code || "external_blocked",
        latencyMs: Date.now() - startedAt,
        source: error.details || {}
      }));
      return writeExternalBlockedResult({ error, runId, outputDir });
    }
    parsed = error?.code === "skill_turn_timeout"
      ? slowResponseSkillPayload(input, skillNames, error)
      : fallbackSkillPayload(input, skillNames, error);
  }

  parsed = repairOverPassIfNeeded(parsed, input, skillNames);
  parsed = enforceSafetyAndRedaction(parsed, skillNames);
  parsed = applyDslCoreEvaluation(parsed, input);
  parsed = enforceClarificationQuestionPolicy(parsed, input);
  parsed.source = {
    ...(parsed.source || {}),
    latencyMs: Number(parsed.source?.latencyMs ?? Date.now() - startedAt)
  };
  await writeSkillDiagnostics(outputDir, finalizeSkillDiagnostics(diagnosticsBase, {
    status: parsed.source?.errorCode || "passed",
    latencyMs: parsed.source.latencyMs,
    source: parsed.source
  }));
  const data = redactSecrets({
    runId,
    outputDir,
    relativeOutputDir: relativeOutputDir(outputDir),
    ...parsed,
    uiState: skillPayloadToUiState(parsed)
  });

  await fs.writeFile(
    path.join(outputDir, "skill_turn_response_parsed.json"),
    JSON.stringify(data, null, 2),
    "utf8"
  );

  return { ok: true, data, error: null };
}

export function buildSkillPrompt(promptBundle, input) {
  const skillSections = Object.values(promptBundle.skills)
    .map((skill) => `- ${skill.name}: ${summarizeSkillContent(skill.content)}`)
    .join("\n\n---\n\n");
  const runtimePayload = compactRuntimePayload(input);
  const prompt = [
    truncateText(promptBundle.wrapper.content, 1800),
    "## Compact Runtime Payload",
    "```json",
    JSON.stringify(runtimePayload, null, 2),
    "```",
    "## Skill summaries, not full skill files",
    skillSections,
    "Return exactly one JSON object. Use clarification.questions for one concise user-answerable question when clarification is needed. No Markdown outside JSON."
  ].join("\n\n");
  if (prompt.length <= FAST_PROMPT_MAX_CHARS) return prompt;
  return [
    truncateText(promptBundle.wrapper.content, 1800),
    "## Compact Runtime Payload",
    "```json",
    JSON.stringify(runtimePayload, null, 2),
    "```",
    "Return exactly this lightweight JSON shape with one clarification question."
  ].join("\n\n");
}

function summarizeSkillContent(content) {
  const text = String(content || "").trim();
  const frontMatterless = text.replace(/^---[\s\S]*?---\s*/m, "").trim();
  return truncateText(frontMatterless.replace(/\s+/g, " "), SKILL_SUMMARY_MAX_CHARS);
}

function compactRuntimePayload(input) {
  return {
    runId: input.runId,
    projectId: input.projectId,
    latestPmInput: truncateText(input.latestPmInput, 900),
    pmMessages: input.pmMessages.map((message) => ({
      role: message.role,
      content: truncateText(message.content, 420)
    })),
    currentDslDraft: input.currentDslDraft,
    riskSignals: input.riskSignals,
    lightweightSignals: input.lightweightSignals,
    clarificationMode: input.clarificationMode,
    refinementRequested: input.refinementRequested,
    previousUiState: input.previousUiState,
    codeContextHint: input.codeContextHint,
    maxLatencyMs: input.maxLatencyMs,
    outputContract: "lightweight_skill_response_only"
  };
}

async function invokeSkillModel(prompt, input, config, promptBundle, context = {}) {
  if (config.modelClient) return config.modelClient({ prompt, input, promptBundle });
  const mode = resolveSkillModelMode(input, config);
  if (mode === "real") return callRealSkillModel(prompt, config, context);
  if (mode === "doubao_ark") return callDoubaoArk(prompt, config, context);
  if (mode === "openai-compatible") return callOpenAICompatible(prompt, config, context);
  if (mode === "mock-hang") return new Promise(() => {});
  return skillModelResult(mockSkillModel(input, Object.keys(promptBundle.skills)), {
    mode: "mock",
    provider: "mock_model"
  });
}

function withSkillTimeout(promise, timeoutMs) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`fast skill turn exceeded ${timeoutMs}ms`);
        error.code = "skill_turn_timeout";
        reject(error);
      }, timeoutMs);
    })
  ]);
}

async function callRealSkillModel(prompt, config, context = {}) {
  if (hasOpenAiCompatibleSkillConfig(config)) return callOpenAICompatible(prompt, config, context);
  return callDoubaoArk(prompt, config, context);
}

async function callDoubaoArk(prompt, config, context = {}) {
  const result = await createDoubaoChatCompletionWithLocalConfig({
    configPath: config.doubaoApiConfigPath,
    baseURL: config.doubaoBaseURL,
    endpointId: config.skillModelName || process.env.SKILL_MODEL_NAME,
    timeoutMs: context.timeoutMs || config.maxLatencyMs,
    temperature: 0.2,
    messages: [
      { role: "system", content: "Return JSON only for PM-to-DSL skill orchestration." },
      { role: "user", content: prompt }
    ],
    fetchImpl: config.fetchImpl
  });

  if (context.outputDir) {
    await fs.writeFile(
      path.join(context.outputDir, "skill_turn_doubao_request.json"),
      JSON.stringify(result.safeRequest, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(context.outputDir, "skill_turn_doubao_response_raw.json"),
      JSON.stringify(result.safeResponse, null, 2),
      "utf8"
    );
  }

  return skillModelResult(result.content, result.source);
}

async function callOpenAICompatible(prompt, config, context = {}) {
  const result = await createChatCompletionWithLocalConfig({
    apiConfigPath: config.skillApiConfigPath || config.apiConfigPath,
    model: config.skillModelName || process.env.SKILL_MODEL_NAME,
    timeoutMs: context.timeoutMs || config.maxLatencyMs,
    temperature: 0.2,
    messages: [
      { role: "system", content: "Return JSON only for PM-to-DSL skill orchestration." },
      { role: "user", content: prompt }
    ],
    OpenAIClass: config.OpenAIClass
  });

  if (context.outputDir) {
    await fs.writeFile(
      path.join(context.outputDir, "skill_turn_sdk_request.json"),
      JSON.stringify(result.safeRequest, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(context.outputDir, "skill_turn_sdk_response_raw.json"),
      JSON.stringify(result.safeResponse, null, 2),
      "utf8"
    );
  }

  return skillModelResult(result.content, result.source);
}

function resolveSkillModelMode(input, config = {}) {
  const explicit = String(config.skillModelMode || process.env.SKILL_MODEL_MODE || "").trim().toLowerCase();
  if (explicit === "real") return "real";
  if (explicit === "doubao" || explicit === "doubao_ark") return "doubao_ark";
  if (explicit === "openai-compatible") return "openai-compatible";
  if (explicit === "mock" || explicit === "mock-hang") return explicit;
  if (input?.mock === true && (isTestEnv(config) || config.allowRequestMock === true)) return "mock";
  return isTestEnv(config) ? "mock" : "real";
}

function isRealModeRequested(input, config = {}) {
  if (config.modelClient) return false;
  return ["real", "doubao_ark", "openai-compatible"].includes(resolveSkillModelMode(input, config));
}

function hasOpenAiCompatibleSkillConfig(config = {}) {
  return Boolean(config.skillApiConfigPath || config.apiConfigPath || process.env.SKILL_MODEL_API_CONFIG);
}

function isTestEnv(config = {}) {
  return String(config.nodeEnv || process.env.NODE_ENV || "").toLowerCase() === "test";
}

async function resolveSkillMaxLatencyMs(requestBody = {}, config = {}) {
  const explicit = firstPositiveNumber(requestBody.maxLatencyMs, config.maxLatencyMs);
  if (explicit > 0) return Math.round(explicit);
  if (hasOpenAiCompatibleSkillConfig(config) || config.modelClient) return DEFAULT_FAST_SKILL_TIMEOUT_MS;
  try {
    const doubaoConfig = await readDoubaoArkConfig({
      configPath: config.doubaoApiConfigPath,
      baseURL: config.doubaoBaseURL,
      endpointId: config.skillModelName || process.env.SKILL_MODEL_NAME
    });
    const timeoutMs = Number(doubaoConfig.timeoutSeconds) > 0
      ? Math.round(Number(doubaoConfig.timeoutSeconds) * 1000)
      : DEFAULT_FAST_SKILL_TIMEOUT_MS;
    return normalizeLatencyMs(timeoutMs, DEFAULT_FAST_SKILL_TIMEOUT_MS);
  } catch {
    return DEFAULT_FAST_SKILL_TIMEOUT_MS;
  }
}

function compactEvpiSignals(signals = {}) {
  const ranked = Array.isArray(signals?.ranked_questions)
    ? signals.ranked_questions.slice(0, 2).map((item) => ({
        question: truncateText(item.question || item.text || "", 240),
        reason: truncateText(item.reason || "", 180),
        source: truncateText(item.source || "", 80)
      }))
    : [];
  return ranked.length ? { ranked_questions: ranked } : {};
}

function compactRiskSignals(signals = {}) {
  if (!signals || typeof signals !== "object") return {};
  return redactSecrets({
    risks: arrayOfStrings(signals.risks || signals.items).slice(0, 5).map((risk) => truncateText(risk, 180)),
    readiness: objectOrEmpty(signals.readiness)
  });
}

function compactLightweightSignals(signals = {}) {
  if (!signals || typeof signals !== "object") return {};
  return redactSecrets({
    riskSummary: Array.isArray(signals.riskSummary)
      ? signals.riskSummary.slice(0, 5).map(compactRiskItem)
      : [],
    missingFields: arrayOfStrings(signals.missingFields).slice(0, 5).map((field) => truncateText(field, 120)),
    readiness: objectOrEmpty(signals.readiness)
  });
}

function compactRiskItem(item) {
  if (!item || typeof item !== "object") return { description: truncateText(item, 160) };
  return {
    key: truncateText(item.key || "", 80),
    priority: truncateText(item.priority || "", 20),
    description: truncateText(item.description || item.text || "", 180)
  };
}

function compactDslDraft(draft = {}) {
  if (!draft || typeof draft !== "object") return {};
  const summary = draft.summary || draft;
  const scope = draft.scope || {};
  return redactSecrets({
    title: truncateText(summary.title || draft.title || "", 120),
    summary: truncateText(summary.text || summary.summary || draft.summary || "", 300),
    inScope: arrayOfStrings(scope.inScope || draft.in_scope || draft.scope).slice(0, 5).map((item) => truncateText(item, 140)),
    outOfScope: arrayOfStrings(scope.outOfScope || draft.out_of_scope).slice(0, 5).map((item) => truncateText(item, 140))
  });
}

function compactPreviousUiState(state = {}) {
  if (!state || typeof state !== "object") return null;
  return redactSecrets({
    readiness: objectOrEmpty(state.readiness),
    pending: arrayOfStrings(state.coverageItems?.pending).slice(0, 5).map((item) => truncateText(item, 140)),
    risks: Array.isArray(state.risks) ? state.risks.slice(0, 5).map(compactRiskItem) : [],
    recommendedQuestion: state.recommendedQuestion ? {
      text: truncateText(state.recommendedQuestion.text || "", 220),
      reason: truncateText(state.recommendedQuestion.reason || "", 180)
    } : null
  });
}

function createSkillDiagnostics({ prompt, input, timeoutMs }) {
  const systemPrompt = "Return JSON only for PM-to-DSL skill orchestration.";
  return redactSecrets({
    provider: "",
    model: "",
    promptChars: prompt.length,
    systemPromptChars: systemPrompt.length,
    userPayloadChars: prompt.length,
    messageCount: 2,
    contextMessageCount: input.pmMessages.length,
    timeoutMs,
    latencyMs: 0,
    status: "started"
  });
}

function finalizeSkillDiagnostics(diagnostics, { status, latencyMs, source = {} }) {
  return redactSecrets({
    ...diagnostics,
    provider: source.provider || diagnostics.provider || "",
    model: source.model || diagnostics.model || "",
    latencyMs: Number.isFinite(Number(latencyMs)) ? Number(latencyMs) : diagnostics.latencyMs,
    status: status || diagnostics.status
  });
}

async function writeSkillDiagnostics(outputDir, diagnostics) {
  if (!outputDir) return;
  await fs.writeFile(
    path.join(outputDir, "skill_turn_diagnostics.json"),
    JSON.stringify(redactSecrets(diagnostics), null, 2),
    "utf8"
  );
}

async function writeSdkResponseArtifact(outputDir, payload) {
  if (!outputDir) return;
  await fs.writeFile(
    path.join(outputDir, "skill_turn_sdk_response_raw.json"),
    JSON.stringify(redactSecrets(payload), null, 2),
    "utf8"
  );
}

async function writeRealResponseArtifact(outputDir, modelDetails = {}, payload) {
  if (!outputDir) return;
  if (modelDetails.provider === "doubao_ark") {
    await fs.writeFile(
      path.join(outputDir, "skill_turn_doubao_response_raw.json"),
      JSON.stringify(redactSecrets(payload), null, 2),
      "utf8"
    );
    return;
  }
  await writeSdkResponseArtifact(outputDir, payload);
}

async function readRealModelDetails(config = {}) {
  if (hasOpenAiCompatibleSkillConfig(config)) {
    const apiConfig = await readOpenAiCompatibleConfig({
      ...config,
      apiConfigPath: config.skillApiConfigPath || config.apiConfigPath
    });
    return {
      model: apiConfig.model,
      baseURL: apiConfig.baseURL,
      provider: "openai_compatible",
      client: "openai_sdk"
    };
  }
  const doubaoConfig = await readDoubaoArkConfig({
    configPath: config.doubaoApiConfigPath,
    baseURL: config.doubaoBaseURL,
    endpointId: config.skillModelName || process.env.SKILL_MODEL_NAME
  });
  return {
    model: doubaoConfig.model,
    baseURL: doubaoConfig.baseURL,
    provider: "doubao_ark",
    client: "doubao_ark"
  };
}

function skillModelResult(content, sourceDefaults = {}) {
  return {
    [SKILL_MODEL_RESULT_MARKER]: true,
    content,
    sourceDefaults
  };
}

function unwrapSkillModelResult(value) {
  if (value && typeof value === "object" && value[SKILL_MODEL_RESULT_MARKER]) {
    return {
      content: value.content,
      sourceDefaults: value.sourceDefaults || {}
    };
  }
  return { content: value, sourceDefaults: {} };
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isExternalBlockedError(error) {
  return [
    "skill_model_unavailable",
    "model_invalid_response",
    "sdk_auth_failed",
    "sdk_timeout",
    "sdk_connection_failed",
    "sdk_request_failed",
    "sdk_config_missing",
    "sdk_config_invalid",
    "doubao_config_missing",
    "doubao_key_missing",
    "doubao_endpoint_missing",
    "doubao_auth_failed",
    "doubao_timeout",
    "doubao_invalid_json",
    "doubao_http_error"
  ].includes(error?.code);
}

async function writeExternalBlockedResult({ error, runId, outputDir }) {
  const details = redactSecrets({
    status: "external_blocked",
    runId,
    outputDir,
    relativeOutputDir: relativeOutputDir(outputDir),
    ...(error.details || {})
  });
  const payload = redactSecrets({
    runId,
    outputDir,
    relativeOutputDir: relativeOutputDir(outputDir),
    status: "external_blocked",
    source: {
      mode: "external_blocked",
      provider: error.details?.provider || "openai_compatible",
      client: error.details?.client || "openai_sdk",
      model: error.details?.model || ""
    },
    error: {
      code: error.code || "skill_model_unavailable",
      message: error.message || "Skill model unavailable",
      details
    }
  });
  await fs.writeFile(
    path.join(outputDir, "skill_turn_response_parsed.json"),
    JSON.stringify(payload, null, 2),
    "utf8"
  );
  return {
    ok: false,
    data: null,
    error: {
      code: error.code || "skill_model_unavailable",
      message: error.message || "Skill model unavailable",
      details
    }
  };
}

function mockSkillModel(input, skillsUsed) {
  const latest = latestPmText(input.pmMessages);
  const profile = classifyRequirement(latest);
  const assistant_message = profile.assistantMessage;
  const payload = {
    assistant_message,
    dsl_patch: {
      title: profile.title,
      candidate: true,
      confirmed: false
    },
    current_dsl_summary: {
      title: profile.title,
      goal: profile.goal,
      scope: profile.scope,
      out_of_scope: ["Agent Plan", "Agent Handoff", "代码执行", "后端真实改造"],
      acceptance_criteria: profile.acceptanceCriteria,
      unknowns: profile.unknowns
    },
    clarification: {
      should_ask: true,
      questions: [
        {
          question: profile.question,
          reason: "避免把候选口径误判为已确认需求。",
          target_fields: profile.targetFields,
          risk_factors: profile.riskFactors,
          priority: "p0"
        }
      ]
    },
    risk_boundary: {
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: "clarify_first",
      reasons: ["仍需 PM 确认候选验收口径", "不得进入 Agent Plan / Handoff / 代码执行"]
    },
    human_report_patch: {
      summary: profile.reportSummary,
      in_scope: profile.scope,
      out_of_scope: ["Agent Plan", "Agent Handoff", "代码执行", "后端真实发布"],
      risks: profile.risks,
      pending_confirmations: profile.unknowns,
      next_actions: ["等待 PM 确认后再更新 DSL draft"]
    },
    source: {
      mode: "mock",
      provider: "mock_model",
      skills_used: skillsUsed
    }
  };
  return JSON.stringify(payload);
}

function classifyRequirement(text) {
  if (/封面|cover|图片|图 URL|图片 URL|破图/i.test(text)) {
    return {
      title: "文章封面图字段与展示",
      goal: "在创建、编辑、列表卡片和详情页之间保持封面图 URL 的前后端/API/数据一致性。",
      assistantMessage: "我先把当前需求沉淀为候选 DSL：文章创建和编辑时允许填写封面图 URL，后端保存并在文章列表与详情接口返回，列表卡片和详情页展示封面图；封面图为空时隐藏图片区域或使用安全占位，不出现破图，也不影响原有发布、编辑、列表和详情流程。这里涉及前端展示、后端字段、API 返回和历史数据兼容，还不能直接 pass。还需要确认一个关键口径：封面图字段名和 URL 校验规则是否采用 `coverImage` + 可为空的合法 URL 校验？如果没有特别要求，我会先按空值不展示、非法 URL 不阻塞原流程来记录候选验收口径。",
      scope: ["文章创建/编辑填写封面图 URL", "后端保存并返回封面图字段", "列表卡片和详情页展示封面图", "空值不显示破图"],
      acceptanceCriteria: ["创建或编辑文章时可保存封面图 URL", "列表与详情接口返回同一封面图字段", "列表卡片和详情页展示封面图", "空值或缺失时不显示破图且不影响原流程"],
      unknowns: ["封面图字段名和 URL 校验规则是否采用默认候选口径"],
      question: "封面图字段名和 URL 校验规则是否采用 `coverImage` + 可为空的合法 URL 校验？如果没有特别要求，是否先按空值不展示、非法 URL 不阻塞原发布/编辑流程来处理？",
      targetFields: ["scope", "acceptance_criteria", "edge_cases", "api_contract"],
      riskFactors: ["cross_stack_contract", "backward_compatibility", "empty_url_handling"],
      risks: ["跨前端、后端、API 和数据存储，需要确认字段名、空值和兼容性口径。"],
      reportSummary: "候选需求：为文章增加封面图 URL 字段，并在创建、编辑、列表、详情链路中保持数据一致；空值不破图。"
    };
  }

  if (/推荐|相关内容|继续阅读|recommend/i.test(text)) {
    return {
      title: "文章详情页相关推荐",
      goal: "在文章阅读结束后展示相关内容推荐，引导用户继续阅读。",
      assistantMessage: "我先把当前需求沉淀为候选 DSL：用户读完文章后，在详情页末尾展示一组相关内容推荐，用于引导继续阅读；版本先保持简单，不进入 Agent Plan，也不把 CodeContext 当成产品决策来源。CodeContext 可以帮助判断现有文章字段和页面结构，但不能代替 PM 确认推荐规则。还需要确认一个关键口径：相关推荐优先按 tag/标签匹配，还是按作者、热门度或发布时间兜底？如果没有特别要求，我会先记录为“同 tag 优先，其次按发布时间取最新文章”。",
      scope: ["文章详情页末尾展示相关推荐", "优先使用简单推荐规则", "CodeContext 仅辅助判断现有字段"],
      acceptanceCriteria: ["读完文章后可看到相关内容推荐", "推荐规则有明确优先级", "无可推荐内容时页面不报错且不出现空壳模块"],
      unknowns: ["推荐规则优先级：tag、作者、热门度或发布时间"],
      question: "相关推荐优先按 tag/标签匹配，还是按作者、热门度或发布时间兜底？如果没有特别要求，是否先按同 tag 优先、再按发布时间取最新文章？",
      targetFields: ["scope", "acceptance_criteria", "test_oracle", "recommendation_rule"],
      riskFactors: ["ambiguous_recommendation_rule", "pm_decision_required"],
      risks: ["推荐规则属于 PM 口径，CodeContext 只能辅助判断，不能替代 PM 决策。"],
      reportSummary: "候选需求：文章详情页阅读结束后展示相关推荐，但推荐规则仍需 PM 确认。"
    };
  }

  if (/阅读|正文|字|分钟|read/i.test(text)) {
    return {
      title: "文章详情页阅读信息提示",
      goal: "在不修改后端和数据库的前提下展示阅读字数与预计时间。",
      assistantMessage: "我先按你的描述沉淀一个候选验收口径：有正文时，在文章详情页正文下方展示“本文共 XXX 字，预计阅读 X 分钟”；正文为空或缺失时隐藏该信息，页面不报错，不出现 NaN 或异常时间；本轮不涉及后端字段、数据库或接口变更。还需要确认一个产品口径：预计阅读时间按多少字/分钟计算？如果你没有特别要求，可以先按每分钟 400 个中文字估算。",
      scope: ["前端根据正文实时计算字数", "正文下方展示阅读信息", "空正文隐藏该信息"],
      acceptanceCriteria: ["有正文时展示“本文共 XXX 字，预计阅读 X 分钟”", "正文为空或缺失时隐藏阅读信息", "不出现 NaN、0 分钟等异常展示", "不新增后端字段、数据库或接口变更"],
      unknowns: ["预计阅读时间按多少字/分钟计算"],
      question: "预计阅读时间按多少字/分钟计算？如果没有特别要求，是否先按每分钟 400 个中文字估算？",
      targetFields: ["acceptance_criteria", "product_default", "test_oracle"],
      riskFactors: ["test_oracle_unclear"],
      risks: ["验收标准仍需人工确认"],
      reportSummary: "候选需求：文章详情页根据正文展示阅读字数与预计阅读时间，空正文隐藏，不改后端。"
    };
  }

  return {
    title: "PM 澄清需求候选 DSL",
    goal: "把 PM 补充转换为可审阅的 DSL 候选内容。",
    assistantMessage: "我先把你的补充整理成候选 DSL：优先明确用户可见结果、边界条件和不进入执行链路的安全约束。还需要你确认一条验收口径：用户在什么页面看到什么结果，以及哪些异常内容不应出现？如果没有特别要求，我会先给出保守默认建议供你确认。",
    scope: ["PM-to-DSL draft", "澄清问题生成"],
    acceptanceCriteria: ["PM 能理解候选范围", "缺失信息以默认建议加确认方式呈现"],
    unknowns: ["最终验收口径"],
    question: "是否接受当前候选验收口径，或需要调整页面、文案和异常展示？",
    targetFields: ["acceptance_criteria", "edge_cases", "test_oracle"],
    riskFactors: ["test_oracle_unclear"],
    risks: ["验收标准仍需人工确认"],
    reportSummary: "候选需求仍处于澄清阶段。"
  };
}

function parseModelJson(rawResponse) {
  if (typeof rawResponse === "object" && rawResponse !== null) return rawResponse;
  const text = String(rawResponse || "").trim();
  const jsonText = text.startsWith("```")
    ? text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
    : text;
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const extracted = extractJsonObjectText(jsonText);
    if (extracted) {
      try {
        return JSON.parse(extracted);
      } catch {
        // Fall through to the structured model_invalid_json error below.
      }
    }
    throw codedError("model_invalid_json", "Model response was not valid JSON", {
      preview: redactString(jsonText).slice(0, 300),
      reason: String(error.message || error)
    });
  }
}

function extractJsonObjectText(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function normalizeModelPayload(payload, skillNames, sourceDefaults = {}) {
  const source = payload.source || {};
  const summarySource = objectOrEmpty(payload.current_dsl_summary);
  const patchSource = objectOrEmpty(payload.dsl_patch);
  const summary = Object.keys(summarySource).length ? summarySource : patchSource;
  const sourceSkills = arrayOfStrings(source.skills_used);
  return {
    assistant_message: String(payload.assistant_message || ""),
    dsl_patch: {
      ...patchSource,
      candidate: patchSource.candidate !== false,
      confirmed: false
    },
    current_dsl_summary: {
      title: String(summary.title || ""),
      goal: String(summary.goal || ""),
      scope: arrayOfStrings(summary.scope),
      out_of_scope: arrayOfStrings(summary.out_of_scope),
      acceptance_criteria: arrayOfStrings(summary.acceptance_criteria),
      unknowns: arrayOfStrings(summary.unknowns)
    },
    clarification: {
      should_ask: payload.clarification?.should_ask !== false,
      questions: normalizeQuestions(payload.clarification?.questions, payload.clarification)
    },
    risk_boundary: objectOrEmpty(payload.risk_boundary),
    human_report_patch: {
      summary: String(payload.human_report_patch?.summary || [summary.title, summary.goal].filter(Boolean).join(": ") || ""),
      in_scope: arrayOfStrings(payload.human_report_patch?.in_scope).length
        ? arrayOfStrings(payload.human_report_patch.in_scope)
        : arrayOfStrings(summary.scope),
      out_of_scope: arrayOfStrings(payload.human_report_patch?.out_of_scope).length
        ? arrayOfStrings(payload.human_report_patch.out_of_scope)
        : arrayOfStrings(summary.out_of_scope),
      risks: arrayOfStrings(payload.human_report_patch?.risks).length
        ? arrayOfStrings(payload.human_report_patch.risks)
        : arrayOfStrings(payload.risk_boundary?.reasons),
      pending_confirmations: arrayOfStrings(payload.human_report_patch?.pending_confirmations).length
        ? arrayOfStrings(payload.human_report_patch.pending_confirmations)
        : arrayOfStrings(summary.unknowns),
      next_actions: arrayOfStrings(payload.human_report_patch?.next_actions).length
        ? arrayOfStrings(payload.human_report_patch.next_actions)
        : ["等待 PM 确认后再进入下一轮 DSL 更新"]
    },
    source: {
      ...source,
      ...sourceDefaults,
      mode: String(sourceDefaults.mode || source.mode || "model_generated"),
      provider: String(sourceDefaults.provider || source.provider || "model"),
      model: String(sourceDefaults.model || source.model || ""),
      skills_used: sourceSkills.length ? sourceSkills : skillNames
    }
  };
}

function repairOverPassIfNeeded(payload, input, skillNames) {
  if (["fallback", "fallback_guardrail", "slow_response"].includes(payload.source?.mode)) return payload;

  const mustRepair =
    payload.clarification?.should_ask === false ||
    !payload.clarification?.questions?.length ||
    Boolean(payload.risk_boundary?.ready_for_agent) ||
    Boolean(payload.risk_boundary?.can_handoff_to_agent) ||
    String(payload.risk_boundary?.handoff_decision || "") !== "clarify_first" ||
    hasDirectPassLanguage(payload.assistant_message);

  if (!mustRepair || !hasMissingCriticalFields(payload)) return payload;

  const question = buildGuardrailQuestion(input);
  const assistant = buildGuardrailAssistant(input, question);
  return {
    ...payload,
    assistant_message: assistant,
    clarification: {
      should_ask: true,
      questions: [{
        question,
        reason: "模型返回过早通过，但 DSL 关键字段仍未确认。",
        target_fields: ["scope", "acceptance_criteria", "edge_cases", "out_of_scope", "test_oracle"],
        risk_factors: ["over_pass_guardrail"],
        priority: "p0"
      }]
    },
    current_dsl_summary: {
      ...payload.current_dsl_summary,
      unknowns: arrayOfStrings(payload.current_dsl_summary?.unknowns).length
        ? payload.current_dsl_summary.unknowns
        : ["候选验收口径和边界仍需 PM 确认"]
    },
    human_report_patch: {
      ...payload.human_report_patch,
      risks: uniqueStrings([...(payload.human_report_patch?.risks || []), "模型过早 pass 已被本地 guardrail 拦截"]),
      pending_confirmations: uniqueStrings([...(payload.human_report_patch?.pending_confirmations || []), question])
    },
    risk_boundary: {
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: "clarify_first",
      reasons: ["DSL 关键字段仍缺确认", "本地 guardrail 阻止过早 pass"]
    },
    source: {
      ...(payload.source || {}),
      mode: "fallback_guardrail",
      provider: "local_overpass_guardrail",
      skills_used: payload.source?.skills_used?.length ? payload.source.skills_used : skillNames
    }
  };
}

function hasMissingCriticalFields(payload) {
  const summary = payload.current_dsl_summary || {};
  return !arrayOfStrings(summary.scope).length ||
    !arrayOfStrings(summary.acceptance_criteria).length ||
    !arrayOfStrings(summary.out_of_scope).length ||
    !arrayOfStrings(summary.unknowns).length;
}

function hasDirectPassLanguage(text) {
  return /需求已完成|已经生成\s*DSL|可以继续|没有新的高优先级|可以进入\s*Agent|ready/i.test(String(text || ""));
}

function buildGuardrailQuestion(input) {
  const latest = latestPmText(input.pmMessages);
  if (/封面|cover|URL|图片|破图/i.test(latest)) {
    return "请确认封面图字段名、URL 校验和空值展示是否采用当前候选口径，或需要调整哪一项？";
  }
  if (/推荐|相关内容|继续阅读/i.test(latest)) {
    return "请确认相关推荐优先按 tag/标签、作者、热门度还是发布时间来排序？";
  }
  if (/阅读|正文|分钟|字/i.test(latest)) {
    return "请确认预计阅读时间是否按每分钟 400 个中文字估算，或需要使用其他口径？";
  }
  return "请确认当前候选验收口径和边界是否正确，或是否需要调整一个关键点？";
}

function buildGuardrailAssistant(input, question) {
  const latest = latestPmText(input.pmMessages);
  const trimmed = latest.length > 80 ? `${latest.slice(0, 80)}...` : latest;
  return `我先把当前需求记录为候选 DSL：${trimmed}。这只是候选理解，还不能直接 pass，也不会交给执行链路。还需要确认一个关键口径：${question}`;
}

function enforceSafetyAndRedaction(payload, skillNames) {
  const assistant = payload.assistant_message.includes(RAW_EVPI_ACCEPTANCE_QUESTION)
    ? payload.assistant_message.replace(RAW_EVPI_ACCEPTANCE_QUESTION, "请确认候选验收口径是否覆盖用户可见结果和测试判断。")
    : payload.assistant_message;
  const riskBoundary = {
    ...payload.risk_boundary,
    ready_for_agent: false,
    can_handoff_to_agent: false,
    handoff_decision: "clarify_first",
    reasons: arrayOfStrings(payload.risk_boundary?.reasons).length
      ? arrayOfStrings(payload.risk_boundary.reasons)
      : ["Skill safety boundary keeps this turn in clarification."]
  };
  return redactSecrets({
    ...payload,
    assistant_message: assistant || "我已经整理出候选需求，但仍需要 PM 人工确认后才能继续。",
    dsl_patch: { ...payload.dsl_patch, candidate: true, confirmed: false },
    risk_boundary: riskBoundary,
    readiness: {
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: "clarify_first",
      reason: riskBoundary.reasons[0] || "仍需 PM 澄清"
    },
    source: {
      ...payload.source,
      skills_used: payload.source?.skills_used?.length ? payload.source.skills_used : skillNames
    }
  });
}

function enforceClarificationQuestionPolicy(payload, input) {
  const risk = payload.risk_boundary || {};
  const mustAsk = risk.ready_for_agent === false || String(risk.handoff_decision || "") === "clarify_first";
  if (!mustAsk) return payload;
  const progress = resolveClarificationProgress(input);
  if (progress.clarificationComplete) {
    return {
      ...payload,
      assistant_message: buildClarificationCompleteMessage(),
      clarification: {
        ...(payload.clarification || {}),
        should_ask: false,
        questions: [],
        currentQuestion: "",
        remainingQuestionCount: 0,
        askedQuestionCount: progress.answeredQuestionCount,
        answeredQuestionCount: progress.answeredQuestionCount,
        questionCount: 0,
        clarificationMode: progress.mode,
        coveredDimensions: progress.coveredDimensions,
        isFinalQuestion: false,
        clarificationComplete: true
      },
      risk_boundary: {
        ...(payload.risk_boundary || {}),
        ready_for_agent: false,
        can_handoff_to_agent: false,
        handoff_decision: "clarification_complete",
        reasons: uniqueStrings([
          ...arrayOfStrings(payload.risk_boundary?.reasons),
          "PM clarification reached design-planning readiness",
          "Agent execution remains gated"
        ]).slice(0, 8)
      },
      readiness: {
        ready_for_agent: false,
        can_handoff_to_agent: false,
        handoff_decision: "clarification_complete",
        reason: "clarification_complete_ready_for_design"
      },
      human_report_patch: {
        ...(payload.human_report_patch || {}),
        pending_confirmations: [],
        next_actions: ["继续丰富需求", "开始施工"]
      }
    };
  }

  const questions = normalizeClarificationQuestionList(payload.clarification?.questions, input, progress);
  const currentQuestion = questions[0]?.question || buildGuardrailQuestion(input);
  const questionCount = questions.length;
  const coveredDimensions = uniqueStrings(questions.map((question) => question.dimension)).slice(0, 8);
  return {
    ...payload,
    assistant_message: appendQuestionGroup(payload.assistant_message, questions, progress.mode),
    clarification: {
      ...(payload.clarification || {}),
      should_ask: true,
      questions,
      currentQuestion,
      remainingQuestionCount: 0,
      askedQuestionCount: questionCount,
      answeredQuestionCount: progress.answeredQuestionCount,
      questionCount,
      minQuestionCount: progress.mode === "refinement" ? REFINEMENT_QUESTIONS : INITIAL_MIN_QUESTIONS,
      maxQuestionCount: progress.mode === "refinement" ? REFINEMENT_QUESTIONS : INITIAL_MAX_QUESTIONS,
      clarificationMode: progress.mode,
      coveredDimensions,
      isFinalQuestion: progress.answeredQuestionCount + questionCount >= INITIAL_REQUIRED_ANSWERS,
      clarificationComplete: false
    },
    current_dsl_summary: {
      ...(payload.current_dsl_summary || {}),
      unknowns: uniqueStrings([
        ...arrayOfStrings(payload.current_dsl_summary?.unknowns),
        ...questions.map((question) => question.question)
      ]).slice(0, INITIAL_MAX_QUESTIONS)
    },
    human_report_patch: {
      ...(payload.human_report_patch || {}),
      pending_confirmations: uniqueStrings([
        ...arrayOfStrings(payload.human_report_patch?.pending_confirmations),
        ...questions.map((question) => question.question)
      ]).slice(0, INITIAL_MAX_QUESTIONS)
    }
  };
}

function applyDslCoreEvaluation(payload, input) {
  const dsl = payloadToRequirementDsl(payload);
  const core = evaluateDslCore({ pmText: latestPmText(input.pmMessages), dsl });
  const evpiQuestions = (core.evpi.ranked_questions || []).map((question) => ({
    question: question.question,
    reason: question.reason || "EVPI-lite clarification gate",
    suggested_default: "",
    target_fields: arrayOfStrings(question.target_fields),
    risk_factors: arrayOfStrings(question.factor_ids),
    priority: question.priority || "p1"
  }));
  const existingQuestions = Array.isArray(payload.clarification?.questions) ? payload.clarification.questions : [];
  const activeRisks = core.riskActivation.activated_risk_factors || [];

  return {
    ...payload,
    dsl_core: core,
    clarification: {
      ...(payload.clarification || {}),
      should_ask: core.evpi.clarification_gate.should_ask || payload.clarification?.should_ask !== false,
      questions: dedupeQuestions([...existingQuestions, ...evpiQuestions]).slice(0, INITIAL_MAX_QUESTIONS)
    },
    risk_boundary: {
      ...(payload.risk_boundary || {}),
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: "clarify_first",
      reasons: uniqueStrings([
        ...arrayOfStrings(payload.risk_boundary?.reasons),
        ...arrayOfStrings(core.scoring.blocking_reasons),
        "standalone DSL core requires PM clarification before Agent handoff"
      ]).slice(0, 8)
    },
    human_report_patch: {
      ...(payload.human_report_patch || {}),
      risks: uniqueStrings([
        ...arrayOfStrings(payload.human_report_patch?.risks),
        ...activeRisks.map((factor) => `${factor.factor_id}: ${factor.default_clarification_question}`)
      ]).slice(0, 8),
      pending_confirmations: uniqueStrings([
        ...arrayOfStrings(payload.human_report_patch?.pending_confirmations),
        ...evpiQuestions.map((item) => item.question)
      ]).slice(0, 8)
    },
    source: {
      ...(payload.source || {}),
      dslCore: "standalone_dsl_core_v0"
    }
  };
}

function payloadToRequirementDsl(payload) {
  const summary = payload.current_dsl_summary || {};
  return {
    title: String(summary.title || payload.dsl_patch?.title || "RequirementDSL draft"),
    summary: String(summary.goal || payload.human_report_patch?.summary || summary.title || "PM clarification draft"),
    requirements: arrayOfStrings(summary.scope || payload.human_report_patch?.in_scope),
    acceptance_criteria: arrayOfStrings(summary.acceptance_criteria),
    risks: arrayOfStrings(payload.human_report_patch?.risks || summary.unknowns),
    ready_for_agent: Boolean(payload.risk_boundary?.ready_for_agent),
    handoff_decision: String(payload.risk_boundary?.handoff_decision || "clarify_first"),
    scope: {
      in_scope: arrayOfStrings(summary.scope || payload.human_report_patch?.in_scope),
      out_of_scope: arrayOfStrings(summary.out_of_scope || payload.human_report_patch?.out_of_scope)
    }
  };
}

function dedupeQuestions(questions) {
  const seen = new Set();
  return questions.filter((question) => {
    const text = String(question?.question || question?.text || "").trim();
    const key = normalizeQuestionKey(text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeClarificationQuestionList(questions = [], input = {}, progress = resolveClarificationProgress(input)) {
  const mode = progress.mode || "initial";
  const targetCount = Number(progress.targetQuestionCount || (mode === "refinement" ? REFINEMENT_QUESTIONS : INITIAL_MIN_QUESTIONS));
  const maxCount = mode === "refinement" ? REFINEMENT_QUESTIONS : INITIAL_MAX_QUESTIONS;
  const askedKeys = extractAskedQuestionKeys(input);
  const existing = (Array.isArray(questions) ? questions : [])
    .map((question, index) => normalizeQuestionItem(question, index))
    .filter((question) => question.question)
    .filter((question) => !askedKeys.has(normalizeQuestionKey(question.question)));
  const fallback = buildNaturalQuestionBank(input);
  const fallbackStart = Math.min(progress.nextQuestionIndex, Math.max(0, fallback.length - 1));
  const orderedFallback = [...fallback.slice(fallbackStart), ...fallback.slice(0, fallbackStart)];
  const candidates = dedupeQuestions([
    ...(shouldPreferCanonicalQuestionSequence(input) ? orderedFallback : existing),
    ...(shouldPreferCanonicalQuestionSequence(input) ? existing : orderedFallback)
  ])
    .map((question, index) => normalizeQuestionItem(question, index))
    .filter((question) => !askedKeys.has(normalizeQuestionKey(question.question)));
  const selected = selectQuestionGroup(candidates, targetCount, maxCount);
  return selected.map((question, index) => ({
    ...question,
    priority: index === 0 ? "p0" : (question.priority || "p1")
  }));
}

function normalizeQuestionItem(question, index) {
  if (typeof question === "string") {
    return {
      question: ensureQuestionMark(question),
      reason: "",
      suggested_default: "",
      target_fields: [],
      risk_factors: [],
      priority: index === 0 ? "p0" : "p1",
      dimension: "scope"
    };
  }
  const targetFields = arrayOfStrings(question?.target_fields);
  const riskFactors = arrayOfStrings(question?.risk_factors || question?.factor_ids);
  return {
    question: ensureQuestionMark(String(question?.question || question?.text || "")),
    reason: String(question?.reason || ""),
    suggested_default: String(question?.suggested_default || question?.suggestedDefault || ""),
    target_fields: targetFields,
    risk_factors: riskFactors,
    priority: String(question?.priority || (index === 0 ? "p0" : "p1")).toLowerCase(),
    dimension: normalizeQuestionDimension(question?.dimension || targetFields[0] || riskFactors[0] || "")
  };
}

function buildNaturalQuestionBank(input = {}) {
  const latest = latestPmText(input.pmMessages);
  const conversation = conversationText(input.pmMessages);
  const lower = `${conversation}\n${latest}`.toLowerCase();
  if (isViewCountClarification(input)) {
    return questionBank([
      ["你要统计的是每篇文章的累计总浏览量，还是还需要今日浏览量、实时浏览量等额外指标?", ["data_boundary"]],
      ["浏览量是否需要去重? 例如同一用户 24 小时内多次访问同一篇文章是否只算 1 次?", ["data_boundary"]],
      ["未登录用户是否也统计浏览量? 如果统计，按 IP、设备还是 session 归并?", ["permission_boundary"]],
      ["如果浏览量接口失败或统计异常，文章页应该隐藏该数据、显示 0，还是显示加载失败提示?", ["failure_case"]],
      ["验收时要看到哪些现象或数据，才能证明统计口径和去重规则生效?", ["acceptance_criteria"]]
    ]);
  }
  if (/login|登录|账号|账户|密码|失败|错误|锁定|找回/.test(lower)) {
    return questionBank([
      ["你希望覆盖哪些登录失败场景，比如密码错误、账号不存在、账号锁定、网络异常？", ["core_scenario", "failure_case"]],
      ["用户看到提示后，下一步动作应该是什么，比如重试、找回密码、联系客服？", ["copy", "expected_outcome"]],
      ["这次只优化登录失败提示，还是也包含注册、找回密码、账号锁定页面？", ["out_of_scope"]],
      ["验收时你希望用哪些标准判断这个需求完成？", ["acceptance_criteria"]],
      ["提示文案里是否需要避免泄露账号是否存在、账号状态等安全信息？", ["security_boundary"]],
      ["不同失败原因是否需要拆成多个需求分别处理？", ["split_requirement"]]
    ]);
  }
  if (/recommend|推荐|相关内容|继续阅读|tag|标签/.test(lower)) {
    return questionBank([
      ["你希望推荐内容主要服务哪些用户和阅读场景？", ["target_user", "core_scenario"]],
      ["推荐排序优先按标签、作者、热度、发布时间，还是由 PM 指定一套规则？", ["ranking_rule"]],
      ["没有相关内容或数据不足时，页面应该隐藏模块还是展示兜底内容？", ["failure_case"]],
      ["这次只做文章详情页推荐，还是也包含列表页、首页或其他入口？", ["out_of_scope"]],
      ["验收时你希望用哪些用户可见结果判断推荐模块完成？", ["acceptance_criteria"]],
      ["推荐逻辑是否涉及权限、下架内容或不可见内容过滤？", ["permission_boundary"]]
    ]);
  }
  if (/阅读|正文|字|分钟|article|reading/.test(lower)) {
    return questionBank([
      ["这个阅读提示主要面向哪些用户和阅读场景？", ["target_user", "core_scenario"]],
      ["预计阅读时间希望按多少字每分钟计算？", ["copy", "acceptance_criteria"]],
      ["正文为空、加载失败或内容很短时应该怎么展示？", ["failure_case"]],
      ["这次只在文章详情页展示，还是也包含列表卡片、分享页等位置？", ["out_of_scope"]],
      ["验收时你希望检查哪些可见结果，比如字数、分钟数和异常兜底？", ["acceptance_criteria"]],
      ["是否需要后端保存该信息，还是仅前端实时计算？", ["data_boundary"]]
    ]);
  }
  const genericQuestions = [
    ["用户会在什么核心场景下使用这个功能？", ["core_scenario"]],
    ["有哪些失败、异常或空状态需要一起处理？", ["failure_case"]],
    ["这次明确不做哪些范围，避免需求被放大？", ["out_of_scope"]],
    ["验收时你希望用哪些标准判断这个需求完成？", ["acceptance_criteria"]],
    ["这个需求是否涉及数据、权限或安全边界？", ["data_security_boundary"]]
  ];
  if (/目标用户|用户群|角色|受众|audience|persona|target\s*user|user\s*group/.test(lower)) {
    genericQuestions.push(["这个需求主要服务哪些目标用户？", ["target_user"]]);
  }
  return questionBank(genericQuestions);
}

function questionBank(items) {
  return items.map(([question, targetFields], index) => ({
    question,
    reason: "补齐 RequirementDSL 澄清所需的 PM 可回答信息。",
    suggested_default: "",
    target_fields: targetFields,
    risk_factors: ["clarification_gap"],
    priority: index === 0 ? "p0" : "p1",
    dimension: normalizeQuestionDimension(targetFields?.[0] || "")
  }));
}

function selectQuestionGroup(candidates, minCount, maxCount) {
  const selected = [];
  const selectedKeys = new Set();
  const selectedDimensions = new Set();
  const add = (question) => {
    const key = normalizeQuestionKey(question?.question || "");
    if (!key || selectedKeys.has(key) || selected.length >= maxCount) return false;
    selected.push(question);
    selectedKeys.add(key);
    selectedDimensions.add(question.dimension);
    return true;
  };

  for (const question of candidates) {
    if (selected.length >= minCount) break;
    if (!selectedDimensions.has(question.dimension)) add(question);
  }
  for (const question of candidates) {
    if (selected.length >= minCount) break;
    add(question);
  }
  return selected.slice(0, maxCount);
}

function extractAskedQuestionKeys(input = {}) {
  const keys = new Set();
  for (const text of extractAskedQuestionTexts(input)) {
    keys.add(normalizeQuestionKey(text));
  }
  return keys;
}

function extractAskedQuestionTexts(input = {}) {
  const questions = [];
  for (const message of Array.isArray(input.pmMessages) ? input.pmMessages : []) {
    const role = String(message?.role || "");
    if (!["system", "system_clarification", "assistant"].includes(role)) continue;
    questions.push(...extractQuestionTextsFromContent(message?.content || message?.text || ""));
  }
  return uniqueStrings(questions);
}

function extractQuestionTextsFromContent(content) {
  const questions = [];
  for (const segment of String(content || "").split(/\r?\n|(?:\d+\.\s*)/)) {
    const text = segment.trim();
    if (/[?？]$/.test(text)) questions.push(text);
  }
  return questions;
}

function normalizeQuestionDimension(value) {
  const text = String(value || "").toLowerCase();
  if (["target_user", "core_scenario", "ranking_rule", "expected_outcome", "split_requirement"].includes(text)) return "behavior";
  if (["failure_case", "empty_state", "state", "state_error"].includes(text)) return "state_error";
  if (["data_boundary", "data_security_boundary", "security_boundary"].includes(text)) return "data";
  if (["permission_boundary"].includes(text)) return "permission";
  if (["acceptance_criteria", "acceptance", "oracle", "acceptance_oracle"].includes(text)) return "acceptance_oracle";
  if (["edge_case"].includes(text)) return "edge_case";
  if (["implementation_boundary"].includes(text)) return "implementation_boundary";
  if (["scope", "out_of_scope"].includes(text)) return "scope";
  if (/object|page|button|entry|target/.test(text)) return "object";
  if (/behavior|rule|ranking|expected|outcome|scenario|core/.test(text)) return "behavior";
  if (/state|failure|error|empty|loading/.test(text)) return "state_error";
  if (/data|persist|dedup|count|database/.test(text)) return "data";
  if (/permission|security|auth|role/.test(text)) return "permission";
  if (/copy|message|wording|hint/.test(text)) return "copy_ui";
  if (/acceptance|test|oracle|criteria/.test(text)) return "acceptance_oracle";
  if (/edge|exception/.test(text)) return "edge_case";
  if (/implementation|api|backend|frontend|boundary|contract/.test(text)) return "implementation_boundary";
  if (/scope|out_of_scope|split/.test(text)) return "scope";
  return "scope";
}

function appendQuestionGroup(message, questions, mode = "initial") {
  const base = String(message || "我已经整理出候选需求，但仍需要 PM 人工确认后才能继续。")
    .split("我还需要确认几个问题：")[0]
    .split("我先从几个不同方向确认一下：")[0]
    .split("我再补充确认两个不同方向的问题：")[0]
    .split("我先确认一个关键口径：")[0]
    .split("我再补充确认一个问题：")[0]
    .split("还需要确认一个关键口径：")[0]
    .trim();
  const heading = mode === "refinement"
    ? "我再补充确认一个问题："
    : questions.length > 1
      ? "我先从几个不同方向确认一下:"
      : "我先确认一个关键口径：";
  const list = questions.map((question, index) => `${index + 1}. ${ensureQuestionMark(question.question || question)}`).join("\n");
  return `${base}\n\n${heading}\n${list}`;
}

function buildClarificationCompleteMessage() {
  return "当前需求已经具备进入设计规划的基础信息。你可以继续丰富需求，也可以开始施工。";
}

function resolveClarificationProgress(input = {}) {
  const messages = Array.isArray(input.pmMessages) ? input.pmMessages : [];
  const latestRole = String(messages[messages.length - 1]?.role || "");
  const askedQuestionCount = extractAskedQuestionTexts(input).length;
  const mode = input.refinementRequested ? "refinement" : "initial";
  const answered = resolveAnsweredQuestionProgress(input);
  const coveredDimensions = uniqueStrings(answered.dimensions);
  const answeredQuestionCount = answered.count;
  const clarificationComplete = !input.refinementRequested &&
    latestRole === "pm" &&
    answeredQuestionCount >= INITIAL_REQUIRED_ANSWERS &&
    coveredDimensions.length >= INITIAL_REQUIRED_DIMENSIONS;
  const initialTargetCount = answeredQuestionCount === 0 && askedQuestionCount === 0
    ? INITIAL_MIN_QUESTIONS
    : REFINEMENT_QUESTIONS;
  const targetCount = mode === "refinement" ? REFINEMENT_QUESTIONS : initialTargetCount;
  return {
    mode,
    answeredQuestionCount,
    askedQuestionCount: clarificationComplete ? answeredQuestionCount : targetCount,
    remainingQuestionCount: Math.max(0, INITIAL_REQUIRED_ANSWERS - answeredQuestionCount),
    isFinalQuestion: answeredQuestionCount + targetCount >= INITIAL_REQUIRED_ANSWERS,
    clarificationComplete,
    coveredDimensions,
    targetQuestionCount: targetCount,
    nextQuestionIndex: Math.min(askedQuestionCount, Math.max(0, buildNaturalQuestionBank(input).length - 1))
  };
}

function resolveAnsweredQuestionProgress(input = {}) {
  const pendingDimensions = [];
  let answeredTurns = 0;
  const dimensions = [];
  for (const message of Array.isArray(input.pmMessages) ? input.pmMessages : []) {
    const role = String(message?.role || "");
    if (["system", "system_clarification", "assistant"].includes(role)) {
      for (const question of extractQuestionTextsFromContent(message?.content || message?.text || "")) {
        const dimension = resolveQuestionDimension(question, input);
        pendingDimensions.push(dimension);
      }
      continue;
    }
    if (role === "pm" && pendingDimensions.length) {
      answeredTurns += 1;
      dimensions.push(...pendingDimensions);
      pendingDimensions.length = 0;
    }
  }
  return { count: answeredTurns, dimensions: uniqueStrings(dimensions) };
}

function resolveQuestionDimension(question, input = {}) {
  const key = normalizeQuestionKey(question);
  const bankQuestion = buildNaturalQuestionBank(input).find((item) => normalizeQuestionKey(item.question) === key);
  if (bankQuestion?.dimension) return bankQuestion.dimension;
  if (/未登录|登录|权限|角色|auth|permission|role/i.test(question)) return "permission";
  if (/失败|异常|空状态|加载|error|failure|empty/i.test(question)) return "state_error";
  if (/验收|证明|测试|criteria|oracle|acceptance/i.test(question)) return "acceptance_oracle";
  if (/数据|统计|去重|累计|实时|今日|浏览量|count|dedup|data/i.test(question)) return "data";
  if (/范围|页面|详情|列表|模块|scope|page/i.test(question)) return "scope";
  return "behavior";
}

function ensureQuestionMark(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return /[?？]$/.test(trimmed) ? trimmed : `${trimmed}？`;
}

function normalizeQuestionKey(text) {
  return String(text || "").replace(/\s+/g, "").replace(/[?？。,.，、]/g, "").toLowerCase();
}

function invalidJsonSkillPayload(input, skillNames, error) {
  return {
    assistant_message: `模型返回内容不是有效 JSON，本轮只保留安全 guardrail，不会进入 Agent Plan、Handoff 或代码执行。请稍后重试真实模型生成。原因：${String(error.message || error)}`,
    dsl_patch: { candidate: true, confirmed: false },
    current_dsl_summary: {
      title: "模型 JSON 解析 guardrail",
      goal: latestPmText(input.pmMessages),
      scope: [],
      out_of_scope: ["Agent Plan", "Agent Handoff", "代码执行"],
      acceptance_criteria: [],
      unknowns: ["真实模型输出需重新生成并通过 JSON schema 校验"]
    },
    clarification: {
      should_ask: true,
      questions: [{
        question: "是否重试本轮真实模型生成，并继续保持当前需求只在澄清阶段？",
        reason: "模型返回内容无法解析为结构化 DSL turn。",
        target_fields: ["model_response_schema"],
        risk_factors: ["model_invalid_json"],
        priority: "p0"
      }]
    },
    risk_boundary: {
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: "clarify_first",
      reasons: ["model_invalid_json", "fallback guardrail only"]
    },
    human_report_patch: {
      summary: "模型输出不是有效 JSON，本轮仅生成 guardrail 记录。",
      in_scope: [],
      out_of_scope: ["Agent Plan", "Agent Handoff", "代码执行"],
      risks: ["模型输出无法解析"],
      pending_confirmations: ["重试真实模型生成"],
      next_actions: ["检查模型输出格式后重试"]
    },
    source: {
      mode: "fallback_guardrail",
      provider: "local_json_guardrail",
      errorCode: "model_invalid_json",
      error: String(error.message || error),
      skills_used: skillNames
    }
  };
}

function fallbackSkillPayload(input, skillNames, error) {
  return {
    assistant_message: `暂时无法完成模型编排，本轮仅保留安全 fallback：我已记录你的 PM 补充，但不会进入 Agent Plan、Handoff 或代码执行。请稍后重试模型生成。原因：${String(error.message || error)}`,
    dsl_patch: { candidate: true, confirmed: false },
    current_dsl_summary: {
      title: "模型编排 fallback",
      goal: latestPmText(input.pmMessages),
      scope: [],
      out_of_scope: ["Agent Plan", "Agent Handoff", "代码执行"],
      acceptance_criteria: [],
      unknowns: ["模型生成失败，需人工确认"]
    },
    clarification: { should_ask: true, questions: [] },
    risk_boundary: {
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: "clarify_first",
      reasons: ["model generation failed", "fallback only"]
    },
    human_report_patch: {
      summary: "模型编排失败，本轮仅生成 fallback 记录。",
      in_scope: [],
      out_of_scope: ["Agent Plan", "Agent Handoff", "代码执行"],
      risks: ["模型生成失败"],
      pending_confirmations: ["重新执行 skill turn"],
      next_actions: ["检查模型服务后重试"]
    },
    source: {
      mode: "fallback_guardrail",
      provider: "local_safety_fallback",
      errorCode: String(error.code || "skill_turn_failed"),
      skills_used: skillNames
    }
  };
}

function slowResponseSkillPayload(input, skillNames, error) {
  const question = buildGuardrailQuestion(input);
  return {
    assistant_message: `我已经收到你的补充，并先按候选 DSL 记录下来；本轮模型响应超过快速澄清时限，所以先返回安全 fallback，不会进入 Agent Plan、Handoff 或代码执行。还需要确认一个关键口径：${question}`,
    dsl_patch: { candidate: true, confirmed: false },
    current_dsl_summary: {
      title: "快速澄清 slow response fallback",
      goal: latestPmText(input.pmMessages),
      scope: ["PM-to-DSL fast turn fallback"],
      out_of_scope: ["Agent Plan", "Agent Handoff", "代码执行"],
      acceptance_criteria: ["PM-facing 回复不等待完整 runner", "超时后仍返回结构化澄清问题"],
      unknowns: [question]
    },
    clarification: {
      should_ask: true,
      questions: [{
        question,
        reason: "fast skill turn 超过时限，先用本地安全兜底保留澄清节奏。",
        target_fields: ["acceptance_criteria", "test_oracle"],
        risk_factors: ["slow_skill_turn"],
        priority: "p0"
      }]
    },
    risk_boundary: {
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: "clarify_first",
      reasons: ["fast skill turn timed out", "fallback keeps clarification boundary"]
    },
    human_report_patch: {
      summary: "fast skill turn 超时，已返回结构化 slow_response fallback。",
      in_scope: ["快速澄清 fallback"],
      out_of_scope: ["Agent Plan", "Agent Handoff", "代码执行"],
      risks: ["模型响应超过快速澄清时限"],
      pending_confirmations: [question],
      next_actions: ["等待 PM 确认后继续更新 DSL draft"]
    },
    source: {
      mode: "slow_response",
      provider: "local_latency_guard",
      latencyMs: normalizeLatencyMs(input.maxLatencyMs),
      skills_used: skillNames,
      error: String(error.message || error)
    }
  };
}

function skillPayloadToUiState(payload) {
  const summary = payload.current_dsl_summary || {};
  const report = payload.human_report_patch || {};
  const rawScore = Number(payload.dsl_core?.scoring?.rawScore ?? 78);
  const displayScore = resolveDisplayScoreForClarification(rawScore, payload.clarification);
  const coreRisks = payload.dsl_core?.riskActivation?.activated_risk_factors || [];
  const clarificationComplete = Boolean(payload.clarification?.clarificationComplete);
  return {
    dslCompletion: {
      rawScore,
      displayScore,
      value: displayScore,
      source: "skill_orchestrated_model",
      displayNote: "clarification stage display score: rawScore is preserved"
    },
    readiness: {
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: clarificationComplete ? "clarification_complete" : "clarify_first",
      source: "skill_safety_boundary"
    },
    clarification: {
      clarificationMode: payload.clarification?.clarificationMode || "initial",
      questionCount: Number(payload.clarification?.questionCount || payload.clarification?.questions?.length || 0),
      minQuestionCount: Number(payload.clarification?.minQuestionCount || INITIAL_MIN_QUESTIONS),
      maxQuestionCount: Number(payload.clarification?.maxQuestionCount || INITIAL_MAX_QUESTIONS),
      remainingQuestionCount: Number(payload.clarification?.remainingQuestionCount || 0),
      askedQuestionCount: Number(payload.clarification?.askedQuestionCount || payload.clarification?.questions?.length || 0),
      answeredQuestionCount: Number(payload.clarification?.answeredQuestionCount || 0),
      coveredDimensions: arrayOfStrings(payload.clarification?.coveredDimensions),
      questions: normalizeQuestions(payload.clarification?.questions, payload.clarification),
      currentQuestion: String(payload.clarification?.currentQuestion || ""),
      clarificationComplete
    },
    risks: (coreRisks.length ? coreRisks.map((risk) => risk.factor_id) : (report.risks?.length ? report.risks : ["验收标准仍需人工确认"])).slice(0, 4).map((risk, index) => ({
      priority: index === 0 ? "P0" : "P1",
      key: coreRisks[index]?.factor_id || (index === 0 ? "test_oracle_unclear" : `skill_risk_${index + 1}`),
      description: coreRisks[index]?.default_clarification_question || risk,
      impact: "中高影响",
      category: coreRisks[index]?.category || "skill_boundary"
    })),
    recommendedQuestion: {
      title: "Skill 生成澄清建议",
      text: payload.clarification?.questions?.[0]?.question || "请确认候选验收口径是否可接受。",
      reason: payload.clarification?.questions?.[0]?.reason || "由 skill orchestration 生成。",
      source: "skill_model",
      questionKey: "skill_generated_clarification"
    },
    humanReport: {
      summary: {
        title: summary.title || "Skill-driven RequirementDSL draft",
        text: report.summary || summary.goal || "Skill model 已生成候选需求摘要。",
        status: "需要澄清",
        source: payload.source?.mode || "model_generated"
      },
      scope: {
        inScope: report.in_scope?.length ? report.in_scope : summary.scope || [],
        outOfScope: report.out_of_scope?.length ? report.out_of_scope : summary.out_of_scope || []
      },
      riskCards: [
        { title: "候选验收标准", points: summary.acceptance_criteria?.length ? summary.acceptance_criteria : ["等待 PM 确认候选验收口径"] },
        { title: "为什么暂不能 handoff", points: payload.risk_boundary?.reasons || ["ready_for_agent=false", "handoff_decision=clarify_first"] },
        { title: "下一步建议", points: report.next_actions?.length ? report.next_actions : ["等待 PM 确认后继续更新 DSL"] }
      ],
      note: "由 Skill-driven model turn 生成；本地规则仅做安全边界与脱敏校验。"
    },
    coverageItems: {
      covered: summary.scope?.slice(0, 5) || [],
      pending: (report.pending_confirmations?.length ? report.pending_confirmations : summary.unknowns || []).slice(0, 5)
    },
    reportQuality: [
      { label: "可读性", value: 90 },
      { label: "边界清晰度", value: 86 },
      { label: "验收完整度", value: 76, tone: "warn" },
      { label: "风险覆盖", value: 82, tone: "pass" }
    ],
    boundaries: {
      agentPlanGenerated: false,
      agentHandoffEntered: false,
      codeExecutionEntered: false,
      postEvalEntered: false
    }
  };
}

function resolveDisplayScoreForClarification(rawScore, clarification = {}) {
  const rounded = Number.isFinite(Number(rawScore)) ? Math.round(Number(rawScore)) : 58;
  if (clarification?.clarificationComplete) return clamp(rounded, 86, 94);
  return clamp(rounded, 0, 84);
}

function normalizePmMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: String(message.role || "pm"),
      content: String(message.content || message.text || "").trim()
    }))
    .filter((message) => message.content);
}

function normalizeQuestions(questions, clarification = {}) {
  const sourceQuestions = Array.isArray(questions) && questions.length
    ? questions
    : clarification?.question
      ? [{
        question: clarification.question,
        reason: clarification.reason,
        suggested_default: clarification.suggested_default,
        target_fields: clarification.target_fields,
        risk_factors: clarification.risk_factors,
        priority: clarification.priority,
        dimension: clarification.dimension
        }]
      : [];
  return sourceQuestions.slice(0, INITIAL_MAX_QUESTIONS).map((question, index) => ({
    question: String(question.question || question.text || ""),
    reason: String(question.reason || ""),
    suggested_default: String(question.suggested_default || question.suggestedDefault || ""),
    target_fields: arrayOfStrings(question.target_fields),
    risk_factors: arrayOfStrings(question.risk_factors || question.factor_ids),
    priority: String(question.priority || (index === 0 ? "p0" : "p1")).toLowerCase(),
    dimension: normalizeQuestionDimension(question.dimension || question.target_fields?.[0] || question.factor_ids?.[0] || "")
  }));
}

function latestPmText(messages) {
  return [...(messages || [])].reverse().find((message) => message.role === "pm")?.content || "";
}

function conversationText(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => String(message?.content || message?.text || ""))
    .join("\n");
}

function isViewCountClarification(input = {}) {
  return /浏览量|浏览|访问量|view\s*count|views/.test(conversationText(input.pmMessages).toLowerCase());
}

function shouldPreferCanonicalQuestionSequence(input = {}) {
  return isViewCountClarification(input);
}

function latestRawPmText(messages) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => String(message?.role || "pm") === "pm")?.content || "";
}

function hasClarificationQuestionContext(messages) {
  return (Array.isArray(messages) ? messages : []).some((message) => {
    const role = String(message?.role || "");
    if (!["system", "system_clarification", "assistant"].includes(role)) return false;
    const content = String(message?.content || message?.text || "");
    return Boolean(content.trim());
  });
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayOfStrings(value) {
  return (Array.isArray(value) ? value : []).map((item) => String(item)).filter(Boolean);
}

function uniqueStrings(value) {
  return [...new Set(arrayOfStrings(value))];
}

function truncateText(value, limit = 200) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3))}...` : text;
}

function normalizeLatencyMs(...values) {
  const candidate = values.map((value) => Number(value)).find((value) => Number.isFinite(value) && value > 0);
  return candidate || DEFAULT_FAST_SKILL_TIMEOUT_MS;
}

function firstPositiveNumber(...values) {
  return values.map((value) => Number(value)).find((value) => Number.isFinite(value) && value > 0) || 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function errorPayload(code, message, details) {
  return {
    ok: false,
    data: null,
    error: redactSecrets({ code, message, details })
  };
}

function inputGatedSkillPayload(intent, latestInput) {
  const assistant = buildInputGateReply(intent, latestInput);
  const data = redactSecrets({
    runId: "",
    outputDir: "",
    relativeOutputDir: "",
    status: "input_gated",
    intent,
    skipDslGeneration: true,
    assistant_message: assistant,
    dsl_patch: { candidate: false, confirmed: false },
    current_dsl_summary: {
      title: "",
      goal: "",
      scope: [],
      out_of_scope: [],
      acceptance_criteria: [],
      unknowns: []
    },
    clarification: {
      should_ask: intent !== "greeting",
      questions: intent === "ambiguous_requirement"
        ? [{
            question: assistant,
            reason: "PM input is too broad to form a RequirementDSL candidate.",
            target_fields: ["target_user", "scenario", "expected_outcome"],
            risk_factors: ["ambiguous_requirement"],
            priority: "p0"
          }]
        : []
    },
    risk_boundary: {
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: "clarify_first",
      reasons: ["local_input_gate", intent]
    },
    readiness: {
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: "clarify_first",
      reason: "local_input_gate"
    },
    human_report_patch: {
      summary: "",
      in_scope: [],
      out_of_scope: [],
      risks: [],
      pending_confirmations: intent === "ambiguous_requirement" ? [assistant] : [],
      next_actions: [assistant]
    },
    source: {
      mode: "local_input_gate",
      provider: "local_rule",
      client: "none",
      model: "",
      skills_used: []
    },
    uiState: {
      dslCompletion: { value: 0, source: "local_input_gate" },
      readiness: {
        ready_for_agent: false,
        can_handoff_to_agent: false,
        handoff_decision: "clarify_first",
        source: "local_input_gate"
      },
      risks: [],
      recommendedQuestion: null,
      humanReport: {
        summary: {
          title: "",
          text: "",
          status: "input_gated",
          source: "local_input_gate"
        },
        scope: { inScope: [], outOfScope: [] },
        riskCards: [],
        note: "Local input gate stopped DSL generation before any model or artifact run."
      },
      coverageItems: { covered: [], pending: [] },
      reportQuality: [],
      boundaries: {
        agentPlanGenerated: false,
        agentHandoffEntered: false,
        codeExecutionEntered: false,
        postEvalEntered: false
      }
    }
  });
  return { ok: true, data, error: null };
}
