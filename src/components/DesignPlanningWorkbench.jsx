import { AlertTriangle, Check, CheckCircle2, Circle, ClipboardList, Eye, FileText, Play, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { checkAgentReadiness, getAgentArtifacts, getAgentRun, startAgentRun } from "../api/agentClient.js";
import { getDesignPlan, listPlanningTasks, updatePlanningTask } from "../api/persistenceClient.js";
import AgentWorkMatrix from "./AgentWorkMatrix.jsx";

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
  const [isAgentRunStarting, setIsAgentRunStarting] = useState(false);
  const hasTargetRepoPath = Boolean(resolveProjectLocalPath(activeProject));

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
    setPlanError("");
    const targetRepoPath = resolveProjectLocalPath(activeProject);
    try {
      const readiness = await checkAgentReadiness({ projectId: activeProject?.id, requirementId: activeRequirement?.id, targetRepoPath });
      onAgentWorkflowChange?.((current) => ({
        ...current,
        status: "ready",
        readiness,
        context: {
          projectId: activeProject?.id,
          projectName: activeProject?.name,
          requirementId: activeRequirement?.id,
          boundary: targetRepoPath ? "dry-run preview target selected" : "dry-run preview blocked: missing project localPath",
          targetRepoPath: targetRepoPath || "not_set",
          agent1EntryPoints: readiness.entrypoints
        },
        latestReturn: "Agent 输入 Context 已准备好，当前不会写入业务仓库。",
        error: null
      }));
      onToast?.("Agent 输入 Context 已准备好");
    } catch (error) {
      const message = error.message || "Agent API request failed";
      setPlanError(`Agent 输入 Context 准备失败：${message}`);
      onAgentWorkflowChange?.((current) => ({ ...current, status: "blocked", error: message }));
    }
  };

  const handlePlanPreview = async () => {
    setPlanError("");
    const targetRepoPath = resolveProjectLocalPath(activeProject);
    if (!targetRepoPath) {
      const message = "缺少项目路径，暂时不能生成 Agent dry-run 计划。";
      setPlanError(message);
      onAgentWorkflowChange?.((current) => ({
        ...current,
        status: "blocked",
        latestReturn: message,
        error: message
      }));
      return;
    }
    setIsAgentRunStarting(true);
    onAgentWorkflowChange?.((current) => ({
      ...current,
      status: "running",
      latestReturn: "正在生成 Agent dry-run 预览，不会写入业务仓库。",
      error: null
    }));
    try {
      const run = await startAgentRun({
        projectId: activeProject?.id,
        requirementId: activeRequirement?.id,
        requirementDsl: buildAgentRequirementDsl(activeRequirement, designPlan, planningTasks),
        taskTitle: activeRequirement?.title || designPlan?.title || "Workbench requirement implementation",
        dryRun: true,
        agentProvider: "agent2",
        targetRepoPath
      });
      const runFromApi = await getAgentRun(run.runId).catch(() => run);
      const artifactsFromApi = await getAgentArtifacts(run.runId).catch(() => ({ artifacts: run.artifacts || {} }));
      const artifacts = artifactsFromApi.artifacts || runFromApi.artifacts || run.artifacts || {};
      const stageEvents = coalesceStageEvents(
        runFromApi.stageEvents,
        runFromApi.activityTimeline,
        artifactsFromApi.stageEvents,
        artifactsFromApi.activityTimeline,
        run.stageEvents,
        run.activityTimeline
      );
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
        outputDir: runFromApi.outputDir || run.outputDir,
        relativeOutputDir: runFromApi.relativeOutputDir || run.relativeOutputDir,
        dryRun: runFromApi.dryRun ?? run.dryRun ?? true,
        realWritePerformed: runFromApi.realWritePerformed ?? run.realWritePerformed ?? false,
        executionResult: runFromApi.executionResult || run.executionResult || extractExecutionResultFromArtifacts(artifacts),
        reviewResult: runFromApi.reviewResult || run.reviewResult || null,
        agentProcess: runFromApi.agentProcess || run.agentProcess || null,
        stageEvents,
        activityTimeline: stageEvents,
        artifactError: artifactsFromApi.error || null,
        error: null
      }));
      onToast?.(`Agent dry-run 计划已生成：${runFromApi.runId || run.runId}`);
    } catch (error) {
      const message = error.message || "Agent API request failed";
      setPlanError(`Agent dry-run 计划生成失败：${message}`);
      onAgentWorkflowChange?.((current) => ({
        ...current,
        status: "blocked",
        latestReturn: "Agent dry-run 计划生成失败。",
        error: message
      }));
    } finally {
      setIsAgentRunStarting(false);
    }
  };

  const handleRealAgentRun = async () => {
    setPlanError("");
    const targetRepoPath = resolveProjectLocalPath(activeProject);
    if (!targetRepoPath) {
      const message = "缺少项目路径，暂时不能开始真实 Agent 执行。";
      setPlanError(message);
      onAgentWorkflowChange?.((current) => ({
        ...current,
        status: "blocked",
        latestReturn: message,
        error: message
      }));
      return;
    }
    const confirmed = window.confirm("本操作会让 Agent 在目标业务仓库中真实修改文件。确认继续？");
    if (!confirmed) return;
    setIsAgentRunStarting(true);
    onAgentWorkflowChange?.((current) => ({
      ...current,
      status: "running",
      latestReturn: "正在执行真实 Agent(2) 流程，目标业务仓库可能被修改。",
      error: null
    }));
    try {
      const run = await startAgentRun({
        projectId: activeProject?.id,
        requirementId: activeRequirement?.id,
        requirementDsl: buildAgentRequirementDsl(activeRequirement, designPlan, planningTasks),
        taskTitle: activeRequirement?.title || designPlan?.title || "Workbench requirement implementation",
        dryRun: false,
        realRunConfirm: true,
        agentProvider: "agent2",
        targetRepoPath,
        repoPath: targetRepoPath
      });
      const runFromApi = await getAgentRun(run.runId).catch(() => run);
      const artifactsFromApi = await getAgentArtifacts(run.runId).catch(() => ({ artifacts: run.artifacts || {} }));
      const artifacts = artifactsFromApi.artifacts || runFromApi.artifacts || run.artifacts || {};
      const stageEvents = coalesceStageEvents(
        runFromApi.stageEvents,
        runFromApi.activityTimeline,
        artifactsFromApi.stageEvents,
        artifactsFromApi.activityTimeline,
        run.stageEvents,
        run.activityTimeline
      );
      onAgentWorkflowChange?.((current) => ({
        ...current,
        status: runFromApi.status || run.status || "completed",
        runId: runFromApi.runId || run.runId,
        latestReturn: runFromApi.latestReturn || runFromApi.resultSummary || run.latestReturn,
        context: runFromApi.context || runFromApi.contextSnapshot || run.context,
        plan: runFromApi.plan || runFromApi.planJson || run.plan,
        review: runFromApi.review || artifactsFromApi.review || run.review,
        prDraft: runFromApi.prDraft || artifactsFromApi.prDraft || run.prDraft,
        changedFiles: runFromApi.changedFiles || run.changedFiles || runFromApi.review?.changedFiles || run.review?.changedFiles || [],
        artifacts,
        outputDir: runFromApi.outputDir || run.outputDir,
        relativeOutputDir: runFromApi.relativeOutputDir || run.relativeOutputDir,
        dryRun: runFromApi.dryRun ?? run.dryRun ?? false,
        realWritePerformed: runFromApi.realWritePerformed ?? run.realWritePerformed ?? false,
        executionResult: runFromApi.executionResult || run.executionResult || extractExecutionResultFromArtifacts(artifacts),
        reviewResult: runFromApi.reviewResult || run.reviewResult || null,
        agentProcess: runFromApi.agentProcess || run.agentProcess || null,
        stageEvents,
        activityTimeline: stageEvents,
        artifactError: artifactsFromApi.error || null,
        error: runFromApi.status === "failed" ? runFromApi.errorSummary || runFromApi.latestReturn || "Agent real-run failed." : null
      }));
      onToast?.(`真实 Agent 执行完成：${runFromApi.runId || run.runId}`);
    } catch (error) {
      const message = error.message || "Agent API request failed";
      setPlanError(`真实 Agent 执行失败：${message}`);
      onAgentWorkflowChange?.((current) => ({
        ...current,
        status: "blocked",
        latestReturn: "真实 Agent 执行失败。",
        error: message
      }));
    } finally {
      setIsAgentRunStarting(false);
    }
  };

  const visibleError = requirementError || planError;

  return (
    <main className="design-planning-workbench" data-testid="design-planning-workbench">
      <section className="planning-main">
        <header className="planning-page-heading">
          <div>
            <h1>设计规划</h1>
            <p>把 RequirementDSL 后半段编排成可审阅的 Agent dry-run 预览链路。</p>
          </div>
          <span>{activeProject?.name ?? "Codex Workbench"}</span>
        </header>

        {visibleError ? <p className="run-error-text" role="alert">{visibleError}</p> : null}

        <RequirementSummary requirement={activeRequirement} plan={designPlan} tasks={planningTasks} loading={isLoadingPlan} />

        <section className="planning-grid">
          <MilestonePanel
            plan={designPlan}
            tasks={planningTasks}
            agentWorkflow={agentWorkflow}
            isAgentRunStarting={isAgentRunStarting}
            hasTargetRepoPath={hasTargetRepoPath}
          />
          <TaskBreakdownPanel
            tasks={planningTasks}
            agentWorkflow={agentWorkflow}
            isAgentRunStarting={isAgentRunStarting}
            onStatusChange={handleTaskStatusChange}
          />
        </section>

        <ExecutionFeedbackPanel tasks={planningTasks} />
        <AgentExecutionPanel
          agentWorkflow={agentWorkflow}
          isStarting={isAgentRunStarting}
          hasTargetRepoPath={hasTargetRepoPath}
          onContextPreview={handleContextPreview}
          onPlanPreview={handlePlanPreview}
          onRealRun={handleRealAgentRun}
          onOpenReview={onOpenReview}
          onOpenPr={onOpenPr}
        />
      </section>

      <PlanningRightPanel plan={designPlan} tasks={planningTasks} />

      {toast ? <div className="selection-toast dsl-toast" role="status">{toast}</div> : null}
    </main>
  );
}

function resolveProjectLocalPath(project = {}) {
  const candidates = [project.localPath, project.path, project.projectRoot, project.railSubtitle]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean);
  return candidates.find((value) => /^[A-Za-z]:\\|^\\\\|^\//.test(value)) || "";
}

function buildAgentRequirementDsl(requirement = {}, plan = null, tasks = []) {
  const dsl = requirement?.dslJson && typeof requirement.dslJson === "object" ? requirement.dslJson : {};
  const taskTitle = requirement?.title || dsl.title || dsl.task_name || plan?.title || "Workbench requirement implementation";
  const rawPmInput = requirement?.rawPmInput || dsl.rawPmInput || dsl.user_story || dsl.description || taskTitle;
  const themeRequest = isThemeRequest(`${taskTitle} ${rawPmInput}`);
  const existingTargets = arrayOfStrings(dsl.target_modules || dsl.targetModules || dsl.targetFiles || dsl.target_files);
  const targetModules = themeRequest
    ? ["frontend/src/styles.css", "frontend/src/index.css", "frontend/src/App.jsx", ...existingTargets]
    : existingTargets.length ? existingTargets : ["frontend/src"];
  const acceptanceCriteria = [
    ...arrayOfStrings(dsl.acceptance_criteria || dsl.acceptanceCriteria || dsl.acceptance),
    ...arrayOfStrings(plan?.acceptanceCriteria),
    ...tasks.map((task) => task.title).filter(Boolean)
  ];
  return {
    ...dsl,
    id: requirement?.id || dsl.id,
    requirement_id: requirement?.id || dsl.requirement_id || dsl.id,
    title: taskTitle,
    task_name: dsl.task_name || taskTitle,
    user_story: rawPmInput,
    rawPmInput,
    description: dsl.description || rawPmInput,
    requirement_type: themeRequest ? "theme" : dsl.requirement_type || dsl.requirementType,
    target_modules: [...new Set(targetModules)],
    target_files: themeRequest ? ["frontend/src/styles.css", "frontend/src/index.css", "frontend/src/App.jsx"] : dsl.target_files || dsl.targetFiles,
    acceptance_criteria: acceptanceCriteria.length ? [...new Set(acceptanceCriteria)] : [rawPmInput],
    constraints: [
      ...arrayOfStrings(dsl.constraints),
      "Implement the PM-requested behavior in the real target repository.",
      "Prefer concrete code/style changes over placeholder comments."
    ],
    skill_hint: themeRequest ? "conduit-theme" : dsl.skill_hint || dsl.skillHint || ""
  };
}

function arrayOfStrings(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function normalizeStageEvents(value) {
  if (!Array.isArray(value)) return [];
  return value.map((stage, index) => ({
    ...stage,
    id: stage?.id || `${stage?.agent || "AgentStage"}-${index + 1}`,
    agent: stage?.agent || stage?.name || "AgentStage",
    title: stage?.title || stage?.summary || "",
    summary: stage?.summary || stage?.title || "",
    status: normalizeStageStatus(stage?.status),
    errorSummary: stage?.errorSummary || stage?.error || ""
  }));
}

function coalesceStageEvents(...values) {
  return normalizeStageEvents(values.find((value) => Array.isArray(value)) || []);
}

function normalizeStageStatus(status) {
  const value = String(status || "idle").toLowerCase();
  return ["idle", "running", "completed", "skipped", "blocked", "failed"].includes(value) ? value : "idle";
}

function isThemeRequest(text) {
  return /配色|主题|样式|黑红|暗色|深色|颜色|界面|ui|theme|style|css|palette|dark|red|black/i.test(String(text || ""));
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

function MilestonePanel({ plan, tasks, agentWorkflow = {}, isAgentRunStarting = false, hasTargetRepoPath = false }) {
  const milestones = buildMilestones(plan, tasks);
  const agentRunMilestones = buildAgentRunMilestones({
    agentWorkflow,
    isAgentRunStarting,
    hasTargetRepoPath
  });
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
      <section className="agent-run-milestones" aria-label="Agent 运行过程" data-testid="agent-run-milestones">
        <div className="agent-run-summary">
          <div>
            <span>Agent run process</span>
            <strong>{agentWorkflow.runId || (isAgentRunStarting ? "Starting real run" : "No run yet")}</strong>
          </div>
          <em className={`agent-run-state ${agentRunStateClass(agentWorkflow, isAgentRunStarting)}`}>
            {agentRunStateLabel(agentWorkflow, isAgentRunStarting)}
          </em>
        </div>
        <div className="agent-run-step-grid">
          {agentRunMilestones.map((step) => (
            <article className={`agent-run-step ${step.status}`} key={step.key}>
              <span aria-hidden="true">{step.index}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function TaskBreakdownPanel({ tasks, agentWorkflow = {}, isAgentRunStarting = false, onStatusChange }) {
  return (
    <section className="planning-card task-breakdown-panel" aria-label="任务拆解清单">
      <div className="planning-card-header">
        <h2>任务拆解清单 / Agent 工作矩阵</h2>
        <button type="button" aria-label="全部状态">全部状态</button>
      </div>
      <AgentWorkMatrix agentWorkflow={agentWorkflow} isStarting={isAgentRunStarting} />
      <div className="task-breakdown-table">
        <div className="task-table-row task-table-head">
          <span>任务项</span><span>负责人</span><span>状态</span><span>预计完成</span>
        </div>
        {tasks.length === 0 ? (
          <div className="task-table-row">
            <span><em>0.</em>暂无具体任务拆解。Agent 计划生成后会在这里展示任务列表。</span>
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

function AgentExecutionPanel({ agentWorkflow = {}, isStarting = false, hasTargetRepoPath = false, onContextPreview, onPlanPreview, onRealRun, onOpenReview, onOpenPr }) {
  const stageEvents = coalesceStageEvents(agentWorkflow.stageEvents, agentWorkflow.activityTimeline);
  const artifacts = Object.keys(agentWorkflow.artifacts || {});
  const statusInfo = resolveAgentPanelStatus(agentWorkflow, isStarting, hasTargetRepoPath);
  const latestStage = latestAgentStage(stageEvents);
  const latestSummary = latestAgentSummary(agentWorkflow, latestStage);
  const visibleArtifacts = buildAgentArtifactTags(agentWorkflow, artifacts);
  const dryRunValue = agentWorkflow.runId ? String(agentWorkflow.dryRun !== false) : "等待生成";
  const realWriteValue = agentWorkflow.realWritePerformed === true ? "true" : "false";
  const targetPath = agentWorkflow.context?.targetRepoPath || agentWorkflow.context?.localPath || "";
  return (
    <section className="planning-card agent-execution-panel" aria-label="Agent dry-run 预览控制台">
      <div className="planning-card-header">
        <div>
          <h2>Agent dry-run 预览控制台</h2>
          <p>当前只生成执行计划、审阅材料和 PR 草稿，不会直接修改业务仓库。</p>
        </div>
        <span className={`agent-status ${statusInfo.className}`}>{statusInfo.label}</span>
      </div>

      <div className="agent-orchestrator-layout">
        <section className="agent-status-summary" aria-label="当前状态">
          <span>当前状态</span>
          <strong>{statusInfo.title}</strong>
          <p>{statusInfo.description}</p>
          {agentWorkflow.runId ? <small>Run：{agentWorkflow.runId}</small> : <small>还没有 Agent 运行记录</small>}
        </section>

        <section className="agent-safety-boundary" aria-label="安全边界">
          <span>安全边界</span>
          <ul>
            <li>dryRun：{dryRunValue}</li>
            <li>realWritePerformed: {realWriteValue}</li>
            <li>真实执行必须二次确认</li>
            <li>{targetPath && targetPath !== "not_set" ? "项目路径通过后才允许真实执行" : "缺少项目路径时会阻止生成计划"}</li>
          </ul>
        </section>
      </div>

      <section className="agent-latest-return" aria-label="最近一次 Agent 返回">
        <div>
          <span>最近一次 Agent</span>
          <strong>{latestSummary.title}</strong>
        </div>
        <p>{latestSummary.detail}</p>
        {agentWorkflow.error ? <small>{agentWorkflow.error}</small> : null}
      </section>

      <section className="agent-artifact-strip" aria-label="可用产物">
        <span>可用产物</span>
        <div>
          {visibleArtifacts.length ? visibleArtifacts.map((artifact) => (
            <strong className={artifact.ready ? "ready" : "pending"} key={artifact.key}>{artifact.label}</strong>
          )) : <em>暂无可用产物</em>}
        </div>
      </section>

      <div className="agent-action-row">
        <button type="button" onClick={onContextPreview}><Eye size={15} />查看 Agent 输入 Context</button>
        <button type="button" onClick={onPlanPreview} disabled={isStarting || !hasTargetRepoPath}>
          {isStarting ? <ClipboardList size={15} /> : <Play size={15} />}
          {isStarting ? "正在生成 dry-run 计划" : hasTargetRepoPath ? "生成 Agent dry-run 计划" : "先绑定项目路径"}
        </button>
        <button type="button" onClick={onRealRun} disabled={isStarting || !hasTargetRepoPath}>
          <AlertTriangle size={15} />开始真实 Agent 执行
        </button>
        <button type="button" onClick={onOpenReview}><FileText size={15} />打开审阅页面</button>
        <button type="button" onClick={onOpenPr}><ClipboardList size={15} />打开 PR 页面</button>
      </div>
      {agentWorkflow.context ? (
        <pre className="agent-context-preview" data-testid="agent-context-preview">{JSON.stringify(agentWorkflow.context, null, 2)}</pre>
      ) : null}
      {agentWorkflow.runId ? (
        stageEvents.length ? (
          <div className="task-stage-detail-list" aria-label="Agent activity timeline">
            {stageEvents.map((stage, index) => (
              <span className={`task-stage-detail ${stage.status || "idle"}`} key={stage.id || `${stage.agent || "stage"}-${index}`}>
                <strong>{stage.agent || stage.title || "AgentStage"}</strong>
                <small>{stage.status || "idle"}</small>
              </span>
            ))}
          </div>
        ) : null
      ) : (
        <p className="monitor-empty-state">暂未启动 Agent dry-run。生成计划后，这里会展示真实阶段活动和产物。</p>
      )}
    </section>
  );
}

function resolveAgentPanelStatus(agentWorkflow = {}, isStarting = false, hasTargetRepoPath = false) {
  if (!hasTargetRepoPath) {
    return {
      className: "blocked",
      label: "缺少项目路径",
      title: "还不能生成 Agent dry-run",
      description: "需要先为项目绑定 localPath，之后才能准备 Agent 输入和预览计划。"
    };
  }
  if (isStarting || agentWorkflow.status === "running") {
    return {
      className: "active",
      label: "生成中",
      title: "正在生成 Agent dry-run 预览",
      description: "系统正在准备计划、审阅材料和 PR 草稿，不会写入业务仓库。"
    };
  }
  if (agentWorkflow.error || agentWorkflow.status === "blocked" || agentWorkflow.status === "failed") {
    return {
      className: "blocked",
      label: "需要处理",
      title: "Agent dry-run 暂未完成",
      description: "请查看最近一次返回或错误详情，处理后可重新生成 dry-run 计划。"
    };
  }
  if (agentWorkflow.runId) {
    return {
      className: "completed",
      label: "已有预览",
      title: "已生成 Agent dry-run 预览",
      description: "可以继续审阅产物，或进入 PR 页面检查草稿。"
    };
  }
  return {
    className: "ready",
    label: "可生成",
    title: "当前可以生成 Agent dry-run 预览",
    description: "将生成计划、审阅材料和 PR 草稿，不会直接写入业务仓库。"
  };
}

function latestAgentStage(stageEvents = []) {
  return [...stageEvents].reverse().find((stage) => stage.status && stage.status !== "idle") || stageEvents.at(-1) || null;
}

function latestAgentSummary(agentWorkflow = {}, latestStage = null) {
  if (!agentWorkflow.runId && !agentWorkflow.latestReturn) {
    return {
      title: "暂未启动 Agent dry-run",
      detail: "点击“生成 Agent dry-run 计划”后，这里会展示最近一次 Agent 做了什么。"
    };
  }
  if (agentWorkflow.error) {
    return {
      title: "最近一次生成失败",
      detail: agentWorkflow.latestReturn || "请查看错误详情后重试。"
    };
  }
  if (latestStage) {
    return {
      title: `${latestStage.agent || latestStage.title || "Agent 阶段"}：${stageStatusLabel(latestStage.status)}`,
      detail: latestStage.summary || agentWorkflow.latestReturn || "阶段状态已从真实运行记录同步。"
    };
  }
  return {
    title: agentWorkflow.runId ? "已记录 Agent dry-run" : "Agent 输入已准备",
    detail: agentWorkflow.latestReturn || "等待生成 dry-run 计划。"
  };
}

function buildAgentArtifactTags(agentWorkflow = {}, artifactKeys = []) {
  return [
    { key: "context", label: "Agent 输入 Context", ready: Boolean(agentWorkflow.context) },
    { key: "plan", label: "执行计划", ready: Boolean(agentWorkflow.plan || artifactKeys.some((key) => /plan/i.test(key))) },
    { key: "review", label: "审阅页", ready: Boolean(agentWorkflow.review || agentWorkflow.reviewResult) },
    { key: "pr", label: "PR 草稿", ready: Boolean(agentWorkflow.prDraft) },
    { key: "artifacts", label: "运行产物", ready: artifactKeys.length > 0 }
  ].filter((item) => item.ready);
}

function stageStatusLabel(status) {
  if (status === "completed") return "已完成";
  if (status === "running") return "进行中";
  if (status === "blocked") return "被阻断";
  if (status === "failed") return "失败";
  if (status === "skipped") return "已跳过";
  return "等待中";
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
              <span>{action.title}</span><strong>{action.priority || "待定"}</strong>
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

function buildAgentRunMilestones({ agentWorkflow = {}, isAgentRunStarting = false, hasTargetRepoPath = false }) {
  const hasRun = Boolean(agentWorkflow.runId);
  const hasError = Boolean(agentWorkflow.error) || agentWorkflow.status === "blocked" || agentWorkflow.status === "failed";
  const isRunning = isAgentRunStarting || agentWorkflow.status === "running";
  const artifacts = Object.keys(agentWorkflow.artifacts || {});
  const changedFiles = agentWorkflow.review?.changedFiles || [];
  const executionBlocked = isAgentExecutionBlocked(agentWorkflow);

  return [
    {
      key: "target",
      index: 1,
      title: "Repository target",
      detail: hasTargetRepoPath ? "Project localPath is bound and ready." : "Bind project localPath before running Agent.",
      status: hasTargetRepoPath ? "completed" : "blocked"
    },
    {
      key: "context",
      index: 2,
      title: "Context package",
      detail: agentWorkflow.context ? "Requirement and target repo context prepared." : "Waiting for context preview or run start.",
      status: agentWorkflow.context ? "completed" : hasTargetRepoPath ? "pending" : "blocked"
    },
    {
      key: "runtime",
      index: 3,
      title: "Dry-run preview",
      detail: isRunning ? "Agent dry-run preview is being generated." : hasRun ? `Run recorded: ${agentWorkflow.runId}` : "Preview not started.",
      status: isRunning ? "active" : hasRun ? "completed" : hasError ? "blocked" : "pending"
    },
    {
      key: "review",
      index: 4,
      title: "Review handoff",
      detail: changedFiles.length ? `${changedFiles.length} changed file(s) ready for audit.` : "No review items yet.",
      status: changedFiles.length ? "completed" : hasRun ? "active" : "pending"
    },
    {
      key: "artifacts",
      index: 5,
      title: "Artifacts",
      detail: artifacts.length ? `${artifacts.length} artifact(s) captured for traceability.` : "No artifacts captured yet.",
      status: artifacts.length ? "completed" : hasRun ? "blocked" : "pending"
    }
  ];
}

function agentRunStateClass(agentWorkflow = {}, isAgentRunStarting = false) {
  if (isAgentRunStarting || agentWorkflow.status === "running") return "active";
  if (agentWorkflow.error || agentWorkflow.status === "blocked" || agentWorkflow.status === "failed" || isAgentExecutionBlocked(agentWorkflow)) return "blocked";
  if (agentWorkflow.runId) return "active";
  return "pending";
}

function agentRunStateLabel(agentWorkflow = {}, isAgentRunStarting = false) {
  if (isAgentRunStarting || agentWorkflow.status === "running") return "running";
  if (agentWorkflow.error || agentWorkflow.status === "blocked" || agentWorkflow.status === "failed" || isAgentExecutionBlocked(agentWorkflow)) return "blocked";
  if (agentWorkflow.runId) return "finished";
  return "idle";
}

function extractExecutionResultFromArtifacts(artifacts = {}) {
  return artifacts?.["agent2_result_preview.json"]?.json?.result?.execution_result || null;
}

function agentExecutionSummary(agentWorkflow = {}) {
  return agentWorkflow.executionResult?.summary ||
    extractExecutionResultFromArtifacts(agentWorkflow.artifacts || {})?.summary ||
    "";
}

function isAgentExecutionBlocked(agentWorkflow = {}) {
  const executionResult = agentWorkflow.executionResult || extractExecutionResultFromArtifacts(agentWorkflow.artifacts || {});
  const summary = String(executionResult?.summary || "");
  return agentWorkflow.runId && agentWorkflow.realWritePerformed !== true && (
    agentWorkflow.review?.status === "blocked" ||
    executionResult?.executed === false && /blocked|not approved|missing review/i.test(summary)
  );
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
