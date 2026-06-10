import { FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  cancelDslRun,
  createSkillPmDslTurn,
  getDslRun,
  getDslRunArtifacts,
  retryDslRun,
  startDslRun
} from "../api/dslClient.js";
import { emptyUiState, fallbackUiState } from "../adapters/dslArtifactAdapter.js";
import {
  createClarification,
  createRequirement,
  getRequirement,
  listClarifications,
  listRequirements,
  upsertDesignPlan,
  updateRequirement
} from "../api/persistenceClient.js";
import ClarificationChat from "./ClarificationChat.jsx";
import DSLStatusConsole from "./DSLStatusConsole.jsx";
import RequirementReportModal from "./RequirementReportModal.jsx";
import { dslTask } from "../data/dslWorkbenchData.js";
import {
  applyClarificationDedupToUiState,
  normalizeQuestionKey
} from "../utils/clarificationDedup.js";
import {
  buildInputGateReply,
  detectInputIntent,
  shouldGateInputIntent
} from "../utils/inputIntentGate.js";

const CLARIFICATION_COMPLETE_MESSAGE = "当前需求已经具备进入设计规划的基础信息。你可以继续丰富需求，也可以开始施工。";

const createInitialRunState = () => ({
  runId: "",
  status: "idle",
  skillStatus: "idle",
  skillSourceMode: "",
  skillModel: "",
  skillClient: "",
  skillProvider: "",
  outputDir: "",
  relativeOutputDir: "",
  realDslEnabled: true,
  artifacts: {},
  error: null
});

export default function DSLWorkbench({
  activeProject,
  activeRequirement,
  onRequirementChange,
  requirementError,
  toast,
  onToast,
  onStartConstruction
}) {
  const [messages, setMessages] = useState([]);
  const [loadedRequirement, setLoadedRequirement] = useState(activeRequirement || null);
  const [inputGateActive, setInputGateActive] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [uiState, setUiState] = useState(() => emptyUiState());
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isPartialOpen, setIsPartialOpen] = useState(false);
  const [partialArtifacts, setPartialArtifacts] = useState(null);
  const pollRef = useRef("");
  const longStageRef = useRef("");
  const [runState, setRunState] = useState(() => createInitialRunState());

  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    let active = true;
    const projectId = activeProject?.id;
    stopPolling();
    setLoadedRequirement(null);
    setMessages([]);
    setInputGateActive(false);
    setUiState(emptyUiState());
    setRunState(createInitialRunState());
    if (!projectId) return () => {
      active = false;
    };
    const sameProjectRequirement = activeRequirement?.id && String(activeRequirement.projectId || "") === String(projectId);
    const requirementPromise = sameProjectRequirement
      ? getRequirement(activeRequirement.id)
      : listRequirements(projectId).then((requirements) => Array.isArray(requirements) && requirements[0]?.id
        ? getRequirement(requirements[0].id)
        : null);

    setHistoryError("");
    requirementPromise
      .then(async (requirements) => {
        if (!active) return;
        const latest = requirements;
        if (latest?.id && String(latest.projectId || "") !== String(projectId)) return;
        setLoadedRequirement(latest);
        onRequirementChange?.(latest);
        if (!latest?.id) {
          setMessages([]);
          setUiState(emptyUiState());
          setRunState(createInitialRunState());
          return;
        }
        const turns = await listClarifications(latest.id).catch((error) => {
          setHistoryError(error.message || "澄清历史加载失败");
          return [];
        });
        if (!active) return;
        if (Array.isArray(turns) && turns.length > 0) {
          setMessages(turns.map((turn, index) => ({
            id: turn.id,
            author: turn.role === "pm" ? "PM" : "系统澄清",
            role: turn.role === "assistant" ? "system" : turn.role,
            time: "历史",
            text: turn.content,
            persisted: true,
            order: index
          })));
        } else {
          setMessages([]);
        }
        setUiState((current) => requirementToUiState(current, latest));
      })
      .catch((error) => {
        if (!active) return;
        setHistoryError(error.message || "需求 API 加载失败");
      });
    return () => {
      active = false;
    };
  }, [activeProject?.id]);

  const stopPolling = () => {
    pollRef.current = "";
  };

  const handleSendAnswer = async (text) => {
    const trimmedText = String(text || "").trim();
    if (!trimmedText) return;
    const pmMessage = {
      id: `pm-${Date.now()}-${messages.length}`,
      author: "PM",
      role: "pm",
      time: "刚刚",
      text: trimmedText
    };
    const nextMessages = trimmedText ? [...messages, pmMessage] : messages;
    const intent = detectInputIntent(trimmedText);
    const hasClarificationContext = hasActiveClarificationContext(messages, loadedRequirement, runState);
    if (shouldGateInputIntent(intent) && !hasClarificationContext) {
      setInputGateActive(true);
      const assistantText = buildInputGateReply(intent, trimmedText);
      setMessages([
        ...nextMessages,
        systemMessage(assistantText, nextMessages.length, {
          kind: "input_gate",
          intent
        })
      ]);
      setUiState((current) => ({
        ...current,
        dslCompletion: { value: 0, source: "local_input_gate" },
        readiness: {
          ready_for_agent: false,
          can_handoff_to_agent: false,
          handoff_decision: "clarify_first",
          source: "local_input_gate"
        },
        humanReport: {
          ...(current.humanReport || {}),
          summary: {
            title: "",
            text: "",
            status: "input_gated",
            source: "local_input_gate"
          }
        },
        coverageItems: { covered: [], pending: [] },
        boundaries: {
          agentPlanGenerated: false,
          agentHandoffEntered: false,
          codeExecutionEntered: false,
          postEvalEntered: false
        }
      }));
      setRunState((current) => ({
        ...current,
        runId: "",
        status: "input_gated",
        skillStatus: "idle",
        skillSourceMode: "local_input_gate",
        skillModel: "",
        skillClient: "",
        skillProvider: "local_rule",
        outputDir: "",
        relativeOutputDir: "",
        artifacts: {},
        error: null
      }));
      onToast("璇疯緭鍏ュ畬鏁撮渶姹?");
      return;
    }
    const loadingId = `system-loading-${Date.now()}-${messages.length}`;
    setInputGateActive(false);
    const loadingMessage = systemMessage("正在生成 DSL draft...", nextMessages.length, {
      id: loadingId,
      kind: "skill_loading"
    });

    setMessages([...nextMessages, loadingMessage]);
    setUiState((current) => markUiStateInitialRequirement(current, trimmedText));
    onToast("已追加 PM 回答");
    setRunState((current) => ({
      ...current,
      status: "queued",
      skillStatus: "understanding",
      skillSourceMode: "",
      skillModel: "",
      skillClient: "",
      skillProvider: "",
      error: null
    }));

    let requirement = loadedRequirement;
    let createdRequirementForTurn = false;
    if (!requirement?.id) {
      try {
        const createdRequirement = await createRequirement(activeProject?.id ?? "conduit-realworld-example-app", {
          title: inferRequirementTitle(trimmedText),
          rawPmInput: trimmedText,
          dslJson: {},
          readinessStatus: "clarify_first",
          readyForAgent: false,
          handoffDecision: "clarify_first",
          completionPercent: 0
        });
        requirement = hasRequirementId(createdRequirement)
          ? createdRequirement
          : localRequirement(activeProject?.id, trimmedText);
        createdRequirementForTurn = hasRequirementId(createdRequirement);
        setLoadedRequirement(requirement);
        if (hasRequirementId(createdRequirement)) onRequirementChange?.(requirement);
      } catch (error) {
        requirement = localRequirement(activeProject?.id, trimmedText);
        setLoadedRequirement(requirement);
        setHistoryError(`需求创建失败：${error.message || "Persistence API request failed"}；本轮仍会继续，但刷新后可能无法恢复。`);
      }
    }

    const requestPayload = {
      projectId: activeProject?.id ?? "conduit-realworld-example-app",
      requirementId: requirement.id,
      pmMessages: messagesToRunnerPayload(nextMessages),
      codeContextPath: "e2e\\context\\default_code_context_packet.json",
      maxRounds: 3
    };
    const testTimeoutMs = getGlobalNumber("__DSL_TEST_TIMEOUT_MS__");
    if (testTimeoutMs > 0) requestPayload.timeoutMs = testTimeoutMs;

    createClarification(requirement.id, {
      role: "pm",
      content: trimmedText,
      source: "pm_input"
    }).catch((error) => setHistoryError(`PM 输入保存失败：${error.message || "Persistence API request failed"}`));

    let skillReplyResolved = false;
    try {
      const skillTurn = await createSkillPmDslTurn(buildSkillTurnRequest(requestPayload, nextMessages, uiState));
      const clarificationComplete = isClarificationCompleteTurn(skillTurn);
      const assistantText = skillTurn.assistant_message || (clarificationComplete
        ? CLARIFICATION_COMPLETE_MESSAGE
        : "模型已生成本轮澄清回复。");
      const skillUiState = clarificationComplete
        ? markUiStateClarificationComplete(skillTurn.uiState)
        : (skillTurn.uiState || {});
      setUiState((current) => mergeRunnerUiState(current, skillUiState));
      setMessages((current) => replaceMessage(
        current,
        loadingId,
        systemMessage(assistantText, current.length, {
          id: loadingId,
          kind: clarificationComplete ? "clarification_complete" : "skill_reply"
        })
      ));
      createClarification(requirement.id, {
        role: "system",
        content: assistantText,
        source: "skill_turn"
      }).catch((error) => setHistoryError(`系统回复保存失败：${error.message || "Persistence API request failed"}`));
      setRunState((current) => ({
        ...current,
        runId: skillTurn.runId || current.runId,
        status: "skill_turn",
        skillStatus: skillStatusFromSource(skillTurn.source?.mode),
        skillSourceMode: skillTurn.source?.mode || "",
        skillModel: skillTurn.source?.model || "",
        skillClient: skillTurn.source?.client || "",
        skillProvider: skillTurn.source?.provider || "",
        outputDir: skillTurn.outputDir || current.outputDir,
        relativeOutputDir: skillTurn.relativeOutputDir || current.relativeOutputDir,
        realDslEnabled: true,
        artifacts: current.artifacts || {},
        error: null
      }));
      onToast("Skill turn generated");
      skillReplyResolved = true;
      longStageRef.current = "clarified";

      if (skillTurn.skipDslGeneration) {
        setRunState((current) => ({
          ...current,
          runId: "",
          status: "input_gated",
          skillStatus: "idle",
          skillSourceMode: skillTurn.source?.mode || "local_input_gate",
          skillModel: "",
          skillClient: skillTurn.source?.client || "",
          skillProvider: skillTurn.source?.provider || "local_rule",
          outputDir: "",
          relativeOutputDir: "",
          artifacts: {},
          error: null
        }));
        return;
      }

      const result = await runDslFlow(requestPayload, { appendStartMessage: false, suppressLongMessages: true });
      const filteredUiState = applyClarificationDedupToUiState(result.uiState, nextMessages);
      const finalUiState = clarificationComplete
        ? markUiStateClarificationComplete(filteredUiState)
        : filteredUiState;
      setUiState((current) => mergeRunnerUiState(current, finalUiState));
      if (!isLocalRequirementId(requirement.id)) {
        persistRequirementState(requirement.id, result, finalUiState)
          .then((updated) => {
            setLoadedRequirement(updated);
            onRequirementChange?.(updated);
            if (createdRequirementForTurn) {
              ensureEmptyDesignPlan(updated).catch((error) => {
                setHistoryError(`设计规划初始化失败：${error.message || "Persistence API request failed"}`);
              });
            }
          })
          .catch((error) => {
            setHistoryError(`DSL 状态保存失败：${error.message || "Persistence API request failed"}`);
          });
      }
      setRunState((current) => ({
        ...current,
        runId: result.runId,
        status: result.status,
        outputDir: result.outputDir,
        relativeOutputDir: result.relativeOutputDir,
        realDslEnabled: true,
        artifacts: result.artifacts || {},
        error: null
      }));
      onToast(`DSL run ${result.status}`);
    } catch (error) {
      const runError = error.payload?.error || { code: "request_failed", message: error.message, details: {} };
      const failureText = skillReplyResolved ? buildArtifactFailureReply(runError) : buildFailureReply(runError);
      setMessages((current) => skillReplyResolved
        ? [...current, systemMessage(failureText, current.length)]
        : replaceMessage(
            current,
            loadingId,
            systemMessage(failureText, current.length, { id: loadingId })
          ));
      createClarification(requirement.id, {
        role: "system",
        content: failureText,
        source: "error"
      }).catch(() => {});
      setRunState((current) => ({
        ...current,
        runId: runError.details?.runId || current.runId,
        outputDir: runError.details?.outputDir || current.outputDir,
        relativeOutputDir: runError.details?.relativeOutputDir || current.relativeOutputDir,
        skillSourceMode: runError.details?.status === "external_blocked" ? "external_blocked" : current.skillSourceMode,
        skillModel: runError.details?.model || current.skillModel,
        skillClient: runError.details?.client || current.skillClient,
        skillStatus: current.skillStatus === "understanding" ? "failed" : current.skillStatus,
        status: runError.code === "runner_timeout" ? "timeout" : runError.code === "runner_cancelled" ? "cancelled" : "failed",
        error: runError
      }));
      onToast(skillReplyResolved ? "完整 artifacts 生成失败" : "DSL run 失败");
    }
  };

  const handleContinueRefine = async () => {
    if (runState.skillStatus === "understanding" || runState.status === "queued") return;
    if (!loadedRequirement?.id) {
      onToast("请先完成一轮需求澄清");
      return;
    }

    const triggerText = "继续丰富需求";
    const pmMessage = {
      id: `pm-refine-${Date.now()}-${messages.length}`,
      author: "PM",
      role: "pm",
      time: "刚刚",
      text: triggerText,
      kind: "refinement_request"
    };
    const nextMessages = [...messages, pmMessage];
    const loadingId = `system-refine-loading-${Date.now()}-${messages.length}`;
    const loadingMessage = systemMessage("正在补充新的澄清问题...", nextMessages.length, {
      id: loadingId,
      kind: "skill_loading"
    });

    setInputGateActive(false);
    setMessages([...nextMessages, loadingMessage]);
    setUiState((current) => ({
      ...current,
      dslCompletion: {
        ...(current.dslCompletion || {}),
        displayScore: Number(current.dslCompletion?.displayScore ?? current.dslCompletion?.value ?? 0),
        value: Number(current.dslCompletion?.displayScore ?? current.dslCompletion?.value ?? 0),
        displayNote: "refinement reopened; displayScore stays stable until a new DSL score arrives"
      },
      readiness: {
        ...(current.readiness || {}),
        ready_for_agent: false,
        can_handoff_to_agent: false,
        handoff_decision: "clarify_first"
      }
    }));
    setRunState((current) => ({
      ...current,
      status: "skill_turn",
      skillStatus: "understanding",
      error: null
    }));
    onToast("继续丰富需求");

    const requestPayload = {
      projectId: activeProject?.id ?? loadedRequirement.projectId ?? "conduit-realworld-example-app",
      requirementId: loadedRequirement.id,
      pmMessages: messagesToRunnerPayload(nextMessages),
      codeContextPath: "e2e\\context\\default_code_context_packet.json",
      maxRounds: 3
    };
    const testTimeoutMs = getGlobalNumber("__DSL_TEST_TIMEOUT_MS__");
    if (testTimeoutMs > 0) requestPayload.timeoutMs = testTimeoutMs;

    createClarification(loadedRequirement.id, {
      role: "pm",
      content: triggerText,
      source: "refinement_request"
    }).catch((error) => setHistoryError(`继续丰富需求保存失败：${error.message || "Persistence API request failed"}`));

    try {
      const skillTurn = await createSkillPmDslTurn(buildSkillTurnRequest(requestPayload, nextMessages, uiState, {
        refinementRequested: true,
        clarificationMode: "refinement"
      }));
      const assistantText = skillTurn.assistant_message || "我再补充确认两个不同方向的问题：";
      setUiState((current) => mergeRunnerUiState(current, skillTurn.uiState || {}));
      setMessages((current) => replaceMessage(
        current,
        loadingId,
        systemMessage(assistantText, current.length, {
          id: loadingId,
          kind: "skill_reply"
        })
      ));
      createClarification(loadedRequirement.id, {
        role: "system",
        content: assistantText,
        source: "skill_turn_refinement"
      }).catch((error) => setHistoryError(`系统回复保存失败：${error.message || "Persistence API request failed"}`));
      setRunState((current) => ({
        ...current,
        runId: skillTurn.runId || current.runId,
        status: "skill_turn",
        skillStatus: skillStatusFromSource(skillTurn.source?.mode),
        skillSourceMode: skillTurn.source?.mode || "",
        skillModel: skillTurn.source?.model || "",
        skillClient: skillTurn.source?.client || "",
        skillProvider: skillTurn.source?.provider || "",
        outputDir: skillTurn.outputDir || current.outputDir,
        relativeOutputDir: skillTurn.relativeOutputDir || current.relativeOutputDir,
        realDslEnabled: true,
        artifacts: current.artifacts || {},
        error: null
      }));
      onToast("已生成继续丰富问题");
    } catch (error) {
      const runError = error.payload?.error || { code: "request_failed", message: error.message, details: {} };
      setMessages((current) => replaceMessage(
        current,
        loadingId,
        systemMessage(buildFailureReply(runError), current.length, { id: loadingId })
      ));
      setRunState((current) => ({
        ...current,
        skillStatus: "failed",
        status: "failed",
        error: runError
      }));
      onToast("继续丰富需求失败");
    }
  };

  const runDslFlow = async (requestPayload, options = {}) => {
    const started = await startDslRun(requestPayload);
    pollRef.current = started.runId;
    longStageRef.current = options.suppressLongMessages ? "clarified" : "";
    setRunState((current) => ({
      ...current,
      ...jobToRunState(started),
      requestPayload,
      error: null
    }));
    if (options.appendStartMessage !== false) {
      setMessages((current) => [
        ...current,
        systemMessage(`Run started: ${started.runId}. DSL draft is running.`, current.length)
      ]);
    }

    return pollRunToTerminal(started.runId, requestPayload);
  };

  const pollRunToTerminal = async (runId, requestPayload) => {
    while (pollRef.current === runId) {
      const job = await getDslRun(runId);
      setRunState((current) => ({
        ...current,
        ...jobToRunState(job),
        requestPayload,
        error: job.error || null
      }));
      maybeAppendLongRunningMessage(job);

      if (job.status === "passed") {
        stopPolling();
        return {
          runId: job.runId,
          status: job.status,
          outputDir: job.outputDir,
          relativeOutputDir: job.relativeOutputDir,
          artifacts: job.fullArtifacts || {},
          uiState: job.uiState || fallbackUiState()
        };
      }
      if (["failed", "timeout", "cancelled"].includes(job.status)) {
        stopPolling();
        throw jobError(job);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const latestJob = await getDslRun(runId).catch(() => null);
    if (latestJob?.status === "passed") {
      return {
        runId: latestJob.runId,
        status: latestJob.status,
        outputDir: latestJob.outputDir,
        relativeOutputDir: latestJob.relativeOutputDir,
        artifacts: latestJob.fullArtifacts || {},
        uiState: latestJob.uiState || fallbackUiState()
      };
    }
    throw pollingStoppedError(runId, latestJob);
  };

  const maybeAppendLongRunningMessage = (job) => {
    const elapsedMs = Number(job.elapsedMs || 0);
    const firstThreshold = getGlobalNumber("__DSL_LONG_RUN_FIRST_MS__", 15000);
    const secondThreshold = getGlobalNumber("__DSL_LONG_RUN_SECOND_MS__", 60000);
    if (job.status !== "running") return;
    if (longStageRef.current === "clarified") return;
    if (elapsedMs >= secondThreshold && longStageRef.current !== "60s") {
      longStageRef.current = "60s";
      setMessages((current) => [
        ...current,
        systemMessage("Long running: you can keep waiting or cancel this run.", current.length)
      ]);
    } else if (elapsedMs >= firstThreshold && longStageRef.current === "") {
      longStageRef.current = "15s";
      setMessages((current) => [
        ...current,
        systemMessage("Still generating DSL; waiting for the model response.", current.length)
      ]);
    }
  };

  const handleCancelRun = async () => {
    if (!runState.runId) return;
    const cancelled = await cancelDslRun(runState.runId);
    stopPolling();
    setRunState((current) => ({
      ...current,
      ...jobToRunState(cancelled),
      error: cancelled.error || current.error
    }));
    setMessages((current) => [
      ...current,
      systemMessage("Run cancelled. Agent execution was not entered.", current.length)
    ]);
    onToast("Run cancelled");
  };

  const handleRetryRun = async () => {
    if (!runState.runId) return;
    const originalRunId = runState.runId;
    const originalStatus = runState.status;
    const retried = await retryDslRun(runState.runId);
    pollRef.current = retried.runId;
    longStageRef.current = "";
    setRunState((current) => ({
      ...current,
      ...jobToRunState(retried),
      originalRunId,
      originalStatus,
      error: null
    }));
    setMessages((current) => [
      ...current,
      systemMessage(`完整 artifacts 重试已启动。原始 run: ${originalRunId} ${originalStatus}; retry run: ${retried.runId} ${retried.status}.`, current.length)
    ]);

    try {
      const result = await pollRunToTerminal(retried.runId, runState.requestPayload || {});
      const filteredUiState = applyClarificationDedupToUiState(result.uiState, messages);
      setUiState((current) => mergeRunnerUiState(current, filteredUiState));
      setRunState((current) => ({
        ...current,
        runId: result.runId,
        status: result.status,
        outputDir: result.outputDir,
        relativeOutputDir: result.relativeOutputDir,
        artifacts: result.artifacts || {},
        error: null
      }));
    } catch (error) {
      const runError = error.payload?.error || { code: "request_failed", message: error.message, details: {} };
      setMessages((current) => [
        ...current,
        systemMessage(buildFailureReply(runError), current.length)
      ]);
    }
  };

  const handleOpenPartialArtifacts = async () => {
    if (!runState.runId) return;
    setPartialArtifacts(await getDslRunArtifacts(runState.runId));
    setIsPartialOpen(true);
  };

  const handleAdoptSuggestion = (question) => {
    const text = typeof question === "string" ? question : question.text;
    setMessages((current) => [
      ...current,
      {
        id: `system-${Date.now()}-${current.length}`,
        author: "系统澄清",
        role: "system",
        time: "刚刚",
        text,
        questionText: text,
        questionKey: typeof question === "string" ? normalizeQuestionKey(question) : question.questionKey
      }
    ]);
  };

  return (
    <main className="dsl-workbench" data-testid="dsl-workbench">
      <section className="dsl-left-pane">
        <header className="dsl-workbench-header">
          <span>{activeProject?.name ?? "conduit-realworld-example-app"}</span>
          <h1>需求澄清工作台</h1>
          <p>通过对话生成 RequirementDSL，并持续检查风险与执行边界</p>
        </header>
        {requirementError || historyError ? (
          <p className="run-error-text" role="alert">{requirementError || historyError}</p>
        ) : null}

        <section className="dsl-task-card" aria-label="当前需求任务">
          <span className="dsl-task-icon" aria-hidden="true"><FileText size={28} /></span>
          <div>
            <h2>{inputGateActive ? "等待输入需求" : (loadedRequirement?.title || dslTask.title)}</h2>
            <p>阶段 <strong>{dslTask.phase}</strong></p>
          </div>
          <div>
            <small>目标</small>
            <strong>{dslTask.goal}</strong>
          </div>
        </section>

        <ClarificationChat
          messages={messages}
          onSendAnswer={handleSendAnswer}
          onAdoptSuggestion={handleAdoptSuggestion}
          onToast={onToast}
          realSuggestion={uiState.recommendedQuestion}
          runId={runState.runId}
          onContinueRefine={handleContinueRefine}
          onStartConstruction={onStartConstruction}
        />
      </section>

      <DSLStatusConsole
        uiState={uiState}
        runState={runState}
        onOpenReport={() => setIsReportOpen(true)}
        onCancelRun={handleCancelRun}
        onRetryRun={handleRetryRun}
        onOpenPartialArtifacts={handleOpenPartialArtifacts}
      />

      {toast ? <div className="selection-toast dsl-toast" role="status">{toast}</div> : null}
      {isReportOpen ? (
        <RequirementReportModal
          onClose={() => setIsReportOpen(false)}
          onToast={onToast}
          uiState={uiState}
          runState={runState}
        />
      ) : null}
      {isPartialOpen ? (
        <PartialArtifactsPanel
          artifacts={partialArtifacts}
          onClose={() => setIsPartialOpen(false)}
        />
      ) : null}
    </main>
  );
}

function hasActiveClarificationContext(messages = [], requirement = null, runState = {}) {
  return Boolean(
    requirement?.id ||
    runState?.runId ||
    messages.some((message) => (
      message.role === "system" &&
      (
        message.kind === "skill_reply" ||
        message.kind === "clarification_complete" ||
        message.questionText ||
        /[?？]|还需要确认|关键口径/.test(String(message.text || ""))
      )
    ))
  );
}

function isClarificationCompleteTurn(skillTurn = {}) {
  if (skillTurn.skipDslGeneration) return false;
  const clarification = skillTurn.clarification || {};
  const decision = String(
    skillTurn.risk_boundary?.handoff_decision ||
    skillTurn.uiState?.readiness?.handoff_decision ||
    ""
  );
  if (clarification.clarificationComplete || decision === "clarification_complete" || decision === "ready_for_design") {
    return true;
  }
  if (!hasStartConstructionGate(clarification, skillTurn.uiState)) return false;
  if (Array.isArray(clarification.questions) && clarification.questions.length === 0 && !clarification.currentQuestion) {
    return true;
  }
  return false;
}

function hasStartConstructionGate(clarification = {}, uiState = {}) {
  const answered = Number(
    clarification.answeredQuestionCount ??
    clarification.askedQuestionCount ??
    uiState?.clarification?.answeredQuestionCount ??
    uiState?.clarification?.askedQuestionCount ??
    0
  );
  const dimensions = new Set([
    ...arrayOfStrings(clarification.coveredDimensions),
    ...arrayOfStrings(uiState?.clarification?.coveredDimensions)
  ]);
  return answered >= 5 && dimensions.size >= 4;
}

function markUiStateClarificationComplete(uiState = {}) {
  const existingDisplay = Number(uiState.dslCompletion?.displayScore ?? uiState.dslCompletion?.value ?? uiState.dslCompletion?.rawScore ?? 0);
  return {
    ...uiState,
    dslCompletion: {
      ...(uiState.dslCompletion || {}),
      displayScore: Number.isFinite(existingDisplay) ? existingDisplay : 0,
      value: Number.isFinite(existingDisplay) ? existingDisplay : 0
    },
    readiness: {
      ...(uiState.readiness || {}),
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: "clarification_complete",
      source: uiState.readiness?.source || "skill_safety_boundary"
    },
    coverageItems: {
      ...(uiState.coverageItems || {}),
      pending: []
    },
    humanReport: {
      ...(uiState.humanReport || {}),
      summary: {
        ...(uiState.humanReport?.summary || {}),
        status: "clarification_complete"
      }
    }
  };
}

function systemMessage(text, index, meta = {}) {
  return {
    id: `system-${Date.now()}-${index}`,
    author: "系统澄清",
    role: "system",
    time: "刚刚",
    text,
    ...meta
  };
}

function replaceMessage(messages, id, replacement) {
  let replaced = false;
  const nextMessages = messages.map((message) => {
    if (message.id !== id) return message;
    replaced = true;
    return replacement;
  });
  return replaced ? nextMessages : [...messages, replacement];
}

function buildSkillTurnRequest(requestPayload, nextMessages, uiState, overrides = {}) {
  const recommendedQuestion = uiState?.recommendedQuestion;
  return {
    ...requestPayload,
    mode: "fast",
    maxLatencyMs: getGlobalNumber("__SKILL_FAST_TIMEOUT_MS__", 60000),
    currentDslDraft: uiState?.humanReport || {},
    lightweightSignals: {
      riskSummary: (uiState?.risks || []).slice(0, 4),
      missingFields: uiState?.coverageItems?.pending || [],
      readiness: uiState?.readiness || {}
    },
    previousUiState: uiState,
    evpiSignals: recommendedQuestion
      ? {
          ranked_questions: [
            {
              question: recommendedQuestion.text,
              reason: recommendedQuestion.reason,
              source: recommendedQuestion.source
            }
          ]
        }
      : {},
    pmMessages: messagesToRunnerPayload(nextMessages).slice(-6),
    ...overrides
  };
}

function skillStatusFromSource(sourceMode) {
  if (["fallback", "fallback_guardrail", "slow_response"].includes(sourceMode)) return "fallback";
  if (sourceMode) return "done";
  return "done";
}

function mergeRunnerUiState(current, runnerUiState) {
  const next = applyMonotonicDisplayScore(current, runnerUiState);
  return {
    ...current,
    ...next,
    recommendedQuestion: current.recommendedQuestion?.source === "skill_model"
      ? current.recommendedQuestion
      : next.recommendedQuestion,
    humanReport: shouldPreserveSkillReport(current.humanReport?.summary?.source)
      ? current.humanReport
      : (next.humanReport || current.humanReport)
  };
}

function applyMonotonicDisplayScore(current = {}, nextUiState = {}) {
  const currentScore = Number(current.dslCompletion?.displayScore ?? current.dslCompletion?.value ?? 0);
  const nextCompletion = nextUiState.dslCompletion || {};
  const nextDisplay = Number(nextCompletion.displayScore ?? nextCompletion.value ?? nextCompletion.rawScore ?? 0);
  const displayScore = Math.max(
    Number.isFinite(currentScore) ? currentScore : 0,
    Number.isFinite(nextDisplay) ? nextDisplay : 0
  );
  return {
    ...nextUiState,
    dslCompletion: {
      ...nextCompletion,
      displayScore,
      value: displayScore
    }
  };
}

function shouldPreserveSkillReport(source) {
  return ["model_generated", "model_generated_real", "mock", "fallback", "fallback_guardrail", "slow_response"].includes(source);
}

function buildFailureReply(error) {
  const code = error?.code || "request_failed";
  const message = error?.message || "未知错误";
  return `系统提示：本轮 DSL 生成失败，原因：${code} / ${message}。已保留结构化错误信息，请检查右侧状态。`;
}

function buildArtifactFailureReply(error) {
  if (error?.code === "polling_stopped") {
    return `系统提示：快速澄清已完成，完整 DSL artifacts 的前端轮询被中断。后台生成可能仍在继续，当前不会自动交给 Agent 执行。请查看右侧 run 状态，或稍后重试生成完整 artifacts。原因：polling_stopped / ${error?.message || "Polling stopped before terminal status"}。`;
  }
  const code = error?.code || "request_failed";
  const message = error?.message || "未知错误";
  return `系统提示：快速澄清已完成，完整 DSL artifacts 后台生成失败。当前不会交给 Agent 执行，你可以继续澄清或稍后重试生成完整 artifacts。原因：${code} / ${message}。`;
}

function requirementToUiState(current, requirement) {
  if (!requirement) return current;
  if (!hasMeaningfulRequirement(requirement)) return emptyUiState();
  const completionValue = resolveRequirementCompletion(requirement);
  return {
    ...current,
    dslCompletion: {
      ...(current.dslCompletion || {}),
      rawScore: completionValue,
      displayScore: completionValue,
      value: completionValue,
      source: "persistent_database"
    },
    readiness: {
      ...(current.readiness || {}),
      ready_for_agent: Boolean(requirement.readyForAgent),
      handoff_decision: requirement.handoffDecision || requirement.readinessStatus || "clarify_first",
      source: "persistent_database"
    },
    humanReport: {
      ...(current.humanReport || {}),
      summary: {
        ...(current.humanReport?.summary || {}),
        title: requirement.dslJson?.title || requirement.title,
        text: requirement.rawPmInput || current.humanReport?.summary?.text || "",
        source: "persistent_database"
      }
    }
  };
}

function markUiStateInitialRequirement(current, pmInput) {
  return {
    ...current,
    dslCompletion: {
      rawScore: 0,
      displayScore: 0,
      value: 0,
      source: "pm_input_initial",
      displayNote: "initial requirement entered; DSL score is calculating"
    },
    readiness: {
      ready_for_agent: false,
      can_handoff_to_agent: false,
      handoff_decision: "clarify_first",
      source: "pm_input_initial"
    },
    risks: [],
    coverageItems: { covered: [], pending: [] },
    humanReport: {
      ...(current.humanReport || {}),
      summary: {
        ...(current.humanReport?.summary || {}),
        title: inferRequirementTitle(pmInput),
        text: pmInput,
        status: "initial_requirement",
        source: "pm_input_initial"
      }
    }
  };
}

function hasMeaningfulRequirement(requirement) {
  return Boolean(
    String(requirement?.rawPmInput || "").trim() ||
    (requirement?.dslJson && typeof requirement.dslJson === "object" && Object.keys(requirement.dslJson).length > 0)
  );
}

function resolveRequirementCompletion(requirement) {
  const persisted = Number(requirement?.completionPercent);
  if (Number.isFinite(persisted) && persisted > 0) return Math.round(persisted);
  return 0;
}

async function persistRequirementState(requirementId, result, uiState) {
  const readiness = uiState?.readiness || {};
  return updateRequirement(requirementId, {
    dslJson: extractDslJson(result, uiState),
    readinessStatus: result.status || readiness.handoff_decision || "clarify_first",
    readyForAgent: Boolean(readiness.ready_for_agent),
    handoffDecision: readiness.handoff_decision || "clarify_first",
    sourceProvider: uiState?.source?.provider || "",
    sourceModel: uiState?.source?.model || "",
    completionPercent: uiState?.dslCompletion?.value ?? 0
  });
}

function ensureEmptyDesignPlan(requirement) {
  return upsertDesignPlan(requirement.id, {
    title: requirement.title || requirement.dslJson?.title || "待规划需求",
    summary: "等待人工从 RequirementDSL 拆解设计规划。",
    currentStage: "empty",
    overallProgress: 0
  });
}

function extractDslJson(result, uiState) {
  const artifacts = result?.artifacts || {};
  return artifacts["12_final_dsl.json"]?.json ||
    artifacts["requirement_dsl.json"]?.json ||
    artifacts["final_dsl.json"]?.json ||
    uiState?.humanReport ||
    {};
}

function inferRequirementTitle(text) {
  const trimmed = String(text || "").trim();
  return trimmed ? trimmed.slice(0, 80) : "Workbench requirement";
}

function hasRequirementId(requirement) {
  return Boolean(requirement?.id && requirement?.projectId !== undefined);
}

function localRequirement(projectId, text) {
  return {
    id: `req-local-${Date.now()}`,
    projectId: projectId || "conduit-realworld-example-app",
    title: inferRequirementTitle(text),
    rawPmInput: text,
    dslJson: {},
    readinessStatus: "clarify_first",
    readyForAgent: false,
    handoffDecision: "clarify_first",
    completionPercent: 0
  };
}

function isLocalRequirementId(requirementId) {
  return String(requirementId || "").startsWith("req-local-");
}

function jobToRunState(job) {
  return {
    runId: job.runId || "",
    status: job.status || "idle",
    outputDir: job.outputDir || "",
    relativeOutputDir: job.relativeOutputDir || "",
    elapsedMs: job.elapsedMs || 0,
    pid: job.pid ?? null,
    lastMessage: job.lastMessage || "",
    originalRunId: job.originalRunId || "",
    artifacts: job.fullArtifacts || job.artifacts || {},
    artifactStatus: job.artifactStatus || "",
    realLlmCalls: job.realLlmCalls ?? null,
    mockLlmUsed: job.mockLlmUsed ?? null,
    realWritePerformed: job.realWritePerformed ?? null,
    realDslEnabled: true,
    error: job.error || null
  };
}

function jobError(job) {
  const error = new Error(job.error?.message || job.status);
  error.payload = {
    ok: false,
    data: null,
    error: job.error || {
      code: job.status === "timeout" ? "runner_timeout" : job.status === "cancelled" ? "runner_cancelled" : "runner_failed",
      message: job.status,
      details: { runId: job.runId, relativeOutputDir: job.relativeOutputDir }
    }
  };
  return error;
}

function pollingStoppedError(runId, latestJob) {
  const error = new Error("Polling stopped before this run reached terminal status.");
  error.payload = {
    ok: false,
    data: latestJob || null,
    error: {
      code: "polling_stopped",
      message: "Polling stopped before this run reached terminal status.",
      details: {
        runId,
        status: latestJob?.status || "unknown",
        outputDir: latestJob?.outputDir || "",
        relativeOutputDir: latestJob?.relativeOutputDir || ""
      }
    }
  };
  return error;
}

function PartialArtifactsPanel({ artifacts, onClose }) {
  const files = artifacts?.available || Object.entries(artifacts?.artifacts || {})
    .filter(([, artifact]) => artifact.exists)
    .map(([filename]) => filename);
  const errorJson = artifacts?.artifacts?.["error.json"]?.json || artifacts?.artifacts?.["server_error.json"]?.json || null;
  return (
    <div className="partial-artifacts-backdrop" role="dialog" aria-label="partial artifacts">
      <section className="partial-artifacts-panel">
        <header>
          <div>
            <span>Partial artifacts</span>
            <h2>{artifacts?.runId || "RUN"}</h2>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </header>
        <div className="partial-artifacts-body">
          <section>
            <h3>可用文件</h3>
            <ul>
              {files.length ? files.map((file) => <li key={file}><code>{file}</code></li>) : <li>暂无可用文件</li>}
            </ul>
          </section>
          <section>
            <h3>Error summary</h3>
            <pre>{errorJson ? JSON.stringify(errorJson.error || errorJson, null, 2) : "No error.json / server_error.json yet."}</pre>
          </section>
        </div>
      </section>
    </div>
  );
}

function messagesToRunnerPayload(messages) {
  return messages
    .filter((message) => String(message.text || "").trim())
    .map((message) => {
      if (message.role === "system") {
        const questionText = message.questionText || message.text;
        return {
          role: "system_clarification",
          content: questionText,
          questionKey: message.questionKey || normalizeQuestionKey(questionText)
        };
      }
      return {
        role: "pm",
        content: message.text
      };
    });
}

function getGlobalNumber(name, fallback = 0) {
  const value = Number(globalThis?.[name] || 0);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampNumber(value, min, max) {
  const numeric = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function arrayOfStrings(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}
