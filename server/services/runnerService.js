import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { artifactsToUiState } from "../../src/adapters/dslArtifactAdapter.js";
import { readRunArtifacts } from "./artifactService.js";
import {
  createJob,
  getInternalJob,
  getJob,
  getJobRuntime,
  markCancelled,
  markFailed,
  markFinished,
  markTimeout,
  setJobRuntime,
  updateJob
} from "./jobStore.js";
import { redactSecrets, redactString } from "./redactionService.js";
import { prepareRunDirectory, relativeOutputDir } from "./runStore.js";

export const defaultConfig = {
  dslRuntimeRoot: path.resolve("e2e"),
  apiConfigPath: path.resolve("configs", "api_config.local.json"),
  codeContextPath: path.resolve("e2e", "context", "default_code_context_packet.json"),
  runsRoot: path.resolve("runs"),
  timeoutSeconds: 180,
  mockDelayMs: Number(process.env.DSL_MOCK_DELAY_MS || 0),
  runnerMode: process.env.DSL_RUNNER_MODE || "real"
};

export async function getHealth(config = {}) {
  const merged = { ...defaultConfig, ...config };
  const mockRunnerAvailable = ["mock", "mock-fail"].includes(merged.runnerMode);
  return {
    service: "codex-workbench-web",
    dslRuntimeRoot: merged.dslRuntimeRoot,
    runnerAvailable: mockRunnerAvailable || await exists(path.join(merged.dslRuntimeRoot, "runtime", "pm_dsl_runner.py")),
    apiConfigExists: await exists(merged.apiConfigPath)
  };
}

export async function createDslRun(requestBody, config = {}) {
  const merged = { ...defaultConfig, ...config };
  const pmMessages = normalizePmMessages(requestBody?.pmMessages);
  if (!pmMessages.length) {
    return errorPayload("bad_request", "pmMessages must include at least one PM message", {});
  }

  const health = await getHealth(merged);
  if (!health.runnerAvailable) return errorPayload("runner_missing", "pm_dsl_runner.py not found", health);
  if (!health.apiConfigExists && merged.runnerMode !== "mock") {
    return errorPayload("config_missing", "api_config.local.json not found", health);
  }

  const { runId, outputDir } = await prepareRunDirectory(merged.runsRoot);
  const codeContextPath = requestBody?.codeContextPath || merged.codeContextPath;
  const mergedPmText = mergePmText(pmMessages);

  try {
    if (merged.runnerMode === "mock") {
      const delayMs = Number(process.env.DSL_MOCK_DELAY_MS || 0);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      await writeMockArtifacts({ runId, outputDir, pmText: mergedPmText, codeContextPath });
    } else if (merged.runnerMode === "mock-fail") {
      throw new RunnerError("runner_failed", "Mock runner failure", { stderr: "api_key=***REDACTED***" });
    } else {
      await invokePythonRunner({
        outputDir,
        pmText: mergedPmText,
        codeContextPath,
        config: merged
      });
    }

    const { artifacts, caseDir } = await readRunArtifacts(outputDir);
    const uiState = artifactsToUiState(artifacts);
    const summary = artifacts["summary.json"]?.json || {};
    const status = String(summary.status || "passed");
    return {
      ok: true,
      data: redactSecrets({
        runId,
        status,
        outputDir,
        relativeOutputDir: relativeOutputDir(outputDir),
        caseDir,
        artifacts,
        uiState,
        runner: {
          mode: merged.runnerMode,
          maxRoundsIgnored: requestBody?.maxRounds !== undefined,
          scope: "pm_to_dsl_only_no_agent_plan_no_handoff"
        }
      }),
      error: null
    };
  } catch (error) {
    const code = error instanceof RunnerError ? error.code : "runner_failed";
    const message = error instanceof RunnerError ? error.message : String(error.message || error);
    await writeRunnerError(outputDir, { code, message, details: error.details || {} });
    return errorPayload(code, message, {
      runId,
      outputDir,
      relativeOutputDir: relativeOutputDir(outputDir),
      details: error.details || {}
    });
  }
}

export async function startDslRunJob(requestBody, config = {}, options = {}) {
  const context = await createRunContext(requestBody, config, options);
  if (!context.ok) return context.payload;

  const job = createJob({
    runId: context.runId,
    originalRunId: options.originalRunId || "",
    outputDir: context.outputDir,
    relativeOutputDir: relativeOutputDir(context.outputDir),
    requestBody,
    lastMessage: "DSL runner started"
  });

  queueMicrotask(() => {
    executeAsyncJob(context).catch(async (error) => {
      await finishJobWithError(context, error);
    });
  });

  return {
    ok: true,
    data: job,
    error: null
  };
}

export function getDslRunJob(runId) {
  const job = getJob(runId);
  if (!job) return errorPayload("not_found", "DSL run not found", { runId });
  return { ok: true, data: job, error: null };
}

export async function cancelDslRunJob(runId) {
  const job = getInternalJob(runId);
  if (!job) return errorPayload("not_found", "DSL run not found", { runId });
  if (!["queued", "running"].includes(job.status)) {
    return { ok: true, data: getJob(runId), error: null };
  }

  const runtime = getJobRuntime(runId);
  if (runtime?.cancel) await runtime.cancel();
  await writeCancelled(job.outputDir, runId);
  const cancelled = markCancelled(runId, {
    lastMessage: "Run cancelled by user before Agent execution"
  });
  return { ok: true, data: cancelled, error: null };
}

export async function retryDslRunJob(runId, config = {}) {
  const job = getInternalJob(runId);
  if (!job) return errorPayload("not_found", "DSL run not found", { runId });
  if (["queued", "running"].includes(job.status)) {
    return errorPayload("bad_request", "Cannot retry a running DSL run", { runId, status: job.status });
  }
  return startDslRunJob(job.requestBody, config, { originalRunId: runId });
}

export async function getDslRunArtifacts(runId) {
  const job = getInternalJob(runId);
  if (!job) return errorPayload("not_found", "DSL run not found", { runId });
  const artifactState = await collectArtifacts(job.outputDir, job.status);
  return {
    ok: true,
    data: {
      runId,
      status: job.status,
      outputDir: job.outputDir,
      relativeOutputDir: relativeOutputDir(job.outputDir),
      partial: job.status !== "passed",
      ...artifactState
    },
    error: null
  };
}

async function createRunContext(requestBody, config, options = {}) {
  const merged = { ...defaultConfig, ...config };
  const pmMessages = normalizePmMessages(requestBody?.pmMessages);
  if (!pmMessages.length) {
    return {
      ok: false,
      payload: errorPayload("bad_request", "pmMessages must include at least one PM message", {})
    };
  }

  const health = await getHealth(merged);
  if (!health.runnerAvailable) {
    return { ok: false, payload: errorPayload("runner_missing", "pm_dsl_runner.py not found", health) };
  }
  if (!health.apiConfigExists && merged.runnerMode !== "mock" && merged.runnerMode !== "mock-fail") {
    return { ok: false, payload: errorPayload("config_missing", "api_config.local.json not found", health) };
  }

  const { runId, outputDir } = await prepareRunDirectory(merged.runsRoot);
  return {
    ok: true,
    merged,
    requestBody,
    pmMessages,
    runId,
    outputDir,
    originalRunId: options.originalRunId || "",
    codeContextPath: requestBody?.codeContextPath || merged.codeContextPath,
    pmText: mergePmText(pmMessages),
    timeoutMs: normalizeTimeoutMs(requestBody, merged)
  };
}

async function executeAsyncJob(context) {
  updateJob(context.runId, {
    status: "running",
    lastMessage: "Running PM-to-DSL runner"
  });

  try {
    if (context.merged.runnerMode === "mock") {
      await runMockJob(context, "passed");
    } else if (context.merged.runnerMode === "mock-fail") {
      await runMockJob(context, "failed");
    } else {
      await invokePythonRunner({
        outputDir: context.outputDir,
        pmText: context.pmText,
        codeContextPath: context.codeContextPath,
        config: context.merged,
        timeoutMs: context.timeoutMs,
        runId: context.runId
      });
    }

    if (isTerminalJob(context.runId)) return;
    const { artifacts, caseDir } = await readRunArtifacts(context.outputDir);
    const uiState = artifactsToUiState(artifacts);
    const summary = artifacts["summary.json"]?.json || {};
    const status = String(summary.status || "passed");
    const artifactState = await collectArtifacts(context.outputDir, status);
    markFinished(context.runId, {
      status,
      caseDir,
      artifacts: artifactState.summary,
      fullArtifacts: artifacts,
      uiState,
      runner: {
        mode: context.merged.runnerMode,
        scope: "pm_to_dsl_only_no_agent_plan_no_handoff"
      },
      lastMessage: `DSL runner finished with ${status}`
    });
  } catch (error) {
    await finishJobWithError(context, error);
  }
}

async function runMockJob(context, mode) {
  const delayMs = Number(context.requestBody?.mockDelayMs ?? context.merged.mockDelayMs ?? 0);
  await waitWithTimeout(context.runId, delayMs, context.timeoutMs);
  if (isTerminalJob(context.runId)) return;
  if (mode === "failed") {
    throw new RunnerError("runner_failed", "Mock runner failure", { stderr: "api_key=***REDACTED***" });
  }
  await writeMockArtifacts({
    runId: context.runId,
    outputDir: context.outputDir,
    pmText: context.pmText,
    codeContextPath: context.codeContextPath
  });
}

function waitWithTimeout(runId, delayMs, timeoutMs) {
  return new Promise((resolve, reject) => {
    const delayTimer = setTimeout(resolve, Math.max(0, delayMs));
    const timeoutTimer = setTimeout(() => {
      reject(new RunnerError("runner_timeout", `runner exceeded ${Math.ceil(timeoutMs / 1000)}s`, {
        timedOut: true
      }));
    }, timeoutMs);
    setJobRuntime(runId, {
      clear: () => {
        clearTimeout(delayTimer);
        clearTimeout(timeoutTimer);
      },
      cancel: async () => {
        clearTimeout(delayTimer);
        clearTimeout(timeoutTimer);
      }
    });
  });
}

async function finishJobWithError(context, error) {
  if (isTerminalJob(context.runId)) return;
  const code = error instanceof RunnerError ? error.code : "runner_failed";
  const message = error instanceof RunnerError ? error.message : String(error.message || error);
  const safeError = redactSecrets({
    code,
    message,
    details: error.details || {}
  });
  await writeRunnerError(context.outputDir, safeError);
  const artifactState = await collectArtifacts(context.outputDir, code === "runner_timeout" ? "timeout" : "failed");
  if (code === "runner_timeout") {
    markTimeout(context.runId, safeError, {
      artifacts: artifactState.summary
    });
  } else {
    markFailed(context.runId, safeError, {
      artifacts: artifactState.summary
    });
  }
}

function isTerminalJob(runId) {
  const status = getInternalJob(runId)?.status;
  return ["passed", "failed", "timeout", "cancelled"].includes(status);
}

async function collectArtifacts(outputDir, status) {
  const { artifacts, caseDir } = await readRunArtifacts(outputDir);
  const available = Object.entries(artifacts)
    .filter(([, artifact]) => artifact.exists)
    .map(([filename]) => filename);
  return {
    artifacts,
    caseDir,
    available,
    partial: status !== "passed",
    summary: {
      available,
      partial: status !== "passed"
    }
  };
}

function normalizePmMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((item) => item && String(item.content || "").trim())
    .map((item) => ({
      role: String(item.role || "pm"),
      content: String(item.content || "").trim(),
      questionKey: item.questionKey ? String(item.questionKey) : ""
    }));
}

function mergePmText(pmMessages) {
  return pmMessages
    .map((message, index) => {
      if (message.role === "system_clarification" || message.role === "system") {
        const suffix = message.questionKey ? `\n[question_key] ${message.questionKey}` : "";
        return `[System clarification asked]\n${message.content}${suffix}`;
      }
      const label = index > 0 ? "[PM answer]" : "[PM request]";
      return `${label}\n${message.content}`;
    })
    .join("\n\n");
}

async function invokePythonRunner({ outputDir, pmText, codeContextPath, config, timeoutMs, runId }) {
  const args = [
    "-m",
    "runtime.pm_dsl_runner",
    "--config",
    config.apiConfigPath,
    "--pm-text",
    pmText,
    "--code-context",
    codeContextPath,
    "--output-dir",
    outputDir
  ];
  const env = {
    ...process.env,
    PYTHONPATH: `${config.dslRuntimeRoot};${path.join(config.dslRuntimeRoot, "core")}`
  };
  const result = await runProcess("python", args, {
    cwd: config.dslRuntimeRoot,
    env,
    timeoutMs: timeoutMs || Number(config.timeoutSeconds || 180) * 1000,
    runId: runId || "",
    command: "python",
    args
  });
  if (result.timedOut) {
    throw new RunnerError("runner_timeout", `runner exceeded ${config.timeoutSeconds}s`, result);
  }
  if (result.exitCode !== 0) {
    throw new RunnerError("runner_failed", "pm_dsl_runner.py exited with a non-zero status", result);
  }
}

function runProcess(command, args, { cwd, env, timeoutMs, runId }) {
  return new Promise((resolve) => {
    const processContext = redactSecrets({
      command,
      args,
      cwd
    });
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child.pid).finally(() => {
        resolve({
          exitCode: null,
          timedOut: true,
          ...processContext,
          stdout: redactString(stdout),
          stderr: redactString(stderr)
        });
      });
    }, timeoutMs);

    if (runId) {
      updateJob(runId, { pid: child.pid });
      setJobRuntime(runId, {
        clear: () => clearTimeout(timer),
        cancel: () => killProcessTree(child.pid)
      });
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: null,
        timedOut: false,
        ...processContext,
        stdout: redactString(stdout),
        stderr: redactString(`${stderr}\n${error.message}`)
      });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        timedOut: false,
        ...processContext,
        stdout: redactString(stdout),
        stderr: redactString(stderr)
      });
    });
  });
}

async function writeMockArtifacts({ runId, outputDir, pmText, codeContextPath }) {
  const caseDir = path.join(outputDir, "single_case");
  await fs.mkdir(caseDir, { recursive: true });
  const finalDsl = {
    requirement: {
      title: "登录失败提示优化",
      summary: "登录失败提示太模糊，希望用户知道下一步怎么做。"
    },
    scope: {
      in_scope: ["登录失败提示文案", "下一步操作指引", "错误场景澄清"],
      out_of_scope: ["Agent Plan", "Agent Handoff", "代码修改执行"]
    },
    execution_atoms: {
      agent_plan_generated: false,
      agent_handoff_entered: false,
      completion_state: "dsl_draft_only"
    }
  };
  const artifacts = {
    "00_input.json": {
      case: {
        case_id: "single_case",
        pm_text: pmText,
        code_context_packet_path: codeContextPath
      },
      runtime_scope: "pm_to_dsl_only_no_agent_plan_no_handoff"
    },
    "05_dsl_draft.json": finalDsl,
    "06_risk_activation.json": {
      module_status: "mock",
      activated_risk_factors: [
        {
          factor_id: "test_oracle_unclear",
          severity: "P0",
          reason: "验收标准不完整",
          category: "oracle",
          impact: "高影响"
        }
      ]
    },
    "09_scoring.json": {
      module_status: "mock",
      dsl_completion_score: 0.81,
      ready_for_agent: false,
      handoff_decision: "clarify_first",
      covered_items: ["目标与范围", "主要用户场景"],
      pending_items: ["验收标准", "错误码映射"]
    },
    "10_evpi_clarification.json": {
      module_status: "mock",
      clarification_gate: {
        should_ask: true,
        ready_for_agent: false,
        can_handoff_to_agent: false,
        handoff_decision: "clarify_first",
        coverage_source_type: "mock_evpi"
      },
      ranked_questions: [
        {
          question: "是否需要展示下一步操作？",
          reason: "EVPI 认为下一步动作仍不明确",
          factor_ids: ["test_oracle_unclear"]
        }
      ]
    },
    "11_pm_turns.json": [{ speaker: "pm", text: pmText, round: 0 }],
    "12_final_dsl.json": finalDsl
  };
  await Promise.all(
    Object.entries(artifacts).map(([filename, json]) =>
      fs.writeFile(path.join(caseDir, filename), JSON.stringify(json, null, 2), "utf8")
    )
  );
  await fs.writeFile(
    path.join(caseDir, "13_case_summary.md"),
    "# Case Summary: single_case\n\n- status: passed\n- scope: PM-to-DSL draft only; no Agent Plan; no Agent Handoff.\n",
    "utf8"
  );
  const summary = {
    run_id: runId,
    status: "passed",
    requested_output_dir: outputDir,
    actual_output_dir: outputDir,
    total_cases: 1,
    passed_cases: 1,
    failed_cases: 0,
    timeout_cases: 0,
    case_results: [
      {
        case_id: "single_case",
        status: "passed",
        output_dir: caseDir,
        rounds: 1,
        should_ask: true,
        handoff_decision: "clarify_first"
      }
    ]
  };
  await fs.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(path.join(outputDir, "summary.md"), `# PM-to-DSL Runner Summary: ${runId}\n`, "utf8");
}

async function writeRunnerError(outputDir, error) {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "error.json"),
    JSON.stringify(redactSecrets({ error }), null, 2),
    "utf8"
  );
}

async function writeCancelled(outputDir, runId) {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "cancelled.json"),
    JSON.stringify(redactSecrets({
      runId,
      status: "cancelled",
      message: "Run was cancelled by user before Agent execution",
      cancelledAt: new Date().toISOString()
    }), null, 2),
    "utf8"
  );
}

function normalizeTimeoutMs(requestBody, config) {
  const requested = Number(requestBody?.timeoutMs);
  if (Number.isFinite(requested) && requested >= 1) {
    return Math.max(1, Math.min(requested, Number(config.timeoutSeconds || 180) * 1000));
  }
  return Number(config.timeoutSeconds || 180) * 1000;
}

function killProcessTree(pid) {
  if (!pid) return Promise.resolve();
  if (process.platform !== "win32") {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have exited between polling and cancellation.
    }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
    killer.on("close", resolve);
    killer.on("error", resolve);
  });
}

function errorPayload(code, message, details) {
  return {
    ok: false,
    data: null,
    error: redactSecrets({
      code,
      message,
      details
    })
  };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

class RunnerError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = redactSecrets(details || {});
  }
}
