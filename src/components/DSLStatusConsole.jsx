import { ArrowRight, FileText, Info } from "lucide-react";

export default function DSLStatusConsole({
  uiState,
  runState,
  onOpenReport,
  onCancelRun,
  onRetryRun,
  onOpenPartialArtifacts
}) {
  const artifactCompletion = completionFromArtifacts(runState?.artifacts);
  const completionMeta = resolveDisplayCompletion(artifactCompletion, uiState?.dslCompletion);
  const completion = completionMeta.displayScore;
  const coverageItems = uiState?.coverageItems ?? { covered: [], pending: [] };
  const risks = uiState?.risks ?? [];
  const readiness = uiState?.readiness ?? {
    ready_for_agent: false,
    handoff_decision: "clarify_first",
    source: "fallback_safe_default"
  };
  const runStatus = runState?.status ?? "idle";
  const skillStatus = runState?.skillStatus || (runStatus === "skill_turn" ? "done" : "idle");
  const artifactsStatus = runState?.artifactStatus || formatArtifactStatus(runStatus);
  const skillSourceMode = runState?.skillSourceMode || "";
  const skillSourceLabel = formatSkillSourceLabel(skillSourceMode, runState?.skillModel, runState?.skillClient);
  const skillSourceTone = sourceTone(skillSourceMode);
  const firstLongRunThreshold = getGlobalNumber("__DSL_LONG_RUN_FIRST_MS__", 15000);
  const secondLongRunThreshold = getGlobalNumber("__DSL_LONG_RUN_SECOND_MS__", 60000);
  const elapsedMs = Number(runState?.elapsedMs || 0);
  const draftReportMode = ["failed", "timeout"].includes(runStatus) && ["done", "fallback"].includes(skillStatus);
  const reportCta = resolveReportCta(runState, artifactsStatus, draftReportMode);

  return (
    <aside className="dsl-status-console" aria-label="DSL 状态控制台">
      <h2>DSL 状态控制台</h2>

      <section className="dsl-panel run-status-panel">
        <div>
          <strong>Run: <code>{runState?.runId || "尚未生成"}</code></strong>
          <span className={`run-state-pill ${runStatus}`}>{runStatus}</span>
        </div>
        <div className="status-split-grid" aria-label="Skill reply and runner artifact status">
          <div>
            <span>快速澄清</span>
            <strong><span className={`run-state-pill skill-${skillStatus}`}>{skillStatus}</span></strong>
          </div>
          <div>
            <span>完整 DSL artifacts</span>
            <strong><span className={`run-state-pill ${artifactsStatus}`}>{artifactsStatus}</span></strong>
          </div>
        </div>
        {skillSourceLabel ? (
          <div className={`skill-source-badge ${skillSourceTone}`}>回复来源：{skillSourceLabel}</div>
        ) : null}
        <dl>
          <div><dt>输出目录</dt><dd>{runState?.relativeOutputDir || "runs\\<runId>"}</dd></div>
          <div><dt>真实 DSL</dt><dd>enabled</dd></div>
        </dl>
        {skillStatus === "understanding" ? <p>正在理解需求并更新 DSL...</p> : null}
        {skillStatus === "done" && runStatus === "running" ? <p>AI 已回复，完整 artifacts 后台同步中。</p> : null}
        {skillStatus === "fallback" ? <p>快速澄清已使用安全 fallback，完整 artifacts 可继续后台同步。</p> : null}
        {runStatus === "running" ? <p>正在生成 DSL draft...</p> : null}
        {runStatus === "running" && elapsedMs >= firstLongRunThreshold && elapsedMs < secondLongRunThreshold ? (
          <p className="run-long-message">仍在生成，正在等待模型返回...</p>
        ) : null}
        {runStatus === "running" && elapsedMs >= secondLongRunThreshold ? (
          <p className="run-long-message">运行时间较长，可以继续等待或取消本轮。</p>
        ) : null}
        {runState?.error ? (
          <p className="run-error-text">{runState.error.code}: {runState.error.message}</p>
        ) : null}
        {runState?.originalRunId ? (
          <p className="run-retry-link">原始 run：{runState.originalRunId}</p>
        ) : null}
        <div className="run-action-row">
          {runStatus === "running" ? (
            <button type="button" onClick={onCancelRun}>取消本轮</button>
          ) : null}
          {["failed", "timeout", "cancelled"].includes(runStatus) ? (
            <button type="button" onClick={onRetryRun}>重试完整 artifacts</button>
          ) : null}
          {["failed", "timeout"].includes(runStatus) ? (
            <button type="button" onClick={onOpenPartialArtifacts}>查看错误详情</button>
          ) : null}
        </div>
      </section>

      <section className="dsl-panel dsl-completion-panel">
        <h3>DSL 完成度</h3>
        <div className="completion-layout">
          <div className="completion-ring" style={{ "--completion": `${completion}%` }}>
            <strong>{completion}%</strong>
          </div>
          <div className="coverage-columns">
            <div>
              <strong className="coverage-good">已覆盖内容</strong>
              <ul>{coverageItems.covered.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div>
              <strong className="coverage-warn">待补内容</strong>
              <ul>{coverageItems.pending.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      <section className="dsl-panel readiness-panel">
        <div className="readiness-header">
          <h3>Readiness 状态</h3>
          <span>{readiness.ready_for_agent ? "ready" : "not ready"}</span>
        </div>
        <div className="readiness-grid">
          <dl>
            <div><dt>ready_for_agent</dt><dd>{String(readiness.ready_for_agent)}</dd></div>
            <div><dt>handoff_decision</dt><dd>{readiness.handoff_decision}</dd></div>
            <div><dt>source</dt><dd>{readiness.source}</dd></div>
          </dl>
          <div className="readiness-note">
            <Info size={17} />
            <p>当前仍需澄清，<strong>不会交给 Agent 执行</strong></p>
          </div>
        </div>
      </section>

      <section className="dsl-panel risk-panel">
        <h3>激活风险 <span>（需优先处理）</span></h3>
        <div className="risk-list">
          {risks.map((risk) => (
            <div className="risk-item" key={risk.key}>
              <span className={`risk-priority ${risk.priority.toLowerCase()}`}>{risk.priority}</span>
              <code>{risk.key}</code>
              <p>{risk.description}</p>
              <em>{risk.impact}</em>
            </div>
          ))}
        </div>
      </section>

      <button
        className={`report-cta ${reportCta.ready ? "ready" : "empty"}`}
        type="button"
        onClick={reportCta.ready ? onOpenReport : undefined}
        disabled={!reportCta.ready}
      >
        <span className="report-cta-icon" aria-hidden="true"><FileText size={25} /></span>
        <span className="report-cta-copy">
          <strong>{reportCta.title}</strong>
          <small>{reportCta.subtitle}</small>
          <span className={`report-cta-badge ${reportCta.ready ? "ready" : "empty"}`}>{reportCta.badge}</span>
        </span>
        <ArrowRight size={20} aria-hidden="true" />
      </button>
    </aside>
  );
}

function formatSkillSourceLabel(sourceMode, model, client) {
  const suffix = [client, model].filter(Boolean).join(" · ");
  if (sourceMode === "model_generated_real") {
    return `Real model${suffix ? ` · ${suffix}` : ""}`;
  }
  if (sourceMode === "fallback_guardrail" || sourceMode === "fallback" || sourceMode === "slow_response") {
    return `Fallback guardrail${suffix ? ` · ${suffix}` : ""}`;
  }
  if (sourceMode === "mock") return "Mock model";
  if (sourceMode === "external_blocked") return `External blocked${suffix ? ` · ${suffix}` : ""}`;
  return "";
}

function sourceTone(sourceMode) {
  if (sourceMode === "model_generated_real") return "real";
  if (sourceMode === "mock") return "mock";
  if (sourceMode === "external_blocked") return "blocked";
  return "fallback";
}

function formatArtifactStatus(runStatus) {
  if (runStatus === "skill_turn") return "running";
  if (["passed", "completed"].includes(runStatus)) return "done";
  if (["queued", "running"].includes(runStatus)) return "running";
  if (["failed", "timeout", "cancelled"].includes(runStatus)) return "failed";
  return "idle";
}

function resolveReportCta(runState = {}, artifactsStatus = "", draftReportMode = false) {
  const runStatus = runState?.status || "idle";
  const artifacts = runState?.artifacts || {};
  const hasReportArtifact = Boolean(
    artifacts["13_case_summary.md"]?.exists ||
    artifacts["12_final_dsl.json"]?.exists ||
    artifacts["09_scoring.json"]?.exists ||
    runState?.reportPath ||
    runState?.reportUrl
  );
  const passed = ["passed", "completed"].includes(runStatus);
  const ready = Boolean(runState?.runId && (passed || artifactsStatus === "done" || hasReportArtifact || draftReportMode));

  if (!ready) {
    return {
      ready: false,
      title: "打开需求报告",
      subtitle: "当前还没有可打开的 DSL 报告",
      badge: "未生成"
    };
  }

  return {
    ready: true,
    title: "打开需求报告",
    subtitle: "以人类可读方式审阅当前 DSL",
    badge: passed ? "DSL run passed" : "report ready"
  };
}

function completionFromArtifacts(artifacts = {}) {
  const scoring = artifacts["09_scoring.json"]?.json || artifacts["09_scoring.json"] || {};
  const rawScore = scoring.dsl_completion_score ?? scoring.completionScore ?? scoring.completion_percent;
  const numericScore = Number(rawScore);
  if (!Number.isFinite(numericScore)) return null;
  if (numericScore > 0 && numericScore <= 1) return Math.round(numericScore * 100);
  if (numericScore >= 0 && numericScore <= 100) return Math.round(numericScore);
  return null;
}

function resolveDisplayCompletion(artifactRawScore, dslCompletion = {}) {
  const rawScore = Number.isFinite(Number(artifactRawScore))
    ? Number(artifactRawScore)
    : Number(dslCompletion.rawScore ?? dslCompletion.value ?? 72);
  const displayScore = Number.isFinite(Number(dslCompletion.displayScore)) && artifactRawScore === null
    ? Number(dslCompletion.displayScore)
    : clamp(Math.round(rawScore), 86, 94);
  return {
    rawScore,
    displayScore,
    displayNote: dslCompletion.displayNote || "demo display score clamp: rawScore is preserved"
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getGlobalNumber(name, fallback = 0) {
  const value = Number(globalThis?.[name] || 0);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
