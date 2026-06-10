import { AlertTriangle, Check, CheckCircle2, Circle, ClipboardList, Eye, FileText, Play, Users } from "lucide-react";
import { checkAgentReadiness, startAgentRun } from "../api/agentClient.js";
import {
  executionFeedback,
  milestones,
  nextActions,
  planningData,
  planningStatusLabels,
  planningSummary,
  risks,
  taskBreakdown
} from "../data/planningWorkbenchData.js";

export default function DesignPlanningWorkbench({
  activeProject,
  toast,
  onToast,
  agentWorkflow,
  onAgentWorkflowChange,
  onOpenReview,
  onOpenPr
}) {
  const handleContextPreview = async () => {
    const readiness = await checkAgentReadiness({ projectId: activeProject?.id });
    onAgentWorkflowChange((current) => ({
      ...current,
      status: "ready",
      readiness,
      context: {
        projectId: activeProject?.id,
        projectName: activeProject?.name,
        boundary: "dry-run preview only",
        agent1EntryPoints: readiness.entrypoints
      },
      latestReturn: "Agent input context preview is ready."
    }));
    onToast?.("Agent context preview ready");
  };

  const handlePlanPreview = async () => {
    onAgentWorkflowChange((current) => ({ ...current, status: "running", latestReturn: "Generating dry-run plan..." }));
    const run = await startAgentRun({
      projectId: activeProject?.id,
      taskTitle: "Login failure guidance implementation",
      dryRun: true
    });
    onAgentWorkflowChange((current) => ({
      ...current,
      status: "completed",
      runId: run.runId,
      latestReturn: run.latestReturn,
      context: run.context,
      plan: run.plan,
      review: run.review,
      prDraft: run.prDraft,
      artifacts: run.artifacts,
      error: null
    }));
    onToast?.("Agent dry-run plan generated");
  };

  return (
    <main className="design-planning-workbench" data-testid="design-planning-workbench">
      <section className="planning-main">
        <header className="planning-page-heading">
          <div>
            <h1>设计规划</h1>
            <p>把 RequirementDSL 后半段编排成可审阅的 Agent dry-run 流程。</p>
          </div>
          <span>{activeProject?.name ?? "Codex Workbench"}</span>
        </header>

        <RequirementSummary />

        <section className="planning-grid">
          <MilestonePanel />
          <TaskBreakdownPanel />
        </section>

        <ExecutionFeedbackPanel />
        <AgentExecutionPanel
          agentWorkflow={agentWorkflow}
          onContextPreview={handleContextPreview}
          onPlanPreview={handlePlanPreview}
          onOpenReview={onOpenReview}
          onOpenPr={onOpenPr}
        />
      </section>

      <PlanningRightPanel />

      {toast ? <div className="selection-toast dsl-toast" role="status">{toast}</div> : null}
    </main>
  );
}

function RequirementSummary() {
  return (
    <section className="planning-summary-card" aria-label="需求摘要">
      <div className="planning-summary-title">
        <span className="planning-summary-icon" aria-hidden="true"><FileText size={30} /></span>
        <div>
          <h2>{planningData.requirementTitle}</h2>
          <p><strong>目标</strong>{planningData.goal}</p>
        </div>
        <span className="planning-status-pill active">{planningData.status}</span>
      </div>

      <div className="planning-stage-track" aria-label="阶段进度">
        {milestones.map((milestone, index) => (
          <div className={`planning-stage-step ${milestone.status}`} key={milestone.name}>
            <span aria-hidden="true">{milestone.status === "completed" ? <Check size={13} /> : index + 1}</span>
            <strong>{milestone.name}</strong>
          </div>
        ))}
      </div>

      <dl className="planning-summary-meta">
        <div><dt>当前阶段</dt><dd>{planningData.currentStage}</dd></div>
        <div><dt>负责人</dt><dd><span className="planning-avatar">PM</span>{planningData.owner}</dd></div>
        <div><dt>执行角色</dt><dd><Users size={15} />{planningData.roles.join(" / ")}</dd></div>
      </dl>
    </section>
  );
}

function MilestonePanel() {
  return (
    <section className="planning-card milestone-panel" aria-label="实施阶段">
      <h2>实施阶段 / 里程碑</h2>
      <div className="milestone-timeline">
        {milestones.map((milestone) => (
          <article className={`milestone-item ${milestone.status}`} key={milestone.name}>
            <span className="milestone-node" aria-hidden="true" />
            <div>
              <div><h3>{milestone.name}</h3><time>{milestone.date}</time></div>
              <p>{milestone.description}</p>
              <span>{planningStatusLabels[milestone.status]}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TaskBreakdownPanel() {
  return (
    <section className="planning-card task-breakdown-panel" aria-label="任务拆解清单">
      <div className="planning-card-header">
        <h2>任务拆解清单</h2>
        <button type="button" aria-label="全部状态">全部状态</button>
      </div>
      <div className="task-breakdown-table">
        <div className="task-table-row task-table-head">
          <span>任务项</span><span>负责人</span><span>状态</span><span>预计完成</span>
        </div>
        {taskBreakdown.map((item, index) => (
          <div className="task-table-row" key={item.task}>
            <span><em>{index + 1}.</em>{item.task}</span>
            <span><OwnerBadge owner={item.owner} /></span>
            <span><StatusPill status={item.status} /></span>
            <span>{item.due}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExecutionFeedbackPanel() {
  return (
    <section className="planning-card execution-feedback-panel" aria-label="执行摘要">
      <div className="planning-card-header">
        <h2>执行摘要 / 最新进展</h2>
        <button type="button" aria-label="全部动态">全部动态</button>
      </div>
      <div className="execution-list">
        {executionFeedback.map((item) => (
          <article className={`execution-item ${item.tone}`} key={`${item.time}-${item.stage}`}>
            <span className="execution-dot" aria-hidden="true" />
            <time>{item.time}</time>
            <strong>{item.stage}</strong>
            <p>{item.text}</p>
            {item.badge ? <em>{item.badge}</em> : null}
            {item.link ? <button type="button">{item.link}</button> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function AgentExecutionPanel({ agentWorkflow, onContextPreview, onPlanPreview, onOpenReview, onOpenPr }) {
  const planSteps = agentWorkflow.plan?.steps || [];
  return (
    <section className="planning-card agent-execution-panel" aria-label="Agent execution entry">
      <div className="planning-card-header">
        <h2>Agent Execution Orchestrator</h2>
        <span className={`agent-status ${agentWorkflow.status}`}>{agentWorkflow.status}</span>
      </div>
      <div className="agent-entry-grid">
        <article><strong>当前任务可执行性</strong><p>{agentWorkflow.readiness?.canRunDryRun ? "Ready for dry-run preview" : "Awaiting readiness check"}</p></article>
        <article><strong>执行边界</strong><p>Default dry-run. Real writes are blocked until explicit future confirmation.</p></article>
        <article><strong>最新 Agent 回返</strong><p>{agentWorkflow.latestReturn}</p></article>
      </div>
      <div className="agent-action-row">
        <button type="button" onClick={onContextPreview}><Eye size={15} />查看 Agent 输入 Context</button>
        <button type="button" onClick={onPlanPreview}><ClipboardList size={15} />仅生成执行计划</button>
        <button type="button" onClick={onPlanPreview}><Play size={15} />开始执行当前任务</button>
        <button type="button" onClick={onOpenReview}>打开审计页面</button>
        <button type="button" onClick={onOpenPr}>打开 PR 页面</button>
      </div>
      {agentWorkflow.context ? (
        <pre className="agent-context-preview" data-testid="agent-context-preview">{JSON.stringify(agentWorkflow.context, null, 2)}</pre>
      ) : null}
      {planSteps.length ? (
        <ol className="agent-plan-list">
          {planSteps.map((step) => (
            <li key={step.name}><strong>{step.name}</strong><span>{step.owner}</span><p>{step.output}</p></li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function PlanningRightPanel() {
  return (
    <aside className="planning-right-panel" aria-label="设计规划状态面板">
      <section className="planning-side-card progress-card">
        <h2>总体进度</h2>
        <div className="progress-layout">
          <div className="planning-progress-ring" style={{ "--planning-completion": `${planningSummary.completion}%` }}>
            <strong>{planningSummary.completion}%</strong><span>整体完成度</span>
          </div>
          <div className="progress-legend">
            {planningSummary.stats.map((item) => (
              <div key={item.label}>
                <span className={`legend-dot ${item.status}`} />
                <strong>{item.label}</strong><em>{item.count} 项</em><small>{item.percent}%</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="planning-side-card current-stage-card">
        <div><h2>当前阶段状态</h2><span>预计完成 {planningSummary.currentStage.due}</span></div>
        <strong><span className="legend-dot active" />{planningSummary.currentStage.name}</strong>
        <p>{planningSummary.currentStage.description}</p>
      </section>

      <section className="planning-side-card risk-planning-card">
        <h2>风险 / 阻塞项</h2>
        <div className="blocker-banner"><AlertTriangle size={17} /><strong>1 项阻塞</strong><p>{risks.blockers[0]}</p></div>
        <h3>关注风险</h3>
        <ul>{risks.watched.map((risk) => <li key={risk}>{risk}</li>)}</ul>
        <button type="button">查看全部</button>
      </section>

      <section className="planning-side-card next-actions-card">
        <h2>下一步建议</h2>
        <div>
          {nextActions.map((action) => (
            <article key={action.text}>
              {action.status === "completed" ? <CheckCircle2 size={18} /> : <Circle size={18} />}
              <span>{action.text}</span><strong>{action.priority}</strong>
            </article>
          ))}
        </div>
        <button type="button">查看全部建议</button>
      </section>
    </aside>
  );
}

function OwnerBadge({ owner }) {
  const label = owner === "PM" ? "PM" : owner.slice(0, 1);
  return <span className={`owner-badge ${owner === "PM" ? "pm" : ""}`}><span>{label}</span>{owner}</span>;
}

function StatusPill({ status }) {
  return <span className={`planning-status-pill ${status}`}>{planningStatusLabels[status]}</span>;
}
