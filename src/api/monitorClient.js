import {
  getDesignPlan,
  getPersistentAgentRun,
  getPrDraft,
  listAgentArtifacts,
  listPlanningTasks,
  listProjectActivity,
  listRequirements,
  listReviewItems
} from "./persistenceClient.js";

export async function loadMonitorConsoleData({ projects = [], activeProjectId = "" } = {}) {
  const activeProject = projects.find((project) => project.id === activeProjectId) || projects[0] || null;
  if (!activeProject?.id || /^pending-/.test(String(activeProject.id))) {
    return emptyMonitorData(activeProject);
  }

  const [requirementsResult, activityResult] = await Promise.allSettled([
    listRequirements(activeProject.id),
    listProjectActivity(activeProject.id)
  ]);
  const requirements = valueOrEmptyArray(requirementsResult);
  const activity = valueOrEmptyArray(activityResult);
  const latestRequirement = requirements[0] || null;
  const latestRunId = activity.find((item) => item.runId)?.runId || "";

  const [designPlanResult, agentRunResult, prDraftResult] = await Promise.allSettled([
    latestRequirement?.id ? getDesignPlan(latestRequirement.id) : Promise.resolve(null),
    latestRunId ? getPersistentAgentRun(latestRunId) : Promise.resolve(null),
    latestRequirement?.id ? getPrDraft(latestRequirement.id) : Promise.resolve(null)
  ]);
  const designPlan = valueOrNull(designPlanResult);
  const agentRun = valueOrNull(agentRunResult);
  const runId = agentRun?.runId || agentRun?.id || latestRunId;

  const [planningTasksResult, artifactsResult, reviewResult] = await Promise.allSettled([
    designPlan?.id ? listPlanningTasks(designPlan.id) : Promise.resolve([]),
    runId ? listAgentArtifacts(runId) : Promise.resolve([]),
    runId ? listReviewItems(runId) : Promise.resolve([])
  ]);

  return {
    activeProject,
    requirements,
    activity,
    designPlan,
    planningTasks: valueOrEmptyArray(planningTasksResult),
    agentRun,
    agentArtifacts: normalizeArtifacts(valueOrNull(artifactsResult)),
    reviewItems: valueOrEmptyArray(reviewResult),
    prDraft: valueOrNull(prDraftResult)
  };
}

function emptyMonitorData(activeProject = null) {
  return {
    activeProject,
    requirements: [],
    activity: [],
    designPlan: null,
    planningTasks: [],
    agentRun: null,
    agentArtifacts: [],
    reviewItems: [],
    prDraft: null
  };
}

function valueOrEmptyArray(result) {
  return result.status === "fulfilled" && Array.isArray(result.value) ? result.value : [];
}

function valueOrNull(result) {
  return result.status === "fulfilled" ? result.value : null;
}

function normalizeArtifacts(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.artifactList)) return value.artifactList;
  return [];
}
