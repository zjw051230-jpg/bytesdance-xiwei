import AgentStageCard, { normalizeStatus } from "./AgentStageCard.jsx";

const agentBlueprint = [
  {
    agent: "RequirementAgent",
    title: "读取 RequirementDSL / 用户需求",
    summary: "等待需求上下文进入 Agent 编排",
    output: "需求摘要 / DSL context"
  },
  {
    agent: "ReadinessAgent",
    title: "检查 dry-run / real-run gate",
    summary: "等待 readiness gate 检查",
    output: "readiness gate"
  },
  {
    agent: "ContextAgent",
    title: "编译 Agent 上下文包",
    summary: "等待 Requirement、项目和目标仓库上下文",
    output: "context package"
  },
  {
    agent: "PlannerAgent",
    title: "生成执行计划",
    summary: "等待上下文完成",
    output: "agent plan"
  },
  {
    agent: "LocatorAgent",
    title: "定位候选文件",
    summary: "等待计划生成",
    output: "file locator result"
  },
  {
    agent: "PatchPlanAgent",
    title: "生成 patch plan",
    summary: "等待文件定位",
    output: "patch plan"
  },
  {
    agent: "ReviewAgent",
    title: "审阅变更风险",
    summary: "等待 patch plan",
    output: "review items"
  },
  {
    agent: "PRDraftAgent",
    title: "整理 PR 草稿",
    summary: "等待审阅结果",
    output: "PR draft"
  },
  {
    agent: "ArtifactAgent",
    title: "收集 run artifacts",
    summary: "等待 run artifacts",
    output: "artifact bundle"
  },
  {
    agent: "SummaryAgent",
    title: "汇总执行结果",
    summary: "等待所有阶段完成",
    output: "final summary"
  }
];

export default function AgentWorkMatrix({ agentWorkflow = {}, isStarting = false }) {
  const stageEvents = Array.isArray(agentWorkflow?.stageEvents)
    ? agentWorkflow.stageEvents
    : Array.isArray(agentWorkflow?.activityTimeline)
      ? agentWorkflow.activityTimeline
      : [];
  const stages = buildAgentStages(stageEvents, agentWorkflow, isStarting);
  const runningAgent = stages.find((stage) => stage.status === "running")?.agent || "";
  const runState = getRunState(agentWorkflow, stages, isStarting);

  return (
    <section className="agent-work-matrix" aria-label="Agent 工作矩阵" data-testid="agent-work-matrix">
      <div className="agent-work-matrix-header">
        <div>
          <h3>Agent 工作矩阵</h3>
          <p>{getRunStateMessage(runState, runningAgent)}</p>
        </div>
        <span className={`agent-matrix-run-state ${agentWorkflow?.status || "idle"}`}>
          {agentWorkflow?.runId || "No run"}
        </span>
      </div>
      <div className="agent-work-grid">
        {stages.map((stage) => <AgentStageCard stage={stage} key={stage.agent} />)}
      </div>
    </section>
  );
}

function buildAgentStages(stageEvents, agentWorkflow, isStarting) {
  const runFinished = isTerminalRun(agentWorkflow) || agentWorkflow?.realWritePerformed === true;
  const eventMap = new Map();
  for (const event of stageEvents) {
    const key = normalizeAgentKey(event?.agent || event?.name || event?.key || event?.title);
    if (!key || eventMap.has(key)) continue;
    eventMap.set(key, event);
  }

  const stages = agentBlueprint.map((blueprint, index) => {
    const event = findEventForAgent(eventMap, blueprint.agent);
    const status = normalizeStatus(event?.status || inferDefaultStatus({ index, agentWorkflow, isStarting, runFinished }));
    return {
      ...blueprint,
      ...(event || {}),
      agent: blueprint.agent,
      title: event?.title || blueprint.title,
      summary: event?.summary || event?.message || blueprint.summary,
      status,
      output: event?.output || event?.artifact || event?.artifactName || event?.result || event?.product || blueprint.output,
      errorSummary: event?.errorSummary || event?.error || event?.blockedReason || ""
    };
  });

  const normalizedStages = normalizeCompletedRunStages(stages, { runFinished });
  if (isStarting && !runFinished && !normalizedStages.some((stage) => stage.status === "running")) {
    return normalizedStages.map((stage, index) => index === 0 ? { ...stage, status: "running", summary: "Agent run 正在启动" } : stage);
  }
  return normalizedStages;
}

function inferDefaultStatus({ agentWorkflow = {}, isStarting, runFinished }) {
  if (runFinished) return "idle";
  if (isStarting || isRunningRun(agentWorkflow)) return "idle";
  if (agentWorkflow?.status === "blocked" || agentWorkflow?.status === "failed") return "idle";
  return "idle";
}

function normalizeCompletedRunStages(stages, { runFinished = false } = {}) {
  const summaryCompleted = stages.some((stage) => stage.agent === "SummaryAgent" && stage.status === "completed");
  if (!runFinished && !summaryCompleted) return stages;
  return stages.map((stage) => {
    if (!["completed", "failed", "blocked", "skipped"].includes(stage.status)) {
      return { ...stage, status: "completed" };
    }
    return stage;
  });
}

function getRunState(agentWorkflow = {}, stages = [], isStarting = false) {
  const hasStageWork = stages.some((stage) => stage.status !== "idle");
  if (!agentWorkflow?.runId && !hasStageWork) return "idle";
  if (agentWorkflow?.status === "failed" || stages.some((stage) => stage.status === "failed")) return "failed";
  if (agentWorkflow?.status === "blocked" || stages.some((stage) => stage.status === "blocked")) return "blocked";
  if (isTerminalRun(agentWorkflow) || agentWorkflow?.realWritePerformed === true) return "completed";
  if (stages.some((stage) => stage.agent === "SummaryAgent" && stage.status === "completed")) return "completed";
  if (isStarting || isRunningRun(agentWorkflow) || stages.some((stage) => stage.status === "running")) return "running";
  return agentWorkflow?.runId ? "completed" : "idle";
}

function getRunStateMessage(runState, runningAgent) {
  if (runState === "running" && runningAgent) return `${runningAgent} 正在工作`;
  if (runState === "running") return "Agent run 正在工作";
  if (runState === "completed") return "Agent run 已完成";
  if (runState === "failed") return "Agent run 失败";
  if (runState === "blocked") return "Agent run 已阻断";
  return "等待 Agent run 或 stageEvents";
}

function isTerminalRun(agentWorkflow = {}) {
  const status = String(agentWorkflow?.status || "").toLowerCase();
  return ["completed", "finished", "done", "success", "passed", "no_changes", "cancelled"].includes(status);
}

function isRunningRun(agentWorkflow = {}) {
  const status = String(agentWorkflow?.status || "").toLowerCase();
  return ["running", "processing", "generating", "queued", "active", "in_progress", "working"].includes(status);
}

function findEventForAgent(eventMap, agentName) {
  const direct = eventMap.get(normalizeAgentKey(agentName));
  if (direct) return direct;
  const simplified = normalizeAgentKey(agentName.replace(/Agent$/i, ""));
  return [...eventMap.entries()].find(([key]) => key.includes(simplified) || simplified.includes(key))?.[1] || null;
}

function normalizeAgentKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
