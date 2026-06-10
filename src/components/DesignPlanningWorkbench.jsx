import { AlertTriangle, Check, CheckCircle2, Circle, ClipboardList, Eye, FileText, Play, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { checkAgentReadiness, getAgentArtifacts, getAgentRun, startAgentRun } from "../api/agentClient.js";
import { getDesignPlan, listPlanningTasks, updatePlanningTask } from "../api/persistenceClient.js";

const planningStatusLabels = {
  todo: "未开始",
  running: "进行中",
  blocked: "阻塞",
  done: "已完成",
  needs_review: "待审阅",
  cancelled: "已取消"
};

const statusOptions = Object.entries(planningStatusLabels);

export default function DesignPlanningWorkbench({
  activeProject,
  activeRequirement,
  requirementError,
  toast,
  onToast,
  agentWorkflow,
  onAgentWorkflowChange,
  onOpenReview,
  onOpenPr
}) {
  const [designPlan, setDesignPlan] = useState(null);
  const [planningTasks, setPlanningTasks] = useState([]);
  const [planError, setPlanError] = useState("");
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);

  useEffect(() => {
    let active = true;
    setDesignPlan(null);
    setPlanningTasks([]);
    setPlanError("");
    if (!activeRequirement?.id) return () => {
      active = false;
    };

    setIsLoadingPlan(true);
    getDesignPlan(activeRequirement.id)
      .then(async (plan) => {
        const tasks = await listPlanningTasks(plan.id);
        if (!active) return;
        setDesignPlan(plan);
        setPlanningTasks(Array.isArray(tasks) ? tasks : []);
      })
      .catch((error) => {
        if (!active) return;
        if (error.payload?.error?.code === "design_plan_not_found") {
          setDesignPlan(null);
          setPlanningTasks([]);
        } else {
          setPlanError(`设计规划加载失败：${error.message || "Persistence API request failed"}`);
        }
      })
      .finally(() => {
        if (active) setIsLoadingPlan(false);
      });

    return () => {
      active = false;
    };
  }, [activeRequirement?.id]);

  const handleTaskStatusChange = async (taskId, status) => {
    setPlanningTasks((current) => current.map((task) => task.id === taskId ? { ...task, status } : task));
    try {
      const updated = await updatePlanningTask(taskId, { status });
      setPlanningTasks((current) => current.map((task) => task.id === taskId ? updated : task));
      onToast?.("任务状态已保存");
    } catch (error) {
      setPlanError(`任务状态保存失败：${error.message || "Persistence API request failed"}`);
    }
  };

  const handleContextPreview = async () => {
    const readiness = await checkAgentReadiness({ projectId: activeProject?.id, requirementId: activeRequirement?.id });
    onAgentWorkflowChange?.((current) => ({
      ...current,
      status: "ready",
      readiness,
      context: {
        projectId: activeProject?.id,
        projectName: activeProject?.name,
        requirementId: activeRequirement?.id,
        boundary: "dry-run preview only",
        agent1EntryPoints: readiness.entrypoints
      },
      latestReturn: "Agent input context preview is ready."
    }));
    onToast?.("Agent context preview ready");
  };

  const handlePlanPreview = async () => {
    onAgentWorkflowChange?.((current) => ({ ...current, status: "running", latestReturn: "Generating dry-run plan..." }));
    const run = await startAgentRun({
      projectId: activeProject?.id,
      requirementId: activeRequirement?.id,
      requirementDsl: activeRequirement?.dslJson || {},
      taskTitle: activeRequirement?.title || designPlan?.title || "Workbench requirement implementation",
      dryRun: true
    });
    const runFromApi = await getAgentRun(run.runId).catch(() => run);
    const artifactsFromApi = await getAgentArtifacts(run.runId).catch(() => ({ artifacts: run.artifacts || {} }));
    const artifacts = artifactsFromApi.artifacts || runFromApi.artifacts || run.artifacts || {};
    onAgentWorkflowChange?.((current) => ({
      ...current,
      status: runFromApi.status || "completed",
      runId: runFromApi.runId || run.runId,
      latestReturn: runFromApi.latestReturn || runFromApi.resultSummary || run.latestReturn,
      context: runFromApi.context || runFromApi.contextSnapshot || run.context,
      plan: runFromApi.plan || runFromApi.planJson || run.plan,
      review: runFromApi.review || run.review,
      prDraft: runFromApi.prDraft || run.prDraft,
      artifacts,
      artifactError: artifactsFromApi.error || null,
      error: null
    }));
    onToast?.("Agent dry-run plan generated");
  };

  const visibleError = requirementError || planError;

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

        {visibleError ? <p className="run-error-text" role="alert">{visibleError}</p> : null}

        <RequirementSummary requirement={activeRequirement} plan={designPlan} tasks={planningTasks} loading={isLoadingPlan} />

        <section className="planning-grid">
          <MilestonePanel plan={designPlan} tasks={planningTasks} />
          <TaskBreakdownPanel tasks={planningTasks} onStatusChange={handleTaskStatusChange} />
        </section>

        <ExecutionFeedbackPanel tasks={planningTasks} />
        <AgentExecutionPanel
          agentWorkflow={agentWorkflow}
          onContextPreview={handleContextPreview}
          onPlanPreview={handlePlanPreview}
          onOpenReview={onOpenReview}
          onOpenPr={onOpenPr}
        />
      </section>

      <PlanningRightPanel plan={designPlan} tasks={planningTasks} />

      {toast ? <div className="selection-toast dsl-toast" role="status">{toast}</div> : null}
    </main>
  );
}

function RequirementSummary({ requirement, plan, tasks, loading }) {
  const title = plan?.title || requirement?.title || "暂无规划记录";
  const summary = plan?.summary || requirement?.rawPmInput || (loading ? "正在读取设计规划..." : "当前 requirement 还没有持久化设计规划。");
  const status = plan ? stageLabel(plan.currentStage) : "空状态";
  return (
    <section className="planning-summary-card" aria-label="需求摘要">
      <div className="planning-summary-title">
        <span className="planning-summary-icon" aria-hidden="true"><FileText size={30} /></span>
        <div>
          <h2>{title}</h2>
          <p><strong>目标</strong>{summary}</p>
        </div>
        <span className={`planning-status-pill ${plan ? "active" : "pending"}`}>{status}</span>
      </div>

      <div className="planning-stage-track" aria-label="阶段进度">
        {buildMilestones(plan, tasks).map((milestone, index) => (
          <div className={`planning-stage-step ${milestone.status}`} key={milestone.name}>
            <span aria-hidden="true">{milestone.status === "completed" ? <Check size={13} /> : index + 1}</span>
            <strong>{milestone.name}</strong>
          </div>
        ))}
      </div>

      <dl className="planning-summary-meta">
        <div><dt>当前阶段</dt><dd>{plan?.currentStage || "未创建"}</dd></div>
        <div><dt>负责人</dt><dd><span className="planning-avatar">PM</span>{primaryOwner(tasks)}</dd></div>
        <div><dt>执行角色</dt><dd><Users size={15} />{[...new Set(tasks.map((task) => task.owner).filter(Boolean))].join(" / ") || "待分配"}</dd></div>
      </dl>
    </section>
  );
}

function MilestonePanel({ plan, tasks }) {
  const milestones = buildMilestones(plan, tasks);
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
              <span>{milestone.label}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TaskBreakdownPanel({ tasks, onStatusChange }) {
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
        {tasks.length === 0 ? (
          <div className="task-table-row">
            <span><em>0.</em>暂无任务拆解。设计规划保存后会从 API 恢复。</span>
            <span>待分配</span><span>空状态</span><span>-</span>
          </div>
        ) : tasks.map((item, index) => (
          <div className="task-table-row" key={item.id || item.title}>
            <span><em>{index + 1}.</em>{item.title}</span>
            <span><OwnerBadge owner={item.owner || "待分配"} /></span>
            <span><StatusSelect task={item} onStatusChange={onStatusChange} /></span>
            <span>{item.dueDate || "-"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExecutionFeedbackPanel({ tasks }) {
  const feedback = tasks.slice(0, 3);
  return (
    <section className="planning-card execution-feedback-panel" aria-label="执行摘要">
      <div className="planning-card-header">
        <h2>执行摘要 / 最新进展</h2>
        <button type="button" aria-label="全部动态">全部动态</button>
      </div>
      <div className="execution-list">
        {feedback.length === 0 ? (
          <article className="execution-item pending">
            <span className="execution-dot" aria-hidden="true" />
            <time>现在</time>
            <strong>空状态</strong>
            <p>暂无持久化执行动态。</p>
          </article>
        ) : feedback.map((item) => (
          <article className={`execution-item ${statusClass(item.status)}`} key={item.id || item.title}>
            <span className="execution-dot" aria-hidden="true" />
            <time>{item.updatedAt ? "已更新" : "计划中"}</time>
            <strong>{planningStatusLabels[item.status] || item.status}</strong>
            <p>{item.title}</p>
            {item.priority ? <em>{item.priority}</em> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function AgentExecutionPanel({ agentWorkflow = {}, onContextPreview, onPlanPreview, onOpenReview, onOpenPr }) {
  const planSteps = agentWorkflow.plan?.steps || [];
  const artifactCount = Object.keys(agentWorkflow.artifacts || {}).length;
  return (
    <section className="planning-card agent-execution-panel" aria-label="Agent execution entry">
      <div className="planning-card-header">
        <h2>Agent Execution Orchestrator</h2>
        <span className={`agent-status ${agentWorkflow.status}`}>{agentWorkflow.status || "idle"}</span>
      </div>
      <div className="agent-entry-grid">
        <article><strong>当前任务可执行性</strong><p>{agentWorkflow.readiness?.canRunDryRun ? "Ready for dry-run preview" : "Awaiting readiness check"}</p></article>
        <article><strong>执行边界</strong><p>Default dry-run. Real writes are blocked until explicit future confirmation.</p></article>
        <article><strong>最新 Agent 回返</strong><p>{agentWorkflow.latestReturn || "No agent dry-run has been started."}</p></article>
      </div>
      <div className="agent-action-row">
        <button type="button" onClick={onContextPreview}><Eye size={15} />查看 Agent 输入 Context</button>
        <button type="button" onClick={onPlanPreview}><ClipboardList size={15} />仅生成执行计划</button>
        <button type="button" onClick={onPlanPreview}><Play size={15} />开始执行当前任务</button>
        <button type="button" onClick={onOpenReview}>打开审计页面</button>
        <button type="button" onClick={onOpenPr}>打开 PR 页面</button>
      </div>
      <div className="agent-entry-grid">
        <article><strong>Run 状态</strong><p>{agentWorkflow.runId || "尚未生成 run"}</p></article>
        <article><strong>Artifacts</strong><p>{artifactCount ? `${artifactCount} 个 API artifact` : "暂无 API artifacts"}</p></article>
        <article><strong>真实写文件</strong><p>{agentWorkflow.realWritePerformed ? "blocked violation" : "dry-run only"}</p></article>
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

function PlanningRightPanel({ plan, tasks }) {
  const stats = summarizeTasks(tasks);
  const completion = plan?.overallProgress ?? stats.completion;
  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const nextActions = tasks.filter((task) => !["done", "cancelled"].includes(task.status)).slice(0, 3);
  return (
    <aside className="planning-right-panel" aria-label="设计规划状态面板">
      <section className="planning-side-card progress-card">
        <h2>总体进度</h2>
        <div className="progress-layout">
          <div className="planning-progress-ring" style={{ "--planning-completion": `${completion}%` }}>
            <strong>{completion}%</strong><span>整体完成度</span>
          </div>
          <div className="progress-legend">
            {stats.items.map((item) => (
              <div key={item.label}>
                <span className={`legend-dot ${item.status}`} />
                <strong>{item.label}</strong><em>{item.count} 项</em><small>{item.percent}%</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="planning-side-card current-stage-card">
        <div><h2>当前阶段状态</h2><span>预计完成 {nextActions[0]?.dueDate || "-"}</span></div>
        <strong><span className="legend-dot active" />{plan?.currentStage || "未创建"}</strong>
        <p>{plan?.summary || "暂无持久化设计规划。"}</p>
      </section>

      <section className="planning-side-card risk-planning-card">
        <h2>风险 / 阻塞项</h2>
        <div className="blocker-banner"><AlertTriangle size={17} /><strong>{blockedTasks.length} 项阻塞</strong><p>{blockedTasks[0]?.blockedReason || blockedTasks[0]?.title || "暂无阻塞项"}</p></div>
        <h3>关注风险</h3>
        <ul>{blockedTasks.length ? blockedTasks.map((task) => <li key={task.id}>{task.title}</li>) : <li>暂无持久化风险</li>}</ul>
        <button type="button">查看全部</button>
      </section>

      <section className="planning-side-card next-actions-card">
        <h2>下一步建议</h2>
        <div>
          {nextActions.length ? nextActions.map((action) => (
            <article key={action.id || action.title}>
              {action.status === "done" ? <CheckCircle2 size={18} /> : <Circle size={18} />}
              <span>{action.title}</span><strong>{action.priority || "P2"}</strong>
            </article>
          )) : (
            <article>
              <Circle size={18} />
              <span>暂无下一步任务</span><strong>-</strong>
            </article>
          )}
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

function StatusSelect({ task, onStatusChange }) {
  return (
    <select
      className={`planning-status-pill ${statusClass(task.status)}`}
      aria-label={`任务状态 ${task.title}`}
      value={task.status || "todo"}
      onChange={(event) => onStatusChange?.(task.id, event.target.value)}
    >
      {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select>
  );
}

function buildMilestones(plan, tasks) {
  const hasPlan = Boolean(plan);
  const hasRunning = tasks.some((task) => task.status === "running");
  const hasReview = tasks.some((task) => task.status === "needs_review");
  const allDone = tasks.length > 0 && tasks.every((task) => task.status === "done");
  return [
    {
      name: "需求确认",
      description: hasPlan ? "Requirement 已从数据库读取。" : "等待持久化 Requirement。",
      date: "-",
      status: hasPlan ? "completed" : "pending",
      label: hasPlan ? "已读取" : "空状态"
    },
    {
      name: "方案设计",
      description: plan?.summary || "暂无设计规划。",
      date: "-",
      status: hasPlan ? "active" : "pending",
      label: stageLabel(plan?.currentStage)
    },
    {
      name: "开发中",
      description: `${tasks.length} 个任务来自数据库。`,
      date: "-",
      status: hasRunning ? "active" : allDone ? "completed" : "pending",
      label: hasRunning ? "进行中" : allDone ? "已完成" : "未开始"
    },
    {
      name: "待审阅",
      description: "Agent dry-run 审阅入口保持人工确认。",
      date: "-",
      status: hasReview ? "active" : allDone ? "completed" : "pending",
      label: hasReview ? "待审阅" : "等待任务"
    }
  ];
}

function summarizeTasks(tasks) {
  const total = tasks.length || 1;
  const groups = [
    ["已完成", "done", "completed"],
    ["进行中", "running", "active"],
    ["未开始", "todo", "pending"],
    ["阻塞", "blocked", "blocked"]
  ].map(([label, status, className]) => {
    const count = tasks.filter((task) => task.status === status).length;
    return { label, count, percent: Math.round((count / total) * 100), status: className };
  });
  const completion = Math.round((tasks.filter((task) => task.status === "done").length / total) * 100);
  return { items: groups, completion };
}

function primaryOwner(tasks) {
  return tasks.find((task) => task.owner)?.owner || "待分配";
}

function stageLabel(stage) {
  if (!stage) return "未创建";
  if (stage === "design") return "方案设计";
  if (stage === "development") return "开发中";
  if (stage === "review") return "待审阅";
  return stage;
}

function statusClass(status) {
  if (status === "done") return "completed";
  if (status === "running" || status === "needs_review") return "active";
  if (status === "blocked" || status === "cancelled") return "blocked";
  return "pending";
}
