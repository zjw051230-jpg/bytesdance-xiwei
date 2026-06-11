export const initialAgentWorkflowState = {
  status: "idle",
  runId: "",
  latestReturn: "No real agent run has been started.",
  readiness: null,
  context: null,
  plan: null,
  review: null,
  prDraft: null,
  artifacts: {},
  workspace: null,
  workspacePath: "",
  sourceRepoPath: "",
  targetRepoPath: "",
  error: null
};

export const agentStatusLabels = {
  idle: "idle",
  ready: "ready",
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  needs_review: "needs_review"
};
