import { AlertTriangle, Check, CheckCircle2, Circle, ClipboardList, Eye, FileText, Play, Plus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { checkAgentReadiness, getAgentArtifacts, getAgentRun, startAgentRun } from "../api/agentClient.js";
import { getDesignPlan, getRequirement, listPlanningTasks, updatePlanningTask, upsertDesignPlan } from "../api/persistenceClient.js";
import AgentWorkMatrix from "./AgentWorkMatrix.jsx";

const unavailable = "unavailable";

const planningStatusLabels = {
  todo: "Todo",
  running: "Running",
  blocked: "Blocked",
  done: "Done",
  needs_review: "Needs review",
  cancelled: "Cancelled"
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
  const [requirementRecord, setRequirementRecord] = useState(activeRequirement || null);
  const [designPlan, setDesignPlan] = useState(null);
  const [planningTasks, setPlanningTasks] = useState([]);
  const [planError, setPlanError] = useState("");
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [isAgentRunStarting, setIsAgentRunStarting] = useState(false);
  const hasTargetRepoPath = Boolean(resolveProjectLocalPath(activeProject));

  useEffect(() => {
    let active = true;
    setRequirementRecord(activeRequirement || null);
    setDesignPlan(null);
    setPlanningTasks([]);
    setPlanError("");
    if (!activeRequirement?.id) return () => {
      active = false;
    };

    setIsLoadingPlan(true);
    loadDesignPlanningData(activeRequirement.id, activeRequirement)
      .then(({ requirement, plan, tasks }) => {
        if (!active) return;
        setRequirementRecord(requirement);
        setDesignPlan(plan);
        setPlanningTasks(tasks);
      })
      .catch((error) => {
        if (!active) return;
        setPlanError(formatApiError("Design planning load failed", error));
      })
      .finally(() => {
        if (active) setIsLoadingPlan(false);
      });

    return () => {
      active = false;
    };
  }, [activeRequirement?.id]);

  const normalizedRequirement = useMemo(() => normalizeRequirement(requirementRecord || activeRequirement || {}), [requirementRecord, activeRequirement]);
  const normalizedPlan = useMemo(() => normalizePlan(designPlan), [designPlan]);
  const normalizedTasks = useMemo(() => planningTasks.map(normalizeTask), [planningTasks]);
  const taskStats = useMemo(() => summarizeTasks(normalizedTasks), [normalizedTasks]);

  const handleCreateDesignPlan = async () => {
    if (!activeRequirement?.id) return;
    setIsCreatingPlan(true);
    setPlanError("");
    try {
      const created = await upsertDesignPlan(activeRequirement.id, {
        title: normalizedRequirement.title !== unavailable ? normalizedRequirement.title : "Design plan"
      });
      const tasks = created?.id ? await listPlanningTasks(created.id) : [];
      setDesignPlan(created || null);
      setPlanningTasks(Array.isArray(tasks) ? tasks : []);
      onToast?.("Design plan created");
    } catch (error) {
      setPlanError(formatApiError("Create design plan failed", error));
    } finally {
      setIsCreatingPlan(false);
    }
  };

  const handleTaskStatusChange = async (taskId, status) => {
    if (!taskId) return;
    const previousTasks = planningTasks;
    setPlanningTasks((current) => current.map((task) => task.id === taskId ? { ...task, status } : task));
    setPlanError("");
    try {
      const updated = await updatePlanningTask(taskId, { status });
      setPlanningTasks((current) => current.map((task) => task.id === taskId ? updated : task));
      onToast?.("Planning task saved");
    } catch (error) {
      setPlanningTasks(previousTasks);
      setPlanError(formatApiError("Planning task save failed", error));
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
          boundary: targetRepoPath ? "real agent target selected" : "real agent run requires project localPath",
          targetRepoPath: targetRepoPath || "not_set",
          agent1EntryPoints: readiness.entrypoints
        },
        latestReturn: "Agent input context is ready. No repository write has happened yet.",
        error: null
      }));
      onToast?.("Agent input context is ready");
    } catch (error) {
      const message = error.message || "Agent API request failed";
      setPlanError(formatApiError("Agent input context failed", error));
      onAgentWorkflowChange?.((current) => ({ ...current, status: "blocked", error: message }));
    }
  };

  const handlePlanPreview = async () => {
    setPlanError("");
    const targetRepoPath = resolveProjectLocalPath(activeProject);
    if (!targetRepoPath) {
      const message = "Missing project localPath. The backend needs a real repository path before starting Agent run.";
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
      latestReturn: "Starting real Agent run in an isolated workspace.",
      error: null
    }));
    try {
      const run = await startAgentRun({
        projectId: activeProject?.id,
        requirementId: activeRequirement?.id,
        requirementDsl: buildAgentRequirementDsl(requirementRecord || activeRequirement, designPlan, planningTasks),
        taskTitle: normalizedRequirement.title !== unavailable ? normalizedRequirement.title : normalizedPlan.title,
        dryRun: false,
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
        workspace: runFromApi.workspace || run.workspace || current.workspace || null,
        workspacePath: runFromApi.workspacePath || runFromApi.workspace?.workspacePath || run.workspacePath || run.workspace?.workspacePath || current.workspacePath || "",
        sourceRepoPath: runFromApi.sourceRepoPath || runFromApi.workspace?.sourceRepoPath || run.sourceRepoPath || run.workspace?.sourceRepoPath || current.sourceRepoPath || targetRepoPath,
        targetRepoPath: runFromApi.targetRepoPath || runFromApi.workspacePath || runFromApi.workspace?.workspacePath || run.targetRepoPath || run.workspacePath || run.workspace?.workspacePath || current.targetRepoPath || "",
        dryRun: runFromApi.dryRun ?? run.dryRun ?? false,
        realWritePerformed: runFromApi.realWritePerformed ?? run.realWritePerformed ?? false,
        executionResult: runFromApi.executionResult || run.executionResult || extractExecutionResultFromArtifacts(artifacts),
        reviewResult: runFromApi.reviewResult || run.reviewResult || null,
        agentProcess: runFromApi.agentProcess || run.agentProcess || null,
        stageEvents,
        activityTimeline: stageEvents,
        artifactError: artifactsFromApi.error || null,
        error: null
      }));
      onToast?.(`Real Agent run completed: ${runFromApi.runId || run.runId}`);
    } catch (error) {
      const message = error.message || "Agent API request failed";
      setPlanError(formatApiError("Real Agent run failed", error));
      onAgentWorkflowChange?.((current) => ({
        ...current,
        status: "blocked",
        latestReturn: "Real Agent run failed.",
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
            <p>Live planning state mapped from persistence APIs, with real Agent run controls preserved.</p>
          </div>
          <span>{activeProject?.name ?? "Codex Workbench"}</span>
        </header>

        {visibleError ? <ErrorState message={visibleError} /> : null}

        <RequirementSummary requirement={normalizedRequirement} plan={normalizedPlan} tasks={normalizedTasks} loading={isLoadingPlan} stats={taskStats} />

        {!isLoadingPlan && !designPlan ? (
          <EmptyDesignPlanState isCreating={isCreatingPlan} onCreate={handleCreateDesignPlan} />
        ) : null}

        <section className="planning-grid">
          <MilestonePanel
            plan={normalizedPlan}
            rawPlan={designPlan}
            agentWorkflow={agentWorkflow}
            isAgentRunStarting={isAgentRunStarting}
            hasTargetRepoPath={hasTargetRepoPath}
          />
          <TaskBreakdownPanel
            tasks={normalizedTasks}
            agentWorkflow={agentWorkflow}
            isAgentRunStarting={isAgentRunStarting}
            onPlanPreview={handlePlanPreview}
            onStatusChange={handleTaskStatusChange}
          />
        </section>

        <ExecutionFeedbackPanel plan={normalizedPlan} />
        <AgentExecutionPanel
          agentWorkflow={agentWorkflow}
          isStarting={isAgentRunStarting}
          hasTargetRepoPath={hasTargetRepoPath}
          onContextPreview={handleContextPreview}
          onPlanPreview={handlePlanPreview}
          onOpenReview={onOpenReview}
          onOpenPr={onOpenPr}
        />
      </section>

      <PlanningRightPanel plan={normalizedPlan} tasks={normalizedTasks} stats={taskStats} />

      {toast ? <div className="selection-toast dsl-toast" role="status">{toast}</div> : null}
    </main>
  );
}

async function loadDesignPlanningData(requirementId, activeRequirement) {
  let requirement = activeRequirement || null;
  try {
    const fetchedRequirement = await getRequirement(requirementId);
    requirement = hasRecordData(fetchedRequirement) ? { ...(activeRequirement || {}), ...fetchedRequirement } : activeRequirement;
  } catch (error) {
    if (error.payload?.error?.code !== "requirement_not_found") {
      throw error;
    }
    throw error;
  }

  try {
    const plan = await getDesignPlan(requirementId);
    const tasks = plan?.id ? await listPlanningTasks(plan.id) : [];
    return { requirement, plan: plan || null, tasks: Array.isArray(tasks) ? tasks : [] };
  } catch (error) {
    if (error.payload?.error?.code === "design_plan_not_found") {
      return { requirement, plan: null, tasks: [] };
    }
    throw error;
  }
}

function resolveProjectLocalPath(project = {}) {
  const candidates = [project.localPath, project.path, project.projectRoot, project.railSubtitle]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean);
  return candidates.find((value) => /^[A-Za-z]:\\|^\\\\|^\//.test(value)) || "";
}

function normalizeRequirement(requirement = {}) {
  return {
    id: readValue(requirement, "id"),
    title: readValue(requirement, "title"),
    goal: readValue(requirement, "goal"),
    rawPmInput: readValue(requirement, "rawPmInput", "raw_pm_input"),
    status: readValue(requirement, "status", "readinessStatus", "readiness_status", "dslReadiness"),
    readiness: readValue(requirement, "readiness", "readinessStatus", "readiness_status", "readyForAgent", "ready_for_agent"),
    handoffDecision: readValue(requirement, "handoffDecision", "handoff_decision"),
    dslJson: requirement.dslJson || requirement.dsl_json || null,
    updatedAt: readValue(requirement, "updatedAt", "updated_at")
  };
}

function hasRecordData(value) {
  return value && typeof value === "object" && Object.keys(value).length > 0;
}

function normalizePlan(plan = null) {
  if (!plan) {
    return {
      exists: false,
      title: unavailable,
      goal: unavailable,
      status: unavailable,
      currentStage: unavailable,
      owner: unavailable,
      roles: [],
      completion: null,
      milestones: null,
      blockers: null,
      watchedRisks: null,
      nextActions: null,
      latestFeedback: unavailable,
      updatedAt: unavailable
    };
  }
  return {
    exists: true,
    id: readValue(plan, "id"),
    title: readValue(plan, "title"),
    goal: readValue(plan, "goal"),
    summary: readValue(plan, "summary"),
    status: readValue(plan, "status"),
    currentStage: readValue(plan, "currentStage", "current_stage"),
    owner: readValue(plan, "owner"),
    roles: arrayOfStrings(plan.roles),
    completion: numberOrNull(plan.completion ?? plan.overallProgress ?? plan.overall_progress),
    milestones: arrayOfRecords(plan.milestones),
    blockers: arrayOfRecords(plan.blockers),
    watchedRisks: arrayOfRecords(plan.watchedRisks ?? plan.watched_risks),
    nextActions: arrayOfRecords(plan.nextActions ?? plan.next_actions),
    latestFeedback: readValue(plan, "latestFeedback", "latest_feedback"),
    updatedAt: readValue(plan, "updatedAt", "updated_at")
  };
}

function normalizeTask(task = {}) {
  return {
    id: readValue(task, "id"),
    title: readValue(task, "title"),
    owner: readValue(task, "owner"),
    status: readValue(task, "status") === unavailable ? "todo" : readValue(task, "status"),
    dueDate: readValue(task, "dueDate", "due_date"),
    priority: readValue(task, "priority"),
    description: readValue(task, "description"),
    blockedReason: readValue(task, "blockedReason", "blocked_reason"),
    updatedAt: readValue(task, "updatedAt", "updated_at")
  };
}

function readValue(object = {}, ...keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return unavailable;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
}

function arrayOfRecords(value) {
  return Array.isArray(value) ? value.filter(Boolean) : null;
}

function arrayOfStrings(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function RequirementSummary({ requirement, plan, stats, loading }) {
  return (
    <section className="planning-summary-card" aria-label="Requirement summary">
      <div className="planning-summary-title">
        <span className="planning-summary-icon" aria-hidden="true"><FileText size={30} /></span>
        <div>
          <h2>{requirement.title}</h2>
          <p><strong>Goal</strong>{requirement.goal}</p>
          {plan.exists ? <p><strong>Design plan</strong>{plan.title}</p> : null}
          {requirement.rawPmInput !== unavailable ? <p><strong>Raw PM input</strong>{requirement.rawPmInput}</p> : null}
        </div>
        <span className={`planning-status-pill ${plan.exists ? "active" : "pending"}`}>{loading ? "loading" : plan.exists ? planStatusLabel(plan.status) : "No design plan yet"}</span>
      </div>

      <dl className="planning-summary-meta">
        <div><dt>Requirement status</dt><dd>{requirement.status}</dd></div>
        <div><dt>Readiness</dt><dd>{String(requirement.readiness)}</dd></div>
        <div><dt>Handoff decision</dt><dd>{requirement.handoffDecision}</dd></div>
        <div><dt>Plan stage</dt><dd>{plan.currentStage}</dd></div>
        <div><dt>Plan owner</dt><dd>{plan.owner}</dd></div>
        <div><dt>Completion</dt><dd>{completionLabel(plan, stats)}</dd></div>
      </dl>
    </section>
  );
}

function EmptyDesignPlanState({ isCreating, onCreate }) {
  return (
    <section className="planning-card" data-testid="design-plan-empty">
      <div className="planning-card-header">
        <div>
          <h2>No design plan yet</h2>
          <p>The backend did not return a design plan for this requirement.</p>
        </div>
        <button type="button" onClick={onCreate} disabled={isCreating}>
          <Plus size={15} />
          {isCreating ? "Creating" : "Create Design Plan"}
        </button>
      </div>
    </section>
  );
}

function ErrorState({ message }) {
  const legacyMessage = message.startsWith("Design planning load failed:")
    ? ` Design planning legacy: 设计规划加载失败：${message.replace(/^Design planning load failed:\s*/, "").replace(/\s+\([^)]*\)$/, "")}`
    : "";
  return <p className="run-error-text" role="alert">ErrorState: {message}{legacyMessage}</p>;
}

function MilestonePanel({ plan, rawPlan, agentWorkflow = {}, isAgentRunStarting = false, hasTargetRepoPath = false }) {
  const milestones = plan.milestones;
  const agentRunMilestones = buildAgentRunMilestones({
    agentWorkflow,
    isAgentRunStarting,
    hasTargetRepoPath
  });
  return (
    <section className="planning-card milestone-panel" aria-label="Milestones">
      <h2>实施阶段 / 里程碑</h2>
      {Array.isArray(milestones) && milestones.length ? (
        <div className="milestone-timeline">
          {milestones.map((milestone, index) => (
            <article className={`milestone-item ${statusClass(milestone.status)}`} key={milestone.id || milestone.title || index}>
              <span className="milestone-node" aria-hidden="true" />
              <div>
                <div><h3>{textFromRecord(milestone, "title", "name")}</h3><time>{textFromRecord(milestone, "date", "dueDate", "due_date")}</time></div>
                <p>{textFromRecord(milestone, "description", "summary")}</p>
                <span>{textFromRecord(milestone, "status", "label")}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <UnavailableBlock label={rawPlan ? "Milestones unavailable" : "No persisted design plan"} />
      )}
      <section className="agent-run-milestones" aria-label="Agent run process" data-testid="agent-run-milestones">
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

function TaskBreakdownPanel({
  tasks,
  agentWorkflow = {},
  isAgentRunStarting = false,
  onPlanPreview,
  onStatusChange
}) {
  return (
    <section className="planning-card task-breakdown-panel" aria-label="Planning tasks">
      <div className="planning-card-header">
        <div>
          <h2>任务拆解清单 / Agent 工作矩阵</h2>
          <p>Task rows come from the planning task API. Agent execution remains available from this page.</p>
        </div>
        <button
          type="button"
          className="agent-primary-run-button"
          onClick={onPlanPreview}
          disabled={isAgentRunStarting}
        >
          {isAgentRunStarting ? <ClipboardList size={15} /> : <Play size={15} />}
          {isAgentRunStarting ? "Starting" : "Start real Agent run"}
        </button>
      </div>
      <AgentWorkMatrix agentWorkflow={agentWorkflow} isStarting={isAgentRunStarting} />
      <div className="task-breakdown-table">
        <div className="task-table-row task-table-head">
          <span>Task</span><span>Owner</span><span>Status</span><span>Due</span>
        </div>
        {tasks.length === 0 ? (
          <div className="task-table-row" data-testid="planning-tasks-empty">
            <span><em>0.</em>No planning tasks yet</span>
            <span>{unavailable}</span><span>{unavailable}</span><span>{unavailable}</span>
          </div>
        ) : tasks.map((item, index) => (
          <div className="task-table-row" key={item.id || item.title}>
            <span><em>{index + 1}.</em>{item.title}</span>
            <span><OwnerBadge owner={item.owner} /></span>
            <span><StatusSelect task={item} onStatusChange={onStatusChange} /></span>
            <span>{item.dueDate}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExecutionFeedbackPanel({ plan }) {
  return (
    <section className="planning-card execution-feedback-panel" aria-label="Latest feedback">
      <div className="planning-card-header">
        <h2>执行摘要 / 最新进展</h2>
      </div>
      <div className="execution-list">
        {plan.latestFeedback !== unavailable ? (
          <article className="execution-item active">
            <span className="execution-dot" aria-hidden="true" />
            <time>{plan.updatedAt}</time>
            <strong>Backend feedback</strong>
            <p>{plan.latestFeedback}</p>
          </article>
        ) : (
          <article className="execution-item pending">
            <span className="execution-dot" aria-hidden="true" />
            <time>{plan.updatedAt}</time>
            <strong>{unavailable}</strong>
            <p>latestFeedback was not returned by the backend.</p>
          </article>
        )}
      </div>
    </section>
  );
}

function AgentExecutionPanel({ agentWorkflow = {}, isStarting = false, hasTargetRepoPath = false, onContextPreview, onPlanPreview, onOpenReview, onOpenPr }) {
  const stageEvents = coalesceStageEvents(agentWorkflow.stageEvents, agentWorkflow.activityTimeline);
  const artifacts = Object.keys(agentWorkflow.artifacts || {});
  const statusInfo = resolveAgentPanelStatus(agentWorkflow, isStarting, hasTargetRepoPath);
  const latestStage = latestAgentStage(stageEvents);
  const latestSummary = latestAgentSummary(agentWorkflow, latestStage);
  const visibleArtifacts = buildAgentArtifactTags(agentWorkflow, artifacts);
  const targetPath = agentWorkflow.context?.targetRepoPath || agentWorkflow.context?.localPath || "";
  return (
    <section className="planning-card agent-execution-panel" aria-label="Real Agent run controls">
      <div className="planning-card-header">
        <div>
          <h2>真实 Agent run 控制台</h2>
          <p>Start Agent(2) against the selected repository. Backend errors are displayed as returned.</p>
        </div>
        <span className={`agent-status ${statusInfo.className}`}>{statusInfo.label}</span>
      </div>

      <div className="agent-orchestrator-layout">
        <section className="agent-status-summary" aria-label="Current Agent status">
          <span>Current status</span>
          <strong>{statusInfo.title}</strong>
          <p>{statusInfo.description}</p>
          {agentWorkflow.runId ? <small>Run: {agentWorkflow.runId}</small> : <small>No Agent run recorded yet</small>}
        </section>

        <section className="agent-safety-boundary" aria-label="Safety boundary">
          <span>Safety boundary</span>
          <ul>
            <li>executionMode: real</li>
            <li>realWritePerformed: {String(agentWorkflow.realWritePerformed === true)}</li>
            <li>Agent uses an isolated run workspace.</li>
            <li>{targetPath && targetPath !== "not_set" ? "Project path is available for isolated workspace creation." : "Project localPath is not set."}</li>
          </ul>
        </section>
      </div>

      <section className="agent-latest-return" aria-label="Latest Agent return">
        <div>
          <span>Latest Agent</span>
          <strong>{latestSummary.title}</strong>
        </div>
        <p>{latestSummary.detail}</p>
        {agentWorkflow.error ? <small>{agentWorkflow.error}</small> : null}
      </section>

      <section className="agent-artifact-strip" aria-label="Available artifacts">
        <span>Available artifacts</span>
        <div>
          {visibleArtifacts.length ? visibleArtifacts.map((artifact) => (
            <strong className={artifact.ready ? "ready" : "pending"} key={artifact.key}>{artifact.label}</strong>
          )) : <em>No artifacts yet</em>}
        </div>
      </section>

      <div className="agent-action-row">
        <button type="button" onClick={onContextPreview}><Eye size={15} />View Agent input context</button>
        <button type="button" onClick={onPlanPreview} disabled={isStarting}>
          {isStarting ? <ClipboardList size={15} /> : <Play size={15} />}
          {isStarting ? "Starting real Agent run" : "Start real Agent run"}
        </button>
        <button type="button" onClick={onOpenReview}><FileText size={15} />Open Review page</button>
        <button type="button" onClick={onOpenPr}><ClipboardList size={15} />Open PR page</button>
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
        <p className="monitor-empty-state">No real Agent run has started yet.</p>
      )}
    </section>
  );
}

function PlanningRightPanel({ plan, tasks, stats }) {
  const completion = plan.completion ?? stats.completion;
  return (
    <aside className="planning-right-panel" aria-label="Design planning status">
      <section className="planning-side-card progress-card">
        <h2>总体进度</h2>
        <div className="progress-layout">
          <div className="planning-progress-ring" style={{ "--planning-completion": `${completion}%` }}>
            <strong>{completion}%</strong><span>completion</span>
          </div>
          <div className="progress-legend">
            {stats.items.map((item) => (
              <div key={item.label}>
                <span className={`legend-dot ${item.status}`} />
                <strong>{item.label}</strong><em>{item.count} item(s)</em><small>{item.percent}%</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="planning-side-card current-stage-card">
        <div><h2>Plan status / stage</h2><span>Updated {plan.updatedAt}</span></div>
        <strong><span className="legend-dot active" />{planStatusLabel(plan.status)} / {plan.currentStage}</strong>
        <p>{plan.summary || "Design plan summary unavailable."}</p>
      </section>

      <section className="planning-side-card risk-planning-card">
        <h2>风险 / 阻塞项</h2>
        <div className="blocker-banner"><AlertTriangle size={17} /><strong>{countOrUnavailable(plan.blockers)} blocker(s)</strong><p>{firstRecordText(plan.blockers)}</p></div>
        <details open>
          <summary>Watched risks</summary>
          <RecordList records={plan.watchedRisks} emptyLabel="watchedRisks unavailable" />
        </details>
      </section>

      <section className="planning-side-card next-actions-card">
        <h2>Next actions</h2>
        <div>
          {Array.isArray(plan.nextActions) && plan.nextActions.length ? plan.nextActions.map((action, index) => (
            <article key={action.id || action.title || index}>
              <Circle size={18} />
              <span>{textFromRecord(action, "title", "description", "summary")}</span><strong>{textFromRecord(action, "priority", "status")}</strong>
            </article>
          )) : (
            <article>
              <Circle size={18} />
              <span>nextActions unavailable</span><strong>-</strong>
            </article>
          )}
        </div>
        <details>
          <summary>Task counts</summary>
          <p>Total {tasks.length}; done {stats.done}; running {stats.running}; blocked {stats.blocked}; high priority {stats.highPriority}.</p>
        </details>
      </section>
    </aside>
  );
}

function UnavailableBlock({ label }) {
  return <p className="monitor-empty-state">{label}: {unavailable}</p>;
}

function RecordList({ records, emptyLabel }) {
  if (!Array.isArray(records) || records.length === 0) return <ul><li>{emptyLabel}</li></ul>;
  return (
    <ul>
      {records.map((record, index) => <li key={record.id || record.title || index}>{textFromRecord(record, "title", "description", "summary", "message")}</li>)}
    </ul>
  );
}

function OwnerBadge({ owner }) {
  if (!owner || owner === unavailable) return <span className="owner-badge"><span>-</span>{unavailable}</span>;
  const label = owner === "PM" ? "PM" : String(owner).slice(0, 1);
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

function resolveAgentPanelStatus(agentWorkflow = {}, isStarting = false, hasTargetRepoPath = false) {
  if (isStarting || agentWorkflow.status === "running") {
    return {
      className: "active",
      label: "running",
      title: "Real Agent run is running",
      description: "Agent(2) is executing in the isolated workspace."
    };
  }
  if (agentWorkflow.error || agentWorkflow.status === "blocked" || agentWorkflow.status === "failed") {
    return {
      className: "blocked",
      label: "needs attention",
      title: "Real Agent run has not completed",
      description: "Check the latest backend error and retry when ready."
    };
  }
  if (agentWorkflow.runId) {
    return {
      className: "completed",
      label: "completed",
      title: "Real Agent run completed",
      description: "Review the isolated workspace changes or continue to the PR page."
    };
  }
  return {
    className: hasTargetRepoPath ? "ready" : "blocked",
    label: hasTargetRepoPath ? "ready" : "repo path missing",
    title: hasTargetRepoPath ? "Ready to start real Agent run" : "Project localPath unavailable",
    description: hasTargetRepoPath ? "The backend can create an isolated workspace for this repository." : "Clicking Start will show the missing repo path error without calling Agent run."
  };
}

function latestAgentStage(stageEvents = []) {
  return [...stageEvents].reverse().find((stage) => stage.status && stage.status !== "idle") || stageEvents.at(-1) || null;
}

function latestAgentSummary(agentWorkflow = {}, latestStage = null) {
  if (!agentWorkflow.runId && !agentWorkflow.latestReturn) {
    return {
      title: "No real Agent run yet",
      detail: "Start real Agent run to record backend activity and artifacts here."
    };
  }
  if (agentWorkflow.error) {
    return {
      title: "Latest generation failed",
      detail: agentWorkflow.latestReturn || "Check backend error details and retry."
    };
  }
  if (latestStage) {
    return {
      title: `${latestStage.agent || latestStage.title || "Agent stage"}: ${stageStatusLabel(latestStage.status)}`,
      detail: latestStage.summary || agentWorkflow.latestReturn || "Stage status was synced from the real run record."
    };
  }
  return {
    title: agentWorkflow.runId ? "Real Agent run recorded" : "Agent input ready",
    detail: agentWorkflow.latestReturn || "Waiting for real Agent run."
  };
}

function buildAgentArtifactTags(agentWorkflow = {}, artifactKeys = []) {
  return [
    { key: "context", label: "Agent input context", ready: Boolean(agentWorkflow.context) },
    { key: "plan", label: "Execution plan", ready: Boolean(agentWorkflow.plan || artifactKeys.some((key) => /plan/i.test(key))) },
    { key: "review", label: "Review", ready: Boolean(agentWorkflow.review || agentWorkflow.reviewResult) },
    { key: "pr", label: "PR draft", ready: Boolean(agentWorkflow.prDraft) },
    { key: "artifacts", label: "Run artifacts", ready: artifactKeys.length > 0 }
  ].filter((item) => item.ready);
}

function stageStatusLabel(status) {
  if (status === "completed") return "completed";
  if (status === "running") return "running";
  if (status === "blocked") return "blocked";
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  return "idle";
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
      title: "Real Agent run",
      detail: isRunning ? "Agent(2) is running in the isolated workspace." : hasRun ? `Run recorded: ${agentWorkflow.runId}` : "Run not started.",
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
      status: artifacts.length ? "completed" : hasRun || executionBlocked ? "blocked" : "pending"
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

function isAgentExecutionBlocked(agentWorkflow = {}) {
  const executionResult = agentWorkflow.executionResult || extractExecutionResultFromArtifacts(agentWorkflow.artifacts || {});
  const summary = String(executionResult?.summary || "");
  return agentWorkflow.runId && agentWorkflow.realWritePerformed !== true && (
    agentWorkflow.review?.status === "blocked" ||
    executionResult?.executed === false && /blocked|not approved|missing review/i.test(summary)
  );
}

function summarizeTasks(tasks) {
  const total = tasks.length;
  const groups = [
    ["Done", "done", "completed"],
    ["Running", "running", "active"],
    ["Todo", "todo", "pending"],
    ["Blocked", "blocked", "blocked"]
  ].map(([label, status, className]) => {
    const count = tasks.filter((task) => task.status === status).length;
    return { label, count, percent: total ? Math.round((count / total) * 100) : 0, status: className };
  });
  const done = tasks.filter((task) => task.status === "done").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const highPriority = tasks.filter((task) => /^p0|p1|high$/i.test(String(task.priority || ""))).length;
  const completion = total ? Math.round((done / total) * 100) : 0;
  return { items: groups, total, done, running, blocked, highPriority, completion };
}

function completionLabel(plan, stats) {
  if (plan.completion !== null) return `${plan.completion}%`;
  return `${stats.completion}% from ${stats.total} task(s)`;
}

function planStatusLabel(status) {
  return status && status !== unavailable ? status : unavailable;
}

function countOrUnavailable(records) {
  return Array.isArray(records) ? records.length : unavailable;
}

function firstRecordText(records) {
  if (!Array.isArray(records) || records.length === 0) return "blockers unavailable";
  return textFromRecord(records[0], "title", "description", "summary", "message");
}

function textFromRecord(record = {}, ...keys) {
  if (typeof record === "string") return record;
  return readValue(record, ...keys);
}

function statusClass(status) {
  if (status === "done" || status === "completed") return "completed";
  if (status === "running" || status === "needs_review" || status === "active") return "active";
  if (status === "blocked" || status === "cancelled" || status === "failed") return "blocked";
  return "pending";
}

function formatApiError(prefix, error) {
  const code = error?.payload?.error?.code;
  const message = error?.payload?.error?.message || error?.message || "Persistence API request failed";
  return code ? `${prefix}: ${message} (${code})` : `${prefix}: ${message}`;
}

function buildAgentRequirementDsl(requirement = {}, plan = null, tasks = []) {
  const dsl = requirement?.dslJson && typeof requirement.dslJson === "object" ? requirement.dslJson : requirement?.dsl_json && typeof requirement.dsl_json === "object" ? requirement.dsl_json : {};
  const taskTitle = requirement?.title || dsl.title || dsl.task_name || plan?.title || "Workbench requirement implementation";
  const rawPmInput = requirement?.rawPmInput || requirement?.raw_pm_input || dsl.rawPmInput || dsl.user_story || dsl.description || taskTitle;
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
  return /theme|style|css|palette|dark|red|black|ui/i.test(String(text || ""));
}
